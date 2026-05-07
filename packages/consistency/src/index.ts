/**
 * @mochi.js/consistency — the Matrix engine.
 *
 * Generates an immutable, relationally-locked fingerprint matrix from a
 * (profile, seed) pair. v0.0.1 claim release; full ruleset lands in phase 0.2 / 0.7.
 *
 * @see PLAN.md §5.2 and §9
 */
export const VERSION = "0.0.1" as const;

export type { MatrixV1 } from "./generated/matrix";
// Canonical types are generated from schemas/*.schema.json by `bun run codegen`.
// @mochi.js/consistency *owns* both ProfileV1 and MatrixV1 — see PLAN.md §5.6.
export type { ProfileV1 } from "./generated/profile";

import type { MatrixV1 } from "./generated/matrix";
import type { ProfileV1 } from "./generated/profile";

/**
 * Derive a Matrix from a profile + seed. Lands in phase 0.2.
 */
export function deriveMatrix(_profile: ProfileV1, _seed: string): MatrixV1 {
  throw new Error(
    "@mochi.js/consistency.deriveMatrix is not yet implemented (v0.0.1 claim). " +
      "Lands in phase 0.2; see PLAN.md §9.",
  );
}
