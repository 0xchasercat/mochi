# @mochi.js/consistency

The Matrix engine for [mochi](https://github.com/0xchasercat/mochi). Generates a relationally-locked fingerprint matrix from a `(profile, seed)` pair.

This is an **internal** package consumed by `@mochi.js/core`. Most users should `bun add @mochi.js/core` instead.

```ts
import { deriveMatrix } from "@mochi.js/consistency";
```

**Status:** shipping in v0.2. The 40-rule DAG covers UA / UA-CH, navigator, plugins, screen, timing, fonts, MediaDevices, Permissions, WebGL, WebGPU, audio fingerprint (R-047), and canvas fingerprint (R-048 — both fed by precomputed per-profile blobs).

See [PLAN.md §9](https://github.com/0xchasercat/mochi/blob/main/PLAN.md) for the full ruleset.

## Documentation

- Package reference: <https://mochijs.com/docs/api/consistency>
- Concept deep-dive: <https://mochijs.com/docs/concepts/consistency-engine>
- Cookbook: <https://mochijs.com/docs/guides/pick-a-scenario>
