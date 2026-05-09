# @mochi.js/harness

Probe Manifest validation harness for [mochi](https://github.com/0xchasercat/mochi). Captures, normalizes, diffs, categorizes — the Zero-Diff PR gate.

Mirrors [Peekaboo's equivalence-harness pattern](https://github.com/0xchasercat/mochi/blob/main/PLAN.md): every PR that touches `@mochi.js/inject`, `@mochi.js/consistency`, or `@mochi.js/profiles` runs the harness against affected profiles and gates on zero material divergences.

**Status:** shipping in v0.2. Capture / normalize / diff / categorize pipeline runs end-to-end; `bun run harness:smoke` and the `bun run test:contract` gate are wired in CI.

See [PLAN.md §13](https://github.com/0xchasercat/mochi/blob/main/PLAN.md).

## Documentation

- Package reference: <https://mochijs.com/docs/api/harness>
- Concept deep-dive: <https://mochijs.com/docs/concepts/probe-manifest>
- Cookbook: <https://mochijs.com/docs/guides/pick-a-scenario>
