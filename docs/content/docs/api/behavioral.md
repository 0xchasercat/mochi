---
title: "@mochi.js/behavioral"
description: "Pure-data biomechanical synth — Bezier paths, Fitts MT, lognormal digraph timing, inertial scroll."
order: 4
category: api
lastUpdated: 2026-05-09
---

`@mochi.js/behavioral` produces *plain data* — arrays of `{tMs, x, y}` trajectory events, `{tDownMs, tUpMs, key, text}` keystroke events, `{tMs, deltaY}` scroll frames. Side effects (CDP `Input.dispatchMouseEvent` / `dispatchKeyEvent`, timing) live in `@mochi.js/core`'s `Page`. You almost never call this package directly — `page.humanClick` / `humanType` / `humanScroll` are the user surface. Reach for the synth functions when you're (a) writing a test that asserts trajectory shape, (b) feeding events into a different dispatch layer, or (c) building a custom motion primitive that composes on top.

## Installation

```sh
bun add @mochi.js/behavioral
```

## Public exports

### `function synthesizeMouseTrajectory(opts: MouseTrajectoryOptions): TrajectoryEvent[]`

Cubic-Bezier mouse trajectory from `from` to `to` (or into `box`). 60 Hz sampling. Includes overshoot+correction (10% probability by default) and autocorrelated Gaussian jitter at τ ≈ 30ms. Pure function — same `(opts, seed)` produces a byte-identical event array.

```ts
import { synthesizeMouseTrajectory } from "@mochi.js/behavioral";

const events = synthesizeMouseTrajectory({
  from: { x: 100, y: 100 },
  to: { x: 800, y: 600 },
  profile: { hand: "right", tremor: 0.18, wpm: 65, scrollStyle: "smooth" },
  seed: "u1:click:0",
});
// events[i] = { tMs: number, x: number, y: number }
```

### `function synthesizeKeystrokes(opts: KeystrokeOptions): KeystrokeEvent[]`

Keystroke synthesis with lognormal digraph timing (same-hand / cross-hand / after-space / after-punctuation regimes), Gaussian press durations, and QWERTY-adjacent mistake injection. WPM scales all inter-key delays.

```ts
import { synthesizeKeystrokes } from "@mochi.js/behavioral";

const events = synthesizeKeystrokes({
  text: "hello, world",
  profile: { wpm: 70 },
  mistakeRate: 0.02,
  seed: "u1:type:0",
});
// events[i] = { tDownMs, tUpMs, key, text, mistake, correction }
```

### `function synthesizeScroll(opts: ScrollOptions): ScrollEvent[]`

Inertial scroll with friction-decay (τ ≈ 350ms). Per-frame `deltaY` capped at 100px (browser throttle). `scrollStyle: "stepped"` rounds each frame to the spec wheel-notch (100px) for chunky-scroll users.

```ts
import { synthesizeScroll } from "@mochi.js/behavioral";

const events = synthesizeScroll({
  from: 0,
  to: 1500,
  duration: 500,
  profile: { scrollStyle: "smooth" },
  seed: "u1:scroll:0",
});
// events[i] = { tMs, deltaY }
```

### Option types

```ts
interface MouseTrajectoryOptions {
  readonly from: Point;
  readonly to: Point;
  readonly box?: Box;
  readonly profile?: Partial<BehaviorProfile>;
  readonly fitts?: { a?: number; b?: number };
  readonly durationMs?: number;
  readonly overshootProbability?: number;
  readonly seed?: string;
}

interface KeystrokeOptions {
  readonly text: string;
  readonly profile?: Partial<BehaviorProfile>;
  readonly mistakeRate?: number; // default 0.02
  readonly seed?: string;
}

interface ScrollOptions {
  readonly from: number;
  readonly to: number;
  readonly duration?: number;     // default 500ms
  readonly profile?: Partial<BehaviorProfile>;
  readonly seed?: string;
}
```

### Event types

```ts
interface Point  { readonly x: number; readonly y: number; }
interface Box    { readonly x: number; readonly y: number; readonly width: number; readonly height: number; }

interface TrajectoryEvent {
  readonly tMs: number;
  readonly x: number;
  readonly y: number;
}

interface KeystrokeEvent {
  readonly tDownMs: number;
  readonly tUpMs: number;
  readonly key: string;        // CDP-canonical key name
  readonly text: string;       // literal text on keydown; "" for control keys
  readonly mistake: boolean;
  readonly correction: boolean;
}

interface ScrollEvent {
  readonly tMs: number;
  readonly deltaY: number;
}
```

### `interface BehaviorProfile` + `DEFAULT_BEHAVIOR_PROFILE`

```ts
interface BehaviorProfile {
  readonly hand: "left" | "right";
  readonly tremor: number;             // per-axis Gaussian jitter amplitude (px)
  readonly wpm: number;                // mean typing speed in words/min
  readonly scrollStyle: "smooth" | "stepped" | "inertial";
}

const DEFAULT_BEHAVIOR_PROFILE: BehaviorProfile = {
  hand: "right",
  tremor: 0.18,
  wpm: 65,
  scrollStyle: "smooth",
};
```

Mirrors `MatrixV1.behavior`. The matrix is the single source of truth (PLAN.md I-5); `Page.humanClick` etc. read `session.profile.behavior` and pass it through. `DEFAULT_BEHAVIOR_PROFILE` is the fallback when no matrix is supplied (e.g. unit tests).

### Lower-level helpers

