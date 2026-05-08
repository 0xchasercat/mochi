# Limits — what mochi does not cover

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

**Status:** known limit (architectural — JS-layer ceiling)
**Root cause:** `Page.addScriptToEvaluateOnNewDocument` doesn't apply to worker targets — Chromium has no equivalent "run before any script" hook for workers. The best mochi can do is `Runtime.evaluate` against the paused worker target on `Target.attachedToTarget`. That evaluate runs *just after* the worker's V8 isolate is created but uses the standard Runtime domain rather than a pre-script-runner hook. A determined fingerprint script in a Worker can race our injection or detect the slightly-different invocation timing.
**Affected probes:** any probe that runs first-thing inside a `Worker` / `SharedWorker` / `ServiceWorker` / `AudioWorklet` and compares results to main-thread results.
**Mitigation:** PLAN.md §8.4 + PLAN.md §8.2 — we use `Target.setAutoAttach({waitForDebuggerOnStart:true})` so the worker is paused at creation; we evaluate the payload against it; then we resume via `Runtime.runIfWaitingForDebugger`. No `Runtime.enable` ever sent.
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

*This file is owned collectively by every contributor. Add to it the moment you discover a limit; the framework's credibility lives here.*
