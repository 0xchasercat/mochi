# @mochi.js/consistency

The Matrix engine for [mochi](https://github.com/0xchasercat/mochi). Generates a relationally-locked fingerprint matrix from a `(profile, seed)` pair.

This is an **internal** package consumed by `@mochi.js/core`. Most users should `bun add @mochi.js/core` instead.

```ts
import { deriveMatrix } from "@mochi.js/consistency";
```

**Status:** v0.0.1 claim release. Full implementation lands in phase 0.2 / 0.7.

See [PLAN.md §9](https://github.com/0xchasercat/mochi/blob/main/PLAN.md) for the full ruleset.
