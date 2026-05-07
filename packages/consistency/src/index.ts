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

export const VERSION = "0.2.0" as const;

export { deriveMatrix } from "./derive";
export { CONSISTENCY_ENGINE_VERSION } from "./engine-version";
export { DuplicateOutputError, MissingInputError, RuleDagCycleError } from "./errors";
export type { MatrixV1 } from "./generated/matrix";
// Canonical types are generated from schemas/*.schema.json by `bun run codegen`.
// @mochi.js/consistency *owns* both ProfileV1 and MatrixV1 — see AGENTS.md §5.
export type { ProfileV1 } from "./generated/profile";
export type { SeededPrng } from "./prng/xoshiro256ss";
export type { Rule } from "./rule";
export { RULES } from "./rules";
