/**
 * `deriveMatrix` — the public Matrix engine entrypoint.
 *
 * Pipeline:
 *   1. Build a fresh PRNG seeded from `(profile.id, seed)`.
 *   2. Deep-clone the profile into a `MatrixV1`-shaped working object,
 *      stamping `seed`, `derivedAt`, `consistencyEngineVersion`.
 *   3. Resolve and cache the topo-sorted rule plan (validated for cycles
 *      and duplicate outputs once per process).
 *   4. Run rules in topological order, reading inputs from the in-progress
 *      matrix and writing outputs back.
 *   5. Return the matrix as a frozen, JSON-round-trippable object.
 *
 * Determinism guarantees:
 *   - Same `(profile, seed)` → same Matrix (excluding `derivedAt`).
 *   - The PRNG sequence is shared across all rules in topo order; rules
 *     that consume the PRNG advance the cursor for downstream rules.
 *   - No `Math.random`, no `Date.now` (other than `derivedAt`), no
 *     environment reads anywhere in the rule path.
 *
 * @see PLAN.md §5.2 / §9
 */

import { type RulePlan, validateAndOrder } from "./dag";
import { CONSISTENCY_ENGINE_VERSION } from "./engine-version";
import { MissingInputError } from "./errors";
import type { MatrixV1 } from "./generated/matrix";
import type { ProfileV1 } from "./generated/profile";
import { type DeepRecord, getByPath, setByPath } from "./path";
import { seedToPrng } from "./prng/seed";
import { RULES } from "./rules";

/**
 * Cached, validated rule plan. Lazily computed on first call so the cycle
 * check runs once per process.
 */
let cachedPlan: RulePlan | null = null;

function getPlan(): RulePlan {
  if (cachedPlan === null) cachedPlan = validateAndOrder(RULES);
  return cachedPlan;
}

/**
 * @internal Reset the cached plan. Used by tests that mutate the global
 * rule list. Not part of the public API.
 */
export function _resetPlanCache(): void {
  cachedPlan = null;
}

/**
 * Derive a `MatrixV1` from `(profile, seed)`. Pure and deterministic per
 * the contract above — except for `derivedAt`, which carries the wall-clock
 * timestamp at derivation. Strip `derivedAt` to compare two matrices for
 * byte-for-byte identity.
 *
 * @param profile The device-class profile to instantiate.
 * @param seed Per-session deterministic entropy seed.
 * @returns A relationally-locked MatrixV1 ready for `@mochi.js/inject`.
 *
 * @throws RuleDagCycleError if the rule list is cyclic (init-time check)
 * @throws DuplicateOutputError if two rules write the same output path
 * @throws MissingInputError if a rule's declared input isn't on the matrix
 *
 * @example
 *   const matrix = deriveMatrix(profile, "session-1");
 *   // matrix.userAgent, matrix.gpu.webglUnmaskedRenderer, ... are derived.
 *   // Two distinct seeds produce two distinct matrices; one seed produces
 *   // one matrix exactly.
 */
export function deriveMatrix(profile: ProfileV1, seed: string): MatrixV1 {
  if (typeof seed !== "string" || seed.length === 0) {
    throw new Error("[mochi/consistency] deriveMatrix: seed must be a non-empty string");
  }
  const plan = getPlan();
  const prng = seedToPrng(profile.id, seed);

  // Deep-clone the profile via JSON round-trip. The schema forbids functions
  // / symbols / cycles already, so the round-trip is lossless.
  const matrix = JSON.parse(JSON.stringify(profile)) as MatrixV1;
  matrix.seed = seed;
  matrix.derivedAt = new Date().toISOString();
  matrix.consistencyEngineVersion = CONSISTENCY_ENGINE_VERSION;

  const view = matrix as unknown as DeepRecord;

  for (const rule of plan.order) {
    const resolved: unknown[] = [];
    for (const path of rule.inputs) {
      const v = getByPath(view, path);
      if (v === undefined) throw new MissingInputError(rule.id, path);
      resolved.push(v);
    }
    const output = rule.derive(resolved as readonly unknown[], prng);
    setByPath(view, rule.output, output);
  }

  return matrix;
}
