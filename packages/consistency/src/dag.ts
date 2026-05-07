/**
 * DAG validation and topological ordering for the rule list.
 *
 *   - Acyclicity: DFS three-coloring (`white` → `gray` → `black`). When DFS
 *     re-enters a gray node we have a cycle; the path-stack at that moment
 *     gives us the cycle for the error message.
 *   - Topological sort: Kahn's algorithm seeded by all nodes with in-degree
 *     zero (typically the rules whose inputs are profile fields).
 *
 * Both passes are O(V + E) and run on the in-process rule list once, the
 * first time `deriveMatrix` executes (the orchestrator caches the order).
 *
 * @see PLAN.md §5.2
 */

import { DuplicateOutputError, RuleDagCycleError } from "./errors";
import type { Rule } from "./rule";

/**
 * The pre-computed rule plan: rules in execution order. Returned by
 * `validateAndOrder` and consumed by `runRules`.
 */
export interface RulePlan {
  /** Rules in topo-sorted execution order. */
  readonly order: readonly Rule[];
  /** Output path → rule id (the unique producer). */
  readonly producers: ReadonlyMap<string, string>;
}

/**
 * Build the producer index, detect duplicates, detect cycles, and topo-sort.
 *
 * @throws RuleDagCycleError when the DAG is cyclic
 * @throws DuplicateOutputError when two rules write the same output path
 */
export function validateAndOrder(rules: readonly Rule[]): RulePlan {
  // 1. Build the producer index (output path → rule id).
  const producers = new Map<string, string>();
  for (const rule of rules) {
    const existing = producers.get(rule.output);
    if (existing !== undefined) {
      throw new DuplicateOutputError(rule.output, [existing, rule.id]);
    }
    producers.set(rule.output, rule.id);
  }

  // 2. Build per-rule predecessor list. A rule R depends on rule P iff one
  //    of R's inputs equals P's output. Inputs that don't match any output
  //    are "external" (profile fields) — they impose no DAG edge.
  const ruleById = new Map<string, Rule>();
  for (const rule of rules) ruleById.set(rule.id, rule);

  const adj = new Map<string, string[]>(); // ruleId -> downstream rule ids
  const inDegree = new Map<string, number>();
  for (const rule of rules) {
    adj.set(rule.id, []);
    inDegree.set(rule.id, 0);
  }
  for (const rule of rules) {
    for (const input of rule.inputs) {
      const producerId = producers.get(input);
      if (producerId === undefined || producerId === rule.id) continue;
      const list = adj.get(producerId);
      if (list !== undefined) list.push(rule.id);
      inDegree.set(rule.id, (inDegree.get(rule.id) ?? 0) + 1);
    }
  }

  // 3. Cycle detection via DFS three-coloring.
  detectCycle(rules, adj);

  // 4. Topo sort (Kahn). The cycle check above guarantees we'll drain.
  const order: Rule[] = [];
  const queue: string[] = [];
  for (const rule of rules) {
    if ((inDegree.get(rule.id) ?? 0) === 0) queue.push(rule.id);
  }
  // Stable ordering: preserve declaration order for ties.
  queue.sort((a, b) => declarationIndex(rules, a) - declarationIndex(rules, b));

  while (queue.length > 0) {
    const id = queue.shift();
    if (id === undefined) break;
    const rule = ruleById.get(id);
    if (rule === undefined) continue;
    order.push(rule);
    const downstream = adj.get(id) ?? [];
    const newlyReady: string[] = [];
    for (const next of downstream) {
      const remaining = (inDegree.get(next) ?? 0) - 1;
      inDegree.set(next, remaining);
      if (remaining === 0) newlyReady.push(next);
    }
    newlyReady.sort((a, b) => declarationIndex(rules, a) - declarationIndex(rules, b));
    queue.unshift(...newlyReady);
    queue.sort((a, b) => declarationIndex(rules, a) - declarationIndex(rules, b));
  }

  if (order.length !== rules.length) {
    // Defensive — `detectCycle` should have raised already.
    throw new RuleDagCycleError(["<unresolved>"]);
  }

  return { order, producers };
}

function declarationIndex(rules: readonly Rule[], id: string): number {
  for (let i = 0; i < rules.length; i++) {
    if (rules[i]?.id === id) return i;
  }
  return Number.MAX_SAFE_INTEGER;
}

/**
 * DFS three-coloring cycle detector. Throws `RuleDagCycleError` if a cycle
 * exists; returns silently otherwise.
 */
function detectCycle(rules: readonly Rule[], adj: ReadonlyMap<string, readonly string[]>): void {
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map<string, number>();
  for (const rule of rules) color.set(rule.id, WHITE);

  const path: string[] = [];

  function visit(id: string): void {
    color.set(id, GRAY);
    path.push(id);
    const downstream = adj.get(id) ?? [];
    for (const next of downstream) {
      const c = color.get(next) ?? WHITE;
      if (c === GRAY) {
        // Found a back-edge. Slice path from where `next` first appears.
        const idx = path.indexOf(next);
        const cycle = idx >= 0 ? [...path.slice(idx), next] : [next, ...path, next];
        throw new RuleDagCycleError(cycle);
      }
      if (c === WHITE) visit(next);
    }
    color.set(id, BLACK);
    path.pop();
  }

  for (const rule of rules) {
    if (color.get(rule.id) === WHITE) visit(rule.id);
  }
}
