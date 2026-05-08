---
"@mochi.js/behavioral": minor
"@mochi.js/consistency": patch
"@mochi.js/core": minor
---

Land the phase 0.8 behavioral engine.

`@mochi.js/behavioral` ships pure-data synthesizers for human-shaped input:
mouse trajectories (cubic Bezier with overshoot+correction, Fitts's-Law
duration, autocorrelated Gaussian jitter), keystroke timing (lognormal
digraph delays, Gaussian press duration, QWERTY-adjacent mistake injection),
and inertial scroll (exponential friction decay, 60Hz frame cap). Every
synth function accepts `seed?: string` and produces byte-identical output
for the same `(opts, seed)` pair, verified by a determinism suite (10
iterations × 4 surfaces).

`@mochi.js/core.Page.humanClick` / `humanType` / `humanScroll` graduate from
`NotImplementedError` placeholders to real implementations that consume the
behavioral synth arrays and dispatch them as `Input.dispatchMouseEvent` /
`Input.dispatchKeyEvent`. The behavior parameters come from
`MatrixV1.profile.behavior` (PLAN.md I-5) and may be overridden per call.

`@mochi.js/consistency` promotes its xoshiro256** PRNG and SHA-256 seed
derivation to a public sub-export (`@mochi.js/consistency/prng`) so the
behavioral package can share the same primitive — preserving the
"single deterministic universe per `(profile, seed)`" invariant.
