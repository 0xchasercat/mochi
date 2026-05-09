---
title: "@mochi.js/consistency"
description: "The Matrix engine — deriveMatrix, ProfileV1, MatrixV1, the rule DAG, the seeded xoshiro256** PRNG."
order: 2
category: api
lastUpdated: 2026-05-09
---

The relational locking engine. `deriveMatrix(profile, seed)` walks a topologically-sorted rule DAG over a seeded xoshiro256** PRNG and returns a `MatrixV1` — the structured fingerprint snapshot that `@mochi.js/core` stamps on the `Session` and that `@mochi.js/inject` reads to compile the IIFE payload. You almost never call `deriveMatrix` yourself; `mochi.launch` does it. Reach for this package directly only when (a) you're writing an inject module that needs to introspect a derived matrix in a test, (b) you want the seeded PRNG without the rule DAG, or (c) you're debugging a divergence between two `(profile, seed)` runs.

## Installation

```sh
bun add @mochi.js/consistency
```

## Public exports

### `function deriveMatrix(profile: ProfileV1, seed: string): MatrixV1`

Pure. Same `(profile.id, seed)` produces a byte-identical `MatrixV1`, **excluding the `derivedAt` ISO timestamp**. Different `profile.id`s with the same `seed` produce isolated PRNG sequences (cross-profile isolation, PLAN.md I-5).

```ts
import { deriveMatrix, type ProfileV1 } from "@mochi.js/consistency";

const profile: ProfileV1 = JSON.parse(
  await Bun.file("./packages/profiles/data/linux-chrome-stable/profile.json").text(),
);
const matrix = deriveMatrix(profile, "user-12345");
console.log(matrix.userAgent);     // "Mozilla/5.0 (X11; Linux ..."
console.log(matrix.timezone);      // e.g. "Europe/Berlin"
```

The rule DAG is validated for acyclicity + unique outputs once per process the first time `deriveMatrix` is called. Subsequent calls use the cached topological plan.

### `type ProfileV1`

The device-class spec the consistency engine consumes. Generated from `schemas/profile.schema.json`. Carries the captured baseline (UA, OS, GPU strings, audio sample-rate, font baseline list, …) plus the entropy budget the rule DAG draws from. `@mochi.js/profiles` ships pre-captured profiles under `data/<id>/profile.json`.

The shape is large and entirely schema-driven — read the JSON Schema or look at any shipped profile (e.g. `packages/profiles/data/linux-chrome-stable/profile.json`) for the canonical layout.

### `type MatrixV1`

The concrete `(profile, seed)` instantiation — what `Session.profile` exposes. Carries every field the inject pipeline reads:

```ts
// Selected fields (the schema is the canonical source of truth):
matrix.id                  // profile id
matrix.seed                // input seed (echoed)
matrix.derivedAt           // ISO timestamp; NOT determinism-stable
matrix.consistencyEngineVersion // bumped per rule-DAG change
matrix.userAgent           // string
matrix.uaCh                // Record<string, string> — "sec-ch-ua", etc.
matrix.locale              // BCP-47, e.g. "en-US"
matrix.languages           // string[]
matrix.timezone            // IANA, e.g. "Europe/Berlin"
matrix.display             // { width, height, dpr, colorDepth, pixelDepth }
matrix.gpu                 // { vendor, renderer, webglUnmaskedVendor, ... }
matrix.audio               // { contextSampleRate, ... }
matrix.fonts               // { family, list }
matrix.behavior            // { hand, tremor, wpm, scrollStyle }
matrix.wreqPreset          // DEPRECATED in 0.7 — runtime ignores; kept in the schema for back-compat.
```

Generated from `schemas/matrix.schema.json`.

### `const CONSISTENCY_ENGINE_VERSION: string`

The engine version stamp on every derived matrix. Currently `"0.2.0"`. Bumped whenever rule semantics change in a way that produces a different output for the same `(profile, seed)` — distinct from the package's `VERSION` so the engine can version its output independently of the npm release lifecycle.

### `const VERSION: string`

The npm package version.

### `const RULES: readonly Rule[]`

The full rule list (R-001..R-048 at the time of this page). Each entry is a `Rule` with `{ id, description, inputs, output, derive }`. Useful for tests asserting rule shape, doc generators, or external tooling that wants to enumerate the locks. The engine sorts these topologically before deriving.

### `interface Rule`

```ts
interface Rule {
  readonly id: string;            // e.g. "R-001"
  readonly description: string;
  readonly inputs: readonly string[]; // dotted paths into the matrix-under-construction
  readonly output: string;            // dotted path the rule writes (must be unique)
  readonly derive: (inputs: readonly unknown[], prng: SeededPrng) => unknown;
}
```

### Seeded PRNG

```ts
interface SeededPrng {
  nextU64(): bigint;
  nextU32(): number;
  nextFloat01(): number;
  nextIntInclusive(lo: number, hi: number): number;
  pick<T>(arr: readonly T[]): T;
  nextHex(byteLength: number): string;
}
function makeXoshiro256ss(state: readonly [bigint, bigint, bigint, bigint]): SeededPrng;
function deriveSeedState(profileId: string, seed: string): readonly [bigint, bigint, bigint, bigint];
function seedToPrng(profileId: string, seed: string): SeededPrng;
```

`seedToPrng(profileId, seed)` hashes `${profileId}:${seed}` with SHA-256 (Bun.CryptoHasher), slices the 32-byte digest into four little-endian u64 words, and constructs the `xoshiro256**` state. Different `profileId`s produce isolated sequences even with the same `seed`. The package exposes `@mochi.js/consistency/prng` as a sub-export so consumers (notably `@mochi.js/behavioral`) can pull the PRNG without dragging in the rule DAG.

