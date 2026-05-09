/**
 * Helpers for the humanize conformance suite (port of CloakBrowser
 * `tests/test_humanize_unit.mjs` + `tests/test_human_visual.mjs`).
 *
 * The CloakBrowser tests compose around three primitives we map onto mochi:
 *
 *   - `resolveConfig(preset, overrides)` → mochi's `MatrixV1.profile.behavior`
 *     block plus per-call `opts`. This file exposes
 *     {@link mochiBehaviorFor} which returns a `BehaviorProfile` for a given
 *     preset name (`"default"` / `"careful"`), kept compatible with the
 *     CloakBrowser presets the tests reference.
 *   - `rand(lo, hi)` / `randRange([lo, hi])` → mochi's seeded xoshiro256**
 *     (`@mochi.js/consistency/prng`). Tests draw from this PRNG and the
 *     bounds are asserted within a tolerance window (we don't claim the
 *     CloakBrowser bounds verbatim — same SHAPE, mochi's PRNG).
 *   - `humanMove(rawMouse, x0, y0, x1, y1, cfg)` → mochi's
 *     {@link synthesizeMouseTrajectory} (pure data) + the new
 *     `Page.humanMove(x, y)` dispatch surface (E2E paths).
 *
 * @see tests/fixtures/cloakbrowser/test_humanize_unit.mjs
 * @see tests/fixtures/cloakbrowser/test_human_visual.mjs
 */

import {
  type BehaviorProfile,
  DEFAULT_BEHAVIOR_PROFILE,
  type TrajectoryEvent,
} from "@mochi.js/behavioral";
import { seedToPrng } from "@mochi.js/consistency/prng";

/**
 * Behavioral preset names that the CloakBrowser tests exercise. Exposed as a
 * union so the port can switch on them without leaking string-typoes.
 */
export type HumanizePreset = "default" | "careful";

/**
 * Map a CloakBrowser-style preset name to a mochi `BehaviorProfile`. The
 * `careful` preset slows typing relative to `default` (CloakBrowser's
 * `careful` config has higher `typing_delay`); the mochi equivalent is a
 * lower `wpm`. The other two parameters (`tremor`, `scrollStyle`) match the
 * default profile's defaults.
 *
 * Why the mapping isn't 1:1 with CloakBrowser's literal numbers:
 *   - mochi's behavioral synth is deterministic per (profile, seed) and
 *     consumes a `BehaviorProfile`, not a CloakBrowser-shaped config
 *     object. The semantically meaningful properties — "default and careful
 *     are both valid; careful types more slowly" — are preserved.
 *   - PLAN.md I-5 makes the matrix the single source of truth. A literal
 *     port of CloakBrowser's `mouse_min_steps`/`mouse_max_steps` knobs
 *     would force a parallel-source-of-truth, violating the invariant.
 *     Tests that asserted on those literal field names assert instead on
 *     the SHAPE the synthesized trajectory produces (see
 *     `bezier-math.test.ts`).
 */
export function mochiBehaviorFor(preset: HumanizePreset): BehaviorProfile {
  if (preset === "careful") {
    return {
      ...DEFAULT_BEHAVIOR_PROFILE,
      // careful = 1.6× the inter-key delay of default. WPM scales inversely
      // with delay (mean delay ms = 60_000 / (wpm * 5)).
      wpm: Math.round(DEFAULT_BEHAVIOR_PROFILE.wpm / 1.6),
    };
  }
  return DEFAULT_BEHAVIOR_PROFILE;
}

/**
 * Build a seeded `SeededPrng` for the conformance tests. The CloakBrowser
 * `rand(lo, hi)` was unseeded `Math.random` based; ours uses xoshiro256**
 * pinned to a per-test seed so failures are reproducible.
 */
export function conformancePrng(seed: string) {
  return seedToPrng("mochi.harness:humanize", seed);
}

/**
 * Uniform float in `[lo, hi]` from a seeded PRNG. Mirrors CloakBrowser's
 * `rand(lo, hi)` interface; the implementation is deterministic.
 */
export function rand(prng: ReturnType<typeof seedToPrng>, lo: number, hi: number): number {
  if (hi < lo) throw new Error("rand: hi < lo");
  return lo + prng.nextFloat01() * (hi - lo);
}

/** Mirror of CloakBrowser's `randRange([lo, hi])`. */
export function randRange(
  prng: ReturnType<typeof seedToPrng>,
  range: readonly [number, number],
): number {
  return rand(prng, range[0], range[1]);
}

/**
 * Recompute pairwise jump magnitudes between consecutive trajectory events.
 * Returns the array of √(Δx² + Δy²); used to assert smoothness ("no large
 * jumps") in the bezier-math conformance tests.
 */
export function pairwiseJumps(events: readonly TrajectoryEvent[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < events.length; i++) {
    const a = events[i - 1];
    const b = events[i];
    if (a === undefined || b === undefined) continue;
    out.push(Math.hypot(b.x - a.x, b.y - a.y));
  }
  return out;
}

/**
 * Maximum perpendicular deviation of a trajectory from the straight line
 * `from → to`. Used to assert the bezier curve isn't a straight line.
 */
export function maxPerpDeviation(
  events: readonly TrajectoryEvent[],
  from: { x: number; y: number },
  to: { x: number; y: number },
): number {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy);
  if (len === 0) return 0;
  let maxDev = 0;
  for (const ev of events) {
    // Perpendicular distance from (ev.x, ev.y) to line through (from, to).
    // |(to - from) × (ev - from)| / |to - from|
    const cross = Math.abs((ev.x - from.x) * dy - (ev.y - from.y) * dx);
    const dev = cross / len;
    if (dev > maxDev) maxDev = dev;
  }
  return maxDev;
}

/**
 * The `MOCHI_E2E=1` flag protects all browser-driving conformance tests.
 * Set alongside `MOCHI_CHROMIUM_PATH` pointing at a Chromium-for-Testing
 * binary that satisfies the test profile's browser version constraints.
 */
export const E2E_ENABLED = process.env.MOCHI_E2E === "1";

/**
 * The `MOCHI_ONLINE=1` flag gates conformance tests that hit live network
 * endpoints (the bot-detection form, etc.). Disabled by default in CI's
 * fast lane; enabled in the nightly + release-gate lanes.
 */
export const ONLINE_ENABLED = process.env.MOCHI_ONLINE === "1";

/**
 * Default test profile id. The conformance suite uses the placeholder
 * `test-humanize` profile when launching mochi sessions; the resolver in
 * `packages/core/src/launch.ts` converts unknown ids to a generic linux
 * profile, which is fine for behavioral tests that don't assert on
 * fingerprint surfaces.
 */
export const TEST_PROFILE_ID = "test-humanize";
