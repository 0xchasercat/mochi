# @mochi.js/behavioral

Biomechanical input synthesis for [mochi](https://github.com/0xchasercat/mochi). Powers `page.humanClick`, `page.humanType`, `page.humanScroll` via cubic Bezier + Fitts's Law + Gaussian jitter — pure data, no side effects.

Internal package consumed by `@mochi.js/core`.

**Status:** shipping in v0.2. Engine drives `humanClick` / `humanType` / `humanScroll` on every `Page` returned by `@mochi.js/core` — Bezier paths with overshoot+correction, Fitts-law movement times, lognormal digraph delays, profile-parameterized off `MatrixV1.profile.behavior` (`hand`, `tremor`, `wpm`, `scrollStyle`).

See [PLAN.md §11](https://github.com/0xchasercat/mochi/blob/main/PLAN.md).

## Documentation

- Package reference: <https://mochijs.com/docs/api/behavioral>
- Concept deep-dive: <https://mochijs.com/docs/concepts/behavioral-synth>
- Cookbook: <https://mochijs.com/docs/guides/pick-a-scenario>
