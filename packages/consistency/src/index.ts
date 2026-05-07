/**
 * @mochi.js/consistency — the Matrix engine.
 *
 * Generates an immutable, relationally-locked fingerprint matrix from a
 * (profile, seed) pair. v0.0.1 claim release; full ruleset lands in phase 0.2 / 0.7.
 *
 * @see PLAN.md §5.2 and §9
 */
export const VERSION = "0.0.1" as const;

/** Placeholder; real shape lands with the schema codegen in phase 0.0+. */
export interface ProfileV1 {
  readonly id: string;
  readonly version: string;
}

/** Placeholder; real shape mirrors ProfileV1 with seed-resolved values. */
export interface MatrixV1 {
  readonly profile: ProfileV1;
  readonly seed: string;
  readonly derivedAt: string;
  readonly consistencyEngineVersion: string;
}

/**
 * Derive a Matrix from a profile + seed. Lands in phase 0.2.
 */
export function deriveMatrix(_profile: ProfileV1, _seed: string): MatrixV1 {
  throw new Error(
    "@mochi.js/consistency.deriveMatrix is not yet implemented (v0.0.1 claim). " +
      "Lands in phase 0.2; see PLAN.md §9.",
  );
}
