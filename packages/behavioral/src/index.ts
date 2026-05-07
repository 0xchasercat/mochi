/**
 * @mochi.js/behavioral — biomechanical input synthesis.
 *
 * Pure-data synthesis: cubic Bezier paths, Fitts's-Law durations, Gaussian jitter,
 * keystroke ngraph timing, inertial scroll. v0.0.1 claim release; engine lands in phase 0.8.
 *
 * @see PLAN.md §5.5 and §11
 */
export const VERSION = "0.0.1" as const;

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface TrajectoryEvent {
  readonly tMs: number;
  readonly x: number;
  readonly y: number;
}

/**
 * Synthesize a mouse trajectory. Lands in phase 0.8.
 */
export function synthesizeMouseTrajectory(
  _from: Point,
  _to: Point,
  _profile?: unknown,
): TrajectoryEvent[] {
  throw new Error(
    "@mochi.js/behavioral.synthesizeMouseTrajectory is not yet implemented (v0.0.1 claim). " +
      "Lands in phase 0.8; see PLAN.md §11.",
  );
}
