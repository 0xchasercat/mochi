/**
 * DAG validation unit tests — acyclicity, duplicate-output detection, and
 * topo-ordering correctness against synthetic rule lists.
 */
import { describe, expect, it } from "bun:test";
import { validateAndOrder } from "../dag";
import { DuplicateOutputError, RuleDagCycleError } from "../errors";
import type { Rule } from "../rule";

const passthrough = (id: string, inputs: readonly string[], output: string): Rule => ({
  id,
  description: `synthetic rule ${id}`,
  inputs,
  output,
  derive: () => null,
});

describe("validateAndOrder", () => {
  it("returns rules in topological order", () => {
    const r1 = passthrough("r1", [], "a");
    const r2 = passthrough("r2", ["a"], "b");
    const r3 = passthrough("r3", ["b"], "c");
    const plan = validateAndOrder([r3, r1, r2]);
    expect(plan.order.map((r) => r.id)).toEqual(["r1", "r2", "r3"]);
  });

  it("preserves declaration order for tied rules (stable tie-break)", () => {
    const r1 = passthrough("r1", [], "a");
    const r2 = passthrough("r2", [], "b");
    const r3 = passthrough("r3", [], "c");
    const plan = validateAndOrder([r1, r2, r3]);
    expect(plan.order.map((r) => r.id)).toEqual(["r1", "r2", "r3"]);
  });

  it("raises RuleDagCycleError on a 2-cycle", () => {
    const r1 = passthrough("r1", ["b"], "a");
    const r2 = passthrough("r2", ["a"], "b");
    expect(() => validateAndOrder([r1, r2])).toThrow(RuleDagCycleError);
  });

  it("raises RuleDagCycleError on a longer cycle and reports the path", () => {
    const r1 = passthrough("r1", ["c"], "a");
    const r2 = passthrough("r2", ["a"], "b");
    const r3 = passthrough("r3", ["b"], "c");
    let caught: unknown;
    try {
      validateAndOrder([r1, r2, r3]);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(RuleDagCycleError);
    expect((caught as RuleDagCycleError).cycle.length).toBeGreaterThanOrEqual(2);
  });

  it("raises DuplicateOutputError when two rules write the same path", () => {
    const r1 = passthrough("r1", [], "shared");
    const r2 = passthrough("r2", [], "shared");
    expect(() => validateAndOrder([r1, r2])).toThrow(DuplicateOutputError);
  });

  it("inputs that don't match any rule output don't create edges (treated as profile-leaves)", () => {
    const r1 = passthrough("r1", ["external.input"], "a");
    const plan = validateAndOrder([r1]);
    expect(plan.order.map((r) => r.id)).toEqual(["r1"]);
  });
});
