/**
 * Hard-coded list of CDP methods (and method+param combinations) that mochi
 * MUST NEVER send to a Chromium target. These constraints are non-negotiable
 * stealth invariants and the CDP transport enforces them with a synchronous
 * assertion at `send()` time.
 *
 * @see PLAN.md §8.2 — "What we do NOT send"
 */

/**
 * Thrown synchronously by the CDP transport when calling code attempts to send
 * a method that is on the forbidden list. The error references the PLAN.md §8.2
 * line for the specific constraint so reviewers can trace the rule back to the
 * design doc.
 */
export class ForbiddenCdpMethodError extends Error {
  /** The CDP method name that was rejected. */
  readonly method: string;
  /** Human-readable rationale citing PLAN.md §8.2. */
  readonly reason: string;

  constructor(method: string, reason: string) {
    super(
      `[mochi] forbidden CDP method "${method}" — ${reason} ` +
        "(see PLAN.md §8.2). This is a stealth invariant; do not bypass.",
    );
    this.name = "ForbiddenCdpMethodError";
    this.method = method;
    this.reason = reason;
  }
}

/**
 * Methods that are forbidden unconditionally, regardless of params or target.
 * @see PLAN.md §8.2
 */
const FORBIDDEN_METHODS: ReadonlyMap<string, string> = new Map([
  [
    "Runtime.enable",
    "PLAN.md §8.2 line 1: 'Runtime.enable (any target). Detectable by error.stack lookup tricks.'",
  ],
  [
    "Page.createIsolatedWorld",
    "PLAN.md §8.2 line 2: 'Page.createIsolatedWorld. Also detectable.' Use main-world (worldName: '') injection only.",
  ],
]);

/**
 * Methods that are forbidden only when called with specific param shapes. The
 * predicate returns the violation reason (string) when params are forbidden, or
 * `null` when the call is acceptable.
 * @see PLAN.md §8.2 line 3
 */
const PARAM_FORBIDDEN: ReadonlyMap<string, (params: unknown) => string | null> = new Map([
  [
    "Runtime.evaluate",
    (params: unknown): string | null => {
      if (
        params !== null &&
        typeof params === "object" &&
        "includeCommandLineAPI" in params &&
        (params as { includeCommandLineAPI?: unknown }).includeCommandLineAPI === true
      ) {
        return (
          "PLAN.md §8.2 line 3: 'Runtime.evaluate with includeCommandLineAPI: true' " +
          "(leaks $x, $_, etc. devtools globals to page script)."
        );
      }
      return null;
    },
  ],
]);

/**
 * Inspect a CDP request and throw `ForbiddenCdpMethodError` if it violates
 * any §8.2 invariant. Called synchronously by the transport before serializing
 * and before any I/O.
 *
 * Exported separately from the transport so tests and contract tests can
 * exercise the invariant directly without spawning Chromium.
 */
export function assertNotForbidden(method: string, params?: unknown): void {
  const flatReason = FORBIDDEN_METHODS.get(method);
  if (flatReason !== undefined) {
    throw new ForbiddenCdpMethodError(method, flatReason);
  }
  const paramCheck = PARAM_FORBIDDEN.get(method);
  if (paramCheck !== undefined) {
    const reason = paramCheck(params);
    if (reason !== null) {
      throw new ForbiddenCdpMethodError(method, reason);
    }
  }
}

/**
 * The list of unconditionally-forbidden method names. Exported for tests and
 * documentation tooling. Do not consume from product code.
 *
 * @internal
 */
export const FORBIDDEN_METHOD_NAMES: readonly string[] = Array.from(FORBIDDEN_METHODS.keys());
