# @mochi.js/harness

Probe Manifest validation harness for [mochi](https://github.com/0xchasercat/mochi). Captures, normalizes, diffs, categorizes — the Zero-Diff PR gate.

Mirrors [Peekaboo's equivalence-harness pattern](https://github.com/0xchasercat/mochi/blob/main/PLAN.md): every PR that touches `@mochi.js/inject`, `@mochi.js/consistency`, or `@mochi.js/profiles` runs the harness against affected profiles and gates on zero material divergences.

**Status:** v0.0.1 claim release. Harness lands in phase 0.5.

See [PLAN.md §13](https://github.com/0xchasercat/mochi/blob/main/PLAN.md).
