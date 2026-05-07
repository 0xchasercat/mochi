# 0020: consistency engine v0

**Package:** `consistency`
**Phase:** `0.2`
**Estimated size:** L
**Dependencies:** 0001, 0003 (codegen — already merged), 0011 (CDP transport — already merged; consistency wires into core's launch)

## Goal

Implement the Matrix engine in `@mochi.js/consistency` per PLAN.md §5.2 + §9. After this lands, `mochi.launch({profile, seed})` produces a real, relationally-locked `MatrixV1` from the input profile + seed via a deterministic acyclic DAG of rules. v0 covers ~30 of the 80 rules planned for v1.0 — the foundational set: navigator, screen, simple GPU strings, locale, timezone, hardware basics. Audio precomputed bytes, canvas hash maps, and full GPU coverage are deferred to phase 0.7.

This task does not yet wire the Matrix into a spoof payload — that's phase 0.3 (`@mochi.js/inject`). At v0.2 the Matrix is computed and exposed via `Session.profile`, but the running browser doesn't see any of it yet. That's intentional and aligned with PLAN.md §14.

## Success criteria

### Public API (replaces the current placeholder in `@mochi.js/consistency`)

- [ ] `deriveMatrix(profile: ProfileV1, seed: string): MatrixV1` — pure, deterministic. Same `(profile, seed)` always produces the exact same `MatrixV1`. JSON round-trip lossless.
- [ ] `MatrixV1` is the codegen'd type from `schemas/matrix.schema.json` — DO NOT redeclare. Imports via the existing generated module.
- [ ] `consistencyEngineVersion: "0.2.0"` (real version, not the `stub-${VERSION}` from `@mochi.js/core`'s launch.ts stub).
- [ ] `derivedAt` is the ISO timestamp at derivation. Note: this breaks bit-for-bit determinism for the `derivedAt` field alone. Document in JSDoc that `derivedAt` is excluded from determinism guarantees; everything else is bit-stable per `(profile, seed)`.

### Seeded PRNG

- [ ] `xoshiro256**` implementation in `src/prng/xoshiro256ss.ts`. Pure, deterministic, well-distributed. Seed derived from `sha256(profile.id + ":" + seed)` to ensure cross-profile isolation.
- [ ] Test: same seed → same sequence; different seeds → different sequences; sequence quality basic statistical sanity (no obvious bias on a 1k-sample run).

### Rule DAG

- [ ] Rules live in `src/rules/<rule-id>.ts`, one file per rule (or grouped by category — your call, but the file system layout should match the categorization in PLAN.md §9.2).
- [ ] Each rule exports:
  ```ts
  export interface Rule<I, O> {
    readonly id: string;        // e.g., "R-001"
    readonly inputs: readonly string[];   // dotted paths into the Matrix being built
    readonly output: string;    // dotted path the rule writes
    readonly derive(inputs: I, prng: SeededPrng): O;
  }
  ```
- [ ] A central `rules/index.ts` exports the full ordered rule list. The DAG topology is derived from `rule.inputs` and `rule.output` — the engine topo-sorts on demand.
- [ ] Acyclicity is enforced at engine-init time: a fast cycle check (DFS-coloring) runs once when `deriveMatrix` is first called. If cycles are detected, throw `RuleDagCycleError` with the cycle path.
- [ ] CI: a contract test imports the rule list and asserts the DAG is acyclic. Lives in `tests/contract/consistency-rules.contract.test.ts`.

### Rules to ship at v0.2 (~30 of 80)

Implement the following rules. Ship more if natural — the brief sets a floor, not a ceiling. Each gets a unit test verifying the relational lock.

| ID | Inputs | Output | Notes |
|---|---|---|---|
| R-001 | gpu.vendor, gpu.renderer | webgl.unmaskedVendor | identity passthrough |
| R-002 | gpu.vendor, gpu.renderer | webgl.unmaskedRenderer | identity passthrough |
| R-003 | gpu.renderer | gpu.webglMaxTextureSize | lookup table |
| R-004 | os.name, browser.name, browser.minVersion, seed | userAgent | UA template + seeded build number |
| R-005 | os.name, browser.name, browser.minVersion | uaCh.sec-ch-ua | client-hints brand list |
| R-006 | os.name | uaCh.sec-ch-ua-platform | enum |
| R-007 | os.version | uaCh.sec-ch-ua-platform-version | passthrough |
| R-008 | device.cpuFamily | navigator.hardwareConcurrency | derived from cores |
| R-009 | device.memoryGB | navigator.deviceMemory | cap at 8 |
| R-010 | display.width, display.height, display.dpr | screen.{width,height,availWidth,availHeight} | derive avail* by subtracting taskbar/menubar heights from OS table |
| R-011 | display.colorDepth | screen.colorDepth | passthrough |
| R-012 | display.dpr | window.devicePixelRatio | passthrough |
| R-013 | os.name | fonts.list | curated baseline list per OS (subset; full list phase 0.7) |
| R-014 | timezone | Intl.DateTimeFormat().resolvedOptions().timeZone | passthrough |
| R-015 | locale | navigator.language | passthrough |
| R-016 | languages | navigator.languages | passthrough (array) |
| R-017 | os.name | platform | "MacIntel" / "Win32" / "Linux x86_64" — even on M-series Macs, navigator.platform is "MacIntel" historically |
| R-018 | browser.name | navigator.vendor | "Google Inc." for chrome/edge/brave |
| R-019 | seed | seed-derived: visitorId-style placeholder for any seedDriven entries | xoshiro |
| R-020 | os.name | navigator.maxTouchPoints | 0 on desktop |
| R-021 | display.width, display.height | window.screen.availWidth/Height adjustment for OS chrome | OS chrome = menu bar + dock for Mac, taskbar for Win, etc. |
| R-022 | os.name, browser.name | webdriver | false on real-browser; relational with bot-detection |
| R-023 | profile.id, seed | navigator.userAgent build hash | deterministic noise within UA's stable major.minor |
| R-024 | gpu.vendor | gpu.webglExtensions | curated extension list per vendor (M2 vs Intel vs AMD) |
| R-025 | gpu.renderer | gpu.webglMaxColorAttachments | lookup table from PLAN.md §9 |
| R-026 | os.name, browser.name | navigator.appVersion | derived from UA |
| R-027 | os.name, browser.name | navigator.appCodeName | "Mozilla" universally — sanity passthrough |
| R-028 | os.name | navigator.product | "Gecko" universally — sanity passthrough |
| R-029 | display.dpr, display.width, display.height | window.{innerWidth,innerHeight,outerWidth,outerHeight} | typical browser chrome subtraction per OS |
| R-030 | os.name, browser.name | navigator.cookieEnabled | true |

Rules R-031 → R-080 (audio precomputed bytes, canvas hash maps, OS-specific font lists, full GPU extension catalog, Intl bits, WebGL2-specific MAX_DRAW_BUFFERS, WebGPU adapter info, `screen.orientation`, `Permissions.query` overrides, etc.) are deferred to phase 0.7.

### Wire-up

- [ ] `@mochi.js/core`'s `launch.ts` replaces its stub MatrixV1 with `deriveMatrix(profile, seed)` from `@mochi.js/consistency`. The existing import is upgraded from a type-only to a runtime import. `consistencyEngineVersion` reflects the real engine.
- [ ] `Session.profile` continues to be the `MatrixV1`. No public-API surface change needed in `@mochi.js/core`.
- [ ] Contract test `tests/contract/consistency-derivation.contract.test.ts` — verifies that `mochi.launch` produces a Matrix where the values match the rule outputs for a known input profile + seed (golden file).

### Tests

- [ ] Unit tests per rule: golden-file assertions for canonical inputs.
- [ ] Determinism test: derive the same `(profile, seed)` 100x; assert byte-for-byte equality (excluding `derivedAt`).
- [ ] Schema validation test: every derived Matrix passes the `schemas/matrix.schema.json` Ajv-style validation (use Bun-native check via the json-schema-to-typescript runtime if it exposes one; otherwise inline a minimal validator). At v0.2 this is "the generated TS type allows this object" — full runtime validation is later.
- [ ] DAG cycle test in contract suite.
- [ ] All existing 0010/0011 tests still pass — typecheck, lint, contract.

## Out of scope

- The remaining ~50 rules (audio bytes, canvas hash maps, full font lists, full WebGL extensions per vendor) — phase 0.7.
- Runtime payload generation (the `@mochi.js/inject` package) — phase 0.3.
- Profile data — `@mochi.js/profiles` is still empty; phase 0.4 captures the first baseline.
- Real device-specific audio/canvas fingerprint bytes — placeholders OK.
- Cross-engine (Safari/Firefox) matrix derivation — v2 per PLAN.md §16.
- Mobile profiles — v2.
- CI-time Ajv validation (full runtime) — types-only at v0.2.

## Implementation notes

- File layout under `packages/consistency/src/`:
  - `index.ts` — re-exports public API (`deriveMatrix`, types from generated)
  - `derive.ts` — `deriveMatrix` orchestrator: cycle-check, topo-sort rules, run them, build matrix
  - `prng/xoshiro256ss.ts` — seeded PRNG implementation
  - `prng/seed.ts` — sha256-based seed derivation
  - `rules/index.ts` — exports the rule list + DAG metadata
  - `rules/r001-webgl-vendor.ts`, `rules/r002-webgl-renderer.ts`, etc. — one file per rule
  - `rules/lookups/` — lookup tables (gpu → max-texture-size, OS → font list, etc.) as plain JSON or TS data
  - `errors.ts` — `RuleDagCycleError`, `MissingInputError`
  - `__tests__/` — unit tests per rule + determinism + DAG cycle
- For the cycle check: standard DFS with three-color marking. Detect when a node currently in the DFS stack is encountered again. Don't add Tarjan or other heavy algorithms — DFS-coloring is O(V+E) and ~30 lines.
- For the topo sort: Kahn's algorithm. Output order is the rule execution order.
- For dotted-path access into the Matrix: a small `setByPath`/`getByPath` helper. No `lodash`. ~20 lines.
- For PRNG seed derivation: `Bun.CryptoHasher` for sha256; first 8 bytes of the digest as the xoshiro256** state seed.
- For `derivedAt`: ISO timestamp via `new Date().toISOString()`. Document the determinism caveat.
- The lookup tables (gpu → renderer-string mapping, OS → font list) should be small at v0.2 — just enough to cover the v1 catalog profiles (mac-m2-chrome, mac-m1-chrome, mac-intel-chrome, win11-chrome, win11-edge, linux-chrome). Real device-specific bytes come in phase 0.7.

## Validation

```sh
bun typecheck
bun lint
bun test
bun test:contract --pkg=consistency

# manual smoke
bun -e 'import {deriveMatrix} from "@mochi.js/consistency"; \
  const m = deriveMatrix({id:"mac-m2-chrome-stable", version:"1.0.0", /* ... */ } as any, "user-1"); \
  console.log(JSON.stringify(m, null, 2))'
```

When everything's green: `bun work submit 0020 --draft`.

## Touch list (rough)

- `packages/consistency/src/derive.ts` (new — orchestrator)
- `packages/consistency/src/prng/{xoshiro256ss,seed}.ts` (new)
- `packages/consistency/src/rules/{index,r001..r030,lookups/*}.ts` (new — bulk of the work)
- `packages/consistency/src/errors.ts` (new)
- `packages/consistency/src/index.ts` (replace placeholder body with real exports)
- `packages/consistency/src/__tests__/*.test.ts` (unit per-rule + determinism + cycle)
- `packages/core/src/launch.ts` (swap stub MatrixV1 for `deriveMatrix(profile, seed)`)
- `packages/core/package.json` (consistency dep upgraded from type-only to runtime — verify `workspace:*` is the right form)
- `tests/contract/consistency-rules.contract.test.ts` (new — DAG acyclicity)
- `tests/contract/consistency-derivation.contract.test.ts` (new — end-to-end via mochi.launch)
