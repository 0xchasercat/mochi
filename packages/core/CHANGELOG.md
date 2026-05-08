# @mochi.js/core

## 0.1.0

### Minor Changes

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

- e97c732: Land the phase 0.1 CDP control plane: pipe-mode transport (`Bun.spawn` with extra
  FDs 3+4, NUL-delimited JSON-RPC framing, no TCP), `MessageRouter` with request/
  response correlation + per-method event bus, minimal `Session` and `Page` (`goto`,
  `content`, `text`, `evaluate`, `waitFor`, `cookies`, `close`), and runtime
  assertions for the §8.2 forbidden CDP methods (`Runtime.enable`,
  `Page.createIsolatedWorld`, `Runtime.evaluate{includeCommandLineAPI:true}`).

  Spoofing is deliberately deferred to phase 0.2/0.3; `Session.fetch`,
  `humanClick/Type/Scroll`, and `screenshot` remain `NotImplementedError`
  placeholders per the task brief.

- 5ea34c6: Add `mochi capture` subcommand and the `LaunchOptions.bypassInject` flag.

  - **`mochi capture --profile-id <id> [--out <dir>] [--browser <path>] [--seed <s>]`** drives a bare, un-spoofed Chromium against `tests/fixtures/probe-page.html`, captures every probe family (navigator, screen, canvas, webgl, webgpu, audio, media, speech, fonts, storage, timing, bot-detection), derives a `ProfileV1`, validates against `schemas/profile.schema.json`, and writes `profile.json` + `baseline.manifest.json` + `PROVENANCE.md` to the output directory.
  - **`LaunchOptions.bypassInject?: boolean`** (`@mochi.js/core`) — when `true`, the `Session` skips `buildPayload` and never sends `Page.addScriptToEvaluateOnNewDocument`. Worker / service-worker / audio-worklet targets also receive no inject. Intended for `mochi capture` and similar baseline-collection flows; **do not enable in production**. PLAN.md §12.1.
  - The new `tests/fixtures/probe-page.html` is a self-contained probe-page (no network, ≤ 5 s budget) shared with phase 0.5's harness runner.

- f0c1a8a: Task 0150 — humanize conformance suite + supporting Page surface.

  - **`@mochi.js/harness`** gains a new conformance suite under
    `src/conformance/humanize/__tests__/` — a mochi-native port of
    CloakHQ/CloakBrowser's `tests/test_humanize_unit.mjs` +
    `tests/test_human_visual.mjs`. Seven test files cover config
    resolution, Bezier math, mouse trajectory (E2E), keystroke timing,
    fill clearing (E2E), patching integrity, and (online,
    `MOCHI_ONLINE=1`) the `deviceandbrowserinfo.com` bot-detection form.
    Run via `bun run conformance:humanize` (offline) or
    `bun run conformance:humanize:online`.
  - **`@mochi.js/core`** ships three Page-surface additions:
    - `Page.humanMove(x, y, opts?)` — animate the cursor to (x, y)
      along a Bezier trajectory without dispatching a click. Same
      underlying synth as `humanClick` minus the press/release.
    - `Page.cursorPosition()` — read the tracked cursor (x, y) so
      sequences of `humanMove`/`humanClick` chain realistically.
    - `Page.humanType("", selector)` — clearing semantics.
      Emits Backspace × `value.length` with realistic key timing
      instead of being a no-op as it was before.
  - Companion correctness fix: `Input.dispatchKeyEvent` now carries
    the proper `code` + `windowsVirtualKeyCode` for control keys
    (Backspace/Enter/Tab/Escape/Delete) so Chromium fires the
    edit-action handler, not just the JS keydown event. Printable
    letters/digits/space also get plausible `KeyA`/`Digit0`/`Space`
    codes for layout-aware page code.
  - Root scripts + CI gates wired:
    - `bun run conformance:humanize` is a PR-fast hard-fail step.
    - `bun run conformance:humanize` is a release-pre-publish gate.
  - Initial cursor position now defaults to the matrix's
    `display.width/2, display.height/2` (PLAN.md I-5) instead of (0, 0)
    — a real human's pointer is never at the viewport origin.

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
- ff75595: Land proxy authentication for HTTP / HTTPS / SOCKS5 / SOCKS4 proxies, wire
  the live `conformance:stealth:online` gate to a residential proxy via the
  `HTTP_PROXY` repo secret, and harden the `bot.incolumitas.com` test against
  goto soft-fail timeouts.

  - **`@mochi.js/core`** ships a new `proxy-auth.ts` that attaches a CDP
    `Fetch.authRequired` listener on session start when credentials are
    present, answering proxy auth challenges with `Fetch.continueWithAuth`.
    No extension, no `Runtime.enable`, no `Page.createIsolatedWorld` —
    PLAN.md §8.2 invariants preserved (`Fetch.enable` is not on the
    forbidden list and produces no page-observable signals). The handler is
    wired with empty `patterns` so regular request flow is unaffected; a
    defensive `Fetch.requestPaused` handler short-circuits via
    `Fetch.continueRequest` if Chromium ever pauses a request despite the
    empty pattern set. `Fetch.disable` runs on session close.

    `parseProxyUrl(url)` is exported and handles the four protocols, with
    and without auth, percent-encoded credentials, IPv6 hosts, and missing
    ports (defaults: HTTP=80, HTTPS=443, SOCKS5/4=1080).
    `LaunchOptions.proxy` accepts both the string form
    (`http://user:pass@host:port`) and the `ProxyConfig` record shape; both
    feed the same auth path. Credentials are forwarded to the network FFI
    too, so `Session.fetch` shares the same authenticated egress as the
    browser.

  - **`@mochi.js/harness`** — `launchSharedSession()` now reads
    `MOCHI_PROXY` and feeds it to `mochi.launch({ proxy })` when set.
    Empty / unset = unproxied (fork PRs without secrets still run cleanly).
    The `bot.incolumitas.com` test short-circuits to its registered
    expected-failure when `bestEffortGoto` reports `navigated: false`,
    preventing the 12s sleep + 30s evaluate + worker-injection cascade
    from eating the 90s test budget.

  - **CI** — both `release.yml` (existing Layer 2 step) and `pr-fast.yml`
    (newly added Layer 2 step, gated `if: github.event_name == 'pull_request'`)
    now pass `MOCHI_PROXY: ${{ secrets.HTTP_PROXY }}` so the live runs
    egress from a residential IP. The secret value is never echoed.

### Patch Changes

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

- 4f09750: Initial v0.0.1 claim release with placeholder exports. Surface lands incrementally per PLAN.md §14.
- Updated dependencies [3fefd93]
- Updated dependencies [29e1bb2]
- Updated dependencies [70a1eb2]
- Updated dependencies [4f09750]
- Updated dependencies [e7cc610]
- Updated dependencies [74443f7]
  - @mochi.js/behavioral@0.1.0
  - @mochi.js/consistency@0.1.0
  - @mochi.js/inject@0.1.0
  - @mochi.js/net@0.1.0
