---
title: "@mochi.js/inject"
description: The zero-jitter stealth payload builder.
order: 3
category: api
lastUpdated: 2026-05-09
---

Builds a single IIFE bundle of TurboFan-friendly proxies for `@mochi.js/core` to install via `Page.addScriptToEvaluateOnNewDocument({ runImmediately: true, worldName: "" })` before any page script runs.

## Public surface

- `buildPayload(matrix: MatrixV1): PayloadResult` — produce the IIFE source, the bundle hash, and the byte size. Pure function of the Matrix.
- `VERSION` — the npm package version.

## `PayloadResult`

```ts
interface PayloadResult {
  source: string;       // the IIFE source code
  hash: string;         // SHA-256 of `source`
  bytes: number;        // byte length of `source`
  modules: string[];    // which modules were included (for debugging)
}
```

## Architectural invariants honored

- **I-1.** No C++ patches; pure JS Proxy traps + property defs.
- **I-3.** Bun-only; `buildPayload` itself runs in any modern JS runtime, but the consuming pipeline assumes Bun.
- **PLAN.md §8.2.** The payload is installed via `runImmediately: true` and never sends `Runtime.enable`. No `Runtime.evaluate` with `includeCommandLineAPI: true`. No `Page.createIsolatedWorld` for naming a world.

## Delivery

`@mochi.js/core` does not call `addScriptToEvaluateOnNewDocument` directly for the Mochi payload — see [The inject pipeline](/docs/concepts/inject-pipeline) for the dual-mechanism design (`Fetch.fulfillRequest` body splice on Document responses, `addScriptToEvaluateOnNewDocument({ runImmediately: true, worldName: "" })` fallback for non-HTTP nav targets). Both mechanisms install the same wrapped source; idempotency is guarded via `__mochi_inject_marker`.

## v0.2 scope

The payload covers all 40 rules in the consistency DAG, including:

- **R-001..R-030.** Navigator, screen, GPU strings, fonts, locale, timezone, hardware basics.
- **R-036.** Per-permission `navigator.permissions.query()` matrix (orthogonal to `Page.grantAllPermissions`).
- **R-047.** Audio (`OfflineAudioContext`) byte-accurate fingerprint, per-(profile, sample-rate) capture. The spoof distributes the audio residual across the 489 samples in `[4510..4999)` using `Math.fround` to model f32 readback, so the page-side digest is byte-exact on every host architecture, not just Mac M-series.
- **R-048.** Canvas (`toDataURL`) byte-accurate fingerprint, per-profile data URL synthesis. Probe-sized canvases (`300×150`) intercepted with the captured baseline; non-probe sizes fall through to native rendering.

Tasks: 0267 (audio + canvas precomputed blobs), 0266 (Fetch.fulfillRequest delivery).
