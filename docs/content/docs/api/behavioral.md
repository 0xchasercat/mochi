---
title: "@mochi.js/behavioral"
description: Pure-data biomechanical synth — Bezier paths, Fitts MT, lognormal digraph timing, inertial scroll.
order: 4
category: api
lastUpdated: 2026-05-09
---

Pure-data synthesis. The exported `synthesize*` functions return arrays of plain objects. Side effects (CDP dispatch, timing) live in `@mochi.js/core/page.ts` — this package is offline-deterministic and side-effect-free.

## Public surface

- `synthesizeTrajectory(opts, seed?): TrajectoryEvent[]` — Bezier path with overshoot+correction, Fitts MT, autocorrelated Gaussian jitter.
- `synthesizeKeystrokes(text, opts, seed?): KeystrokeEvent[]` — lognormal digraph timing, QWERTY-adjacent mistake injection.
- `synthesizeScroll(opts, seed?): ScrollEvent[]` — inertial scroll with friction.
- `DEFAULT_BEHAVIOR_PROFILE` — sensible v1 defaults (right-handed, low tremor, ~250 wpm range).
- `VERSION` — the npm package version.

## Types

- `BehaviorProfile` — `{ hand, tremor, wpm, scrollStyle, ... }` — the profile-derived behavior block.
- `Point` / `Box` — geometry primitives.
- `TrajectoryEvent` — `{ t, x, y }` per movement step.
- `KeystrokeEvent` — `{ t, key, type: "down" | "up" }`.
- `ScrollEvent` — `{ t, deltaY, deltaX }`.

## Determinism contract

Each synth function accepts an optional `seed: string`. Same `(opts, seed)` produces byte-identical output across runs and across processes. When `seed` is omitted, a stable per-namespace default is used so unseeded calls remain deterministic *within a process*.

## I-5 honored

The behavioral PRNG reuses `@mochi.js/consistency`'s `xoshiro256**` so a `(profile, seed)` pair produces a single deterministic universe across all surfaces — fingerprint and behavior. No separate entropy source.
