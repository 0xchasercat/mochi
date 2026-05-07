/**
 * The Rule contract — the unit of relational locking inside the consistency
 * engine. PLAN.md §5.2 / §9.2.
 *
 * Each rule reads a tuple of dotted-path inputs from the matrix-under-
 * construction, runs its `derive` function (pure + deterministic given the
 * inputs and PRNG), and the engine writes the returned value to the rule's
 * `output` path. Rules are executed in topological order; the engine
 * verifies the DAG is acyclic before any rule runs.
 *
 * The PRNG is the only side-channel a rule may read beyond its declared
 * inputs. PRNG state is forked per (profile.id, seed); rules that consume
 * it produce different outputs per seed but the same output per (profile,
 * seed) pair.
 */

import type { SeededPrng } from "./prng/xoshiro256ss";

/**
 * The engine's view of a rule. The input tuple type is erased to
 * `readonly unknown[]` so heterogeneous rules collect into a single
 * `readonly Rule[]` array. Individual rule definitions narrow the tuple
 * via the `defineRule` helper for ergonomic, type-safe authoring.
 */
export interface Rule {
  /** Stable rule id, e.g. `"R-001"`. */
  readonly id: string;
  /** Short human description of the lock the rule encodes. */
  readonly description: string;
  /** Dotted paths into the matrix-under-construction. Empty for source rules. */
  readonly inputs: readonly string[];
  /**
   * Dotted path the rule writes. Must be unique across the rule list; the
   * engine raises `DuplicateOutputError` otherwise.
   */
  readonly output: string;
  /** Compute the output. Must be pure given (inputs, prng). */
  readonly derive: (inputs: readonly unknown[], prng: SeededPrng) => unknown;
}

/**
 * Define a rule with a typed input tuple `I` and output `O`. The helper
 * casts the typed `derive` into the engine's erased shape, letting rule
 * authors keep their narrowed types inside the body without polluting the
 * collection-level rule list with variant generics.
 */
export function defineRule<I extends readonly unknown[], O>(rule: {
  readonly id: string;
  readonly description: string;
  readonly inputs: readonly string[];
  readonly output: string;
  readonly derive: (inputs: I, prng: SeededPrng) => O;
}): Rule {
  return {
    id: rule.id,
    description: rule.description,
    inputs: rule.inputs,
    output: rule.output,
    derive: rule.derive as (inputs: readonly unknown[], prng: SeededPrng) => unknown,
  };
}
