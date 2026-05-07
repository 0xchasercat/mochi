/**
 * Rule registry — the single source of truth for the v0.2 ruleset.
 *
 * The order in `RULES` is the **declaration order**. The engine topo-sorts
 * via `validateAndOrder` (see `dag.ts`); declaration order is used as the
 * tie-breaker for nodes with equal topological depth. Adding a rule means:
 *   1. write the rule in its category file (gpu / userAgent / navigator / …),
 *   2. import it here,
 *   3. append it to `RULES`.
 *
 * Acyclicity is verified the first time `deriveMatrix` runs; the rule list
 * is also exercised by `tests/contract/consistency-rules.contract.test.ts`.
 *
 * @see PLAN.md §5.2 / §9.2
 * @see tasks/0020-consistency-engine-v0.md
 */

import type { Rule } from "../rule";
import { GPU_RULES } from "./gpu";
import { LOCALE_RULES } from "./locale";
import { NAVIGATOR_RULES } from "./navigator";
import { SCREEN_RULES } from "./screen";
import { USER_AGENT_RULES } from "./userAgent";

/**
 * The full rule list. Don't reorder casually — the topo sort uses
 * declaration order as the tie-breaker, so reorderings can change the
 * output of seed-driven rules that share a PRNG cursor.
 */
export const RULES: readonly Rule[] = [
  ...GPU_RULES,
  ...USER_AGENT_RULES,
  ...NAVIGATOR_RULES,
  ...SCREEN_RULES,
  ...LOCALE_RULES,
];
