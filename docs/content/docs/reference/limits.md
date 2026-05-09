---
title: Known limits
description: The architectural-honesty page — every fingerprint vector mochi knows it does not cover, with a root cause, mitigation, and tracking link. Canonical site home for the mochi limits document.
order: 2
category: reference
lastUpdated: 2026-05-09
---

> **Canonical home.** This page is the canonical home for the mochi limits document. The repo file [`docs/limits.md`](https://github.com/0xchasercat/mochi/blob/main/docs/limits.md) redirects here.
>
> A living document. Per invariant **I-8** ("honesty over marketing"), every entry must be added in the same PR that creates the limit, and stale entries must be flipped in the PR that closes the gap.

mochi gives you the best possible JS-layer answer for stealth automation against Chromium-family WAFs. There are things the JS layer cannot do; this page enumerates them. The "What works / what doesn't" matrix in the [README](https://github.com/0xchasercat/mochi/blob/main/README.md) is the short-form summary; this file is the per-vector root cause.

Read it before opening an issue saying "X site detects mochi" — half the answers are already here.

Each entry follows the same shape: **status**, **root cause**, **mitigation** (if any), **affected probes**, **user workaround**, and **tracking** issue or task brief.

See also: [FAQ](/docs/reference/faq), [Comparison](/docs/reference/comparison), [Invariants](/docs/reference/invariants).

---

## v0.2 wave-4 surfaces (just landed)

### Audio (`OfflineAudioContext`) byte-accurate fingerprint — covered

**Status:** covered (was: deferred until per-(profile, sample-rate) captures shipped)
**Root cause (closed):** Faithful audio spoofing requires precomputed per-(profile, sample-rate) byte tables that match real Chromium's `OfflineAudioContext.startRendering()` output to byte equality. Runtime synthesis cannot reproduce the upstream digest because the page-side script reads back `Float32Array` channel data through a path that involves the host CPU's f32 rounding, not just the spoofed bytes.
**Mitigation:** R-047 (`audioFingerprint`) emits the captured baseline keyed by sample rate. The `packages/inject/src/modules/audio-fingerprint.ts` module patches `OfflineAudioContext.prototype.startRendering` to return a `Promise<AudioBuffer>` whose channel data is the matrix-derived bytes. The critical detail is the **residual**: probes typically digest the 489 samples in the index range `[4510..4999)`, and the page's own readback runs through a `Float32Array` view. We distribute the byte residual across those 489 samples and apply `Math.fround` to model the f32 readback step page-side. The resulting digest matches the captured baseline byte-exactly on every host architecture (not just Mac M-series), because we model the readback truncation rather than relying on the host's native FPU.
**Affected probes:** `OfflineAudioContext.startRendering()` byte hash (Browserleaks audio, FPJS visitor-id audio, creep.js audio, bot.incolumitas audio probe).
**User workaround:** none needed.

### Canvas (`toDataURL`) byte-accurate fingerprint — covered

**Status:** covered (was: deferred until captured baselines shipped)
**Root cause (closed):** Faithful canvas spoofing requires the captured `toDataURL` PNG bytes for the standard probe payloads, plus a heuristic to distinguish "this is a fingerprint probe" from "this is legitimate page canvas use" so that real apps still render. Runtime synthesis cannot reproduce upstream Skia output to byte equality.
**Mitigation:** R-048 emits the captured baseline; the `packages/inject/src/modules/canvas-fingerprint.ts` module patches `HTMLCanvasElement.prototype.toDataURL` (and the `OffscreenCanvas` / `getImageData` siblings) to detect the standard probe shape. The probe heuristic is canvas size: probe-sized (300×150) canvases get the captured baseline returned verbatim, so the probe-side `hashString(url)` + length + first-50-char prefix match the captured fingerprint byte-exactly. Non-probe sizes (any canvas the page legitimately renders to a non-default dimension) fall through to native rendering, so application canvas use keeps working.
**Affected probes:** Browserleaks canvas, FPJS visitor-id canvas component, creep.js canvas.
**Known asymmetry:** a probe that intentionally renders to a non-300×150 canvas to evade the heuristic would see native rendering rather than the captured baseline. The trade-off is deliberate — false positives on legitimate canvas use would break far more apps than the narrow detection-evasion window costs us. v0.3+ is exploring per-pixel noise on non-probe canvases as a generalization.
**User workaround:** none needed for the standard probe surface.
**Tracking:** per-pixel noise generalization in v0.3+ scope.

### Turnstile auto-click — covered (visible-checkbox variants only)

**Status:** covered
**Root cause:** Cloudflare Turnstile escalates a fraction of visitors to image / audio / managed-mode challenges that require either a 3rd-party solver (2captcha / anti-captcha) or fail the bot heuristics outright. The convenience layer in `@mochi.js/challenges` deliberately does NOT click randomly into image-challenge iframes — that's the definitional "obviously a bot" tell. Visible checkbox variants (the ~80% case) are covered.
**Mitigation:** `mochi.launch({ challenges: { turnstile: { autoClick: true } } })` auto-clicks the visible checkbox through the existing behavioral synth (Bezier path + Fitts's-Law dwell from `@mochi.js/behavioral`). For the remaining cases — image, audio, managed — the convenience layer fires `onEscalation(reason)` (`"image-challenge" | "managed" | "timeout"`) and bails rather than clicking blindly. Wire a 3rd-party solver in `onEscalation` if you need to handle escalations.
**Affected probes:** Turnstile in environments where the bot heuristics escalate beyond the first checkbox.
**User workaround:** wire a 3rd-party solver in `onEscalation`. For invisible / managed variants the auto-click layer is a no-op — those resolve on page load via Turnstile's own bot heuristics, which is a function of mochi's stealth posture (handled by inject + behavioral).
**Tracking:** image / audio / managed solving deferred to v0.3 first-party solver hooks.

### `Page.screenshot` — covered (full-page + clip + viewport)

**Status:** covered (was: `NotImplementedError`)
**Root cause (closed):** `Page.screenshot` was a placeholder that threw `NotImplementedError`. CDP `Page.captureScreenshot` is the canonical mechanism; the implementation is ~30 lines and not on PLAN.md §8.2's forbidden list.
**Mitigation:** `Page.screenshot(opts)` now returns `Uint8Array` (default, `encoding: "binary"`) or `string` (`encoding: "base64"`). Supported opts: `format` (`"png" | "jpeg" | "webp"`), `quality` (0–100, JPEG/WebP only), `fullPage`, `clip` (`{ x, y, width, height, scale? }`), `omitBackground`. For `fullPage: true` we read content size via `Page.getLayoutMetrics`, override device metrics to that size via `Emulation.setDeviceMetricsOverride`, capture, then `Emulation.clearDeviceMetricsOverride` to restore.
**Remaining gap — element-bounded capture:** `Page.screenshot({ element: handle })` is NOT yet implemented. Element-bounded capture requires `DOM.getBoxModel` to derive the clip rect from an `ElementHandle` — tracked separately.
**User workaround:** until element-bounded capture lands, call `Page.screenshot({ clip: { x, y, width, height } })` with manually-derived coordinates, or use `fullPage: true` and crop client-side.
**Tracking:** element-bounded capture is a separate brief.

### Cookie persistence (`Session.cookies.{save,load}`) — covered

**Status:** covered
**Root cause (closed):** previously, callers had to round-trip cookies through `Session.cookies()` + their own JSON serializer. nodriver ships this with pickle, which doesn't fit a Bun-native codebase.
**Mitigation:** `Session.cookies.save(path, { pattern? })` writes JSON (NOT pickle) with a small header (`version`, `savedAt`, `mochiVersion`, `pattern`, `count`) plus the `cookies` array. `Session.cookies.load(path, { pattern? })` reads it back. `pattern` is a regex applied to cookie domain; default `.*` matches all. Underlying CDP: `Storage.getCookies` for save, `Storage.setCookies` for load. The save → load round-trip is lossless (every CDP cookie field round-trips identically).
**Affected probes:** none — DX feature.
**User workaround:** none needed.

### `Page.localStorage.{get,set}` and `Page.sessionStorage.{get,set}` — covered

**Status:** covered
**Root cause (closed):** previously, callers had to `page.evaluate(() => localStorage.foo)` which round-trips through the lossier `Runtime.callFunctionOn` JSON serialization path. Direct CDP DOMStorage access avoids that surface.
**Mitigation:** `page.localStorage.get()` returns `Record<string, string>`; `page.localStorage.set({ ... })` writes each key. Backed by `DOMStorage.getDOMStorageItems` and `DOMStorage.setDOMStorageItem`. Frame-scoped — defaults to the current main-frame origin; pass `{ origin: string }` for cross-origin. `Page.sessionStorage` has the same shape (`isLocalStorage: false` on the underlying CDP call).
**Affected probes:** none — DX feature.
**User workaround:** none needed.

### `Page.grantAllPermissions()` — covered

**Status:** covered
**Root cause (closed):** for tests / dev sessions, granting individual permissions one-by-one through `Browser.grantPermissions` is tedious.
**Mitigation:** `page.grantAllPermissions()` (or with `{ origin? }`) wraps `Browser.grantPermissions` with the full `Browser.PermissionDescriptor` list (39 entries on the Chromium 148 pin: geolocation, camera, microphone, notifications, clipboard, sensors, the XR cluster, …). Pairs with R-036: the Browser-domain grant is unconditional, but page-side `navigator.permissions.query()` still returns per-permission state per the matrix's spoofed defaults. Production users typically don't need this; tests do.
**Affected probes:** none — DX feature.
**User workaround:** none needed.

### Init-script delivery without `Page.createIsolatedWorld` — covered (dual mechanism)

**Status:** covered
**Root cause (closed):** `Page.addScriptToEvaluateOnNewDocument` carries an attribution leak — the "did this script come from a CDP-injected `addScriptToEvaluateOnNewDocument` call?" probe surface that the "Vanilla CDP" detection family checks for. PLAN.md §8.2 already forbids `Runtime.enable` and `Page.createIsolatedWorld` for inject delivery; this brief closes the remaining attribution surface. See [The inject pipeline](/docs/concepts/inject-pipeline).
**Mitigation (dual-mechanism):**
  1. **Primary path — `Fetch.fulfillRequest` body splice on Document responses.** `Fetch.enable` is now always-on per session (combined with the existing proxy-auth `handleAuthRequests` handler). `Fetch.requestPaused` listener: on a `Document` resourceType, fetch the original response, parse + rewrite CSP (header AND `<meta http-equiv="Content-Security-Policy">` in the HTML body, with nonce reuse where present and `'unsafe-inline'` fallback where the policy mode requires it), splice the inject as inline `<script class="mochi-init" id="<randomHex>">` at end-of-head BEFORE the first non-comment `<script>`, and reply via `Fetch.fulfillRequest` with the rewritten body. The injected node self-removes from the DOM on first execution (`document.currentScript?.remove()` as the first line of the IIFE); a post-`load` `DOM.querySelectorAll(".mochi-init")` walk strips any stragglers. Non-Document `requestPaused` events are auto-forwarded via `Fetch.continueRequest` so non-document traffic costs nothing.
  2. **Fallback path — `Page.addScriptToEvaluateOnNewDocument({ runImmediately: true, worldName: "" })`.** `Fetch.fulfillRequest` does not intercept `about:blank`, `data:`, or other non-HTTP nav targets. For those, we fall through to the classic CDP install. The attribution leak is irrelevant on `about:blank` (no page script to detect us with), so the trade-off is acceptable.

**Idempotency guard:** `globalThis.__mochi_inject_marker` is set on first run. If both delivery mechanisms fire (e.g. a same-origin nav that crosses the `Fetch` boundary), the second-pass script self-removes without re-running.
**Affected probes:** "Vanilla CDP" detection probes that flag `addScriptToEvaluateOnNewDocument` source attribution. After this lands, the inject pipeline is byte-indistinguishable from a same-origin developer's own `<script>` tag at the top of `<head>`.
**User workaround:** none needed.
**Tracking:** PLAN.md §8.4.

### Worker `idOnly` inject on transient workers — best-effort

**Status:** best-effort (architectural — JS-layer ceiling)
**Root cause:** `Page.addScriptToEvaluateOnNewDocument` doesn't apply to worker targets; Chromium has no equivalent "run before any script" hook for workers. The best mochi can do is bind to the worker's V8 isolate after creation but before user code runs. Real-world pages (bot.sannysoft, deviceandbrowserinfo, incolumitas, fingerprintjs) commonly spawn brief workers whose entire lifecycle finishes before our `Runtime.callFunctionOn` roundtrip completes, even with `Target.setAutoAttach({waitForDebuggerOnStart:true})` — the worker can die between `Target.attachedToTarget` and our reply.
**Mitigation:** we attach to `worker` / `service_worker` / `shared_worker` / `audio_worklet` targets, send `Runtime.evaluate("globalThis", { serialization: "idOnly" })` to extract the executionContextId without ever issuing `Runtime.enable`, then deliver the payload via `Runtime.callFunctionOn({ functionDeclaration, executionContextId, returnByValue: true })`. Per the v0.2 tightening, both the inject and the following `Runtime.runIfWaitingForDebugger` carry a `timeoutMs: 5_000` cap — real workers reply in single-digit ms, so 5s is generous, and orphan workers no longer hold the router for the full 30s default. The warn-log is downgraded to silent for the expected race fingerprints (`CdpTimeoutError`, `Session with given id not found`, `Target closed`); a genuine bug (bad contextId, schema drift) still logs.
**Affected probes:** any probe that runs first-thing inside a transient `Worker` / `SharedWorker` / `ServiceWorker` / `AudioWorklet` and compares results to main-thread results. Page-world inject is unaffected; this only matters for sites that scope detection inside short-lived workers.
**User workaround:** none at JS layer. Profiles can be marked "worker-stealth-sensitive" in v2 so user code can opt out of probes that use workers.
**Tracking:** Chromium upstream (likely never lands as a public CDP method — security-sensitive).

---

## v0.5.x (stealth conformance) — known limits

These limits were discovered porting CloakBrowser's `tests/test_stealth.py` to a mochi-native suite under `packages/harness/src/conformance/stealth/`. The Layer 1 (offline) suite runs cleanly with zero expected failures. The Layer 2 (online) suite carries the limits below — each is either C++-only or fundamentally network-dependent.

### `bot.incolumitas.com` — anti-debugger CDP trap

**Status:** known limit (C++-only, expected-failure)
**Root cause:** `bot.incolumitas.com` ships an anti-debugger / infinite-loop trap that detects the V8 debugger flag and intentionally prevents the page's `load` lifecycle from firing under any CDP-controlled browser. The trap targets *the debugger itself*, not mochi's specific spoofing — every CDP-driven stealth tool (Playwright, Patchright, Selenium, CloakBrowser) trips it identically. Confirmed against [CloakBrowser test_stealth.py:115-136](https://github.com/CloakHQ/CloakBrowser/blob/13b1b98b6840b68316e43fd46f43ffa7f50fd967/tests/test_stealth.py#L115-L136).
**Affected probes:** the conformance suite's `bot-detection-sites.test.ts > bot.incolumitas.com — 0 unexpected failures`.
**Mitigation:** marked as expected-failure in `packages/harness/src/conformance/stealth/expected-failures.ts` (`incolumitas-anti-debugger-trap`). The test still runs and surfaces an upgrade signal if the upstream removes the trap.
**User workaround:** none at JS layer. The fix is either (a) a Chromium source patch that disables `Debugger.enable`'s probe surface, or (b) routing the page through a non-CDP automation path (e.g. native CDP-free MCP) — both violate I-1 / I-3.
**Tracking:** none — fundamental to the JS-only stealth ceiling.

### `deviceandbrowserinfo.com` — worker-injection / anti-debugger hang

**Status:** known limit (C++-only, expected-failure)
**Root cause:** `deviceandbrowserinfo.com/are_you_a_bot` ships heavy fingerprint workers that mochi's inject pipeline tries to attach to via `Target.setAutoAttach({waitForDebuggerOnStart:true})`. The page's anti-debugger trap detects the V8 debugger flag and intentionally hangs the worker initialization, which races mochi's `Runtime.evaluate` on the worker target. Mirrors the `bot.incolumitas.com` cascade — both sites detect *the debugger*, not mochi's specific spoofing.
**Affected probes:** the conformance suite's `bot-detection-sites.test.ts > deviceandbrowserinfo.com — isBot is false`.
**Mitigation:** marked as expected-failure (`deviceandbrowserinfo-worker-injection-hang`); the test runs and any successful pass surfaces as an upgrade signal.
**User workaround:** none at JS layer — same C++-only fix path as incolumitas.
**Tracking:** none — fundamental.

### `bot.sannysoft.com` — `MQ_SCREEN` probe mismatch

**Status:** known limit (sannysoft-specific, expected-failure)
**Root cause:** sannysoft's `MQ_SCREEN` row checks `matchMedia('(device-width: <screen.width>px)')` against the live viewport. Mochi spoofs `screen.width` from `matrix.display.width`, but Chromium's viewport-driven `matchMedia` evaluator reads the underlying *page* viewport, and there's a small numeric mismatch in how the MQ length pixel is rounded. The other 56/57 sannysoft probes pass cleanly. No real-world site fingerprints `(device-width: Npx)` MQ strings — this is sannysoft-specific.
**Affected probes:** the conformance suite's `bot-detection-sites.test.ts > bot.sannysoft.com — 0 failures across all rows`.
**Mitigation:** marked as expected-failure (`sannysoft-mq-screen`); the remaining 56 probes assert clean.
**User workaround:** no production impact.
**Tracking:** v1.x — could be closed by tying mochi's spoofed `screen.width` directly to the CDP `Page.setDeviceMetricsOverride` viewport so the MQ evaluator and the spoofed property converge.

### `demo.fingerprint.com` `/web-scraping` — IP-class scoring

**Status:** known limit (network/cohort-class, expected-failure)
**Root cause:** fingerprint.com's `/web-scraping` demo uses IP-class + cohort scoring + behavioral entropy in addition to JS fingerprint match. A fresh datacenter session with zero behavioral history is blocked even when every JS surface matches a pixel-perfect real Chrome. The block decision is made *server-side* against a model fingerprint.com trains on residential session telemetry; we can't beat it from the JS layer alone. Confirmed against [CloakBrowser test_stealth.py:179-199](https://github.com/CloakHQ/CloakBrowser/blob/13b1b98b6840b68316e43fd46f43ffa7f50fd967/tests/test_stealth.py#L179-L199).
**Affected probes:** the conformance suite's `bot-detection-sites.test.ts > demo.fingerprint.com/web-scraping — not blocked, sees flight data`.
**Mitigation:** marked as expected-failure (`fingerprintjs-web-scraping-not-blocked`).
**User workaround:** route through residential proxies; pre-warm the session with synthetic browsing history; pace requests to match human cadence. None of these are inside mochi's scope — they're operator concerns.
**Tracking:** none — fundamental.

### `LaunchOptions.hermetic` — required for harness/CI; `false` by default for production

**Status:** documented surface
**Root cause:** Patchright (`chromiumSwitchesPatch.ts:20-34`) and puppeteer-real-browser (`lib/cjs/index.js:57-58`) explicitly REMOVE `--disable-component-update`, `--disable-default-apps`, `--disable-background-networking`, and `--disable-sync` from their default flag sets because each is a passive command-line bot-tell — anti-bot heuristics that read `chrome://version` (or a sibling-tab equivalent) can string-match the trimmed argv. Mochi previously inherited all four and leaked the same surface to production users. The audit split the flag set into a production default (clean) and a hermetic addendum that re-applies them under `LaunchOptions.hermetic: true`.
**Affected probes:** none directly — this is a defensive flag-set trim, not a new fingerprint vector.
**Mitigation:** `mochi.launch({ hermetic: true })` re-applies the harness/CI flag set. `@mochi.js/harness`, `@mochi.js/cli` `mochi capture`, and the stealth conformance fixture all set `hermetic: true` automatically. Production `mochi.launch()` callers stay on the cleaner default flag set unless they explicitly opt in.
**Known asymmetries:**
  - `--disable-features=Translate,AcceptCHFrame,IsolateOrigins,site-per-process` is kept in BOTH modes. `IsolateOrigins,site-per-process` is load-bearing for inject reach (mochi has no OOPIF context resolution today). `AcceptCHFrame` keeps the UA-CH single-source-of-truth posture. `Translate` suppresses the headed translate prompt UI.
  - `--no-sandbox` is NOT in either set. CI uses `MOCHI_EXTRA_ARGS=--no-sandbox` env passthrough exclusively.
  - `--disable-blink-features=AutomationControlled` is NOT in either set. Mochi patches `navigator.webdriver` from JS via R-022; the flag itself is a `chrome://version` tell.

**User workaround:** none needed — the production default is the safer posture.

### Exit IP / timezone / locale consistency — covered

**Status:** covered
**Root cause:** mochi previously treated `(matrix.timezone, matrix.locale)` as canonical regardless of where the proxy egressed. A US-West profile (`America/Los_Angeles` + `en-US`) routed through an EU residential proxy produced a mismatch between `Date.getTimezoneOffset()` (-480min) and the IP's geolocation (UTC+1) — the canonical bot signature.
**Affected probes:** any fingerprinter that cross-references the page-side timezone offset against the request IP's geolocation. Common in CreepJS-style aggregators and bespoke WAF heuristics.
**Mitigation:** at launch, mochi probes the apparent exit IP through Chromium's network stack via CDP (so the geo service sees the same JA4 / headers as user traffic — it IS user traffic). 7-endpoint registry, shuffled-sequential, 4-attempt cap, 2s per endpoint. The reconciler cross-references against the matrix and applies one of four `LaunchOptions.geoConsistency` modes:
  - `"privacy-fallback"` *(default)* — override matrix to `UTC` + `en-US` on mismatch (or probe failure). Fingerprints as a Tor / hardened-FF user.
  - `"auto-correct"` — override matrix tz/locale with IP-derived values.
  - `"strict"` — throw `GeoMismatchError` on mismatch.
  - `"off"` — skip the probe.

JS-side timezone is delivered via CDP `Emulation.setTimezoneOverride` per-target — drives both `Intl.DateTimeFormat().resolvedOptions().timeZone` AND `Date.getTimezoneOffset()` because Chromium's V8 reads from the same internal source. NOT manually rewritten in inject (prototype-shape detectable).
**Known gaps:**
  - **Probe rate-limiting**: `ipapi.co/json/` is rate-limited from many IPs and frequently returns 429; the probe expects this and falls through.
  - **Tor exit nodes**: Tor exits sometimes geolocate to wrong countries; probing through Tor → privacy-fallback is correct behavior.
  - **Locale primary-region table**: `auto-correct` mode falls back to `en-<CC>` for unknown country codes.
  - **No cross-session caching**: probe results are NOT cached across sessions because proxy IPs rotate.

**User workaround:** pass `geoConsistency: "off"` for tests / rate-limit-impacted environments. Pass `"strict"` to fail closed when proxy egress doesn't match the declared profile.
**Tracking:** PLAN.md §9.6.

### Proxy authentication — covered (HTTP basic + SOCKS5 user/pass)

**Status:** covered
**Root cause:** Chromium's `--proxy-server=` flag accepts the address but rejects inline credentials; the historical workaround (`--load-extension <proxy-auth-extension>`) is itself a fingerprint leak (`chrome.runtime` weirdness, observable extension ids). mochi instead attaches a CDP `Fetch.authRequired` listener (empty patterns, `handleAuthRequests: true`) — no extension, no `Runtime.enable`, no `Page.createIsolatedWorld`.
**Affected probes:** none — feature gap closure.
**Mitigation:** pass credentials either as an inline URL (`mochi.launch({ proxy: "http://user:pass@host:port" })`) or via the explicit `ProxyConfig` shape (`{ server, username, password }`). Both forms work for HTTP, HTTPS, SOCKS5, SOCKS4. `Session.fetch` rides Chromium's own network stack via CDP, so it automatically shares the same `--proxy-server=` egress — no separate HTTP layer to wire creds into.
**Known gaps:**
  - **proxy-PAC scripts** are NOT yet supported — there is no `--proxy-pac-url` plumbing today (separate task, low priority).
  - **SOCKS5 auth at the SOCKS handshake layer** depends on Chromium surfacing the challenge through `Fetch.authRequired`. Tested in modern Chrome stable; some older / patched builds may fail to fire the event cleanly.

**User workaround:** for proxy-PAC, configure the proxy via system environment / network policy until the flag lands.
**Tracking:** future task — proxy-PAC support.

---

## Out of v1 scope (documented for awareness)

### Cross-engine FPU / JIT divergence

**Status:** out of v1 scope
**Root cause:** v1 profiles are Chromium-family only. Trying to spoof a Safari profile from a Chromium runtime leaks through floating-point / JIT divergence (V8 vs JavaScriptCore differ on edge-case f64 arithmetic; constant folding strategies differ; the two engines emit different round-trip strings for some IEEE-754 edge cases). Documented here for v2 readers who try.
**Affected probes:** any cross-engine fingerprint that exploits implementation-specific f64 behavior.
**User workaround:** stay within Chromium-family profiles in v1. Safari / Firefox profiles are v2+ research items.
**Tracking:** v2+.

### Mobile / touch profiles

**Status:** out of v1 scope
**Root cause:** v1 profiles are desktop Chromium-family only. Touch gestures (tap / swipe / pinch / rotate) require a different model — pressure curves, multi-touch coordination, OS-specific touch-event sequencing. Sensor APIs (`DeviceMotionEvent`, `DeviceOrientationEvent`, `GeolocationCoordinates`) require additional spoof surfaces.
**Affected probes:** any TouchEvent / PointerEvent (`pointerType: "touch"`) fingerprint, or mobile-class sensor probes.
**Mitigation:** none today. mochi sessions never claim to be mobile in v1; the matrix produces a desktop UA + UA-CH posture and the inject does not touch the touch-events surface.
**User workaround:** wait for v2 mobile profiles.
**Tracking:** v2 — mobile profiles.

### Cross-engine recorder replay (recorded-trace behavioral)

**Status:** acknowledged forward gap (deferred to v1.x)
**Root cause:** mochi's behavioral synth is paper-spec-driven — Bezier with overshoot+correction, Fitts MT, lognormal digraph timing. The conformance suite validates the SHAPE of the synthesized events against the CloakBrowser test bar. If a future ML-style classifier learns that the *distributional fingerprint* of synthetic events is detectable (e.g., the 60Hz cadence is too uniform vs a real OS's variable input pump rate), the answer is recorded-trace replay, which is on the v1.x roadmap (`mochi record` + `humanClick(sel, { trace })` already in the API contract). No quantitative evidence today that the default synth fails real classifiers.
**Affected probes:** hypothetical future ML classifiers.
**Tracking:** v1.x — `mochi record` recorder + replay surface.

---

## v0.1 (CDP transport) — known limits

### `page.evaluate(fn)` is `Runtime.callFunctionOn`-based

**Status:** known limit
**Root cause:** PLAN.md §8.2 forbids `Runtime.enable`, and §8.4 forbids `Runtime.evaluate` with `includeCommandLineAPI:true` and `Page.createIsolatedWorld` for naming a world. Without those, the only way to run a function in main world is `Runtime.callFunctionOn` against the document's `objectId` — which has lossier return-value semantics than full `Runtime.evaluate`.
**What works:** any function whose return value is JSON-serializable (string, number, boolean, plain object, array). `this` inside the function is the document.
**What doesn't:** returning DOM nodes, functions, `undefined`, circular structures, classes, or Maps/Sets — these are coerced or dropped per CDP `returnByValue:true` semantics. Argument-passing into `evaluate` is also unsupported at v0.1.
**Mitigation:** documented; a future `evaluateHandle`-style API will return a `RemoteObject` wrapper for non-serializable returns.
**Tracking:** none yet — file when needed.

### `Page.goto(url, { waitUntil: "networkidle" })` not implemented

**Status:** partial coverage (mapped to `"load"`)
**Root cause:** `networkidle` requires the `Network` domain, which we keep disabled by default per PLAN.md §8.2 ("Network.enable globally on the root target — only attached per-frame when needed"). v0.1 does not implement the per-frame Network attach yet.
**Mitigation:** silently uses `"load"` semantics when `"networkidle"` is requested. `"load"` and `"domcontentloaded"` work as expected.
**Tracking:** to be addressed once the Network domain is properly scoped per-frame.

### `Session.cookies()` URL filter is host-only

**Status:** partial coverage
**Root cause:** v0.1 reads cookies via `Storage.getCookies` on the root browser target (the only domain that exposes a global cookie list without per-page Network enablement). CDP `Storage.getCookies` does not accept a URL filter; we filter client-side by hostname suffix.
**Mitigation:** path/secure/SameSite filtering can be applied by the caller on the returned array. Full URL semantics will land alongside per-frame Network in a later phase.

### `Page.screenshot({ element })` element-bounded capture

**Status:** not implemented (full-page + clip + viewport modes work)
**Root cause:** element-bounded capture requires `DOM.getBoxModel` to derive the clip rect from an `ElementHandle` — tracked separately.
**Mitigation:** call `Page.screenshot({ clip: { x, y, width, height } })` with manually-derived coordinates, or use `fullPage: true` and crop client-side.

---

## `Session.fetch` semantics — covered, with caveats

### Cookie inheritance + CORS scope

**Status:** documented surface

**Root cause:** post-0.7, `Session.fetch` routes through Chromium itself via CDP. Two paths:

- **Mechanism A — `Network.loadNetworkResource`.** Used for simple GETs (no `init` / no method override / no headers / no body). Bypasses CORS at the network layer; no `Origin` header is sent.
- **Mechanism B — `page.evaluate("fetch(url, init)")` against an `about:blank` scratch frame.** Used for everything else. Cookies inherit from the page's origin; CORS applies the same as a real user's `fetch` from the console.

Both paths share Chromium's network stack with `page.goto`, so JA4/JA3/H2 are real Chrome by definition.

**Caveats:**

- **Cookie-inheritance shift vs. 0.6.** Pre-0.7, the wreq path was cookieless. Post-0.7, both mechanisms share the session's cookie jar with the browser. Set `init.credentials = "omit"` for the page-evaluate path or clear the relevant cookies before the call if you need the cookieless behavior.
- **CORS for non-GET cross-origin calls.** Mechanism B obeys CORS; cross-origin POSTs to an endpoint without `Access-Control-Allow-Origin` will fail in 0.7 where they may have succeeded in 0.6.
- **Request body shapes.** `string`, `ArrayBuffer` / typed arrays, and `URLSearchParams` are supported. `Blob`, `FormData`, and `ReadableStream` throw with a clear diagnostic — they need a richer transport than the JSON-only page-evaluate seam, and land in a follow-up PR.
- **No per-call timeout knob on Mechanism A.** `Network.loadNetworkResource` has no timeout parameter; wrap the call with `AbortController` if you need one (Mechanism B respects `init.signal`).

**Mitigation / migration:** [Migration → v0.6 → 0.7](/docs/reference/migration#upgrade-from-v06--v07-sessionfetch-routes-through-chromium) covers the breaking shifts in detail.

### CfT download integrity (no upstream-published SHA256)

**Status:** partial coverage
**Root cause:** Google's Chromium-for-Testing registry does not publish per-asset SHA256 hashes — none of the manifest endpoints (`known-good-versions-with-downloads.json`, `last-known-good-versions-with-downloads.json`) carry hash fields, and there are no sidecar `.sha256` files in the GCS bucket. Verified 2026-05-08.
**Affected probes:** integrity / supply-chain (not a fingerprint vector).
**Mitigation:** `mochi browsers install` computes SHA256 itself during the streamed download and records it in `<installDir>/.mochi-meta.json`. Users can pass `--sha256 <hex>` to verify against a hash they obtained out-of-band. `--force` reinstalls re-verify by recomputing.
**User workaround:** Pin `--sha256 <hex>` in any environment that requires verified-binary integrity.
**Tracking:** none — fundamental until Google publishes hashes.

---

## Profile catalog — placeholder vs. real-device

**Status:** documented surface

The shipped profile catalog has six **real-device** baselines and five **placeholder** entries. The placeholders resolve to a generic synthesis that is consistency-clean but does not match any specific captured device. See [Profiles](/docs/concepts/profiles).

**Real-device baselines (stable IDs — depend on these):**
- `mac-m4-chrome-stable`
- `mac-chrome-stable`
- `mac-chrome-beta`
- `windows-chrome-stable`
- `linux-chrome-stable`
- `mac-brave-stable`

Each is filtered by FingerprintJS Pro `suspectScore <= 20` and validated by the harness round-trip.

**Placeholders (do NOT depend on the IDs — they may flip to real captures or be renamed):**
- `mac-m2-chrome-stable`
- `mac-m1-chrome-stable`
- `mac-intel-chrome-stable`
- `win11-chrome-stable`
- `win11-edge-stable`

**Tracking:** v0.3+ — additional captures as the harvester corpus expands.

---

*This file is owned collectively by every contributor. Add to it the moment you discover a limit; the framework's credibility lives here.*

<!-- llm-context:start
This page is the canonical mochi limits document — the honest cut of what works and what doesn't.

Purpose: enumerate every fingerprint vector mochi knows it does NOT cover, with a documented root cause, mitigation, and tracking link. Required reading before claiming "mochi defeats site X".

Key terms:
- "Known limit" = a feature mochi's JS-only architecture cannot fully cover; documented with root cause and workaround.
- "Stealth ceiling" = the highest detection sophistication mochi can defeat from JS alone (PLAN.md I-1 forbids C++ patches).
- "Expected-failure" = a conformance test that asserts a known C++-only limit; the test runs to surface upgrade signals.

Common LLM hallucinations to avoid:
- "mochi defeats every fingerprinter" — false; specific limits exist (incolumitas + deviceandbrowserinfo anti-debugger trap, fingerprint.com IP-class scoring, sannysoft MQ_SCREEN edge case).
- "Add a Chromium patch to fix X" — forbidden by invariant I-1; not how mochi works.
- "Use --disable-blink-features=AutomationControlled" — mochi refuses this flag; the flag is itself a chrome://version tell. mochi patches navigator.webdriver from JS via R-022.
- "Use --no-sandbox" — never set in production. CI passes via MOCHI_EXTRA_ARGS env only.
- "page.evaluate(fn) returns DOM nodes" — false; v0.1 page.evaluate is Runtime.callFunctionOn-based and only returns JSON-serializable values.
- "waitUntil: 'networkidle' is supported" — not at v0.1; silently falls back to 'load'.
- "Element-bounded screenshots work" — not yet; only fullPage / clip / viewport. Tracked separately.
- "Mobile / touch profiles ship in v1" — out of v1 scope.

Cross-references:
- FAQ: https://mochijs.com/docs/reference/faq
- Comparison: https://mochijs.com/docs/reference/comparison
- Glossary: https://mochijs.com/docs/reference/glossary
- Invariants: https://mochijs.com/docs/reference/invariants
- Inject pipeline: https://mochijs.com/docs/concepts/inject-pipeline
- Profiles: https://mochijs.com/docs/concepts/profiles
- Consistency engine: https://mochijs.com/docs/concepts/consistency-engine
llm-context:end -->
