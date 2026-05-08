---
title: "@mochi.js/consistency"
description: The Matrix engine — deriveMatrix, the rule DAG, the seeded PRNG.
order: 2
category: api
lastUpdated: 2026-05-09
---

The relational locking engine. `deriveMatrix(profile, seed)` produces a `MatrixV1` — the structured snapshot consumed by `@mochi.js/inject`.

## Public surface

- `deriveMatrix(profile: ProfileV1, seed: string): MatrixV1` — pure. Same inputs → byte-identical output (excluding `derivedAt`).
- `CONSISTENCY_ENGINE_VERSION` — the engine version stamp (changes whenever the rule DAG changes).
- `VERSION` — the npm package version (`0.1.0` at the time of this page).

## Types

- `ProfileV1` — the device-class spec. Source-of-truth for both this package and `@mochi.js/profiles`.
- `MatrixV1` — the concrete `(profile, seed)` instantiation. Generated from `schemas/matrix.schema.json`.
- `Rule` — the shape of a single rule in the DAG. Useful for downstream packages that introspect the ruleset.
- `SeededPrng` — the `xoshiro256**` primitive shared with `@mochi.js/behavioral`. Same seed → same sequence.

## Sub-export `@mochi.js/consistency/prng`

For consumers that want the seeded PRNG without the rule DAG:

```ts
import { makeXoshiro256ss, seedToPrng } from "@mochi.js/consistency/prng";

const prng = seedToPrng("my-seed-string");
prng(); // deterministic float in [0, 1)
```

## Error classes

- `RuleDagCycleError` — thrown at engine load time if a rule introduces a cycle.
- `DuplicateOutputError` — thrown when two rules try to write the same Matrix path.
- `MissingInputError` — thrown when a rule reads a path no other rule produces.

All three are CI-checked via the rule-DAG validation tests; they shouldn't fire at runtime unless you've patched the ruleset locally.

## Determinism contract

- `deriveMatrix(profile, seed)` is pure. Same inputs → same output, bit-for-bit, **excluding the `derivedAt` ISO timestamp**.
- Different `(profile.id, seed)` pairs produce isolated PRNG sequences. Reusing a seed across profiles is safe.
- The rule DAG is validated for acyclicity and unique outputs once per process the first time `deriveMatrix` is called.
