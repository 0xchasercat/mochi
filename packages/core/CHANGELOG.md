# @mochi.js/core

## 0.9.4

### Patch Changes

- Updated dependencies [7bd80bb]
  - @mochi.js/consistency@0.1.5
  - @mochi.js/behavioral@0.1.7
  - @mochi.js/inject@0.4.2
  - @mochi.js/profiles@0.2.1

## 0.9.3

### Patch Changes

- 8dd25a8: Roll back `PINNED_FALLBACK_VERSION` from `148.0.7778.97` → `147.0.7727.138` to match the captured-baseline majority. Closes the canonical R-004 mismatch ("Different browser version" -5% on browserscan.net / generic-bot detectors): the captured profiles in `@mochi.js/profiles` are still on Chrome 146/147, so pinning 148 shipped a UA-vs-binary divergence on every install.

  After this rollback:

  - The three most-used profiles (`linux-chrome-stable`, `mac-m4-chrome-stable`, `mac-chrome-beta`) match the binary byte-exactly.
  - The placeholder synthesizer (`synthesizePlaceholderProfile` in `@mochi.js/core`) bumps in lockstep — its UA / `wreqPreset` / `browser.{min,max}Version` are now Chrome 147.
  - The three older 146 captures (`mac-chrome-stable`, `windows-chrome-stable`, `mac-brave-stable`) still mismatch by 1 minor — tracked for the next recapture pass; users hitting these can pass an inline ProfileV1 with a 147 UA as a workaround.

  Existing users who already downloaded Chromium 148 should refresh:

  ```sh
  bunx mochi browsers install --force
  ```

  (or pass `--version 147.0.7727.138` explicitly — the new default is the same build).

## 0.9.2

### Patch Changes

- b0c5987: Fix `synthesizePlaceholderProfile` hardcoding Linux for every profile id. Pre-fix, the 5 catalog ids without captured baselines (`mac-m2-chrome-stable`, `mac-m1-chrome-stable`, `mac-intel-chrome-stable`, `win11-chrome-stable`, `win11-edge-stable`) all silently produced a Linux UA + Linux `os.name` regardless of what the id implied. macOS and Windows users passing those ids saw a Linux fingerprint against their actual Chromium-for-Testing binary — the canonical R-004 mismatch.

  The placeholder synthesizer now pattern-matches the id and emits OS-coherent skeletons:

  - `mac-*` / `macos-*` → macOS placeholder (Apple Silicon arm64 default, M3 GPU, `Macintosh; Intel Mac OS X` UA, Helvetica fonts, America/Los_Angeles tz).
  - `win11-*` / `windows-*` / `win10-*` → Windows placeholder (D3D11 ANGLE, `Windows NT 10.0; Win64; x64` UA, Segoe UI fonts).
  - `linux-*` and unknown prefixes → Linux placeholder (preserves long-standing default).

  Captured baselines (the 6 real-device profiles in `@mochi.js/profiles`) are unaffected — `getProfile()` returns those directly without hitting the synthesizer.

  The `inferPlaceholderOsFromId` helper is exported as `@internal` for unit-test coverage. Reported by user observation; reproducible via `await mochi.launch({ profile: "mac-m1-chrome-stable", seed: "x" })` on any host (pre-fix produced Linux UA).

## 0.9.1

### Patch Changes

- Updated dependencies [a884318]
  - @mochi.js/inject@0.4.1

## 0.9.0

### Minor Changes

