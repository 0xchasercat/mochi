# @mochi.js/inject

## 0.2.1

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

- Updated dependencies [92b8a57]
  - @mochi.js/consistency@0.1.2

## 0.2.0

### Minor Changes

- 1231131: MouseEvent.screenX/screenY prototype patch (R-041) per task 0250.

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

### Patch Changes

- Updated dependencies [1231131]
  - @mochi.js/consistency@0.1.1

## 0.1.1

### Patch Changes

- 7073097: Hot-fix v0.1.0's broken `workspace:*` references in published package.json
  files. v0.1.0 leaked the Bun workspace protocol verbatim into published
  tarballs because `changeset publish` (which wraps `npm publish`) does NOT
  rewrite `workspace:*` to concrete semver ranges — that's a pnpm/yarn
  courtesy npm doesn't replicate. As a result, `bun add @mochi.js/core@0.1.0`
  fails with `Workspace dependency not found` for every internal dep
  (behavioral, consistency, inject, net), and the same for the 6 other
  packages with internal deps.

  The fix adds `scripts/rewrite-workspace-deps.ts` as a publish-time
  pre-hook in the root `release` script. Pre-publish, every `workspace:*`
  in `packages/<name>/package.json` is rewritten to `^<sibling-version>`
  resolved from the local workspace map. Bun's workspace links during
  dev still resolve via the `name` field, so concrete versions on disk
  between cycles don't break local development.

  Verified by `bun pack`-ing the affected packages locally and inspecting
  the resulting tarball's `package.json` deps before pushing v0.1.1.

  `@mochi.js/consistency` and `@mochi.js/net-rs` are leaf packages with no
  internal deps; they ship at v0.1.0/0.1.0 already and don't need a bump.

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
  trims to just `audio.**` + `canvas.**` (deferred to task 0071).
  `baseline.manifest.json` is corrected for the natural-Chrome shape
  (`webdriver: false`, no `HeadlessChrome` UA leak, `deviceMemory: 8` per
  Chrome's quantization).

- e7cc610: Land phase 0.3 — the zero-jitter inject engine. `@mochi.js/inject` exposes
  `buildPayload(matrix)` which composes a single IIFE of TurboFan-friendly
  `Object.defineProperty` proxies covering the v0.2-rule surface: navigator,
  screen + window viewport, WebGL `getParameter` (UNMASKED_VENDOR/RENDERER,
  MAX_TEXTURE_SIZE, MAX_COLOR_ATTACHMENTS), `navigator.userAgentData`
  (brands + `getHighEntropyValues`), `Intl.DateTimeFormat` timezone,
  `document.fonts` enumeration, and bot-detection sentinel cleanup. Every
  spoofed function answers `.toString()` with the native shape via a
  shared `Function.prototype.toString` cloak. `@mochi.js/core` wires the
  payload at session construction and installs it via
  `Page.addScriptToEvaluateOnNewDocument({runImmediately:true, worldName:""})`
  on each new page; worker targets receive the payload via
  `Runtime.evaluate` from the auto-attached paused session, then resume.
  No `Runtime.enable` is ever sent — verified by
  `tests/contract/inject-no-runtime-enable.contract.test.ts` and the
  existing §8.2 forbidden-method assertions.
- 74443f7: Phase 0.5.x — stealth conformance suite (port of CloakBrowser
  `tests/test_stealth.py`).

  - **`@mochi.js/harness`** gains a new `conformance/stealth/` subtree. Layer 1
    (`webdriver-detection.test.ts`) runs as the load-bearing PR-fast gate
    alongside `bun harness:smoke` — six offline assertions ported verbatim
    from CloakBrowser's `TestWebDriverDetection`:
    `navigator.webdriver===false`, no `HeadlessChrome` UA, `typeof window.chrome === "object"`,
    `navigator.plugins.length >= 5`, `navigator.languages.length >= 1`,
    no `cdc_*` / `__webdriver*` window keys. Layer 2
    (`bot-detection-sites.test.ts`) runs gated by `MOCHI_ONLINE=1` against
    bot.sannysoft, bot.incolumitas, browserscan, deviceandbrowserinfo, and
    demo.fingerprint.com/web-scraping. Three online tests carry typed
    expected-failure entries (incolumitas anti-debugger trap, sannysoft
    MQ_SCREEN, fingerprint.com IP-class blocking) — see `docs/limits.md`.
  - **`@mochi.js/inject`** gains two CloakBrowser-surfaced defensive shim
    modules: `window-chrome.ts` (mirrors Chrome's `window.chrome` shape with
    `loadTimes`/`csi`/`app` only when the underlying browser doesn't already
    expose it; `runtime` is intentionally undefined for non-extension
    contexts) and `plugins.ts` (curated 5-plugin PluginArray + 2-mimetype
    MimeTypeArray, matching the `mac-m4-chrome-stable` baseline; only
    installed when the underlying browser reports an empty list). Both
    shims no-op on real Chrome.app where the surfaces are native, so the
    existing harness Zero-Diff gate is unchanged at runtime.
  - New scripts: `bun conformance:stealth` (Layer 1, PR-fast) and
    `bun conformance:stealth:online` (Layer 2, network-gated). Wired into
    `.github/workflows/pr-fast.yml` (Layer 1 hard-fail) and
    `.github/workflows/release.yml` (both layers gate publish).
  - Vendored upstream source: `tests/fixtures/cloakbrowser/test_stealth.py`
    (sha-pinned to `13b1b98b6840b68316e43fd46f43ffa7f50fd967`).

### Patch Changes

- 4f09750: Initial v0.0.1 claim release with placeholder exports. Surface lands incrementally per PLAN.md §14.
- Updated dependencies [3fefd93]
- Updated dependencies [29e1bb2]
- Updated dependencies [4f09750]
  - @mochi.js/consistency@0.1.0
