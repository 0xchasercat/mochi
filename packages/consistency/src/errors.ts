/**
 * Errors raised by the consistency engine.
 *
 * @see PLAN.md §5.2
 */

/**
 * Thrown when the rule DAG is found to contain a cycle at engine init time.
 * The cycle path is included for triage. Detection runs once per process via
 * a cached check inside `deriveMatrix`.
 */
export class RuleDagCycleError extends Error {
  override readonly name = "RuleDagCycleError";
  /** Ordered list of rule ids forming the detected cycle (head equals tail). */
  readonly cycle: readonly string[];
  constructor(cycle: readonly string[]) {
    super(`[mochi/consistency] rule DAG contains a cycle: ${cycle.join(" -> ")}`);
    this.cycle = cycle;
  }
}

/**
 * Thrown when a rule declares an input path that is missing from the matrix
 * being built. This is a programmer error — either the input path is wrong,
 * or the rule that produces it was filtered out before this rule executed.
 */
export class MissingInputError extends Error {
  override readonly name = "MissingInputError";
  readonly ruleId: string;
  readonly path: string;
  constructor(ruleId: string, path: string) {
    super(
      `[mochi/consistency] rule ${ruleId} requires input "${path}" but it is missing from the matrix-under-construction`,
    );
    this.ruleId = ruleId;
    this.path = path;
  }
}

/**
 * Thrown when two rules declare the same output path. The DAG must have a
 * single producer per slot — otherwise execution order silently changes
 * results and the deterministic guarantee breaks.
 */
export class DuplicateOutputError extends Error {
  override readonly name = "DuplicateOutputError";
  readonly path: string;
  readonly ruleIds: readonly string[];
  constructor(path: string, ruleIds: readonly string[]) {
    super(
      `[mochi/consistency] output path "${path}" is produced by multiple rules: ${ruleIds.join(", ")}`,
    );
    this.path = path;
    this.ruleIds = ruleIds;
  }
}
