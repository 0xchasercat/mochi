# @mochi.js/consistency

## 0.1.1

### Patch Changes

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
