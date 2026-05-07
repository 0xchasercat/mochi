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

### WebGPU adapter info is NOT spoofed at v0.3

**Status:** known limit
**Root cause:** WebGPU `requestAdapter().requestAdapterInfo()` exposes `architecture`/`description`/`device`/`vendor` strings. These haven't been added to `MatrixV1` yet — they require additional consistency-engine rules to lock against the existing `gpu.{vendor, renderer}` slot.
**Affected probes:** WebGPU adapter info readout, browserleaks webgpu.
**Mitigation:** none at v0.3 — bare Chromium values.
**User workaround:** none at JS layer in v0.3.
**Tracking:** phase 0.7 (consistency engine full).

### `MediaDevices.enumerateDevices()` is NOT spoofed at v0.3

**Status:** known limit
**Root cause:** Persistent device-id spoofing requires (a) the matrix to declare a stable per-(profile, seed) device list and (b) the inject layer to wrap the async `enumerateDevices` Promise. Neither lands until phase 0.7.
**Affected probes:** WebRTC device enumeration probes, FPJS hardware tab.
**Mitigation:** v0.3 leaves bare Chromium output (typically empty in headless mode).
**User workaround:** none at JS layer in v0.3.
**Tracking:** phase 0.7.

### `SpeechSynthesis.getVoices()` is NOT spoofed at v0.3

**Status:** known limit
**Root cause:** Voice-list spoofing requires per-OS voice catalog data (mac voices vs Windows voices vs Linux voices) — to land alongside fonts in phase 0.7.
**Affected probes:** speech-synthesis probes (creepjs speech).
**Mitigation:** none at v0.3.
**User workaround:** none.
**Tracking:** phase 0.7.

### `Notification.permission` and `Permissions.query` use bare Chrome behavior

**Status:** known limit
**Root cause:** v0.3 deliberately doesn't override these — they're more about page-permission state (which mochi sessions don't grant) than fingerprintable surface. The bare Chromium values match what a fresh-profile, never-prompted user would see.
**Affected probes:** anti-bot heuristics that compare `Notification.permission === "denied"` against UA.
**Mitigation:** none — the bare values are already the "stealth-correct" values.
**User workaround:** none needed.
**Tracking:** revisit when a probe actually flags this.

### Worker context injection has a smaller stealth ceiling than main-world

**Status:** known limit (architectural — JS-layer ceiling)
**Root cause:** `Page.addScriptToEvaluateOnNewDocument` doesn't apply to worker targets — Chromium has no equivalent "run before any script" hook for workers. The best mochi can do is `Runtime.evaluate` against the paused worker target on `Target.attachedToTarget`. That evaluate runs *just after* the worker's V8 isolate is created but uses the standard Runtime domain rather than a pre-script-runner hook. A determined fingerprint script in a Worker can race our injection or detect the slightly-different invocation timing.
**Affected probes:** any probe that runs first-thing inside a `Worker` / `SharedWorker` / `ServiceWorker` / `AudioWorklet` and compares results to main-thread results.
**Mitigation:** PLAN.md §8.4 + PLAN.md §8.2 — we use `Target.setAutoAttach({waitForDebuggerOnStart:true})` so the worker is paused at creation; we evaluate the payload against it; then we resume via `Runtime.runIfWaitingForDebugger`. No `Runtime.enable` ever sent.
**User workaround:** none at JS layer. Profiles can be marked "worker-stealth-sensitive" in v2 so that user code can opt out of probes that use workers.
**Tracking:** Chromium upstream. Likely never lands as a public CDP method (security-sensitive).

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

### `Session.fetch`, `Page.humanClick`, `Page.humanType`, `Page.humanScroll`, `Page.screenshot`

**Status:** placeholder — `NotImplementedError`
**Root cause:** out of scope for phase 0.1 per `tasks/0011-cdp-pipe-transport.md`. Phase 0.6 wires `Session.fetch`; phase 0.8 wires the human-input surface; `screenshot` lands in a follow-up.
**Mitigation:** none needed; the error message names the API and the phase.

### `Session.cookies()` URL filter is host-only

**Status:** partial coverage
**Root cause:** v0.1 reads cookies via `Storage.getCookies` on the root browser target (the only domain that exposes a global cookie list without per-page Network enablement). The CDP `Storage.getCookies` does not accept an URL filter; we filter client-side by hostname suffix.
**Mitigation:** path/secure/SameSite filtering can be applied by the caller on the returned array. Full URL semantics will land alongside per-frame Network in a later phase.

---

*This file is owned collectively by every contributor. Add to it the moment you discover a limit; the framework's credibility lives here.*
