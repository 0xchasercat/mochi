---
title: "@mochi.js/inject"
description: "Stealth payload builder — buildPayload(matrix) → IIFE source + sha256 of the spoof bundle."
order: 3
category: api
lastUpdated: 2026-05-09
---

`buildPayload(matrix)` composes the per-API spoof modules (navigator, screen, webgl, client-hints, timing, fonts, audio-fingerprint, canvas-fingerprint, …) into a single IIFE that `@mochi.js/core` delivers via the dual-mechanism inject pipeline (Fetch.fulfillRequest body splice on Document responses, `Page.addScriptToEvaluateOnNewDocument({ runImmediately: true, worldName: "" })` fallback for `about:blank` / `data:` / `blob:`). You almost never call this yourself — `Session` builds and installs the payload at construction. Reach for it directly only when you're (a) writing a contract test that pins payload bytes per matrix, (b) inspecting the IIFE in DevTools, or (c) building a custom orchestrator that's not the standard `mochi.launch` path.

## Installation

```sh
bun add @mochi.js/inject
```

## Public exports

### `function buildPayload(matrix: MatrixV1): PayloadResult`

```ts
function buildPayload(matrix: MatrixV1): PayloadResult;
```

Pure function of `MatrixV1`. Produces the IIFE source + a hex-encoded SHA-256 of that source. Same matrix (excluding `derivedAt`) → byte-identical `code` → identical `sha256`. Module composition order is fixed; changing it changes every downstream sha256 pin in the harness.

```ts
import { buildPayload } from "@mochi.js/inject";
import { deriveMatrix } from "@mochi.js/consistency";

const matrix = deriveMatrix(profile, "user-12345");
const { code, sha256 } = buildPayload(matrix);
console.log(`payload: ${code.length} chars, sha256 ${sha256}`);
// → payload: 27000 chars, sha256 e3b0c44298fc1c149afbf4c8996fb924...
```

### `interface PayloadResult`

```ts
interface PayloadResult {
  readonly code: string;    // the IIFE source
  readonly sha256: string;  // hex-encoded SHA-256 of `code`
}
```

- `code` — feed straight to `Page.addScriptToEvaluateOnNewDocument({ source, runImmediately: true, worldName: "" })`, or to a `Fetch.fulfillRequest` body splice, or to `Runtime.callFunctionOn` against worker targets (wrapped as `function() { ${code} }`).
- `sha256` — used by the contract test (`tests/contract/inject-payload.contract.test.ts`) to pin payload bytes per matrix and by the harness for change detection.

### `const VERSION: string`

The npm package version.

## Module composition

The IIFE layout is fixed:

1. IIFE prologue — `(function () {`
2. Banner comment block (engine version, profile id, seed — useful in DevTools dumps; deliberately omits `derivedAt`).
3. `'use strict';`
4. Runtime helpers — `defineProperty` cloak + `toString` cloak.
5. Spoof modules (18 total), each wrapped in `try { /* mochi:<name> */ ... } catch (_e) {}` so a single module's failure can't take down the rest:
   - `navigator`, `screen`, `webgl`, `client-hints`, `timing`, `bot-globals`, `fonts`
   - `media-devices`, `network-info`, `permissions`, `screen-orientation`, `webgpu`
   - `window-chrome`, `plugins`, `mouse-event-screen`
   - `audio-fingerprint`, `canvas-fingerprint`
   - `performance-timing` — `PerformanceNavigationTiming` `dns` / `tcp` / `secureConnectionStart` / `nextHopProtocol` overrides. Closes the pipe-mode-launch zero-handshake leak (cold loads under `--remote-debugging-pipe` would emit `domainLookupStart === domainLookupEnd`, `connectStart === connectEnd`, `nextHopProtocol === ""` — a documented headless tell).
