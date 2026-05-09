---
title: Behavioral synthesis
description: Bezier paths with overshoot+correction, Fitts movement times, lognormal digraph delays — the biomechanical model behind humanClick / humanType / humanScroll.
order: 5
category: concepts
lastUpdated: 2026-05-09
---

A cursor that teleports in a straight line to a button and clicks it is a fingerprint signal as obvious as a wrong UA string. mochi's `page.humanClick` / `page.humanType` / `page.humanScroll` derive from biomechanical models — Bezier paths with overshoot+correction, Fitts movement times, lognormal digraph delays, autocorrelated Gaussian jitter — all parameterized off the matrix's `behavior` block (`hand`, `tremor`, `wpm`, `scrollStyle`).

This is the third pillar of mochi's stealth philosophy alongside [relational consistency](/docs/concepts/consistency-engine) and [JA4 coherence via Chromium-native networking](/docs/concepts/stealth-philosophy#network-and-ja4). The same `(profile, seed)` that locks the fingerprint Matrix also seeds the [`@mochi.js/behavioral`](https://github.com/0xchasercat/mochi/tree/main/packages/behavioral) PRNG — one deterministic universe across consistency *and* behavior. PLAN.md §11.

## The pure-data principle

Behavioral synth is split into two layers:

1. **`@mochi.js/behavioral`** is *pure data*. Its functions take options + a seed and return arrays of plain objects:
   ```ts
   import { synthesizeMouseTrajectory } from "@mochi.js/behavioral";

   const trajectory = synthesizeMouseTrajectory({
     from: { x: 100, y: 100 },
     to: { x: 800, y: 600 },
     box: { x: 780, y: 580, width: 40, height: 40 },
     profile: { hand: "right", tremor: 0.18, wpm: 65, scrollStyle: "smooth" },
     seed: "user-12345:target-1:0",
   });
   // trajectory: TrajectoryEvent[] = [{ tMs, x, y }, ...]
   ```
2. **`@mochi.js/core/page.ts`** is the side-effect layer. It receives the synthesized array and dispatches each event via `Input.dispatchMouseEvent` / `Input.dispatchKeyEvent`, paced via `setTimeout` to match the synthesized `tMs` cadence.

