# @mochi.js/core

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
