/**
 * @mochi.js/consistency — the Matrix engine.
 *
 * Generates an immutable, relationally-locked fingerprint matrix from a
 * `(profile, seed)` pair. The matrix is a JSON-serializable, schema-shaped
 * snapshot consumed by `@mochi.js/inject` (phase 0.3+).
 *
 * Determinism contract:
 *   - `deriveMatrix(profile, seed)` is pure. Same inputs → same output,
 *     bit-for-bit, **excluding the `derivedAt` ISO timestamp**.
 *   - Different `(profile.id, seed)` pairs produce isolated PRNG sequences;
 *     reusing a seed across profiles is safe.
 *   - The rule DAG is validated for acyclicity and unique outputs once per
 *     process the first time `deriveMatrix` is called.
 *
 * Public API surface:
 *   - {@link deriveMatrix} — derive a Matrix from a profile + seed.
 *   - {@link CONSISTENCY_ENGINE_VERSION} — the engine version stamp.
 *   - {@link VERSION} — the npm package version.
 *   - {@link Rule}, {@link SeededPrng} — types for downstream packages
 *     building on the engine (e.g. tests asserting rule shape).
 *   - Error classes: {@link RuleDagCycleError}, {@link DuplicateOutputError},
 *     {@link MissingInputError}.
 *
 * @see PLAN.md §5.2 and §9
 */

export const VERSION = "0.1.4" as const;

export { deriveMatrix } from "./derive";
export { CONSISTENCY_ENGINE_VERSION } from "./engine-version";
export { DuplicateOutputError, MissingInputError, RuleDagCycleError } from "./errors";
export type { MatrixV1 } from "./generated/matrix";
// Canonical types are generated from schemas/*.schema.json by `bun run codegen`.
// @mochi.js/consistency *owns* both ProfileV1 and MatrixV1 — see PLAN.md §5.6.
export type { ProfileV1 } from "./generated/profile";
// Public PRNG surface — promoted from internal at v0.2.1 so downstream packages
// (e.g. `@mochi.js/behavioral`, phase 0.8) can reuse the seeded xoshiro256**
// without re-implementing it. See PLAN.md §5.5 ("pure-data principle"): the
// behavioral engine is deterministic, and its determinism MUST share the same
// PRNG primitive as the consistency engine to avoid divergence.
//
// Sub-export `@mochi.js/consistency/prng` is also exposed via package.exports
// so consumers may import it without pulling the rule DAG. The barrel here
// is the canonical re-export.
export { deriveSeedState, seedToPrng } from "./prng/seed";
export { makeXoshiro256ss, type SeededPrng } from "./prng/xoshiro256ss";
export type { Rule } from "./rule";
export { RULES } from "./rules";