6. Self-delete tail — sweeps `__mochi*` keys off `window` (belt-and-braces; the modules don't actually leak there).
7. IIFE epilogue — `})();`

Soft size budget: 80 KB. `buildPayload` `console.warn`s if exceeded but never throws. Measured size at v0.3 is ~30 KB unminified.

## Stealth invariants enforced at build time

- **Single IIFE.** No top-level identifiers escape.
- **Per-module `try`/`catch`.** A thrown spoof never reaches page script.
- **No `Date.now()`, no `Math.random()`, no env reads.** The build is deterministic per matrix.
- **No `console.log` / `console.warn` from spoof modules.** Page script must never observe inject-side output.
- **Empty `worldName`** at install time. Naming an isolated world (PLAN.md §8.4) is detectable; `runImmediately: true` is non-negotiable.

The CDP-layer `Runtime.enable` ban (PLAN.md §8.2) is enforced by `@mochi.js/core`'s `assertNotForbidden`, not by inject — see [Reference → Invariants](/docs/reference/invariants).

## Common patterns

### Pin payload bytes in a contract test

```ts
import { buildPayload } from "@mochi.js/inject";
import { deriveMatrix } from "@mochi.js/consistency";
import { test, expect } from "bun:test";

test("payload sha256 stable for (linux-chrome-stable, harness)", async () => {
  const profile = JSON.parse(
    await Bun.file("./packages/profiles/data/linux-chrome-stable/profile.json").text(),
  );
  const matrix = deriveMatrix(profile, "harness");
  const { sha256 } = buildPayload(matrix);
  expect(sha256).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
});
```

### Inspect the bundle in a doc generator

```ts
const { code } = buildPayload(matrix);
const head = code.slice(0, 200);
const moduleMarkers = [...code.matchAll(/\/\* mochi:([\w-]+) \*\//g)].map((m) => m[1]);
console.log(`modules included: ${moduleMarkers.join(", ")}`);
```

## See also

- [Concepts → Inject pipeline](/docs/concepts/inject-pipeline)
- [Concepts → Consistency engine](/docs/concepts/consistency-engine)
- [API → @mochi.js/consistency](/docs/api/consistency)
- [API → @mochi.js/core](/docs/api/core)
- [Reference → Invariants](/docs/reference/invariants)
- [Reference → Limits](/docs/reference/limits)

<!-- llm-context:start
Package: @mochi.js/inject
Public surface (verbatim from packages/inject/src/index.ts as of 2026-05-09):

  VERSION                                          (const string, "0.1.0")
  buildPayload(matrix: MatrixV1): PayloadResult    (function)
  PayloadResult                                    (interface { code: string; sha256: string })

That is the entire public surface. Internal-only:
  - emit*Module helpers (one per spoof module) live under packages/inject/src/modules/
  - emitDefinePropertyHelper, emitToStringCloak (runtime helpers)
  - All are NOT exported from the barrel.

Note: `wrapSelfRemovingPayload(code)` is in @mochi.js/core (packages/core/src/cdp/init-injector.ts), NOT @mochi.js/inject.

Common LLM hallucinations (DO NOT USE):
- `buildInjectScript(matrix)` / `buildScript(matrix)` — function is named `buildPayload`
- `PayloadResult.source` — field is `code`, not `source`
- `PayloadResult.bytes` — does not exist; compute `new TextEncoder().encode(code).length` yourself
- `PayloadResult.modules` / `PayloadResult.hash` — fields are `code` and `sha256` only
- `installPayload(page, code)` / `injectPayload(page)` — the install path lives in @mochi.js/core; users do not install payloads themselves
- `wrapSelfRemovingPayload` — exported from @mochi.js/core/cdp/init-injector, not from @mochi.js/inject
- `emitNavigatorModule` / per-module emitters as named exports — internal only
- Synchronous build that hits the network — buildPayload is pure; no I/O
- `buildPayload({ minify: true })` — no options bag; takes only a `MatrixV1`

Cross-references:
- /docs/concepts/inject-pipeline
- /docs/concepts/consistency-engine
- /docs/api/consistency
- /docs/api/core
- /docs/reference/invariants
- /docs/reference/limits
llm-context:end -->
