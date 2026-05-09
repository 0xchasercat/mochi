# @mochi.js/inject

Zero-jitter stealth payload for [mochi](https://github.com/0xchasercat/mochi). Builds a single TurboFan-friendly IIFE that installs JS-layer fingerprint proxies before any page script runs.

Internal package consumed by `@mochi.js/core`.

**Status:** shipping in v0.2. Module surface covers UA / UA-CH, navigator, plugins, screen, timing, fonts, MediaDevices, Permissions, WebGL, WebGPU, network-info, screen-orientation, mouse-event-screen, window-chrome, bot-globals, plus the byte-exact fingerprint modules:

- `audio-fingerprint` — consumes the per-(profile, sample-rate) precomputed blob produced by R-047 and patches `OfflineAudioContext.prototype.startRendering`. The residual is distributed across the 489 samples in `[4510..4999)` with `Math.fround` to model the f32 readback step page-side, so the digest is byte-exact on every host architecture.
- `canvas-fingerprint` — consumes the R-048 baseline and patches `HTMLCanvasElement.prototype.toDataURL` (plus `OffscreenCanvas` / `getImageData` siblings). Probe-sized canvases (300×150) get the captured baseline verbatim; non-probe sizes fall through to native rendering so application canvas use keeps working.

Delivery is dual-mechanism: `Fetch.fulfillRequest` body splice on Document responses (CSP-rewritten), with `Page.addScriptToEvaluateOnNewDocument({ runImmediately: true, worldName: "" })` as fallback for `about:blank` / `data:` / other non-HTTP nav targets. Idempotency via `globalThis.__mochi_inject_marker`.

See [PLAN.md §5.3 and §8.4](https://github.com/0xchasercat/mochi/blob/main/PLAN.md) and <https://mochijs.com/docs/reference/limits>.

## Documentation

- Package reference: <https://mochijs.com/docs/api/inject>
- Concept deep-dive: <https://mochijs.com/docs/concepts/inject-pipeline>
- Cookbook: <https://mochijs.com/docs/guides/pick-a-scenario>
