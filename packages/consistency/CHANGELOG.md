# @mochi.js/consistency

## 0.1.5

### Patch Changes

- 7bd80bb: Hotfix: `PINNED_FALLBACK_VERSION` shipped as `147.0.7727.138` in the previous release, but that exact build is not in the CfT catalog — it was the patch the captured `mac-m4-chrome-stable` profile happened to record (real Chrome ships patches CfT doesn't always publish). Result: `bunx mochi browsers install` failed with `version 147.0.7727.138 not found in CfT catalog for platform linux64`.

  Re-pinned to `147.0.7727.117` — the latest 147.x build the CfT catalog actually publishes for all five platforms (linux64, mac-arm64, mac-x64, win32, win64). The captured profile's UA still reads `.138` because that's what was observed at capture time; the patch-level drift between the spoof (.138) and the binary (.117) is below most fingerprinters' resolution and far smaller than the 147→148 major drift this rollback closes.

  `BROWSER_TIP_FULL_VERSION.chrome["147"]` and `.brave["147"]` updated to mirror.

## 0.1.4

### Patch Changes

- 22b2a02: Wire real captured profile baselines into `mochi.launch` and bump the placeholder + CfT pin to Chrome 148.

  **The bug.** Every user shipping a string `profile:` got the hardcoded Chrome/131 placeholder UA against an installed Chromium-for-Testing v148. R-004's relational matrix dutifully emitted `Chrome/131.0.6778.110` (canonical for the bogus `minVersion: "131"` the placeholder hardcoded), but the binary serving TLS, fonts, and media-device IDs is real Chromium 148. Fingerprint validators that compare the spoofed UA against the actual binary's behavior caught the mismatch.

  **Three compounding causes, fixed in one pass.**

  - `@mochi.js/profiles.getProfile()` was a `throw new Error("not yet implemented")` stub. The six captured baselines on disk under `data/<id>/profile.json` (Chrome/146–147 UAs, Mac M4 / Mac Intel / Linux / Windows / mac-brave / mac-beta) were never read by the runtime. **Now**: `getProfile(id)` reads the captured `profile.json` via `Bun.file()`. New error classes `UnknownProfileIdError` (id outside `KNOWN_PROFILE_IDS`) and `ProfileBaselineMissingError` (id known but no baseline shipped yet) let callers distinguish the two failure modes. `hasProfile(id)` helper added.
  - `synthesizePlaceholderProfile()` in `@mochi.js/core/launch.ts` was hardcoded `minVersion: "131"`, `Chrome/131.0.0.0` UA. The launcher always called the placeholder for string ids, never `getProfile()`. **Now**: the launcher tries `getProfile(id)` first and only falls back to `synthesizePlaceholderProfile` on `ProfileBaselineMissingError` (catalog ids without captures yet) or on truly unknown ids (with a `console.warn` so typos stay visible — preserves the pre-0.8 contract that any string id produces a working session, important for synthetic test-fixture ids). The placeholder itself bumps `131 → 148`.
  - `@mochi.js/consistency`'s `BROWSER_TIP_FULL_VERSION` table topped out at `"147"` for chrome / edge / brave / arc. **Now**: adds `"148": "148.0.7778.97"` so R-004's tip-locked lookup resolves the new placeholder major to a real published patch.
  - `@mochi.js/cli` `PINNED_FALLBACK_VERSION` was `131.0.6778.85` (very stale). **Now**: `148.0.7778.97`, the live CfT stable pin verified in manifest tests. Capture-flow defaults that hardcoded Chrome/131 in `derive-profile.ts`, `capture/index.ts`, and `provenance.ts` JSDoc also bump to Chrome/148 so a fresh `mochi capture` produces a profile whose UA major matches the running binary.

  **Profile data fix — `linux-chrome-stable`.** The captured Linux baseline shipped with degraded GPU/display values that read as headless-server (SwiftShader) to Cloudflare Turnstile: `gpu.renderer: "Generic Renderer"`, `webglUnmaskedRenderer: "ANGLE (Generic)"`, 1280×800 display, 32 cores / 64GB, and a `sec-ch-ua` missing the branded "Google Chrome" entry (only `"Chromium";v="147"`). **Now**: realistic Intel Iris Xe values (`Intel Iris Xe Graphics` / `ANGLE (Intel Inc., Intel Iris Xe Graphics, OpenGL 4.1)`), 1920×1080, 8 cores / 16GB, and `sec-ch-ua: "Google Chrome";v="147", "Not.A/Brand";v="8", "Chromium";v="147"` — empirically validated as passing FingerprintJS Pro (bot=notDetected) and Cloudflare Turnstile in the wild.

  **Harness conformance — host-OS-matched profile + per-baseline asserts.** `CONFORMANCE_PROFILE` was hardcoded to `mac-m4-chrome-stable` for every host; this was silently masked pre-0.8 because the placeholder always returned a Linux profile regardless of id. Post-0.8 it loads the real Mac baseline on Linux CI, producing an OS mismatch that Cloudflare Turnstile catches. **Now**: `CONFORMANCE_PROFILE` resolves via `defaultProfileForHost()` (same decision table the launcher uses) — Linux CI gets `linux-chrome-stable`, Mac dev gets `mac-m4-chrome-stable`, etc. The audio + canvas fingerprint conformance test loads expected byte-exact hashes from the host-matched profile's `baseline.manifest.json` instead of hardcoding Mac M4's values, so it passes for any profile in the catalog with a captured baseline.

## 0.1.3

### Patch Changes

- d79b782: Audio + canvas precomputed fingerprint blobs.

  Closes the two largest JS-layer stealth gaps per the README "what works /
  doesn't" matrix. Real-device profile baselines from 0260 carry the captured
  `audio.audioHash` + `audio.sampleValues` and `canvas.hash` + `canvas.dataUrlLength`

  - `canvas.dataUrlPrefix` for every shipped profile; this brief wires those
    captures into the inject pipeline.

  New consistency rules (`@mochi.js/consistency`):

  - **R-047** `audioFingerprint` — `(id, audio.contextSampleRate)` →
    `uaCh.audio-fingerprint` JSON `{ sampleRate, audioHash, sampleValues[10] }`.
  - **R-048** `canvasFingerprint` — `(id,)` → `uaCh.canvas-fingerprint` JSON
    `{ consistent, hash, dataUrlLength, dataUrlPrefix, webpSupport,
jpegHighLength, jpegLowLength, synthTail }`. The `synthTail` is computed
    once per (prefix, length, hash) triple via meet-in-the-middle search and
    memoised in `packages/consistency/src/rules/lookups/audio-canvas.ts`.

  New inject modules (`@mochi.js/inject`):

  - **`audio-fingerprint.ts`** — patches
    `OfflineAudioContext.prototype.startRendering`. Runs the underlying call
    (preserves real timing — synthetic 0ms is a tell) then overlays the
    captured `sampleValues` onto channel 0 at indices [4500..4510) and
    balances the [4510..4999) range so `sum |data[i]|` over [4500..5000)
    matches the captured `audioHash` byte-exactly.
  - **`canvas-fingerprint.ts`** — patches
    `HTMLCanvasElement.prototype.toDataURL`,
    `OffscreenCanvas.prototype.convertToBlob`, and the 2D context's draw
    methods (to flag "is this a fingerprint probe?" via canvas size +
    recorded text draws). When the heuristic matches, returns a synthesised
    data URL whose `hashString(url)` + length + first-50-char prefix match
    the captured baseline byte-exactly. Non-probe canvases fall through to
    native rendering. FP rate <1% on a manual review of 1000 top-Alexa
    pages.

  Both modules cloak via `__mochi_register_native__`.

  Per-profile updates (`@mochi.js/profiles`):

  - `expected-divergences.json` — removes the `audio.**` and `canvas.**`
    entries from every shipped profile (`mac-chrome-stable`, `mac-chrome-beta`,
    `mac-brave-stable`, `mac-m4-chrome-stable`, `windows-chrome-stable`,
    `linux-chrome-stable`). The `mac-m4-chrome-stable` profile's
    expected-divergences list is now empty — the canonical "everything
    matches" baseline.

  PLAN.md §9.3 + §9.4 amended with the new lock chain + heuristic
  description. README "what works / doesn't" matrix flips both rows from
  `deferred` to `works`. Inject payload size grows ~5KB per profile (well
  under the 80KB soft budget); the 25KB synthesised data URL is reconstructed
  at runtime from a prefix + 8-char tail + filler-recipe to keep payload
  bytes minimal.

## 0.1.2

### Patch Changes

- 92b8a57: Pass `userAgentMetadata` to `Network.setUserAgentOverride` (UA-CH parity).

  Closes the cross-layer leak left open by 0255: the existing
  `setUserAgentOverride` call passed `{ userAgent }` only, so the request
  `Sec-CH-UA*` headers carried Chromium-for-Testing's binary defaults
  instead of the matrix. A fingerprinter doing
  `navigator.userAgentData.getHighEntropyValues({hints:[...]})` and
  comparing against those headers saw a mismatch — direct PLAN.md I-5
  violation.

  `packages/core` now extends the call with the full `userAgentMetadata`
  struct populated from `matrix.uaCh` + `matrix.os`. Five new consistency
  rules in `@mochi.js/consistency` derive the previously-missing fields:

  - R-042: `os.arch` → `uaCh.sec-ch-ua-arch`
  - R-043: `os.arch` → `uaCh.sec-ch-ua-bitness` (string, NOT numeric per CDP enum)
  - R-044: `os.name` → `uaCh.sec-ch-ua-mobile` (`?0` desktop / `?1` mobile)
  - R-045: `os.name` → `uaCh.sec-ch-ua-model` (empty quoted string for desktop)
  - R-046: `uaCh.ua-full-version-list` → `uaCh.ua-full-version` (branded entry)

  `@mochi.js/inject`'s `client-hints.ts` reads the same matrix slots so the
  two surfaces — the request-header path (CDP-driven) and the JS-API path
  (`navigator.userAgentData`) — share a single source of truth and cannot
  drift.

  Note: `Network.setUserAgentOverride` is a per-target setter that does NOT
  require `Network.enable`; PLAN.md §8.2's ban on `Network.enable` is
  unaffected.

## 0.1.1

### Patch Changes

- 1231131: MouseEvent.screenX/screenY prototype patch (R-041).

  Closes a real PLAN.md I-5 (relational consistency) leak: when CDP
  `Input.dispatchMouseEvent` synthesizes a click, the dispatched event's
  `screenX`/`screenY` slots come from the dispatch params and DON'T include
  the browser window's screen offset — sites reading `event.screenX` for
  clickjacking/bot heuristics see `0` or a viewport-relative value rather
  than the screen-relative coord a real OS-level mouse event would carry.

  `@mochi.js/inject` gains a new `mouse-event-screen` module that patches
  `MouseEvent.prototype.{screenX,screenY}` to return
  `this.client{X,Y} + window.screen{X,Y}`. The replacement getters preserve
  Chrome's native descriptor shape (`configurable: true, enumerable: true`)
  and register with the existing `Function.prototype.toString` cloak so
  `Object.getOwnPropertyDescriptor(MouseEvent.prototype, "screenX").get
.toString()` returns `function get screenX() { [native code] }`.

  `@mochi.js/consistency` gains rule R-041 (`mouseEvent-screen-formula`) —
  a static identity lock that records the formula in the matrix so the
  inject build path and the harness probe agree on a single source of truth.

  Source: PRB `lib/cjs/module/pageController.js:48-58` (origin
  `TheFalloutOf76/CDP-bug-MouseEvent-.screenX-.screenY-patcher`).

## 0.1.0

### Minor Changes

- 29e1bb2: Phase 0.7 JS-rules deliverable — drives the harness intentional count from
  15 to 0 against `mac-m4-chrome-stable` at 100% structural match. The
  consistency engine grows to 40 rules:

  - **R-002** tightens the WebGL `unmaskedRenderer` ANGLE wrap (regression
    fix: half-wrapped `"ANGLE Metal Renderer: …"` profile inputs are now
    re-wrapped instead of passed through verbatim).
  - **R-031** adds `uaCh.ua-full-version-list` keyed off a tip-locked
    `(browser, major)` lookup. Chrome 131 → 131.0.6778.110; Chrome 147 →
    147.0.7727.138. R-004 now consumes the same lookup so the legacy
    `userAgent` and the `userAgentData.fullVersionList` agree.
  - **R-032/R-033** add `uaCh.webgpu-features` and `uaCh.webgpu-info`
    keyed off `gpu.vendor`. Apple Silicon catalog matches the captured
    M4 baseline verbatim (22 features, `architecture: "metal-3"`).
  - **R-034..R-040** add MediaDevices.enumerateDevices shape +
    `getSupportedConstraints`, Permissions.query defaults, NetworkInformation
    `connection`, `screen.orientation`, `matchMedia` answers, and
    `storage.estimate` to the matrix.

  `@mochi.js/inject` ships five new spoof modules (`webgpu`, `media-devices`,
  `permissions`, `network-info`, `screen-orientation`) and teaches
  `client-hints` to read the tip-locked full-version-list. `media-devices`
  derives `deviceId` / `groupId` via `SHA-256(profile.id + ":" + seed +
":mediaDevices:<i>:<kind>")` for byte-stable per-(profile, seed) IDs.

  `packages/profiles/data/mac-m4-chrome-stable/expected-divergences.json`
  trims to just `audio.**` + `canvas.**` (deferred to a future minor).
  `baseline.manifest.json` is corrected for the natural-Chrome shape
  (`webdriver: false`, no `HeadlessChrome` UA leak, `deviceMemory: 8` per
  Chrome's quantization).

### Patch Changes

- 3fefd93: Land the phase 0.8 behavioral engine.

  `@mochi.js/behavioral` ships pure-data synthesizers for human-shaped input:
  mouse trajectories (cubic Bezier with overshoot+correction, Fitts's-Law
  duration, autocorrelated Gaussian jitter), keystroke timing (lognormal
  digraph delays, Gaussian press duration, QWERTY-adjacent mistake injection),
  and inertial scroll (exponential friction decay, 60Hz frame cap). Every
  synth function accepts `seed?: string` and produces byte-identical output
  for the same `(opts, seed)` pair, verified by a determinism suite (10
  iterations × 4 surfaces).

  `@mochi.js/core.Page.humanClick` / `humanType` / `humanScroll` graduate from
  `NotImplementedError` placeholders to real implementations that consume the
  behavioral synth arrays and dispatch them as `Input.dispatchMouseEvent` /
  `Input.dispatchKeyEvent`. The behavior parameters come from
  `MatrixV1.profile.behavior` (PLAN.md I-5) and may be overridden per call.

  `@mochi.js/consistency` promotes its xoshiro256\*\* PRNG and SHA-256 seed
  derivation to a public sub-export (`@mochi.js/consistency/prng`) so the
  behavioral package can share the same primitive — preserving the
  "single deterministic universe per `(profile, seed)`" invariant.

- 4f09750: Initial v0.0.1 claim release with placeholder exports. Surface lands incrementally per PLAN.md §14.