```ts
import { seedToPrng } from "@mochi.js/consistency/prng";

const prng = seedToPrng("linux-chrome-stable", "user-12345");
prng.nextFloat01();          // [0, 1)
prng.nextIntInclusive(1, 6); // [1, 6]
prng.pick(["a", "b", "c"]);  // deterministic pick
```

### Error classes

```ts
class RuleDagCycleError extends Error  { /* cycle in the rule DAG */ }
class DuplicateOutputError extends Error { /* two rules write the same path */ }
class MissingInputError extends Error  { /* rule reads a path no rule produces */ }
```

All three are CI-checked at engine load time; they shouldn't fire at runtime unless you've patched the rule list locally.

## Common patterns

### Verify a matrix is byte-stable across runs

```ts
import { deriveMatrix } from "@mochi.js/consistency";

const a = deriveMatrix(profile, "u1");
const b = deriveMatrix(profile, "u1");
const sa = JSON.stringify({ ...a, derivedAt: undefined });
const sb = JSON.stringify({ ...b, derivedAt: undefined });
if (sa !== sb) throw new Error("matrix not deterministic — investigate rule DAG");
```

### Reuse the seeded PRNG outside the rule DAG

```ts
import { seedToPrng } from "@mochi.js/consistency/prng";

const prng = seedToPrng("my-tool", "run-2026-05-09");
// Same (profileId, seed) → same sequence; safe across processes.
const noise = Array.from({ length: 8 }, () => prng.nextFloat01());
```

### Enumerate the rule DAG

```ts
import { RULES } from "@mochi.js/consistency";

console.log(`${RULES.length} rules registered`);
for (const r of RULES) {
  console.log(`${r.id} writes ${r.output} from [${r.inputs.join(", ")}]`);
}
```

## Errors

| Class | When it fires | How to recover |
| --- | --- | --- |
| `RuleDagCycleError` | Two rules form a cycle in the input/output graph | Don't ship a custom rule list; if you did, break the cycle |
| `DuplicateOutputError` | Two rules declare the same `output` path | Audit rule ids; output paths must be unique |
| `MissingInputError` | A rule reads an input no other rule produces | Add the producer rule or remove the dangling input |

## See also

- [Concepts → Consistency engine](/docs/concepts/consistency-engine)
- [Concepts → Profiles](/docs/concepts/profiles)
- [API → @mochi.js/profiles](/docs/api/profiles)
- [API → @mochi.js/inject](/docs/api/inject)
- [API → @mochi.js/behavioral](/docs/api/behavioral)
- [Reference → Invariants](/docs/reference/invariants)

<!-- llm-context:start
Package: @mochi.js/consistency
Public surface (verbatim from packages/consistency/src/index.ts as of 2026-05-09):

  VERSION                                            (const string, "0.2.1")
  deriveMatrix(profile: ProfileV1, seed: string): MatrixV1
  CONSISTENCY_ENGINE_VERSION                         (const, "0.2.0")
  DuplicateOutputError                               (class)
  MissingInputError                                  (class)
  RuleDagCycleError                                  (class)
  MatrixV1                                           (type, generated from schemas/matrix.schema.json)
  ProfileV1                                          (type, generated from schemas/profile.schema.json)
  deriveSeedState(profileId, seed): readonly [bigint, bigint, bigint, bigint]
  seedToPrng(profileId, seed): SeededPrng
  makeXoshiro256ss(state): SeededPrng
  SeededPrng                                         (interface)
  Rule                                               (interface)
  RULES: readonly Rule[]

Sub-exports:
  @mochi.js/consistency/prng                         — re-exports seedToPrng, makeXoshiro256ss, deriveSeedState, SeededPrng

SeededPrng interface methods:
  nextU64(): bigint
  nextU32(): number
  nextFloat01(): number
  nextIntInclusive(lo: number, hi: number): number
  pick<T>(arr: readonly T[]): T
  nextHex(byteLength: number): string

Determinism contract:
  - deriveMatrix(profile, seed) is pure given (profile, seed)
  - byte-identical MatrixV1 except `derivedAt` ISO timestamp
  - Different profile.id with same seed → isolated PRNG sequences

Common LLM hallucinations (DO NOT USE):
- `deriveMatrix(profileId)` — single-arg form does not exist; both `profile` and `seed` required
- `Matrix.fromProfile(...)` — class-method form not exposed
- `MatrixV1.validate(matrix)` / Zod schema export — types are JSON-Schema-derived, no runtime validator exposed
- `loadProfile(id)` — lives in @mochi.js/harness, not here
- `getProfile(id)` — lives in @mochi.js/profiles, not here. Returns Promise<ProfileV1>; throws UnknownProfileIdError or ProfileBaselineMissingError.
- `RULES.find(r => r.id === "R-001").apply(...)` — Rule.derive takes (inputs[], prng), not the matrix; not for direct user invocation
- `Math.random` based PRNG — uses xoshiro256** seeded from SHA-256(`${profileId}:${seed}`), not Math.random
- `defineRule(...)` is exported from `./rule` but NOT from the package barrel — internal authoring helper

Cross-references:
- /docs/concepts/consistency-engine
- /docs/concepts/profiles
- /docs/api/core
- /docs/api/inject
- /docs/api/profiles
- /docs/api/behavioral
llm-context:end -->