- c8e2055: Add `mochi.connect()` for attaching to existing CDP browsers + `profile: null` for no-spoof mode.

  **`mochi.connect(opts)`** — new top-level entry point that mirrors `puppeteer.connect`'s shape. Attaches to a Chromium that's already running and exposing a CDP browser endpoint over a WebSocket — BrowserBase / Browserless / your own gateway, dockerised Chromium, your own patched Chrome, or a re-attach to a previously-launched browser. Pass `wsEndpoint` directly or `browserURL` (mochi GETs `${browserURL}/json/version` to discover the WS URL). Includes `headers` for proxied / authenticated gateways. `session.close()` disconnects the WebSocket without killing the browser, matching `puppeteer.connect`'s convention. New `WebSocketCdpAdapter` + `connectWebSocketCdp()` in `packages/core/src/cdp/transport-ws.ts`; the existing pipe-mode `CdpTransport` is untouched. Lifecycle errors surface as a new `ConnectionLostError`.

  **`profile: null`** — new third state for `LaunchOptions.profile` and `ConnectOptions.profile`. Skips every fingerprint override: no `deriveMatrix`, no inject payload build, no `Page.addScriptToEvaluateOnNewDocument`, no `Network.setUserAgentOverride`, no `Emulation.setTimezoneOverride`, no locale / viewport CDP calls. The user gets mochi's API surface (humanClick, session.fetch, screenshot, cookie jar, the lifecycle ergonomics) without any spoof layered on top. Composes with both entry points: `mochi.launch({ profile: null })` for a fresh stock Chromium mochi just drives, `mochi.connect({ wsEndpoint, profile: null })` for the remote / patched browser case, or `mochi.connect({ wsEndpoint, profile: "id", seed: "..." })` to layer mochi's full spoof onto a remote browser. `Session.profile` is now `MatrixV1 | null`; `Session.owned` distinguishes launched (owned) from connected (borrowed) sessions.

  **`@mochi.js/behavioral`**: exports a new `DEFAULT_BEHAVIOR` constant (`{ hand: "right", tremor: 0.18, wpm: 60, scrollStyle: "smooth" }`) — the conservative-default behavioral profile mochi uses as the no-spoof fallback for `humanClick` / `humanType` / `humanScroll` when a session was launched with `profile: null` and there's no matrix-derived `behavior` block.

  **Type widening (additive)**: `LaunchOptions.profile` widens from `ProfileId | ProfileV1 | undefined` to `ProfileId | ProfileV1 | null | undefined`. No breaking change — existing `undefined` (auto-pick) and `string` / `ProfileV1` callers work unchanged.

  Tests: `tests/contract/connect-ws-transport.contract.test.ts` (Bun.serve mock CDP server, end-to-end `Browser.getVersion` round-trip + lifecycle assertions), `tests/contract/launch-no-profile.contract.test.ts` (verifies no spoof CDP overrides on the wire under `profile: null`), `packages/core/src/__tests__/connect.test.ts` (validation), `packages/core/src/__tests__/no-spoof-behavior.test.ts`, `packages/behavioral/src/__tests__/default-behavior.test.ts`.

  Docs: `docs/content/docs/api/core.md` (new `mochi.connect`, `ConnectOptions`, `ConnectionLostError`, `Session.owned`, no-spoof-mode subsection); `docs/content/docs/guides/connect-existing-chrome.md` (new — usage examples for direct WS, `browserURL` discovery, no-spoof, power-user spoof-on-top).

### Patch Changes

- Updated dependencies [c8e2055]
  - @mochi.js/behavioral@0.1.6

## 0.8.2

### Patch Changes

