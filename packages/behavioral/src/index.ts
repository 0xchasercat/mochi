/**
 * `@mochi.js/behavioral` — biomechanical input synthesis.
 *
 * Pure-data synthesis: cubic Bezier paths with overshoot+correction, Fitts's
 * Law durations, autocorrelated Gaussian jitter, lognormal-digraph keystroke
 * timing with QWERTY-adjacent mistake injection, and inertial scroll. Phase
 * 0.8 of PLAN.md.
 *
 * Architectural invariants honored:
 *   - I-3 (Bun-only): no Node-specific imports, no FS / network access.
 *   - I-5 (relational consistency): the behavioral PRNG reuses
 *     `@mochi.js/consistency`'s xoshiro256** so a `(profile, seed)` pair
 *     produces a single deterministic universe across all surfaces.
 *
 * Pure-data principle (PLAN.md §5.5):
 *   - The exported `synthesize*` functions return arrays of plain objects.
 *   - Side effects (CDP dispatch, timing) live in `@mochi.js/core/page.ts`.
 *
 * Determinism contract:
 *   - Each synth function accepts `seed?: string`.
 *   - Same `(opts, seed)` → byte-identical output across runs.
 *   - When `seed` is omitted, a stable per-namespace default is used so
 *     unseeded calls remain deterministic *within a process* but two
 *     unseeded calls in the same process *with the same opts* still
 *     produce identical output (by design).
 *
 * @see PLAN.md §5.5, §11
 */

export const VERSION = "0.1.0" as const;

// ---- Public types -----------------------------------------------------------

export type {
  BehaviorProfile,
  Box,
  KeystrokeEvent,
  Point,
  ScrollEvent,
  TrajectoryEvent,
} from "./types";
export { DEFAULT_BEHAVIOR_PROFILE } from "./types";

// ---- Synth surfaces ---------------------------------------------------------

export {
  type KeystrokeOptions,
  synthesizeKeystrokes,
} from "./keys";
export {
  type MouseTrajectoryOptions,
  synthesizeMouseTrajectory,
} from "./mouse";
export {
  type ScrollOptions,
  synthesizeScroll,
} from "./scroll";

// ---- Lower-level helpers (exported for tests + power users) ----------------

export { fittsMT } from "./fitts";
export { adjacentKey, cdpKeyFor, handFor } from "./qwerty";
