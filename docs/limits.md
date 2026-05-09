# Limits — what mochi does not cover

> A living document. Per invariant **I-8** ("honesty over marketing"), every
> entry must be added in the same PR that creates the limit, and stale
> entries must be flipped in the PR that closes the gap.
>
> Each entry: what's covered (or not), why, what a user can do about it.

This is the architectural-honesty page. mochi gives you the best possible
JS-layer answer for stealth automation against Chromium-family WAFs. There
are things the JS layer cannot do; this page enumerates them. The
"What works / what doesn't" table in the [README](../README.md) is the
short-form summary; this file is the per-vector root cause.

Read it before opening an issue saying "X site detects mochi" — half the
answers are already here.

---

## v0.2 wave-4 surfaces (just landed)

### Audio (`OfflineAudioContext`) byte-accurate fingerprint — covered

**Status:** covered as of task 0267 (was: deferred to v0.7 capture under task 0071)
**Root cause (closed):** Faithful audio spoofing requires precomputed
per-(profile, sample-rate) byte tables that match real Chromium's
`OfflineAudioContext.startRendering()` output to byte equality. Runtime
synthesis cannot reproduce the upstream digest because the page-side
script reads back `Float32Array` channel data through a path that involves
the host CPU's f32 rounding, not just the spoofed bytes.
**Mitigation (the technique that makes it work):** R-047 (`audioFingerprint`)
emits the captured baseline keyed by sample rate. The
`packages/inject/src/modules/audio-fingerprint.ts` module patches
`OfflineAudioContext.prototype.startRendering` to return a `Promise<AudioBuffer>`
whose channel data is the matrix-derived bytes. The critical detail is
the residual: probes typically digest the 489 samples in the index range
`[4510..4999)`, and the page's own readback runs through a `Float32Array`
view. We distribute the byte residual across those 489 samples and apply
`Math.fround` to model the f32 readback step page-side. The resulting
digest matches the captured baseline byte-exactly on every host
architecture (not just Mac M-series), because we model the readback
truncation rather than relying on the host's native FPU to produce the
bytes.
**Affected probes:** `OfflineAudioContext.startRendering()` byte hash
(Browserleaks audio, FPJS visitor-id audio, creep.js audio, bot.incolumitas
audio probe).
**User workaround:** none needed.
**Tracking:** task 0267.

### Canvas (`toDataURL`) byte-accurate fingerprint — covered

**Status:** covered as of task 0267 (was: deferred to v0.7 capture)
**Root cause (closed):** Faithful canvas spoofing requires the captured
`toDataURL` PNG bytes for the standard probe payloads, plus a heuristic to
distinguish "this is a fingerprint probe" from "this is legitimate page
canvas use" so that real apps still render. Runtime synthesis cannot
reproduce upstream Skia output to byte equality.
**Mitigation:** R-048 emits the captured baseline; the
`packages/inject/src/modules/canvas-fingerprint.ts` module patches
`HTMLCanvasElement.prototype.toDataURL` (and the `OffscreenCanvas` /
`getImageData` siblings) to detect the standard probe shape. The probe
heuristic is canvas size: probe-sized (300×150) canvases get the captured
baseline returned verbatim, so the probe-side `hashString(url)` + length
+ first-50-char prefix match the captured fingerprint byte-exactly.
Non-probe sizes (any canvas the page legitimately renders to a non-default
dimension) fall through to native rendering, so application canvas use
keeps working.
**Affected probes:** Browserleaks canvas, FPJS visitor-id canvas component,
creep.js canvas.
**Known asymmetry:** a probe that intentionally renders to a non-300×150
canvas to evade the heuristic would see native rendering rather than the
captured baseline. The trade-off is deliberate per task 0267 — false
positives on legitimate canvas use would break far more apps than the
narrow detection-evasion window costs us. v0.3+ is exploring per-pixel
noise on non-probe canvases as a generalization.
**User workaround:** none needed for the standard probe surface.
**Tracking:** task 0267; per-pixel noise generalization in v0.3+ scope.

