# 0030: inject engine v0

**Package:** `inject` (with wiring in `core`)
**Phase:** `0.3`
**Estimated size:** L
**Dependencies:** 0001, 0011 (CDP transport — merged), 0020 (consistency engine — merged)

## Goal

Implement the Zero-Jitter stealth payload in `@mochi.js/inject` per PLAN.md §5.3 + §8.4, and wire it into `@mochi.js/core` so the payload runs **in main world before any page script** on every navigation. After this lands, a Mochi-driven Chromium presents the spoofed surface from the consistency-engine `MatrixV1` instead of the bare Chromium fingerprint. v0.3 covers only the surface that v0.2 produces (the 30 rules from R-001..R-030 — navigator, screen, simple GPU strings, fonts/baseline-only, locale, timezone, hardware basics). Audio precomputed bytes, canvas hash maps, and full WebGL extension catalogs remain phase 0.7.

This is the framework's first real value-prop milestone: probing creep.js or browserleaks against a Mochi session must show altered, internally-consistent values that match the input profile, with no detectable proxy/runtime artifacts.

## Success criteria

### Public API of `@mochi.js/inject`

- [ ] `buildPayload(matrix: MatrixV1): { code: string; sha256: string }` — pure, deterministic. Same matrix → identical code (byte-for-byte) → identical sha256.
- [ ] `code` is a single self-contained IIFE: no imports at runtime, no module references, executable as-is via `Page.addScriptToEvaluateOnNewDocument`.
- [ ] `code` size budget: ≤ 80 KB minified (target ~50 KB at v0.3 for the 30-rule surface). Warn (not error) on exceed; document the budget.
- [ ] `sha256` is `Bun.CryptoHasher`-derived hex of `code`. Used for caching + change detection in tests and harness.

### Payload runtime invariants (PLAN.md §5.3 + §8.4)

These are the things the payload must do correctly — verified by unit tests that load the payload string into a synthesized JS sandbox and probe the resulting environment.

- [ ] **Override pattern.** Every spoofed property uses `Object.defineProperty(target, key, descriptor)` with:
  - `configurable: false` so page code cannot re-define
  - `enumerable` matching the original native descriptor
  - `get` returning the matrix value (no `value:` for properties that are accessor-style natively, e.g., `navigator.userAgent`)
- [ ] **`toString` cloaking.** Every spoofed *function* has its `.toString()` return `function ${name}() { [native code] }` exactly — preserve the original shape. Patched via a single shared `Function.prototype.toString` proxy that consults a per-spoofed-fn map; falls through to the original `Function.prototype.toString` for everything else.
- [ ] **Error stack scrubbing.** Errors thrown from inside the payload's IIFE never carry stack frames pointing at the IIFE's own source. Implementation: catch internal errors, rebuild a synthetic `Error` whose `stack` mimics the call site shape Chrome would produce natively (or simply has the IIFE filtered out).
- [ ] **Self-deletion of init globals.** The payload exposes nothing on `window` or `globalThis` after init. Any temporary globals (`__mochi__`, etc.) are `delete`d before the IIFE returns. Test: after the payload runs, every original `window.*` enumeration produces results indistinguishable from a bare browser.
- [ ] **`Runtime.enable` poisoning resilience.** The payload assumes `Runtime.enable` is never sent (PLAN.md §8.2 invariant) and does not add anti-`Runtime.enable` hacks. Document this assumption in payload header comments.
- [ ] **JIT-friendly.** No async, no Promise, no setTimeout, no `eval`, no `new Function` at runtime. Pure synchronous defineProperty calls + plain function declarations. v8 should JIT the proxies.

### Spoof modules covered at v0.3 (matching v0.2 matrix output)

The payload composes from per-API modules under `packages/inject/src/modules/`. v0.3 ships these modules. Each module exports `(matrix: MatrixV1) => string` that returns a JS snippet to splice into the master payload.