```ts
function fittsMT(distancePx: number, targetWidthPx: number, a?: number, b?: number): number;
function adjacentKey(intended: string, pickIndex: (n: number) => number): string | null;
function cdpKeyFor(char: string): string;
function handFor(char: string): "left" | "right" | null;
```

- `fittsMT(D, W, a=200, b=90)` — Fitts's-Law movement time in ms. `a` is the reaction-time intercept, `b` is the motor-speed slope.
- `adjacentKey(intended, pickIndex)` — pick a QWERTY-adjacent key for mistake injection. `pickIndex(n)` returns an integer in `[0, n)`.
- `cdpKeyFor(char)` — map a character to its CDP `Input.dispatchKeyEvent` `key` field.
- `handFor(char)` — `"left"` / `"right"` / `null` for the default-finger hand on QWERTY.

### `const VERSION: string`

The npm package version.

## Determinism contract

Each synth function accepts an optional `seed: string`. Same `(opts, seed)` produces byte-identical output across runs and across processes. When `seed` is omitted, a stable per-namespace default is used so unseeded calls remain deterministic *within a process*.

The PRNG is `xoshiro256**` from `@mochi.js/consistency/prng` — same primitive the rule DAG uses, so a `(profile, seed)` pair produces a single deterministic universe across fingerprint AND behavior.

## Common patterns

### Inspect a click trajectory before dispatching

```ts
import { synthesizeMouseTrajectory } from "@mochi.js/behavioral";

const traj = synthesizeMouseTrajectory({
  from: page.cursorPosition(),
  to: { x: 200, y: 150 },
  profile: session.profile.behavior,
  seed: "diag",
});
console.log(`${traj.length} samples, peak deltaT = ${
  Math.max(...traj.slice(1).map((e, i) => e.tMs - (traj[i]?.tMs ?? 0)))
}ms`);
```

### Drive a custom dispatch layer

```ts
import { synthesizeKeystrokes } from "@mochi.js/behavioral";

const events = synthesizeKeystrokes({ text: "search query", seed: "x" });
for (const ev of events) {
  await myDispatch.keyDown({ key: ev.key, text: ev.text });
  await sleep(ev.tUpMs - ev.tDownMs);
  await myDispatch.keyUp({ key: ev.key });
}
```

## See also

- [Concepts → Behavioral synth](/docs/concepts/behavioral-synth)
- [Concepts → Consistency engine](/docs/concepts/consistency-engine)
- [API → @mochi.js/core](/docs/api/core) — `page.humanClick`, `humanType`, `humanScroll`, `humanMove`
- [API → @mochi.js/consistency](/docs/api/consistency) — `MatrixV1.behavior`, the seeded PRNG

<!-- llm-context:start
Package: @mochi.js/behavioral
Public surface (verbatim from packages/behavioral/src/index.ts as of 2026-05-09):

  VERSION                                            (const string, "0.1.0")

Types:
  BehaviorProfile, Box, KeystrokeEvent, Point, ScrollEvent, TrajectoryEvent
  DEFAULT_BEHAVIOR_PROFILE                           (const BehaviorProfile)

Synth functions + their option types:
  KeystrokeOptions
  synthesizeKeystrokes(opts: KeystrokeOptions): KeystrokeEvent[]
  MouseTrajectoryOptions
  synthesizeMouseTrajectory(opts: MouseTrajectoryOptions): TrajectoryEvent[]
  ScrollOptions
  synthesizeScroll(opts: ScrollOptions): ScrollEvent[]

Lower-level helpers:
  fittsMT(distancePx, targetWidthPx, a=200, b=90): number
  adjacentKey(intended: string, pickIndex: (n: number) => number): string | null
  cdpKeyFor(char: string): string
  handFor(char: string): "left" | "right" | null

Internal (NOT exported from the barrel):
  prngFor, GaussianSampler, lognormal, sampleCubicBezier, perpendicularUnit, dist
  isSpaceLike, isPunctuation (qwerty.ts internals)

Event field names — these are the EXACT names:
  TrajectoryEvent: { tMs, x, y }                   — NOT { t, x, y }
  KeystrokeEvent: { tDownMs, tUpMs, key, text, mistake, correction }
                                                    — NOT { t, key, type: "down"|"up" }
  ScrollEvent: { tMs, deltaY }                     — NOT { t, deltaY, deltaX }; deltaX is not modeled

Common LLM hallucinations (DO NOT USE):
- `synthesizeTrajectory(...)` — function is named `synthesizeMouseTrajectory`
- `synthesizeKeystrokes(text, opts)` two-arg form — single options object: { text, profile, mistakeRate, seed }
- `KeystrokeEvent.type === "down" | "up"` — events are press-pairs with tDownMs + tUpMs, not split events
- `TrajectoryEvent.t` (short field) — field is `tMs`
- `BehaviorProfile.handedness` — field is `hand`
- `BehaviorProfile.scrollSpeed` — there is no scrollSpeed; use scrollStyle
- `DEFAULT_BEHAVIOR_PROFILE.wpm === 250` — actual default is 65 (not 250)
- `synthesize*(opts, seed)` two-arg form — seed is `opts.seed`, not a separate positional arg
- `CDP.dispatch(events)` — this package is pure data; dispatch lives in @mochi.js/core's Page

Cross-references:
- /docs/concepts/behavioral-synth
- /docs/concepts/consistency-engine
- /docs/api/core
- /docs/api/consistency
llm-context:end -->