This split (PLAN.md §5.5) means the synth is testable without spawning a Chromium, and the dispatch timing matches the model on a relaxed best-effort basis (Bun's `setTimeout` granularity is sub-ms; the model is at 60Hz). It also means a future v1.x recording API can replay captured `TrajectoryEvent[]` arrays without touching the synth side.

## Mouse trajectory model

`synthesizeMouseTrajectory` produces a cubic-Bezier path with overshoot+correction, sampled at ~60 events per second, jittered with autocorrelated Gaussian noise:

- **P0** = current cursor position (the previous arrival point — `humanClick` chains realistically across consecutive calls).
- **P3** = target point. Sampled inside the target box with a Gaussian distribution biased toward the centre, not the geometric mid-point — humans aim at the perceived target, not the pixel-perfect centre.
- **P1, P2** = control points placed off-axis. Magnitude ~0.3–0.5 of the Euclidean distance, perpendicular offset from the straight line scaled by `tremor`.

The number of sampled points is `N = ceil(MT * 60)` where `MT` is the Fitts movement time (below). Each sampled point is jittered by Gaussian(σ = `tremor * pixelSize`) per axis, autocorrelated with τ ≈ 30ms — neighbouring frames look like neighbouring frames, not independent draws.

**Movement duration** uses Fitts's Law:

```
MT = a + b * log2(D / W + 1)
```

- `D` = Euclidean pixel distance from cursor to target.
- `W` = target box minimum dimension (a thin button is harder to hit than a wide one).
- `a = 200` ms — per-profile reaction time intercept.
- `b = 90` ms/bit — per-profile motor speed.

The `a` and `b` constants are profile-derived in v1.x; v0.2 uses the literature defaults. `fittsMT(D, W)` is exported for tests + power users who want to compute the duration without going through the full synth.

**Overshoot.** A 5–15% chance of overshoot per call: the cursor arcs *past* the target by `1.05–1.15 * D`, then a corrective sub-curve walks it back. Probability and magnitude are seed-driven, so the same `(seed, target)` pair always either overshoots or doesn't.

The `humanClick` flow (`packages/core/src/page.ts`):

1. `DOM.querySelector` + `DOM.getBoxModel` resolve the target rect.
2. `synthesizeMouseTrajectory` produces the `TrajectoryEvent[]`.
3. Optional `preMoveSettle` (default Gaussian(150, 50)ms) — the page settles before the cursor moves; a real human doesn't snap instantly.
4. Each trajectory event dispatches `Input.dispatchMouseEvent` of type `mouseMoved`, paced via `setTimeout` to match `tMs`.
5. `Input.dispatchMouseEvent` of type `mousePressed` then `mouseReleased` at the final point with realistic press duration (~30..80ms).
6. The page's last cursor position updates so the next `humanClick` chains from this arrival point.

## Keystroke timing

`synthesizeKeystrokes` produces a `KeystrokeEvent[]` with QWERTY-aware digraph delays and adjacent-key mistake injection:

```ts
import { synthesizeKeystrokes } from "@mochi.js/behavioral";

const events = synthesizeKeystrokes({
  text: "hello@example.com",
  profile: { hand: "right", tremor: 0.18, wpm: 65, scrollStyle: "smooth" },
  seed: "user-12345:input-1:0",
  mistakeRate: 0.02,
});
// events: KeystrokeEvent[] = [{ key, text, tDownMs, tUpMs }, ...]
```

Per-letter press duration is Gaussian(80, 25)ms. Inter-key delay is a lognormal — different distribution per digraph class:

| Digraph class | Distribution | Approx range |
|---|---|---|
| Same-hand | lognormal(μ=4.7, σ=0.35) | 80–250ms |
| Cross-hand | lognormal(μ=4.4, σ=0.30) | 60–180ms |
| After space | lognormal(μ=4.9, σ=0.40) | 100–300ms |
| After punctuation | 1.3× same-hand | scaled |

The hand classifier (`handFor(key)`) is QWERTY-static — the left hand owns `qwertasdfgzxcvb` plus the digit row up to `5`, the right hand owns the rest. `cdpKeyFor` maps printable characters to the CDP `key` / `code` / `windowsVirtualKeyCode` triple Chromium expects on `Input.dispatchKeyEvent`. Control keys (Backspace, Tab, Enter, Escape, Delete) carry a manual mapping table.

**Mistake injection.** With probability `mistakeRate` per key (default 0.02), the synth emits a wrong-key sequence: type an `adjacentKey(target)` character, delay 200–500ms, Backspace, delay 100–300ms, type the correct key. The "wrong key" is a true QWERTY-adjacent character, not a random one — humans hit the next column, not the next page.

The `humanType` flow:

1. `DOM.querySelector` + `DOM.focus` on the target input.
2. `synthesizeKeystrokes` produces the `KeystrokeEvent[]`.
3. Each event dispatches `Input.dispatchKeyEvent` of type `keyDown` (with `text` for printable keys), waits the synthesized down-duration, then `keyUp`. Special case: `humanType(selector, "")` clears the field — reads `element.value.length`, synthesizes that many Backspace keystrokes with realistic timings.

## Inertial scroll

`synthesizeScroll` produces a `ScrollEvent[]` modelling an inertial flick — initial velocity from a target distance over ~0.5s, friction-decayed exponentially with τ ≈ 350ms, capped at 100px/frame (browsers throttle higher rates):

```ts
import { synthesizeScroll } from "@mochi.js/behavioral";

const events = synthesizeScroll({
  from: 0,
  to: 1200,
  profile: { hand: "right", tremor: 0.18, wpm: 65, scrollStyle: "smooth" },
  seed: "user-12345:scroll-1:0",
  duration: 500, // optional — overrides the model's default time budget
});
// events: ScrollEvent[] = [{ tMs, deltaY }, ...]
```

The `humanScroll` flow dispatches `Input.dispatchMouseEvent` of type `mouseWheel` per frame at the current cursor position. `scrollStyle: "stepped"` profiles cap each frame to a single 100px wheel notch; `"smooth"` and `"inertial"` are treated identically (the inertial curve IS the smooth curve).

## Per-profile parameterization

The matrix's `behavior` block is the canonical source (PLAN.md I-5 — every behavioral surface comes from `MatrixV1.behavior`):

```ts
type BehaviorProfile = {
  hand: "left" | "right";                         // dominant hand — affects digraph hand classification
  tremor: number;                                 // 0.0..1.0 — perpendicular jitter scale on Bezier paths
  wpm: number;                                    // typing speed — drives the lognormal digraph means
  scrollStyle: "smooth" | "stepped" | "inertial"; // smooth/inertial = inertial curve; stepped = quantised wheel-tick
};
```

The `DEFAULT_BEHAVIOR_PROFILE` falls back when a profile doesn't carry one (the v0.0 placeholder ProfileV1 carries `{ hand: "right", tremor: 0.18, wpm: 60, scrollStyle: "smooth" }`).

`humanClick` accepts per-call overrides for `duration`, `button`, and `preMoveSettle`. `humanType` accepts `wpm` and `mistakeRate`. `humanScroll` accepts `duration`. Per-call overrides supersede the profile-level values *for that call only* — the matrix is not mutated.

## Determinism contract

Each synth function accepts `seed?: string`. Same `(opts, seed)` → byte-identical output across runs. When `seed` is omitted, a stable per-namespace default is used so unseeded calls remain deterministic *within a process*. The `Page` layer composes the per-call seed as `${session.seed}:${page.targetId}:${callCounter++}` so back-to-back `humanClick` calls within the same session still produce divergent (but deterministic) trajectories.

The PRNG is `xoshiro256**`, shared with [`@mochi.js/consistency`](/docs/concepts/consistency-engine) via the `@mochi.js/consistency/prng` sub-export. One PRNG, one deterministic universe — a `(profile, seed)` pair produces both the same fingerprint Matrix *and* the same cursor trajectory on the same selector. This matters for harness reproducibility: a behavioral regression shows up as a structural diff in a captured trajectory, not as a flake.

## What we don't do in v1

- **Real-trace recording / replay.** The API surface (`humanClick(sel, { trace })`) is forward-compatible; the recorder lands in v1.x.
- **Per-profile mouse-acceleration curves.** The Bezier control-point magnitudes are constants today; v1.x maps them per profile.
- **Touch gesture synthesis.** v2 — mobile profiles.
- **Eye-tracking-coupled mouse models.** v2+ research.

## What to read next

- [The Consistency Engine](/docs/concepts/consistency-engine) — the matrix that supplies the `behavior` block.
- [Profiles](/docs/concepts/profiles) — what `behavior` looks like per profile.
- [The inject pipeline](/docs/concepts/inject-pipeline) — the other surface that consumes the matrix.
- [Stealth philosophy](/docs/concepts/stealth-philosophy) — why behavioral coherence is part of the threat model.

<!-- llm-context:start
This page covers @mochi.js/behavioral and the Page-level human input methods.

Key API symbols on @mochi.js/behavioral (source: packages/behavioral/src/index.ts):
- synthesizeMouseTrajectory(opts: MouseTrajectoryOptions): TrajectoryEvent[]
  - opts: { from: Point, to: Point, box?: Box, profile: BehaviorProfile, seed?: string, durationMs?: number }
- synthesizeKeystrokes(opts: KeystrokeOptions): KeystrokeEvent[]
  - opts: { text: string, profile: BehaviorProfile, seed?: string, mistakeRate?: number }
- synthesizeScroll(opts: ScrollOptions): ScrollEvent[]
  - opts: { from: number, to: number, profile: BehaviorProfile, seed?: string, duration?: number }
- fittsMT(distance: number, width: number): number
- adjacentKey(key: string): string
- cdpKeyFor(char: string): { key: string, code: string, windowsVirtualKeyCode?: number, text?: string }
- handFor(char: string): "left" | "right"
- DEFAULT_BEHAVIOR_PROFILE: BehaviorProfile
- type BehaviorProfile = { hand: "left" | "right", tremor: number, wpm: number, scrollStyle: "smooth" | "stepped" | "inertial" }
- type Point = { x: number, y: number }
- type Box = { x: number, y: number, width: number, height: number }
- type TrajectoryEvent = { tMs: number, x: number, y: number }
- type KeystrokeEvent = { key: string, text: string, tDownMs: number, tUpMs: number }
- type ScrollEvent = { tMs: number, deltaY: number }

Page-level surface (source: packages/core/src/page.ts):
- page.humanClick(selector: string, opts?: HumanClickOptions): Promise<void>
- page.humanClickHandle(handle: ElementHandle, opts?: HumanClickOptions): Promise<void>
- page.humanMove(x: number, y: number, opts?: HumanMoveOptions): Promise<void>
- page.humanType(selector: string, text: string, opts?: HumanTypeOptions): Promise<void>
- page.humanScroll(opts: HumanScrollOptions): Promise<void>
- page.cursorPosition(): { x: number, y: number }
- HumanClickOptions: { button?: "left"|"right"|"middle", duration?: number, preMoveSettle?: boolean }
- HumanTypeOptions: { wpm?: number, mistakeRate?: number }
- HumanScrollOptions: { to: string | { x: number, y: number }, duration?: number }
- HumanMoveOptions: { duration?: number }

Common LLM hallucinations to avoid:
- page.click() — does NOT exist on the public surface; use page.humanClick(selector).
- page.type() — does NOT exist; use page.humanType(selector, text).
- page.hover() — does NOT exist; use page.humanMove(x, y) after resolving the box.
- humanType(selector, text, { delay: 50 }) — `delay` is not an option; use `wpm` to control speed.
- humanClick takes a (x, y) tuple — false; humanClick takes a selector. For raw coordinates, use humanMove(x, y) followed by humanClickHandle on a resolved ElementHandle, or use humanClick on a CSS selector.
- humanScroll(deltaY) — false; the option is `{ to: selector | { x, y }, duration? }`. CSS selector or absolute coords only — no magic strings. `humanScroll({ to: "top" })` does NOT scroll to the top; use `{ to: { x: 0, y: 0 } }`. `humanScroll({ to: "bottom" })` does NOT scroll to the bottom; use `{ to: "footer" }` or coords matching `document.body.scrollHeight`.
- "Set typingSpeed: 'fast'" — false; use wpm: 80 or higher.
- "Disable jitter" — false architecturally; tremor: 0 in the profile reduces it but jitter is part of the model.

Determinism notes for LLMs:
- Same (profile, seed) + same selector + same call ordinal → same trajectory. Reproducible.
- Per-call seed includes session.seed, page.targetId, and a call counter — back-to-back humanClick calls produce different trajectories, but in a deterministic order.

Cross-references:
- https://mochijs.com/docs/concepts/consistency-engine
- https://mochijs.com/docs/concepts/profiles
- https://mochijs.com/docs/concepts/inject-pipeline
- https://mochijs.com/docs/concepts/stealth-philosophy
- https://mochijs.com/docs/api/behavioral
- https://mochijs.com/docs/api/core
llm-context:end -->