### Turnstile auto-click — covered (visible-checkbox variants only)

**Status:** covered as of task 0220 (was: tracked in task 0220, partial coverage)
**Root cause:** Cloudflare Turnstile escalates a fraction of visitors to
image / audio / managed-mode challenges that require either a 3rd-party
solver (2captcha / anti-captcha) or fail the bot heuristics outright. The
convenience layer in `@mochi.js/challenges` deliberately does NOT click
randomly into image-challenge iframes — that's the definitional
"obviously a bot" tell. Visible checkbox variants (the ~80% case) are
covered.
**Mitigation:** `mochi.launch({ challenges: { turnstile: { autoClick: true } } })`
auto-clicks the visible checkbox through the existing behavioral synth
(Bezier path + Fitts's-Law dwell from `@mochi.js/behavioral`). For the
remaining cases — image, audio, managed — the convenience layer fires
`onEscalation(reason)` (`"image-challenge" | "managed" | "timeout"`) and
bails rather than clicking blindly. Wire a 3rd-party solver in
`onEscalation` if you need to handle escalations.
**Affected probes:** Turnstile in environments where the bot heuristics
escalate beyond the first checkbox.
**User workaround:** wire a 3rd-party solver in `onEscalation`. For
invisible / managed variants the auto-click layer is a no-op — those
resolve on page load via Turnstile's own bot heuristics, which is a
function of mochi's stealth posture (handled by inject + behavioral).
**Tracking:** task 0220 (shipped). Image / audio / managed solving
deferred to v0.3 first-party solver hooks.

### `Page.screenshot` — covered (full-page + clip + viewport)

**Status:** covered as of task 0265 (was: `NotImplementedError`)
**Root cause (closed):** `Page.screenshot` was a placeholder that threw
`NotImplementedError`. CDP `Page.captureScreenshot` is the canonical
mechanism; the implementation is ~30 lines and not on PLAN.md §8.2's
forbidden list.
**Mitigation:** `Page.screenshot(opts)` now returns `Uint8Array` (default,
`encoding: "binary"`) or `string` (`encoding: "base64"`). Supported opts:
`format` (`"png" | "jpeg" | "webp"`), `quality` (0–100, JPEG/WebP only),
`fullPage`, `clip` (`{ x, y, width, height, scale? }`), `omitBackground`.
For `fullPage: true` we read content size via `Page.getLayoutMetrics`,
override device metrics to that size via
`Emulation.setDeviceMetricsOverride`, capture, then
`Emulation.clearDeviceMetricsOverride` to restore.
**Remaining gap — element-bounded capture:** `Page.screenshot({ element: handle })`
is NOT yet implemented. Element-bounded capture requires
`DOM.getBoxModel` to derive the clip rect from an `ElementHandle` —
tracked separately.
**User workaround:** until element-bounded capture lands, call
`Page.screenshot({ clip: { x, y, width, height } })` with manually-derived
coordinates, or use `fullPage: true` and crop client-side.
**Tracking:** task 0265 (shipped); element-bounded capture is a separate
brief.

### Cookie persistence (`Session.cookies.{save,load}`) — covered

**Status:** covered as of task 0257
**Root cause (closed):** previously, callers had to round-trip cookies
through `Session.cookies()` + their own JSON serializer. nodriver ships
this with pickle, which doesn't fit a Bun-native codebase.
**Mitigation:** `Session.cookies.save(path, { pattern? })` writes JSON
(NOT pickle) with a small header (`version`, `savedAt`, `mochiVersion`,
`pattern`, `count`) plus the `cookies` array. `Session.cookies.load(path, { pattern? })`
reads it back. `pattern` is a regex applied to cookie domain; default
`.*` matches all. Underlying CDP: `Storage.getCookies` for save,
`Storage.setCookies` for load. The save → load round-trip is lossless
(every CDP cookie field round-trips identically).
**Affected probes:** none — DX feature.
**User workaround:** none needed.
**Tracking:** task 0257.

### `Page.localStorage.{get,set}` and `Page.sessionStorage.{get,set}` — covered

**Status:** covered as of task 0257
**Root cause (closed):** previously, callers had to `page.evaluate(() => localStorage.foo)`
which round-trips through the lossier `Runtime.callFunctionOn` JSON
serialization path. Direct CDP DOMStorage access avoids that surface.
**Mitigation:** `page.localStorage.get()` returns `Record<string, string>`;
`page.localStorage.set({ ... })` writes each key. Backed by
`DOMStorage.getDOMStorageItems` and `DOMStorage.setDOMStorageItem`.
Frame-scoped — defaults to the current main-frame origin; pass
`{ origin: string }` for cross-origin. `Page.sessionStorage` has the same
shape (`isLocalStorage: false` on the underlying CDP call).
**Affected probes:** none — DX feature.
**User workaround:** none needed.
**Tracking:** task 0257.

### `Page.grantAllPermissions()` — covered

**Status:** covered as of task 0257
**Root cause (closed):** for tests / dev sessions, granting individual
permissions one-by-one through `Browser.grantPermissions` is tedious.
**Mitigation:** `page.grantAllPermissions()` (or with `{ origin? }`)
wraps `Browser.grantPermissions` with the full
`Browser.PermissionDescriptor` list (~25 entries: geolocation, camera,
microphone, notifications, clipboard, sensors, …). Pairs with R-036:
the Browser-domain grant is unconditional, but page-side
`navigator.permissions.query()` still returns per-permission state per
the matrix's spoofed defaults. Production users typically don't need
this; tests do.
**Affected probes:** none — DX feature.
**User workaround:** none needed.
**Tracking:** task 0257.

### Init-script delivery without `Page.createIsolatedWorld` — covered (dual mechanism)

**Status:** covered as of task 0266
**Root cause (closed):** `Page.addScriptToEvaluateOnNewDocument` carries an
attribution leak — the "did this script come from a CDP-injected
addScriptToEvaluateOnNewDocument call?" probe surface that the "Vanilla
CDP" detection family checks for. PLAN.md §8.2 already forbids
`Runtime.enable` and `Page.createIsolatedWorld` for inject delivery; this
brief closes the remaining attribution surface.
**Mitigation (dual-mechanism):**
  1. **Primary path — `Fetch.fulfillRequest` body splice on Document
     responses.** `Fetch.enable` is now always-on per session (combined
     with the existing proxy-auth `handleAuthRequests` handler).
     `Fetch.requestPaused` listener: on a `Document` resourceType, fetch
     the original response, parse + rewrite CSP (header AND
     `<meta http-equiv="Content-Security-Policy">` in the HTML body, with
     nonce reuse where present and `'unsafe-inline'` fallback where the
     policy mode requires it), splice the inject as inline
     `<script class="mochi-init" id="<randomHex>">` at end-of-head BEFORE
     the first non-comment `<script>`, and reply via
     `Fetch.fulfillRequest` with the rewritten body. The injected node
     self-removes from the DOM on first execution
     (`document.currentScript?.remove()` as the first line of the IIFE);
     a post-`load` `DOM.querySelectorAll(".mochi-init")` walk strips any
     stragglers. Non-Document `requestPaused` events are auto-forwarded
     via `Fetch.continueRequest` so non-document traffic costs nothing.
  2. **Fallback path — `Page.addScriptToEvaluateOnNewDocument({ runImmediately: true, worldName: "" })`.**
     `Fetch.fulfillRequest` does not intercept `about:blank`, `data:`,
     or other non-HTTP nav targets. For those, we fall through to the
     classic CDP install. The attribution leak is irrelevant on
     `about:blank` (no page script to detect us with), so the trade-off
     is acceptable.
**Idempotency guard:** `globalThis.__mochi_inject_marker` is set on first
run. If both delivery mechanisms fire (e.g. a same-origin nav that
crosses the `Fetch` boundary), the second-pass script self-removes
without re-running.
**Affected probes:** "Vanilla CDP" detection probes that flag
`addScriptToEvaluateOnNewDocument` source attribution. After this lands,
the inject pipeline is byte-indistinguishable from a same-origin
developer's own `<script>` tag at the top of `<head>`.
**User workaround:** none needed.
**Tracking:** task 0266; PLAN.md §8.4 (amended).

### Worker `idOnly` inject on transient workers — best-effort

**Status:** best-effort (architectural — JS-layer ceiling)
**Root cause:** `Page.addScriptToEvaluateOnNewDocument` doesn't apply to
worker targets; Chromium has no equivalent "run before any script" hook
for workers. The best mochi can do is bind to the worker's V8 isolate
after creation but before user code runs. Real-world pages
(bot.sannysoft, deviceandbrowserinfo, incolumitas, fingerprintjs) commonly
spawn brief workers whose entire lifecycle finishes before our
`Runtime.callFunctionOn` roundtrip completes, even with
`Target.setAutoAttach({waitForDebuggerOnStart:true})` — the worker can die
between `Target.attachedToTarget` and our reply.
**Mitigation:** we attach to `worker` / `service_worker` / `shared_worker`
/ `audio_worklet` targets, send
`Runtime.evaluate("globalThis", { serialization: "idOnly" })` to extract
the executionContextId without ever issuing `Runtime.enable`, then
deliver the payload via
`Runtime.callFunctionOn({ functionDeclaration, executionContextId, returnByValue: true })`.
Per the v0.2 tightening (commit 20ce20e), both the inject and the
following `Runtime.runIfWaitingForDebugger` carry a `timeoutMs: 5_000`
cap — real workers reply in single-digit ms, so 5s is generous, and
orphan workers no longer hold the router for the full 30s default. The
warn-log is downgraded to silent for the expected race fingerprints
(`CdpTimeoutError`, `Session with given id not found`, `Target closed`);
a genuine bug (bad contextId, schema drift) still logs.
**Affected probes:** any probe that runs first-thing inside a transient
`Worker` / `SharedWorker` / `ServiceWorker` / `AudioWorklet` and
compares results to main-thread results. Page-world inject is unaffected;
this only matters for sites that scope detection inside short-lived
workers.
**User workaround:** none at JS layer. Profiles can be marked
"worker-stealth-sensitive" in v2 so user code can opt out of probes that
use workers.
**Tracking:** Chromium upstream (likely never lands as a public CDP method —
security-sensitive). A future architectural fix on our side is to have
the router subscribe to `Target.detachedFromTarget` and proactively
reject pending requests for dead sessions.

---

## v0.5.x (stealth conformance) — known limits

These limits were discovered porting CloakBrowser's `tests/test_stealth.py`
to a mochi-native suite under
`packages/harness/src/conformance/stealth/`. The Layer 1 (offline) suite
runs cleanly with zero expected failures. The Layer 2 (online) suite
carries the limits below — each is either C++-only or fundamentally
network-dependent.

### `bot.incolumitas.com` — anti-debugger CDP trap

**Status:** known limit (C++-only, expected-failure)
**Root cause:** `bot.incolumitas.com` ships an anti-debugger / infinite-loop
trap that detects the V8 debugger flag and intentionally prevents the
page's `load` lifecycle from firing under any CDP-controlled browser. The
trap targets *the debugger itself*, not mochi's specific spoofing — every
CDP-driven stealth tool (Playwright, Patchright, Selenium, CloakBrowser)
trips it identically. Confirmed against
[CloakBrowser test_stealth.py:115-136](https://github.com/CloakHQ/CloakBrowser/blob/13b1b98b6840b68316e43fd46f43ffa7f50fd967/tests/test_stealth.py#L115-L136).
**Affected probes:** the conformance suite's
`bot-detection-sites.test.ts > bot.incolumitas.com — 0 unexpected failures`.
**Mitigation:** marked as expected-failure in
`packages/harness/src/conformance/stealth/expected-failures.ts`
(`incolumitas-anti-debugger-trap`). The test still runs and surfaces an
upgrade signal if the upstream removes the trap.
**User workaround:** none at JS layer. The fix is either (a) a Chromium
source patch that disables `Debugger.enable`'s probe surface, or (b)
routing the page through a non-CDP automation path (e.g. native CDP-free
MCP) — both violate I-1 / I-3.
**Tracking:** none — fundamental to the JS-only stealth ceiling.

### `deviceandbrowserinfo.com` — worker-injection / anti-debugger hang

**Status:** known limit (C++-only, expected-failure)
**Root cause:** `deviceandbrowserinfo.com/are_you_a_bot` ships heavy
fingerprint workers that mochi's inject pipeline tries to attach to via
`Target.setAutoAttach({waitForDebuggerOnStart:true})`. The page's
anti-debugger trap detects the V8 debugger flag and intentionally hangs
the worker initialization, which races mochi's `Runtime.evaluate` on the
worker target. Mirrors the `bot.incolumitas.com` cascade — both sites
detect *the debugger*, not mochi's specific spoofing.
**Affected probes:** the conformance suite's
`bot-detection-sites.test.ts > deviceandbrowserinfo.com — isBot is false`.
**Mitigation:** marked as expected-failure
(`deviceandbrowserinfo-worker-injection-hang`); the test runs and any
successful pass surfaces as an upgrade signal.
**User workaround:** none at JS layer — same C++-only fix path as
incolumitas.
**Tracking:** none — fundamental.

### `demo.fingerprint.com` `/web-scraping` — IP-class scoring

**Status:** known limit (network/cohort-class, expected-failure)
**Root cause:** fingerprint.com's `/web-scraping` demo uses IP-class +
cohort scoring + behavioral entropy in addition to JS fingerprint match.
A fresh datacenter session with zero behavioral history is blocked even
when every JS surface matches a pixel-perfect real Chrome. The block
decision is made *server-side* against a model fingerprint.com trains on
residential session telemetry; we can't beat it from the JS layer alone.
Confirmed against
[CloakBrowser test_stealth.py:179-199](https://github.com/CloakHQ/CloakBrowser/blob/13b1b98b6840b68316e43fd46f43ffa7f50fd967/tests/test_stealth.py#L179-L199).
**Affected probes:** the conformance suite's
`bot-detection-sites.test.ts > demo.fingerprint.com/web-scraping — not blocked, sees flight data`.
**Mitigation:** marked as expected-failure
(`fingerprintjs-web-scraping-not-blocked`). The test still runs so a
favorable IP / warm session surfaces as an upgrade signal.
**User workaround:** route through residential proxies; pre-warm the
session with synthetic browsing history; pace requests to match human
cadence. None of these are inside mochi's scope — they're operator
concerns.
**Tracking:** none — fundamental.

---

## Out of v1 scope (documented for awareness)

### Cross-engine FPU / JIT divergence

**Status:** out of v1 scope
**Root cause:** v1 profiles are Chromium-family only. Trying to spoof a
Safari profile from a Chromium runtime leaks through floating-point /
JIT divergence (V8 vs JavaScriptCore differ on edge-case f64
arithmetic; constant folding strategies differ; the two engines emit
different round-trip strings for some IEEE-754 edge cases). Documented
here for v2 readers who try.
**Affected probes:** any cross-engine fingerprint that exploits
implementation-specific f64 behavior.
**User workaround:** stay within Chromium-family profiles in v1. Safari /
Firefox profiles are v2+ research items.
**Tracking:** v2+.

### Mobile / touch profiles

**Status:** out of v1 scope
**Root cause:** v1 profiles are desktop Chromium-family only. Touch
gestures (tap / swipe / pinch / rotate) require a different model —
pressure curves, multi-touch coordination, OS-specific touch-event
sequencing. Sensor APIs (DeviceMotionEvent, DeviceOrientationEvent,
GeolocationCoordinates) require additional spoof surfaces.
**Affected probes:** any TouchEvent / PointerEvent (`pointerType: "touch"`)
fingerprint, or mobile-class sensor probes.
**Mitigation:** none today. mochi sessions never claim to be mobile in
v1; the matrix produces a desktop UA + UA-CH posture and the inject does
not touch the touch-events surface.
**User workaround:** wait for v2 mobile profiles.
**Tracking:** v2 — mobile profiles.

---

## v0.1 (CDP transport) — known limits

### `page.evaluate(fn)` is `Runtime.callFunctionOn`-based

**Status:** known limit
**Root cause:** PLAN.md §8.2 forbids `Runtime.enable`, and §8.4 forbids
`Runtime.evaluate` with `includeCommandLineAPI:true` and
`Page.createIsolatedWorld` for naming a world. Without those, the only
way to run a function in main world is `Runtime.callFunctionOn` against
the document's `objectId` — which has lossier return-value semantics
than full `Runtime.evaluate`.
**What works:** any function whose return value is JSON-serializable
(string, number, boolean, plain object, array). `this` inside the
function is the document.
**What doesn't:** returning DOM nodes, functions, `undefined`, circular
structures, classes, or Maps/Sets — these are coerced or dropped per CDP
`returnByValue:true` semantics.
**Mitigation:** documented; a future `evaluateHandle`-style API will
return a `RemoteObject` wrapper for non-serializable returns.
**Tracking:** none yet — file when needed.

### `Page.goto(url, { waitUntil: "networkidle" })` not implemented

**Status:** partial coverage (mapped to `"load"`)
**Root cause:** `networkidle` requires the `Network` domain, which we
keep disabled by default per PLAN.md §8.2 ("Network.enable globally on
the root target — only attached per-frame when needed"). v0.1 does not
implement the per-frame Network attach yet.
**Mitigation:** silently uses `"load"` semantics when `"networkidle"` is
requested. `"load"` and `"domcontentloaded"` work as expected.
**Tracking:** to be addressed once the Network domain is properly scoped
per-frame.

### `Session.cookies()` URL filter is host-only

**Status:** partial coverage
**Root cause:** v0.1 reads cookies via `Storage.getCookies` on the root
browser target (the only domain that exposes a global cookie list
without per-page Network enablement). CDP `Storage.getCookies` does not
accept a URL filter; we filter client-side by hostname suffix.
**Mitigation:** path/secure/SameSite filtering can be applied by the
caller on the returned array. Full URL semantics will land alongside
per-frame Network in a later phase.

---

## v0.10 (cross-platform prebuilds) — known limits

### Prebuilt cdylib platform coverage

**Status:** partial coverage
**Supported (postinstall download from GH Releases):**
- `darwin-arm64` (macOS, Apple Silicon)
- `darwin-x64` (macOS, Intel)
- `linux-x64` (Linux x86_64, glibc)
- `linux-arm64` (Linux aarch64, glibc — cross-compiled with `cargo-zigbuild`)
- `win32-x64` (Windows, MSVC)

**Not covered:**
- FreeBSD / OpenBSD / Alpine musl / Linux ia32 / Windows arm64 — no
  prebuilt assets shipped. Consumers can build from source via
  `cargo build --release --manifest-path packages/net-rs/Cargo.toml`;
  the loader (`packages/net/src/ffi.ts`) walks both the postinstall
  `native/` directory AND `target/release/`, so a local cargo build Just
  Works.

**Root cause:** PLAN.md §14 phase 0.10 scopes prebuilds to the 5 tuples
that cover ~95% of the npm install base. Adding more (musl, Windows
arm64) is a workflow-matrix entry, not a fundamental gap.
**Mitigation:** the postinstall script
(`packages/net-rs/scripts/install-prebuild.ts`) emits a friendly message
and exits 0 on unsupported platforms; install never blocks. Set
`MOCHI_NET_SKIP_POSTINSTALL=1` to bypass the download entirely.
**User workaround:** cargo-build the cdylib locally; the loader picks it
up from `packages/net-rs/target/release/`.
**Tracking:** none — driven by demand.

---

*This file is owned collectively by every contributor. Add to it the
moment you discover a limit; the framework's credibility lives here.*
