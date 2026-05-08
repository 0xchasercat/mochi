---
title: Known limits
description: Architectural-honesty page — every fingerprint vector mochi knows it does not cover, with a root cause and a tracking link.
order: 2
category: reference
lastUpdated: 2026-05-09
---


> A living document. Every entry must be added in the same PR that creates the limit.
> Each entry: what's not covered, why, what a user can do about it (if anything).

This is the architectural-honesty page. mochi gives you the best possible JS-layer answer for stealth automation against Chromium-family WAFs. There are things the JS layer cannot do; this page enumerates them. Users who need more should expect to look beyond mochi.

---

## v0 placeholder

This file will populate as the framework lands. Entries follow this template:

```markdown
### <vector name>

**Status:** known limit | partial coverage | covered (verify)
**Root cause:** <why JS-only can't fix this>
**Affected probes:** <which probe families notice it>
**Mitigation:** <what we do about it> | <none>
**User workaround:** <if any>
**Tracking:** <issue link, or "none — fundamental">
```

---

## Live entries

### Turnstile auto-click — visible-checkbox variants only

**Status:** partial coverage
**Root cause:** v0.2 ships only the visible-checkbox auto-click flow. Cloudflare Turnstile escalates a fraction of visitors to image / audio / managed-mode challenges that require either a 3rd-party solver (2captcha / anti-captcha) or fail the bot heuristics outright. The convenience layer in `@mochi.js/challenges` deliberately does NOT click randomly into image-challenge iframes; it surfaces escalations via `onEscalation(reason)` (`"image-challenge" | "managed" | "timeout"`) and bails.
**Affected probes:** Cloudflare Turnstile in environments where the bot heuristics escalate beyond the first checkbox.
**Mitigation:** Pass `challenges.turnstile.autoClick: true` to `mochi.launch()` for the ~80% of deployments that show a visible checkbox — the click goes through the existing behavioral synth (Bezier path + Fitts's-Law dwell from `@mochi.js/behavioral`). Hook `onEscalation` to fire your own solver in the remaining cases.
**User workaround:** Wire a 3rd-party solver in `onEscalation` (v0.3 will ship a first-party hook surface). For the invisible / managed variants the auto-click layer is a no-op — those resolve on page load via Turnstile's own bot heuristics, which is a function of mochi's stealth posture (handled by the inject + behavioral pipelines).
**Tracking:** task 0220 for the auto-click; image / audio / managed solving deferred to v0.3.

### CfT download integrity (no upstream-published SHA256)

**Status:** partial coverage
**Root cause:** Google's Chromium-for-Testing registry does not publish per-asset SHA256 hashes — none of the manifest endpoints (`known-good-versions-with-downloads.json`, `last-known-good-versions-with-downloads.json`) carry hash fields, and there are no sidecar `.sha256` files in the GCS bucket. Verified 2026-05-08.
**Affected probes:** integrity / supply-chain (not a fingerprint vector — listed here because the task brief expected manifest-published hashes).
**Mitigation:** `mochi browsers install` computes SHA256 itself during the streamed download and records it in `<installDir>/.mochi-meta.json`. Users can pass `--sha256 <hex>` to verify against a hash they obtained out-of-band. `--force` reinstalls naturally re-verify by recomputing.
**User workaround:** Pin `--sha256 <hex>` in any environment that requires verified-binary integrity. mochi cannot derive the hash from the registry alone.
**Tracking:** none — fundamental until Google publishes hashes.

---

## Anticipated v1 entries (will be populated as discovered during development)

The following are **expected** limits we'll formalize as the framework is built. Listed here for awareness; each will get a full entry when it lands in code.

- **`Runtime.enable` detection** — some scripts side-channel detect whether DevTools-style runtime hooks are active. Avoiding `Runtime.enable` entirely (PLAN.md §8.2) reduces but doesn't eliminate the surface.
- **WebRTC local IP leak** — mDNS-obfuscated since Chrome 84, but original IP recoverable via STUN if no proxy is configured. mochi delegates to user-configured proxy; we don't override at JS layer because it's brittle.
- **Cross-engine FPU/JIT divergence** — out of v1 scope (Chromium-only profiles). Documented here for v2 readers who try to spoof Safari from Chromium.
- **Canvas randomness for non-fixture payloads** — we precompute hash maps for known canvas-fingerprint test payloads; for site-randomized canvas paint, we add per-pixel noise scaled by profile noise budget. A determined adversary may detect the noise.
- **Audio fingerprint on novel sample rates** — we ship precomputed fingerprint bytes for the sample rates each profile's hardware naturally exposes. If a probe forces an unusual sample rate, fallback fidelity is reduced.
- **performance.now() timing under cross-origin isolation** — Chrome's natural 100µs coarsening differs by origin-isolation state; we don't actively spoof this and accept it as Chrome-natural.
- **Trust Tokens / Topics / FedCM** — passthrough; we don't actively answer these probes with fake values, we let Chrome answer naturally.
- **Sensor APIs on desktop** — Chrome doesn't expose them on desktop; nothing to spoof. Mobile profiles (v2) will need real handling.

---

## v0.5.x (stealth conformance landed) — known limits

These limits were discovered while porting CloakBrowser's `tests/test_stealth.py`
to a mochi-native Bun-TS suite under `packages/harness/src/conformance/stealth/`.
The Layer 1 (offline) suite runs cleanly with zero expected failures — the
six webdriver-detection assertions are JS-fixable and pass via mochi's
existing inject pipeline plus two new defensive shim modules
(`packages/inject/src/modules/{window-chrome,plugins}.ts`). The Layer 2
(online) suite carries the limits below — each is either C++-only or
fundamentally network-dependent.

### `bot.incolumitas.com` — anti-debugger CDP trap

**Status:** known limit (C++-only, treated as expected-failure)
**Root cause:** `bot.incolumitas.com` ships an anti-debugger / infinite-loop
trap that detects the V8 debugger flag and intentionally prevents the page's
`load` lifecycle event from firing under any CDP-controlled browser. The
page's scoring routine still partially writes to `document.body` but mochi's
worker-injection pipeline races the trap and the underlying Chromium process
hangs. The trap is targeting *the debugger itself*, not mochi's specific
spoofing — every CDP-driven stealth tool (Playwright, Patchright, Selenium,
CloakBrowser) trips it identically. Confirmed against
[CloakBrowser test_stealth.py:115-136](https://github.com/CloakHQ/CloakBrowser/blob/13b1b98b6840b68316e43fd46f43ffa7f50fd967/tests/test_stealth.py#L115-L136).
**Affected probes:** the conformance suite's
`bot-detection-sites.test.ts > bot.incolumitas.com — 0 unexpected failures`.
**Mitigation:** marked as expected-failure in
`packages/harness/src/conformance/stealth/expected-failures.ts` (`incolumitas-anti-debugger-trap`).
The test still runs and surfaces an upgrade signal if it ever passes (e.g.
when the upstream removes the trap or when a future patched-Chromium variant
ships that hides the debugger flag).
**User workaround:** none at JS layer. The fix is either (a) a Chromium
source patch that disables `Debugger.enable`'s probe surface, or (b) routing
the page through a non-CDP automation path (e.g. native CDP-free MCP), both
of which violate I-1 / I-3.
**Tracking:** none — fundamental to the JS-only stealth ceiling.

### `deviceandbrowserinfo.com` — worker-injection / anti-debugger hang

**Status:** known limit (C++-only, treated as expected-failure)
**Root cause:** `deviceandbrowserinfo.com/are_you_a_bot` ships heavy
fingerprint workers that mochi's inject pipeline tries to attach to via
`Target.setAutoAttach({waitForDebuggerOnStart:true})`. The page's
anti-debugger trap detects the V8 debugger flag and intentionally hangs
the worker initialization, which races mochi's `Runtime.evaluate` on the
worker target. The page's `domcontentloaded` event eventually fires but
`page.evaluate` against the partial DOM also stalls behind the same trap.
Mirrors the `bot.incolumitas.com` cascade — both sites detect *the
debugger*, not mochi's specific spoofing, so all CDP-driven stealth tools
trip identically.
**Affected probes:** the conformance suite's
`bot-detection-sites.test.ts > deviceandbrowserinfo.com — isBot is false`.
**Mitigation:** marked as expected-failure
(`deviceandbrowserinfo-worker-injection-hang`); the test runs and any
successful pass surfaces as an upgrade signal.
**User workaround:** none at JS layer. Same C++-only fix path as
incolumitas — disable Chromium's debugger-detection codepath at the
source level, or migrate to a non-CDP automation channel.
**Tracking:** none — fundamental.

### `bot.sannysoft.com` — `MQ_SCREEN` probe mismatch

**Status:** known limit (sannysoft-specific, treated as expected-failure)
**Root cause:** sannysoft's `MQ_SCREEN` row checks
`matchMedia('(device-width: <screen.width>px)')` against the live viewport.
Mochi spoofs `screen.width` from `matrix.display.width` (800 for the
mac-m4-chrome-stable profile, captured under headless), but Chromium's
viewport-driven `matchMedia` evaluator reads the underlying *page* viewport
(also 800 in headless), and there's a small numeric mismatch in how the MQ
length pixel is rounded. The other 56/57 sannysoft probes pass cleanly. No
real-world site fingerprints `(device-width: Npx)` MQ strings — this is
sannysoft-specific.
**Affected probes:** the conformance suite's
`bot-detection-sites.test.ts > bot.sannysoft.com — 0 failures across all rows`.
**Mitigation:** marked as expected-failure (`sannysoft-mq-screen`); the
test allows `MQ_SCREEN` in the `KNOWN_ACCEPTABLE` set, mirroring
CloakBrowser's `KNOWN_ACCEPTABLE` pattern for incolumitas. The remaining
56 probes assert clean.
**User workaround:** no production impact.
**Tracking:** v1.x — could be closed by tying mochi's spoofed
`screen.width` directly to the CDP `Page.setDeviceMetricsOverride` viewport
so the MQ evaluator and the spoofed property converge.

### `demo.fingerprint.com` `/web-scraping` — requires residential IP + warm session

**Status:** known limit (network/cohort-class, treated as expected-failure)
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

### Proxy authentication — supported (HTTP basic + SOCKS5 user/pass)

**Status:** covered as of task 0160 (replaces the prior "ProxyConfig.auth ignored" limit)
**Root cause:** Chromium's `--proxy-server=` flag accepts the address but
rejects inline credentials; the historical workaround
(`--load-extension <proxy-auth-extension>`) is itself a fingerprint leak
(`chrome.runtime` weirdness, observable extension ids). mochi instead
attaches a CDP `Fetch.authRequired` listener (empty patterns,
`handleAuthRequests: true`) to provide credentials on demand — no
extension, no `Runtime.enable`, no `Page.createIsolatedWorld`. PLAN.md
§8.2 invariants are preserved.
**Affected probes:** none — this is a feature gap closure, not a stealth limit.
**Mitigation:** pass credentials either as an inline URL
(`mochi.launch({ proxy: "http://user:pass@host:port" })`) or via the
explicit `ProxyConfig` shape (`{ server, username, password }`). Both
forms work for HTTP, HTTPS, SOCKS5, SOCKS4 proxies. Credentials are
automatically forwarded to the network FFI as well so out-of-band
`Session.fetch` traffic shares the same authenticated egress.
**Known gaps:**
  - **proxy-PAC scripts** are NOT yet supported — there is no
    `--proxy-pac-url` plumbing today (separate task, low priority).
  - **SOCKS5 auth at the SOCKS handshake layer** depends on Chromium
    surfacing the challenge through `Fetch.authRequired`. Tested in modern
    Chrome stable; some older / patched builds may fail to fire the event
    cleanly. If you observe SOCKS5 auth failures in CI but the same
    creds work over HTTP, fall back to an HTTP proxy as the canonical
    path.
**User workaround:** for proxy-PAC, configure the proxy via system
environment / network policy until the flag lands.
**Tracking:** future task — proxy-PAC support.

---

## v0.5 (validation harness landed) — known limits

### Phase-0.7 JS-rule surfaces — DELIVERED in task 0070

**Status:** ~~known limit~~ resolved by task 0070 (phase 0.7 JS-rules deliverable)
**Root cause:** v0.5 shipped the harness mechanics; v0.7 (task 0070) extended the consistency engine + inject pipeline to cover WebGPU adapter info (R-032/R-033), MediaDevices.enumerateDevices with seed-stable IDs (R-034/R-035), Permissions.query defaults (R-036), Network Information API (R-037), screen.orientation + matchMedia + storage.estimate (R-038..R-040), and tip-locked browser full-version-list (R-031). The webgl unmasked-renderer wrap (R-002) is also tightened.
**Affected probes:** the harness now sees them all as matches — `mac-m4-chrome-stable` Zero-Diff at 100% structural match against the local fixture.
**Mitigation:** the per-profile `expected-divergences.json` is trimmed to just `audio.**` + `canvas.**` (deferred to task 0071 with precomputed blob fixtures).
**Tracking:** task 0071 (audio bytes + canvas hash maps).

### Audio + canvas precomputed fixtures — deferred to task 0071

**Status:** known limit (deferred to task 0071)
**Root cause:** Faithful spoofing of `OfflineAudioContext.startRendering()` byte hashes and `HTMLCanvasElement.toDataURL` outputs requires precomputed per-(profile, sample-rate) byte tables and per-(profile, payload) canvas hash maps. These are device-class-bound data files that need to ship in `packages/profiles/data/<id>/{audio,canvas}/*.bin`.
**Affected probes:** Browserleaks audio + canvas, FPJS visitor-id (audio + canvas components), creep.js audio + canvas. The harness baseline currently has audio/canvas data but the local fixture's spoofed run produces matching values too (both empty in the headless capture); when 0071 lands the precomputed bytes will be loaded explicitly so probes see the device's real fingerprint regardless of capture mode.
**Mitigation:** `packages/profiles/data/<id>/expected-divergences.json` lists `audio.**` + `canvas.**` as the only intentional divergences at v0.7.
**Tracking:** task 0071.

---

## v0.3 (inject engine landed) — known limits

### Audio fingerprinting (`OfflineAudioContext`) is NOT spoofed at v0.3

**Status:** known limit
**Root cause:** Faithful audio spoofing requires precomputed per-(profile, sample-rate) byte tables that don't exist until `@mochi.js/profiles` ships its first capture (phase 0.7). Runtime synthesis can't match real Chromium output to byte equality.
**Affected probes:** `OfflineAudioContext.startRendering()` byte hash, FPJS Pro audio component, creep.js audio.
**Mitigation:** v0.3 leaves the audio surface bare. A probe that hits it sees the raw Chromium audio fingerprint, which mismatches the spoofed UA family. Sites that fingerprint audio cross-checked with UA can detect the mismatch.
**User workaround:** none at JS layer. Pin the matched profile + Chromium-for-Testing version (phase 0.4 onward) so that the bare audio fingerprint *also* matches the device class.
**Tracking:** phase 0.7.

### Canvas fingerprinting (`HTMLCanvasElement.toDataURL`) is NOT spoofed at v0.3

**Status:** known limit
**Root cause:** Same as audio — faithful canvas spoofing needs precomputed hash maps for the standard probe payloads + per-pixel noise injection for unknown payloads. Both require profile-bound data tables that land in phase 0.7.
**Affected probes:** Browserleaks canvas, FPJS visitor-id (canvas component), creep.js canvas.
**Mitigation:** v0.3 leaves canvas bare. Same UA-mismatch caveat as audio.
**User workaround:** same as audio.
**Tracking:** phase 0.7.

### WebGPU adapter info — covered (verify)

**Status:** covered as of task 0070 (phase 0.7 JS-rules)
**Root cause:** WebGPU `requestAdapter().info` and `adapter.features` are now spoofed by `packages/inject/src/modules/webgpu.ts`, driven by R-032 (features) and R-033 (info) keyed off `gpu.vendor`. Per-vendor curated catalogs in `packages/consistency/src/rules/lookups/webgpu.ts`.
**Affected probes:** harness gate confirms `mac-m4-chrome-stable` Zero-Diff at the WebGPU surface as of 2026-05-08.
**Mitigation:** none needed.
**Tracking:** none — covered.

### `MediaDevices.enumerateDevices()` — covered (verify)

**Status:** covered as of task 0070
**Root cause:** Persistent device-id spoofing now ships in `packages/inject/src/modules/media-devices.ts`. `deviceId` and `groupId` are SHA-256(profile.id + ":" + seed + ":mediaDevices:<index>:<kind>") for byte-stable per-(profile, seed) IDs. Device shape and `getSupportedConstraints()` come from R-034/R-035 lookups.
**Affected probes:** WebRTC device enumeration probes, FPJS hardware tab.
**Mitigation:** none needed.
**Tracking:** none — covered.

### `SpeechSynthesis.getVoices()` — out of scope at v0.7 JS-rules; baseline empty

**Status:** known limit (no inject module yet; harness matches because the local fixture's mochi run also produces an empty list)
**Root cause:** Voice-list spoofing requires per-OS voice catalog data (mac voices vs Windows voices vs Linux voices). The captured Mac M4 baseline runs in headless mode where Chromium reports zero voices; mochi-spoofed sessions in headless mode also report zero voices, so the harness diff is currently empty. When future profile captures run headed, the catalog needs to land here.
**Affected probes:** speech-synthesis probes (creepjs speech).
**Mitigation:** none at v0.7.
**Tracking:** revisit when a headed-mode profile capture exposes the gap.

### `Permissions.query` — covered (verify)

**Status:** covered as of task 0070
**Root cause:** R-036 emits a default-state map (`prompt` for most APIs, `granted` for sensors and `clipboard-write`); `packages/inject/src/modules/permissions.ts` overrides `Permissions.prototype.query` to consult it.
**Affected probes:** anti-bot heuristics that compare permission states.
**Mitigation:** none needed.
**Tracking:** none — covered.

### Worker context injection has a smaller stealth ceiling than main-world

**Status:** known limit (architectural — JS-layer ceiling). Race window tightened in v0.2 (task 0254) but the underlying ceiling remains.
**Root cause:** `Page.addScriptToEvaluateOnNewDocument` doesn't apply to worker targets — Chromium has no equivalent "run before any script" hook for workers. The best mochi can do is bind to the worker's V8 isolate after creation but before user code runs. A determined fingerprint script in a Worker can still race our injection or detect the slightly-different invocation timing.
**Affected probes:** any probe that runs first-thing inside a `Worker` / `SharedWorker` / `ServiceWorker` / `AudioWorklet` and compares results to main-thread results.
**Mitigation:** PLAN.md §8.4 + PLAN.md §8.2. We use `Target.setAutoAttach({waitForDebuggerOnStart:true})` so the worker is paused at creation. v0.2 (task 0254 — patchright `crServiceWorkerPatch.ts:32-43`, `crPagePatch.ts:404-417`) tightens the inject window: pre-`runIfWaitingForDebugger` we send `Runtime.evaluate("globalThis", { serialization: "idOnly" })`, parse `objectId.split(".")[1]` for the worker's executionContextId, then deliver the payload via `Runtime.callFunctionOn({ functionDeclaration, executionContextId, returnByValue: true })`. Compared to v0.1.x's bare `Runtime.evaluate({ expression: payload.code })`, the bound-context call is harder to race because the contextId is captured in a single round-trip and reused — but it doesn't close the gap to a pre-script hook. No `Runtime.enable` ever sent.
**User workaround:** none at JS layer. Profiles can be marked "worker-stealth-sensitive" in v2 so that user code can opt out of probes that use workers.
**Tracking:** Chromium upstream. Likely never lands as a public CDP method (security-sensitive).

---

## v0.8 (behavioral engine landed) — known limits

### Real-trace recording / replay (`mochi record`)

**Status:** known limit (deferred to v1.x)
**Root cause:** v0.8 ships *synthesis-only*. A future `mochi record` API will
capture a real session's mouse / keyboard event stream and let the user replay
it through `humanClick(selector, { trace })`. The contract leaves room for it
(the `humanClick` opts surface is forward-compatible) but the recorder is out
of scope for v0.8 — synthesis covers the visible-trajectory bot-detection
heuristics on its own.
**Affected probes:** none today. Mentioned here for completeness.
**User workaround:** none needed; synthesis is the v0.8 answer.
**Tracking:** v1.x.

### Per-profile mouse acceleration curves

**Status:** known limit (deferred to v1.x)
**Root cause:** v0.8 uses a single Fitts-derived velocity profile (constant `a`
and `b` per profile). Real human motion is reported in some literature to
exhibit profile-specific acceleration / deceleration curves. PLAN.md §11
defers this nuance to v1.x because the synthesizer's overshoot+correction
already covers the dominant detectable signal.
**Affected probes:** academic mouse-velocity classifiers (no commercial probe
known to consume this).
**Mitigation:** none at v0.8.
**Tracking:** v1.x.

### Touch-gesture synthesis (mobile profiles)

**Status:** known limit (deferred to v2)
**Root cause:** v1 profiles are desktop Chromium-family only. Touch gestures
(tap / swipe / pinch / rotate) require a different model: pressure curves,
multi-touch coordination, OS-specific touch-event sequencing. Out of scope
until mobile profiles ship in v2.
**Affected probes:** any TouchEvent / PointerEvent (`pointerType: "touch"`)
fingerprinting.
**Mitigation:** none today. mochi sessions never claim to be mobile in v1.
**User workaround:** wait for v2 mobile profiles.
**Tracking:** v2 — mobile profiles.

### Realistic typing-error correction beyond "type wrong, backspace, retype"

**Status:** known limit (deferred to v1.x)
**Root cause:** Real typists sometimes notice an error several keystrokes
later and correct it with a series of backspaces. v0.8's mistake model
corrects immediately ("type adjacent key → backspace → type correct key").
The literature reports this is the dominant pattern at sub-3% error rates
(typical for `mistakeRate=0.02`); higher rates would benefit from the
deferred-correction model.
**Affected probes:** anti-bot heuristics that score "perfectness" of typing
patterns over long-form input.
**Mitigation:** keep `mistakeRate` close to the default 0.02.
**Tracking:** v1.x.

### Eye-tracking-coupled mouse models

**Status:** known limit (deferred to v2+)
**Root cause:** Some research-grade bot detectors look for the slight gaze /
mouse coupling characteristic of human attention. Synthesizing this requires
a saliency model and is well beyond the JS layer.
**Affected probes:** none in commercial deployment as of 2026-05.
**Tracking:** v2+ research item.

### Inter-action idle pauses (CloakBrowser `idle_between_actions`)

**Status:** known limit (intentional design choice)
**Root cause:** CloakBrowser's `idle_between_actions` config inserts a
randomized pause between successive `humanX` calls (e.g. between a click
and the next type). mochi does NOT insert such pauses by default — every
`humanClick`/`humanType`/`humanMove`/`humanScroll` includes its own
realistic intra-action timing (Bezier pacing, keystroke digraph delays,
inertial-scroll friction), but the inter-action interval is the user's
responsibility. This is a deliberate choice: we don't want to hide
realized timing from the caller, who often needs to coordinate with
page-side state changes (waitFor, etc.).
**Affected probes:** anti-bot heuristics that score "actions back-to-back
with zero idle" — typically not commercially deployed; the action-shape
classifiers we've measured care about intra-action distributions.
**User workaround:** `await new Promise(r => setTimeout(r, 200 + Math.random()*400))`
between actions if a target site rates the macro pacing.
**Tracking:** v1.x — opt-in `session.behavior = { idleBetweenActions: true }`.

### `humanClick` always re-clicks even on already-focused element

**Status:** known limit (intentional simplicity)
**Root cause:** CloakBrowser's `press(key)` short-circuits the trajectory
when the element is already focused (saves ~700ms on repeat input). mochi's
`humanClick(selector)` always synthesizes the trajectory + dispatches the
click, even when the target already has focus. The cost is one redundant
trajectory; the simplicity is worth more than the saved milliseconds at v1.
**Affected probes:** none — the behavior produces a *more* human-like
trace, not less.
**Mitigation:** call `page.humanType(selector, text)` directly when the
element already has focus from a prior interaction; the `DOM.focus`
happens internally and is idempotent.
**Tracking:** v1.x — focus-aware skip.

### Behavioral-conformance pushback (recorded-trace replay)

**Status:** acknowledged forward gap (deferred to v1.x)
**Root cause:** mochi's behavioral synth is paper-spec-driven — Bezier with
overshoot+correction, Fitts MT, lognormal digraph timing. The conformance
suite (task 0150) validates the SHAPE of the synthesized events against the
CloakBrowser test bar; the deviceandbrowserinfo.com online check returns
`superHumanSpeed=false` and `suspiciousClientSideBehavior=false`. If a
future ML-style classifier learns that the *distributional fingerprint* of
synthetic events is detectable (e.g., the 60Hz cadence is too uniform vs
a real OS's variable input pump rate), the answer is recorded-trace replay,
which is on the v1.x roadmap (`mochi record` + `humanClick(sel, { trace })`
already in the API contract). No quantitative evidence today that the
default synth fails real classifiers; this entry is for awareness.
**Affected probes:** hypothetical future ML classifiers.
**Tracking:** v1.x — `mochi record` recorder + replay surface.

---

## v0.1 (CDP transport landed) — known limits

### `page.evaluate(fn)` is `Runtime.callFunctionOn`-based, not full `Runtime.evaluate`

**Status:** known limit
**Root cause:** PLAN.md §8.2 forbids `Runtime.enable`, and PLAN.md §8.4 forbids `Runtime.evaluate` with `includeCommandLineAPI:true` and `Page.createIsolatedWorld` for naming a world. Without those, the only way to run a function in main world is `Runtime.callFunctionOn` against the document's `objectId` — which has lossier return-value semantics than full `Runtime.evaluate`.
**Affected APIs:** `Page.evaluate(fn)` consumers.
**What works:** any function whose return value is JSON-serializable (string, number, boolean, plain object, array). `this` inside the function is the document.
**What doesn't:** returning DOM nodes, functions, `undefined`, circular structures, classes, or Maps/Sets — these are coerced or dropped per CDP `returnByValue:true` semantics. Argument-passing into `evaluate` is also unsupported at v0.1 (the brief deferred this); pass values via DOM data attributes or globals.
**Mitigation:** documented; phase 0.x will add an `evaluateHandle`-style API that returns a `RemoteObject` wrapper for non-serializable returns.
**Tracking:** none yet — file when needed.

### `Page.goto(url, { waitUntil: "networkidle" })` not implemented

**Status:** partial coverage (mapped to `"load"`)
**Root cause:** `networkidle` requires the `Network` domain, which we keep disabled by default per PLAN.md §8.2 ("Network.enable globally on the root target — only attached per-frame when needed"). v0.1 does not implement the per-frame Network attach yet.
**Mitigation:** v0.1 silently uses `"load"` semantics when `"networkidle"` is requested. `"load"` and `"domcontentloaded"` work as expected.
**Tracking:** to be addressed in a follow-up task once Network domain enablement is properly scoped per-frame.

### `Session.fetch`, `Page.screenshot`

**Status:** placeholder — `NotImplementedError`
**Root cause:** out of scope for phase 0.1 per `tasks/0011-cdp-pipe-transport.md`. Phase 0.6 wires `Session.fetch`; `screenshot` lands in a follow-up.
**Mitigation:** none needed; the error message names the API and the phase.

> Phase 0.8 graduated `Page.humanClick` / `Page.humanType` / `Page.humanScroll`
> from placeholder to real implementations. See the "v0.8" section above for
> the known limits of the behavioral engine.

### `Session.cookies()` URL filter is host-only

**Status:** partial coverage
**Root cause:** v0.1 reads cookies via `Storage.getCookies` on the root browser target (the only domain that exposes a global cookie list without per-page Network enablement). The CDP `Storage.getCookies` does not accept an URL filter; we filter client-side by hostname suffix.
**Mitigation:** path/secure/SameSite filtering can be applied by the caller on the returned array. Full URL semantics will land alongside per-frame Network in a later phase.

---

## v0.10 (cross-platform prebuilds landed)

The `@mochi.js/net-rs` cdylib now ships as a postinstall-downloaded
prebuilt asset on the 5 supported platforms. Anything outside that set
falls back to a local `cargo build`.

### Prebuilt cdylib platform coverage

**Status:** partial coverage
**Supported (postinstall download from GH Releases):**
- `darwin-arm64` (macOS, Apple Silicon — `mochi_net-darwin-arm64.dylib`)
- `darwin-x64` (macOS, Intel — `mochi_net-darwin-x64.dylib`)
- `linux-x64` (Linux x86_64, glibc — `mochi_net-linux-x64.so`)
- `linux-arm64` (Linux aarch64, glibc — `mochi_net-linux-arm64.so`,
  cross-compiled with `cargo-zigbuild`)
- `win32-x64` (Windows, MSVC — `mochi_net-win32-x64.dll`)

**Not covered:**
- FreeBSD / OpenBSD / Alpine musl / Linux ia32 / Windows arm64 — no
  prebuilt assets shipped. Consumers can build from source via
  `cargo build --release --manifest-path packages/net-rs/Cargo.toml`;
  the loader (packages/net/src/ffi.ts) walks both the postinstall
  `native/` directory AND `target/release/`, so a local cargo build
  Just Works.

**Root cause:** PLAN.md §14 phase 0.10 scopes prebuilds to the 5
tuples that cover ~95% of the npm install base. Adding more (musl,
Windows arm64) is straightforward in the workflow matrix but requires
either a `cross` Docker image or alternative zigbuild target — defer
to v1.x driven by actual demand.

**Mitigation:** the postinstall script (`packages/net-rs/scripts/install-prebuild.ts`)
emits a friendly message and exits 0 on unsupported platforms; install
never blocks. The `@mochi.js/net` loader produces a clean
`cargo build` instruction at first `Session.fetch()` if no binary is
resolvable. Set `MOCHI_NET_SKIP_POSTINSTALL=1` to bypass the download
entirely.

**User workaround:** cargo-build the cdylib locally; the loader picks
it up from `packages/net-rs/target/release/`.

**Tracking:** none — adding a 6th platform is a workflow-matrix entry,
not a fundamental gap.

---

*This file is owned collectively by every contributor. Add to it the moment you discover a limit; the framework's credibility lives here.*
