/**
 * Cross-package contract: the @mochi.js/consistency rule list MUST form an
 * acyclic DAG with unique outputs. This is the load-bearing structural
 * invariant that lets `deriveMatrix` produce a deterministic, ordered
 * execution plan (PLAN.md §5.2).
 *
 * The test imports the canonical RULES export and calls validateAndOrder —
 * if the consistency package ever ships a rule that closes a cycle or
 * duplicates an output path, this test breaks before merge.
 *
 * @see PLAN.md §5.2
 * @see tasks/0020-consistency-engine-v0.md
 */
import { describe, expect, it } from "bun:test";
import { validateAndOrder } from "../../packages/consistency/src/dag";
import { DuplicateOutputError, RuleDagCycleError } from "../../packages/consistency/src/errors";
import { RULES } from "../../packages/consistency/src/rules";

describe("contract: @mochi.js/consistency rule DAG", () => {
  it("RULES is non-empty (>= 30 at v0.2)", () => {
    expect(RULES.length).toBeGreaterThanOrEqual(30);
  });

  it("every rule has a stable id, a non-empty output path, and a derive function", () => {
    for (const rule of RULES) {
      expect(typeof rule.id).toBe("string");
      expect(rule.id.length).toBeGreaterThan(0);
      expect(typeof rule.output).toBe("string");
      expect(rule.output.length).toBeGreaterThan(0);
      expect(Array.isArray(rule.inputs)).toBe(true);
      expect(typeof rule.derive).toBe("function");
    }
  });

  it("rule ids are unique", () => {
    const seen = new Set<string>();
    for (const rule of RULES) {
      expect(seen.has(rule.id)).toBe(false);
      seen.add(rule.id);
    }
  });

  it("validateAndOrder succeeds (no cycles, no duplicate outputs)", () => {
    const plan = validateAndOrder(RULES);
    expect(plan.order.length).toBe(RULES.length);
  });

  it("validateAndOrder produces a topo-order: every rule's edge predecessors run before it", () => {
    const plan = validateAndOrder(RULES);
    const seen = new Set<string>();
    for (const rule of plan.order) {
      for (const input of rule.inputs) {
        const producer = plan.producers.get(input);
        if (producer === undefined) continue; // external (profile) input
        if (producer === rule.id) continue; // self-loop allowed (rule recomputes its own slot)
        expect(seen.has(producer)).toBe(true);
      }
      seen.add(rule.id);
    }
  });

  it("RuleDagCycleError + DuplicateOutputError are exported from the package surface", async () => {
    // Smoke check that the error classes are constructable and throwable —
    // the engine relies on `instanceof` checks downstream.
    const {
      RuleDagCycleError: RuleDagCycleErrorPublic,
      DuplicateOutputError: DuplicateOutputErrorPublic,
    } = await import("../../packages/consistency/src/index");
    expect(new RuleDagCycleErrorPublic(["a", "b", "a"])).toBeInstanceOf(RuleDagCycleError);
    expect(new DuplicateOutputErrorPublic("p", ["r1", "r2"])).toBeInstanceOf(DuplicateOutputError);
  });
});