- 080e418: Add `PerformanceNavigationTiming` spoof module — closes the `dns:0 / tcp:0 / nextHopProtocol:""` headless-browser tell.

  **The leak.** Chrome launched via `--remote-debugging-pipe` (mochi's launch path) sometimes emits `PerformanceNavigationTiming` entries with `domainLookupStart === domainLookupEnd`, `connectStart === connectEnd`, and `nextHopProtocol === ""` even on cold cross-origin loads. Real Chrome on a real cold load shows nonzero DNS / TCP times and a populated `nextHopProtocol` (typically `"h2"` for HTTPS/2 origins). The empty/zero triad is a documented headless tell that FPJS's tampering ML has been observed reading.

  **The fix.** New `packages/inject/src/modules/performance-timing.ts`. Wraps each navigation entry returned by `performance.getEntriesByType("navigation")`, `performance.getEntries()`, and `performance.getEntriesByName()` in a `Proxy` that overrides only the four leaky fields (`domainLookupEnd`, `connectEnd`, `secureConnectionStart`, `nextHopProtocol`) when their live values are zero/empty. Every other property (`responseStart`, `responseEnd`, `transferSize`, etc.) passes through unchanged so legitimate timing fidelity is preserved. `instanceof PerformanceNavigationTiming` checks pass through the Proxy transparently.

  Handshake durations are derived from the matrix's `uaCh.connection.rtt` (clamped to 200ms): `tcp ≈ 0.55 × rtt`, `tls ≈ 0.1 × rtt`, with sensible defaults when `connection` is absent. DNS is a fixed 30ms.

  Idempotent: only patches when the live entry has the leaky shape (`end <= start` for the relevant phase). Browsers that populate real values (e.g. non-CDP launch paths) get them through unchanged.

  `toJSON()` is also overridden so `JSON.stringify(entry)` sees the patched values rather than the raw zeroes.

  Discovered empirically against `wrkx.app`'s FingerprintJS panel during the 2026-05-09 chaser-vs-Aixit suspect-score investigation: containerised mochi runs always emitted `dns:0, tcp:0, protocol:""` while a known-good real-Chrome run on the same fingerprint stack emitted `dns:30, tcp:28, protocol:"h2"`. The shim closes that observable gap.

- Updated dependencies [080e418]
  - @mochi.js/inject@0.4.0

## 0.8.1

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

- Updated dependencies [22b2a02]
  - @mochi.js/profiles@0.2.0
  - @mochi.js/consistency@0.1.4
  - @mochi.js/behavioral@0.1.5
  - @mochi.js/inject@0.3.1

## 0.8.0

### Minor Changes

- 52b5a45: Drop the Rust `wreq` HTTP layer; route `Session.fetch` through Chromium itself via CDP.

  `Session.fetch(url, init?)` now goes through the browser's own network stack rather than a parallel Rust HTTP layer. JA4 / JA3 / H2 are real Chrome by definition because Chromium is the client — there is no impersonator to keep in lockstep with the spoofed profile, no preset table to maintain, and no cdylib to install.

  **Breaking changes**

  - **Cookies inherit from the browser session.** A cookie set via `Page.goto` or `session.cookies.set` is sent on the next `session.fetch` call to the same origin automatically. The pre-0.7 wreq path was cookieless — callers that relied on a cookie-free out-of-band fetch should explicitly clear the jar (`session.cookies.set([])`) before the call, or set `init.credentials = "omit"` for the page-evaluate path.
  - **Non-GET routes through `page.evaluate("fetch")`; CORS applies.** Simple GETs (no `init`, no method override, no headers, no body) take a fast path through `Network.loadNetworkResource` which bypasses CORS at the network layer. Anything else (POST, custom headers, body) routes through a scratch-frame `fetch` call from `about:blank`, so cross-origin requests obey the same CORS rules a user's browser would.
  - **`Session.fetch` `Blob` / `FormData` / `ReadableStream` bodies throw with a clear diagnostic.** `string` / `ArrayBuffer` / typed arrays / `URLSearchParams` are supported; richer bodies will land in a follow-up PR.

  **Deprecations**

  - The `@mochi.js/net` and `@mochi.js/net-rs` packages are deprecated and no longer published. The cdylib install friction (`bunx mochi pm trust @mochi.js/net-rs`, the cross-platform prebuild matrix, the `cargo build` fallback) is gone with them.
  - `ProfileV1.wreqPreset` and `MatrixV1.wreqPreset` are deprecated. The runtime no longer reads either field; the schema retains them for one release for migration and will drop them in 0.8.

  **`ALL_BROWSER_PERMISSIONS` retuned for Chromium 148**

  The constant now matches `Browser.PermissionType` on Chromium 148. Removed entries no longer accepted by the runtime: `accessibilityEvents`, `captureHandle`, `flash`, `videoCapturePanTiltZoom`. Added entries: `ar`, `vr`, `handTracking`, `automaticFullscreen`, `cameraPanTiltZoom`, `capturedSurfaceControl`, `keyboardLock`, `pointerLock`, `localNetwork`, `localNetworkAccess`, `loopbackNetwork`, `smartCard`, `webPrinting`. Calls to `page.grantAllPermissions()` against an older Chromium will fall through with no behavior change; calls against 148 stop tripping the `Unknown permission type: accessibilityEvents` runtime error.

## 0.6.0

### Minor Changes

- 5705d38: Auto-detect Linux server env, default to `--headless=new`, surface a `headlessMode` option.

  Closes the "common deployment env" failure mode for `mochi.launch()` on a fresh Ubuntu / Debian server: previously a no-DISPLAY box would either crash on the first paint or hang while Chromium tried to attach to a non-existent display server. mochi now snapshots `(process.platform, DISPLAY, WAYLAND_DISPLAY, getuid, container probes)` at launch time and defaults `headlessMode` to `"new"` whenever the host is Linux without a display server.

  New `LaunchOptions` field:

  - **`headlessMode: "new" | "legacy" | "off"`** — supersedes the v0.1 `headless: boolean`. `"new"` emits `--headless=new` (modern headless: full rendering, near-byte-identical to headful for fingerprinting). `"legacy"` emits bare `--headless` for parity with older tooling. `"off"` runs headful and requires a display server / xvfb. The legacy `headless` field is retained — `true` maps to `"new"`, `false` to `"off"`.

  Resolution order:

  1. Explicit `headlessMode` wins.
  2. Legacy `headless: true | false` maps to `"new"` / `"off"`.
  3. Env-aware default — Linux without DISPLAY / WAYLAND_DISPLAY → `"new"`; everywhere else → `"off"`.

  New helper:

  - **`mochi.detectLinuxServerEnv()`** (and the named export `detectLinuxServerEnv` / `probeLinuxServerEnv`) — pure read of `process.platform`, `process.env.DISPLAY`, `process.env.WAYLAND_DISPLAY`, `process.getuid?.()`, and the container probes (`/.dockerenv`, `/proc/1/cgroup` mentions of `docker | containerd | kubepods`). Returns a `LinuxServerEnv` summary `{ serverNoDisplay, root, container, rationale }` so users can introspect what mochi would infer before launching.
  - **`resolveHeadlessMode(opts, env)`** — pure helper exposing the resolution table above, for callers that want to reason about the default without spawning.

  The existing root + auto-`--no-sandbox` fallback is unchanged — orthogonal axis, kept verbatim. Stealth conformance (`webdriver-detection.test.ts`) remains green: the inject layer rewrites the UA via `Network.setUserAgentOverride` so the `HeadlessChrome` substring under `--headless=new` never reaches the network or the page's `navigator.userAgent`.

  Docs: new `docs/getting-started/linux-server.md` covers the auto-detection, the `headlessMode` option, container guidance (Docker / Kubernetes / `--cap-add=SYS_ADMIN` trade-off), and the "if you really need it" xvfb path. `docs/quickstart.md` cross-links to the new page.

- dd9a3c9: Auto-pick the host-OS-matching profile when `LaunchOptions.profile` is omitted ( engineering follow-up to the strategic thesis).

  `mochi.launch({ seed })` (no `profile`) now succeeds on Linux, Mac, and Windows hosts — mochi consults the host's `(process.platform, process.arch)` pair and routes to the matching real-device baseline:

  - `linux/x64` → `linux-chrome-stable`
  - `darwin/arm64` → `mac-m4-chrome-stable`
  - `darwin/x64` → `mac-chrome-stable`
  - `win32/x64` → `windows-chrome-stable`

  On any unsupported host (FreeBSD, Linux arm64 today, Windows arm64, Alpine musl), launch throws with a precise diagnostic listing the six explicit profile IDs and a pointer to the `choose-your-profile` guide. We never silently fall back to a placeholder. Passing `profile` explicitly always wins; the auto-pick never overrides an explicit choice.

  `LaunchOptions.profile` is now optional (`profile?: ProfileId | ProfileV1`). When the auto-pick fires, mochi logs one INFO line so the inferred id is visible without an extra introspection call:

  ```
  [mochi] no profile supplied; auto-picked linux-chrome-stable for host linux/x64. To override: pass profile: "linux-chrome-stable" explicitly.
  ```

  New helper:

  - **`mochi.defaultProfileForHost(): ProfileId | null`** (and the named export `defaultProfileForHost` / `resolveDefaultProfileForHost`) — pure read of `process.platform` / `process.arch`. Returns `null` on unsupported hosts. Use it to introspect what mochi would pick before launching.

  The strategic rationale: spoofing Windows from a Linux server is the wrong default. Linux is a real-user signal in WAFs trained on real traffic, not a bot signal — high-value user segments (developers, engineers, researchers) are heavily Linux-skewed and CTOs do not flag their own engineering team. Production validation: `aone.gg` / FingerprintJS Pro v4 / Linux DC IP / `bot: not_detected` / `suspect_score: 8` (vs patched Chrome 14-18, CloakBrowser 20+) on 2026-05-08. See `concepts/stealth-philosophy` for the full thesis + evidence.

  Docs: README "Proof" subsection, `concepts/stealth-philosophy` ("Default to the host OS, not Windows"), `reference/comparison` ("Default profile strategy" axis), `reference/faq` ("Should I spoof Windows even when running on a Linux server?"), `reference/glossary` (host-OS asymmetry, privacy-fallback, tampering ML score), and inline notes on `getting-started/install` + `getting-started/linux-server`.

### Patch Changes

- Updated dependencies [d79b782]
  - @mochi.js/inject@0.3.0
  - @mochi.js/consistency@0.1.3
  - @mochi.js/behavioral@0.1.4

## 0.4.0

### Minor Changes

- 60dac27: DX cluster: cookie persistence + localStorage helpers + grantAllPermissions.

  Three additive convenience APIs around CDP domains we already drive. None
  are stealth-critical — they bring mochi to feature-parity with nodriver /
  puppeteer / playwright on the "warm a session, persist state, grant
  permissions for tests" use cases.

  - **`Session.cookies.{save,load}`** — JSON-backed jar persistence keyed off
    `Storage.getCookies` / `Storage.setCookies` with a regex `pattern` filter
    on cookie domain. File format pinned by `CookieJarFile`: `version`,
    `savedAt` (ISO-8601 UTC), `mochiVersion`, `pattern`, `count`, `cookies`.
    Format version `1`; loaders refuse unknown versions with a precise error.
    JSON, not pickle (Bun-native runtime per PLAN.md I-3).

  - **`Page.localStorage.{get,set}`** + **`Page.sessionStorage.{get,set}`** —
    thin wrappers around `DOMStorage.getDOMStorageItems` /
    `DOMStorage.setDOMStorageItem`. Returns `Record<string, string>`. Frame
    scope defaults to the page's main-frame origin; pass `{ origin }` to
    scope explicitly. The two surfaces are identical except for the
    `isLocalStorage` flag CDP receives.

  - **`Page.grantAllPermissions(opts?)`** — wraps `Browser.grantPermissions`
    with the full `Browser.PermissionType` descriptor list (pinned by
    `ALL_BROWSER_PERMISSIONS`). Pairs with R-036: this method grants ALL at
    the _browser_ level, but page-side `navigator.permissions.query()` still
    returns per-permission state per `matrix.uaCh["permissions-defaults"]`.
    Origin defaults to the page's main-frame origin; pass `{ origin }` for
    explicit scoping.

  The pre-0257 method shape `Session.cookies(filter)` / `Session.setCookies(...)`
  is gone — `Session.cookies` is now a getter returning the `CookieJar`
  namespace (`get`, `set`, `save`, `load`).

  nodriver-cited (`docs/audits/nodriver.md` LOW × 3).

- a92cebf: Implement `Page.screenshot` via CDP `Page.captureScreenshot`.

  The placeholder `NotImplementedError` rejection is replaced with a real
  implementation that supports the standard puppeteer/playwright option
  surface:

  ```ts
  interface ScreenshotOptions {
    format?: "png" | "jpeg" | "webp"; // default: "png"
    quality?: number; // 0-100, JPEG/WebP only
    fullPage?: boolean; // capture beyond viewport
    clip?: { x; y; width; height; scale? };
    omitBackground?: boolean; // transparent PNG bg
    encoding?: "binary" | "base64"; // default "binary" → Uint8Array
  }
  ```

  Return type is discriminated by `encoding`: `Uint8Array` for the default
  binary mode, `string` for the raw base64 passthrough.

  `fullPage: true` reads the document size via `Page.getLayoutMetrics`,
  overrides the device metrics via `Emulation.setDeviceMetricsOverride`,
  captures with `captureBeyondViewport: true`, then clears the override via
  `Emulation.clearDeviceMetricsOverride`. The override clear runs in a
  `finally` block so a capture failure does not leave the page wedged at an
  oversized viewport.

  `Page.captureScreenshot` is verified absent from the PLAN.md §8.2
  forbidden list — only `Runtime.enable` and `Page.createIsolatedWorld` are
  disallowed unconditionally.

  Out of scope (separate briefs): element-bounded capture (`{ element }`,
  needs `DOM.getBoxModel` integration) and PDF generation
  (`Page.printToPDF`).

- 5cb8160: init-script delivery via `Fetch.fulfillRequest` body splice + CSP rewriter
  (architectural pivot).

  Replaces `Page.addScriptToEvaluateOnNewDocument` as the inject delivery
  mechanism with a `Fetch.requestPaused` → `Fetch.fulfillRequest` body splice
  that inlines the payload as a same-origin `<script class="__mochi_init_script__">`
  at end-of-`<head>`, BEFORE the document's first non-comment `<script>`.
  Closes the source-attribution leak the previous channel carried (the
  "Vanilla CDP" detection probe). After this lands the inject is
  byte-indistinguishable from a developer's own `<script>` tag.

  ## Behavioural changes

  - **`Fetch.enable` becomes always-on per session** (gated only on
    `bypassInject`). Patterns:
    `[{ urlPattern: "*", resourceType: "Document" }, { urlPattern: "*" }]`.
    Document responses get the body splice; non-Document requests get an
    immediate `Fetch.continueRequest` (zero-cost pass-through).
  - Proxy auth (`SessionInit.proxyAuth`) now shares the SAME `Fetch.enable`
    call (single owner — no double-enable). The auth-only path still skips
    the protocol surface when both `bypassInject:true` AND no proxy creds are
    set.
  - The inject `<script>` tag carries no `defer`/`async`/`type="module"` —
    parser-blocking is required to keep the timing guarantee.
  - The payload is wrapped in a self-removing IIFE
    (`document.currentScript?.remove()` first; post-`load` DOM walk as belt).

  ## CSP rewriter

  Handles `Content-Security-Policy` AND `Content-Security-Policy-Report-Only`
  response headers AND `<meta http-equiv="Content-Security-Policy">` tags.
  Reuses existing `'nonce-…'` tokens; admits `'strict-dynamic'`; falls back
  to `'unsafe-inline'` for nonce-less restrictive policies. Multiple CSPs
  (header + meta) are each rewritten independently so most-restrictive-wins
  still admits us.

  ## PLAN.md amendments

  - §8.4 — full rewrite documenting the new mechanism and trade-offs.
  - §8.2 — note that `Fetch.enable` is allowed (only `Runtime.enable` and
    `Page.createIsolatedWorld` are forbidden); cost characterisation added.

  ## Migration

  The public `Page.addInitScript()` / `Page.removeInitScript()` API is
  unchanged — convenience-layer scripts (e.g. Turnstile detector) still
  flow through `Page.addScriptToEvaluateOnNewDocument`. Only the
  session-level matrix payload moved to the new channel.

## 0.3.0

### Minor Changes

- 61ee52c: Add exit-IP / timezone / locale consistency probe + reconciler with
  privacy-fallback default.

  Closes the cross-layer leak where `(matrix.timezone, matrix.locale)` and
  the apparent **exit IP** disagree — a fingerprinter computing
  `Date.getTimezoneOffset()` and cross-referencing against the IP's
  geolocation sees a mismatch any time the matrix doesn't match the proxy
  egress (US-West profile + EU residential proxy → -480min vs UTC+1, the
  canonical bot signature).

  At launch, `@mochi.js/core` now probes the apparent exit IP through wreq
  (using the matrix's TLS preset, so the geo service sees the same JA4 /
  headers as user traffic). 7-endpoint registry (`ip.decodo.com/json`,
  `ipinfo.io/json`, `ipwho.is/`, `api.ip.sb/geoip`, `ifconfig.co/json`,
  `api.iplocation.net/`, `ipapi.co/json/`), shuffled-sequential, 2s per
  endpoint, 4-attempt cap. Per-endpoint adapter normalises to a shared
  `ExitGeo` shape; schema mismatch returns `null` (no throw).

  The reconciler cross-references the probed geo against the matrix's
  `(timezone, locale)` and applies one of four
  `LaunchOptions.geoConsistency` modes:

  - `"privacy-fallback"` _(default)_ — override matrix to `UTC` + `en-US`
    on mismatch (or probe failure). Fingerprints as a Tor / hardened-FF
    user. Benign in most threat models.
  - `"auto-correct"` — override matrix tz/locale with IP-derived values.
  - `"strict"` — throw `GeoMismatchError` on mismatch.
  - `"off"` — skip the probe entirely (offline tests).

  Mismatch criteria use timezone OFFSET minutes (via
  `Intl.DateTimeFormat({timeZoneName: "longOffset"})`), not zone names —
  `America/New_York` and `America/Detroit` share an offset and fingerprint
  identically. Locale region comes from `Intl.Locale(matrix.locale).region`.

  JS-side timezone spoof delivered per-target via CDP
  `Emulation.setTimezoneOverride` — drives both
  `Intl.DateTimeFormat().resolvedOptions().timeZone` AND
  `Date.getTimezoneOffset()` because Chromium's V8 reads from the same
  internal source. Single CDP send, no `Network.enable` / `Emulation.enable`
  required (so PLAN.md §8.2 invariants are unaffected).

  Probe results are NOT cached across sessions — proxy IPs rotate; stale
  cache is worse than no cache.

  PLAN.md §9 amended with the new `9.6` subsection (cross-layer IP/TZ/Locale
  consistency). `docs/content/docs/reference/limits.md` documents the
  probe rate-limit handling, the privacy-fallback default rationale, and
  the Tor-exit edge case.

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
  - @mochi.js/inject@0.2.1
  - @mochi.js/behavioral@0.1.3

## 0.2.2

### Patch Changes

- 92eda96: Audit and trim `DEFAULT_CHROMIUM_FLAGS` against patchright's
  `chromiumSwitchesPatch.ts:20-34` removal list.

  Drops these passive command-line bot-tells from the production default
  flag set:

  - `--disable-component-update` (patchright drops; PRB drops)
  - `--disable-default-apps` (patchright drops)
  - `--disable-background-networking` (patchright drops)
  - `--disable-sync` (patchright drops)

  Plus the noise-reduction `--disable-features=` extras
  (`OptimizationHints,MediaRouter,InterestFeedContentSuggestions,
CalculateNativeWinOcclusion`) that previously rode along with the
  load-bearing tokens.

  Adds `LaunchOptions.hermetic?: boolean` (default `false`). When `true`,
  re-applies the dropped flags on top of the production default — used by
  `@mochi.js/harness`, `@mochi.js/cli` `mochi capture`, and the stealth
  conformance fixture so baseline collection isn't perturbed by updater /
  sync / default-apps / feed-prefetch network noise.

  Production `mochi.launch()` callers get the cleaner flag set without any
  opt-in: no command-line bot-tells, normal-looking updater + sync traffic.

  `--disable-features=` token now split — production keeps `Translate,
AcceptCHFrame,IsolateOrigins,site-per-process` (load-bearing for inject
  reach + UA-CH alignment + headed translate-prompt suppression); hermetic
  appends the noise-reduction extras as a separate token (Chromium merges
  multiple `--disable-features=` tokens into a union).

  PLAN.md §8.6 amended with the new two-tier flag set + per-flag decision
  lineage table. `docs/content/docs/reference/limits.md` documents the
  hermetic-mode surface.

  Verified: `--enable-unsafe-swiftshader` is not emitted anywhere
  (patchright strips Playwright's leak; mochi never had it). Legacy
  `--headless` (without `=new`) is not emitted anywhere — the `=new` form
  is the only headless mode mochi ever spawns.

  Source: patchright `chromiumSwitchesPatch.ts:20-34`,
  puppeteer-real-browser `lib/cjs/index.js:57-58`.

- 7cb4997: First-run UX on Linux — close two opaque-crash surfaces.

  `mochi browsers install` now runs a `<binary> --version` smoke after extract on `linux64`. On `error while loading shared libraries: <name>.so` we parse the offending lib, print the verbatim apt install line for the canonical Chromium-for-Testing dep set (the same list both CI workflows install), and exit non-zero so the user knows the install isn't truly done. On success we print "Chromium binary verified — launches cleanly". The install command also prints a one-line warning if it detects `uid === 0` so the root-sandbox gotcha shows up before the launch crashes opaquely. The CLI does not auto-`sudo` — the user runs the apt line themselves.

  `@mochi.js/core` extends the v0.1.4 early-exit diagnostic in `proc.ts` with a second pattern matching the same missing-shared-libraries stderr — so any future `mochi.launch()` that hits this case (e.g. user installed mochi pre-v0.1.5 and ran the smoke before the apt-get) surfaces the same hint instead of the bare `BrowserCrashedError` / `EPIPE`.

  Both CI workflows + the new install path share a single `LINUX_RUNTIME_DEPS` constant in `packages/cli/src/lib/linux-deps.ts`; a contract test asserts the workflows install every dep in the constant so they cannot drift. Plus a "Linux runtime dependencies" Prerequisites block in `docs/quickstart.md` and `docs/content/docs/getting-started/install.md`.

## 0.2.1

### Patch Changes

- 59d7b91: Auto-add `--no-sandbox` when `mochi.launch()` detects Linux + root UID and no `--no-sandbox` is already set. Chromium refuses to start as root with the user-namespace sandbox enabled; previously this surfaced as an opaque `EPIPE: broken pipe` from the first CDP write. Now mochi logs a one-line warning naming the fingerprint trade-off and injects the flag so the launch succeeds.

  Stealth-critical workloads can opt out with `allowRootWithSandbox: true` on `LaunchOptions`. PLAN.md §8.6 still excludes `--no-sandbox` from `DEFAULT_CHROMIUM_FLAGS` — this is a runtime fallback, not a default. The flag is logged so it's never silent.

- 2855668: `spawnChromium` now diagnoses Chromium dying within 750ms of spawn and surfaces a clear error naming the most likely cause — sandbox refusal under root, missing libs, malformed flags — instead of letting the eventual EPIPE on the first CDP write bubble up with no context. When the stderr tail matches Chromium's "Running as root without --no-sandbox" pattern, the error includes the canonical fixes (run as non-root, `chmod 4755 chrome-sandbox`, or `args: ['--no-sandbox']`).

  Plus a "Linux gotcha — Chromium and root" note in `docs/quickstart.md` so server / dev-rig setups don't hit the EPIPE first.

- a7d8ca9: Defensive UA override at the network layer.

  `Session.newPage` now sends `Network.setUserAgentOverride` on every page
  session immediately after `Target.attachToTarget` and before
  `Page.addScriptToEvaluateOnNewDocument`. Closes a real defensive gap: under
  `--headless=new` Chromium's bare User-Agent header still contains
  `"HeadlessChrome"`. The inject module patches `navigator.userAgent` in JS,
  but early subresource / preload / navigation `Network.requestWillBeSent`
  events fire BEFORE any document script can run — only a CDP-level UA
  override on the page session catches those bytes.

  `Network.setUserAgentOverride` is a stateless setter that does NOT require
  `Network.enable`, so the §8.2 invariant (no global `Network.enable`) is
  unaffected. Skipped under `bypassInject:true` because capture flows must
  record the bare browser fingerprint.

  Pinned by a new two-layer contract test
  (`tests/contract/headless-ua-no-leak.contract.test.ts`):

  1. The built inject payload bundle contains no `"Headless"` substring.
  2. `Session.newPage` sends `Network.setUserAgentOverride(matrix.userAgent)`
     on the page session before the inject install, and the simulated
     `Network.requestWillBeSent` UA is the matrix UA — never `"HeadlessChrome"`.

  Sources: udc `__init__.py:519-527`, nodriver `tab.py:203-222` (both flag
  the same defensive gap as LOW).

- ddcc49e: Pin Chromium's outer-window geometry from `matrix.display.{width,height}` per

  Under `--headless=new` Chromium's outer window defaults to 800×600 regardless
  of the JS-spoofed `screen.*` surface — `fingerprint-scan.com` flags the
  mismatch because `window.outerWidth/outerHeight` reads from the OS-level
  window, not the spoof. `launch.ts` now derives `--window-size=<W>,<H>` from
  the matrix's `display` slot and passes it to `spawnChromium`, so the OS
  window matches the spoof. When `display.{width,height}` is missing or
  malformed the flag is omitted (the matrix is canonical — no hardcoded
  fallback).

  Defensive scrub: `--start-maximized` is stripped from `LaunchOptions.args`
  and `MOCHI_EXTRA_ARGS`. UDC adds it; mochi must not — it produces
  host-OS-dependent geometry that drifts from the matrix's display spoof.

  Source: UDC `__init__.py:410-411`, UDC issue #2242.

- ef00f63: Tighten the worker payload-inject race window via patchright's
  `Runtime.evaluate("globalThis", { serialization: "idOnly" })` trick
  . On `Target.attachedToTarget` for a worker-style target,
  mochi now extracts the worker's executionContextId by parsing
  `objectId.split(".")[1]` of an idOnly-serialised `globalThis`, then
  delivers the inject via `Runtime.callFunctionOn({ functionDeclaration,
executionContextId, returnByValue: true })` before
  `Runtime.runIfWaitingForDebugger`. The bound-context call replaces
  v0.1.x's bare `Runtime.evaluate({ expression: payload.code })`, which
  worked but was coarser.

  The §8.2 forbidden-method invariant is preserved: `Runtime.enable` is
  never sent. The whole point of the idOnly bootstrap is to extract the
  contextId without it. A new contract test
  (`tests/contract/worker-idonly-bootstrap.contract.test.ts`) pins the
  call sequence and the negative invariant, and asserts the parser fails
  loudly if Chromium ever shifts the objectId wire format.

  Source-cited reference: patchright `crServiceWorkerPatch.ts:32-43`,
  `crPagePatch.ts:404-417`.

## 0.2.0

### Minor Changes

- be1c69b: Closed-shadow-root piercing locator on `Page`.

  `@mochi.js/core` adds `Page.querySelectorPiercing(selector)` /
  `Page.querySelectorAllPiercing(selector)` plus a public `ElementHandle`. The
  locator walks `DOM.getDocument({ depth: -1, pierce: true })` and matches a
  parsed CSS selector in JS, which is the only way to find elements inside
  **closed** shadow roots — `DOM.querySelector(..., pierce: true)` itself does
  not pierce closed shadows. Required for the Turnstile auto-clicker
  on Cloudflare CDN integrations where the iframe lives behind a closed shadow
  root. Algorithm sourced from patchright `framesPatch.ts:868-1012`
  (`_customFindElementsByParsed`); selector subset is intentionally narrower
  (tag / id / class / attribute / descendant combinator / comma lists). XPath
  deferred per task brief — TODO if a future surface needs it.

  `Page.humanClickHandle(handle, opts)` is the click-via-handle counterpart;
  required when no CSS path can name the element from the parent document.

  `@mochi.js/challenges` updates `installTurnstileAutoClick` so each poll tick
  also performs a host-side piercing scan via the new locator. Inject-side
  detection (light DOM + open shadows) and host-side piercing detection
  (closed shadows) merge into a single per-widget state machine; clicks route
  through `humanClick(selector)` for selector-reachable widgets and
  `humanClickHandle(handle)` for closed-shadow widgets. Documented in
  `packages/challenges/src/inject.ts` why the inject MutationObserver alone
  cannot pierce closed shadows.

  Neither `DOM.getDocument` nor `DOM.resolveNode` is on the §8.2 forbidden
  list, and no `Runtime.enable` / `Page.createIsolatedWorld` are used.

### Patch Changes

- 4f1b81e: Pass `--lang=<matrix.locale>` to the spawned Chromium so the network-layer
  `Accept-Language` header agrees with the JS-layer `navigator.language(s)`
  spoof. Closes the PLAN.md I-5 leak surfaced by the upstream audit.

  Without this flag, Chromium falls back to the host OS locale (or the
  `en-US,en;q=0.9` default), and a site that cross-references the request
  header against `navigator.languages` saw a mismatch. The flag is sourced
  from the matrix's primary BCP-47 locale; multi-locale q-weighting is
  derived by Chromium itself from this single primary, while the broader
  list still flows through `matrix.languages` to the inject layer.

  We deliberately do NOT fall back to the host locale (unlike
  undetected-chromedriver `__init__.py:359-369`) — locale comes from the
  matrix or `--lang` is omitted, surfacing a missing-locale profile bug
  loudly instead of leaking the OS default.

  Source-cited reference: udc `__init__.py:359-369`.

- Updated dependencies [be1c69b]
- Updated dependencies [1231131]
  - @mochi.js/challenges@0.2.1
  - @mochi.js/inject@0.2.0
  - @mochi.js/consistency@0.1.1
  - @mochi.js/behavioral@0.1.2

## 0.1.2

### Patch Changes

- 707e42d: Turnstile auto-click convenience layer.

  New package `@mochi.js/challenges` exposing `installTurnstileAutoClick(page, opts)` plus
  the `LaunchOptions.challenges.turnstile.autoClick` ergonomic surface on `mochi.launch`.
  The detector mounts a `MutationObserver` (iframe-only filter) in the page's main world
  via `Page.addScriptToEvaluateOnNewDocument({ runImmediately: true, worldName: "" })`
  per PLAN.md §8.4. Clicks reuse the existing Bezier+Fitts behavioral synth from
  `@mochi.js/behavioral` — no new fingerprint surface, no new globals, no Runtime.enable.

  Scope: visible-checkbox auto-click only. Image/audio/managed escalations fire
  `onEscalation(reason)` and bail (image-challenge solving is deferred to v0.3 via the
  solver-hook surface that lands then). See `docs/limits.md` for the limit entry.

  `@mochi.js/core` adds `Page.addInitScript` / `Page.removeInitScript` so the challenges
  module can install its main-world inject without owning the router.

- Updated dependencies [707e42d]
  - @mochi.js/challenges@0.2.0

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

- Updated dependencies [7073097]
  - @mochi.js/behavioral@0.1.1
  - @mochi.js/inject@0.1.1
  - @mochi.js/net@0.1.1

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
  trims to just `audio.**` + `canvas.**` (deferred to a future minor).
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
