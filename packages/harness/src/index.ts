/**
 * @mochi.js/harness — Probe Manifest validation.
 *
 * Captures a Probe Manifest from a Mochi-driven session, normalizes it,
 * diffs against a committed baseline, categorizes divergences as
 * guid-class | intentional | material, and gates PRs on `material === 0`.
 *
 * Mirrors Peekaboo's equivalence-harness pattern. v0.0.1 claim release;
 * harness lands in phase 0.5.
 *
 * @see PLAN.md §5.7 and §13
 */
export const VERSION = "0.0.1" as const;

export type Verdict = "EQUIVALENT" | "DIVERGED";

export interface DiffReport {
  readonly verdict: Verdict;
  readonly counts: { material: number; intentional: number; guidClass: number };
  readonly structuralMatchPct: number;
}

/**
 * Capture a Probe Manifest and diff against the profile baseline. Lands in phase 0.5.
 */
export async function diff(_args: { profile: string; manifest: unknown }): Promise<DiffReport> {
  throw new Error(
    "@mochi.js/harness.diff is not yet implemented (v0.0.1 claim). " +
      "Lands in phase 0.5; see PLAN.md §13.",
  );
}
