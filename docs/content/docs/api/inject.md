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

## v0.1 scope

The payload covers the ~30 rules from R-001..R-030 — navigator, screen, simple GPU strings, fonts/baseline-only, locale, timezone, hardware basics. Audio precomputed bytes, canvas hash maps, and full WebGL extension catalogs land in phase 0.7 (task 0071).