- [ ] `navigator.ts` — overrides `navigator.userAgent`, `navigator.platform`, `navigator.vendor`, `navigator.appVersion`, `navigator.appCodeName`, `navigator.product`, `navigator.cookieEnabled`, `navigator.hardwareConcurrency`, `navigator.deviceMemory`, `navigator.maxTouchPoints`, `navigator.webdriver` (false), `navigator.languages`, `navigator.language`. Reads from `matrix.uaCh.*` and `matrix.userAgent` and `matrix.locale` and `matrix.languages`.
- [ ] `screen.ts` — overrides `screen.width/height/availWidth/availHeight/colorDepth/pixelDepth`, `window.devicePixelRatio`, plus `window.{innerWidth,innerHeight,outerWidth,outerHeight}` per `matrix.uaCh.window-viewport`.
- [ ] `webgl.ts` — overrides `WebGLRenderingContext.prototype.getParameter` so that `UNMASKED_VENDOR_WEBGL` and `UNMASKED_RENDERER_WEBGL` queries return `matrix.gpu.webglUnmaskedVendor/Renderer`. Also `MAX_TEXTURE_SIZE`, `MAX_COLOR_ATTACHMENTS` (WebGL2). Other `getParameter` calls fall through to native. Same pattern for `WebGL2RenderingContext.prototype.getParameter` if separately defined.
- [ ] `client-hints.ts` — overrides `navigator.userAgentData.toJSON()` and `getHighEntropyValues()` to return shapes matching `matrix.uaCh.sec-ch-ua/-platform/-platform-version/-arch`.
- [ ] `timing.ts` — sets `Intl.DateTimeFormat.prototype.resolvedOptions().timeZone = matrix.timezone` (via prototype override). Does NOT spoof `performance.now()` precision (Chrome's natural 100µs coarsening is fine for same-engine v1 per PLAN.md §9.6).
- [ ] `bot-globals.ts` — DELETES the automation key globals listed in `chaser-recon/src/lib/fingerprint/bot-detection.ts:14-25` if they exist on `window` (CDC keys, `_phantom`, `__nightmare`, `domAutomation`, etc.). At v0.3 this is mostly defensive — they shouldn't be present in stock Chromium-for-Testing — but the payload includes the cleanup as a safety net.
- [ ] `fonts.ts` — overrides `document.fonts` enumeration and the FontFace API to report only `matrix.fonts.list`. v0.3 uses the OS-baseline-only list from R-013; full per-device fonts in phase 0.7.

### NOT covered at v0.3 (placeholders or omitted)

Document each in `docs/limits.md`:

- Audio fingerprinting (`OfflineAudioContext.startRendering`) — phase 0.7. Probes that hit it will see the bare Chrome audio fingerprint, which mismatches the spoofed UA. Document.
- Canvas fingerprinting (`HTMLCanvasElement.toDataURL`) — phase 0.7. Same caveat.
- WebGPU adapter info — later. v0.3 doesn't override.
- `MediaDevices.enumerateDevices` — phase 0.7. Bare Chrome behavior.
- `SpeechSynthesis.getVoices` — phase 0.7.
- `Notification.permission`, `Permissions.query` — bare Chrome behavior.

### Core integration (`@mochi.js/core`)

- [ ] `Session.start()` (or wherever `launch()` finalizes setup) calls `buildPayload(matrix)` and stores the result as `session._payload`.
- [ ] When `Session.newPage()` creates a new page (a new Target), the page's CDP session calls `Page.addScriptToEvaluateOnNewDocument` with:
  - `source: session._payload.code`
  - `runImmediately: true`
  - `worldName: ""` (CRITICAL — empty string = main world; ANY non-empty value = isolated world = detectable)
  - `includeCommandLineAPI: false` (default; do not flip)
- [ ] The returned `identifier` is tracked per-page; on `Page.close()` or `Session.close()`, call `Page.removeScriptToEvaluateOnNewDocument({ identifier })`.
- [ ] For workers/service-workers/audio-worklets: when `Target.attachedToTarget` fires for a worker target, send `Runtime.evaluate({ expression: payload.code, ... })` against that target. **CRITICAL:** worker targets DO accept `Runtime.evaluate` and are NOT subject to the Page.addScriptToEvaluateOnNewDocument flow. Use `awaitPromise: false`, `returnByValue: false`. The forbidden-method assertion in `cdp/forbidden.ts` does NOT apply here because we're not sending `Runtime.enable` — only `Runtime.evaluate` against an already-paused worker target.

  **Caveat:** worker injection via Runtime.evaluate is a known leak vector vs. Page.addScriptToEvaluateOnNewDocument's main-world stealth. Since workers don't have AddScriptToEvaluateOnNewDocument equivalent, this is the best we can do at the JS layer. Document in `docs/limits.md` as "worker context injection has a smaller stealth ceiling than main-world".

### Tests

- [ ] `packages/inject/src/__tests__/`:
  - `payload-shape.test.ts` — `buildPayload` returns a valid IIFE string, parsable by `acorn` or just `new Function(payload + '; return true')` test, deterministic across calls.
  - `runtime-overrides.test.ts` — load payload into a fresh `vm.Script`-style sandbox (Bun has no `vm`; use a synthesized sandbox via `Function` constructor + a fake `window`/`navigator` proxy), verify each spoofed property reads back the matrix value.
  - `tostring-cloak.test.ts` — verify spoofed function `.toString()` matches `function NAME() { [native code] }` exactly.
  - `self-delete.test.ts` — after running, `__mochi__` is undefined.
- [ ] `tests/contract/inject-payload.contract.test.ts` — pinned cross-package contract: `buildPayload(<canonical matrix>).sha256` matches a golden hex (committed). Catches accidental payload churn that would invalidate harness baselines downstream.
- [ ] `tests/contract/inject-no-runtime-enable.contract.test.ts` — drives the full launch+payload path against a fake CDP transport, asserts zero `Runtime.enable` sends across all pages and worker auto-attaches.
- [ ] **MOCHI_E2E gated**: `packages/core/src/__tests__/inject.e2e.test.ts` — launches real Chromium, navigates to a `data:text/html,<script>document.body.innerText = JSON.stringify({ ua: navigator.userAgent, plat: navigator.platform, hw: navigator.hardwareConcurrency, dpr: window.devicePixelRatio })</script>`, reads body text, asserts the values match the input matrix's expected values (NOT the bare Chrome values). This is THE phase 0.3 gate — passing it proves spoofing works.

### Other

- [ ] `docs/limits.md` updated with: audio not spoofed v0.3, canvas not spoofed v0.3, WebGPU not spoofed v0.3, MediaDevices not spoofed v0.3, SpeechSynthesis not spoofed v0.3, worker context injection ceiling.
- [ ] Changeset added: `@mochi.js/inject` minor (first real surface), `@mochi.js/core` minor (payload wiring, public-visible behavior change).
- [ ] All other gates green: typecheck, lint, test, test:contract, no Runtime.enable assertions still firing.

## Out of scope

- The 50 v1 rules NOT in v0.2's R-001..R-030 (audio bytes, canvas hashes, full font lists, full WebGL extensions per device, sensor APIs, WebGPU, FedCM, Trust Tokens, Topics) — phase 0.7 / later phases.
- Worker stealth parity with main-world stealth — fundamental Chromium limitation; documented limit, not a fixable issue.
- Spoofing `performance.now()` precision — bare Chrome's 100µs coarsening matches what we want for same-engine v1.
- Cross-engine spoofing (Safari, Firefox surface from Chromium) — v2.
- Mobile profiles / touch event synthesis — v2.
- Cookie/storage spoofing — those are session-level state, not page-runtime.

## Implementation notes

- File layout under `packages/inject/src/`:
  - `index.ts` — re-exports `buildPayload`, `PayloadResult` type
  - `build.ts` — `buildPayload` orchestrator: composes module snippets, wraps in IIFE, hashes
  - `modules/{navigator,screen,webgl,client-hints,timing,bot-globals,fonts}.ts` — per-API snippets
  - `runtime/` — pure-string runtime helpers that get embedded in every payload (the toString-cloak proxy, the descriptor-replicating defineProperty helper, the original-fn map)
  - `__tests__/` — units
- The payload is generated as a string. Authoring tip: write each module as a tagged-template-literal-friendly TS function that returns the JS snippet. Keep snippets small and obviously-correct; don't generate obfuscated code.
- For toString cloaking: the payload runs ONCE before page scripts. It captures references to original `Function.prototype.toString`, `Object.defineProperty`, `Object.getOwnPropertyDescriptor`, etc., into local consts inside the IIFE. Page scripts that run later see the spoofed `Function.prototype.toString` whose internal logic uses the captured originals.
- Don't use `Object.freeze` on `navigator` etc. — bare Chrome doesn't freeze them, freezing is a fingerprint vector.
- Use `Object.defineProperty` directly, not Reflect.defineProperty. Same effect, but defineProperty is the well-known native and matches what a typical fingerprint library expects to see.
- The integration test (E2E) is the proof-of-life. Run it locally before submit.

## Validation

```sh
bun typecheck
bun lint
bun test
bun test:contract --pkg=inject

# E2E: real spoofing proof
MOCHI_E2E=1 MOCHI_CHROMIUM_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  bun test packages/core/src/__tests__/inject.e2e.test.ts

# manual smoke (after E2E confirmed):
MOCHI_CHROMIUM_PATH=... bun -e '
import { mochi } from "@mochi.js/core";
const s = await mochi.launch({profile: "mac-m2-chrome-stable", seed: "demo"});
const p = await s.newPage();
await p.goto("data:text/html,<pre id=u></pre><pre id=p></pre><pre id=hw></pre><script>u.textContent = navigator.userAgent; p.textContent = navigator.platform; hw.textContent = navigator.hardwareConcurrency</script>");
console.log(await p.text("#u"));     // expect: spoofed UA
console.log(await p.text("#p"));     // expect: "MacIntel"
console.log(await p.text("#hw"));    // expect: 8
await s.close();
'
```

When everything's green: `bun work submit 0030 --draft`.

## Touch list (rough)

- `packages/inject/src/{index,build}.ts` (replace placeholders)
- `packages/inject/src/modules/{navigator,screen,webgl,client-hints,timing,bot-globals,fonts}.ts` (new)
- `packages/inject/src/runtime/{tostring-cloak,defineproperty}.ts` (new — pure-string helpers)
- `packages/inject/src/__tests__/*.test.ts` (units)
- `packages/inject/package.json` (add `@mochi.js/consistency: workspace:*` for type-only `MatrixV1` import)
- `packages/core/src/{launch,session,page}.ts` (wire `buildPayload(matrix)` + `Page.addScriptToEvaluateOnNewDocument`)
- `packages/core/src/__tests__/inject.e2e.test.ts` (new, MOCHI_E2E-gated)
- `tests/contract/inject-payload.contract.test.ts` (new — sha256 pin)
- `tests/contract/inject-no-runtime-enable.contract.test.ts` (new — invariant verification)
- `docs/limits.md` (audio, canvas, webgpu, media-devices, speech, worker-context)
- `.changeset/inject-engine-v0.md` (new)
