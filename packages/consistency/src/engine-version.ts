/**
 * Engine version stamped on every derived MatrixV1.
 *
 * Bumped whenever the rule semantics change in a way that produces a
 * different output for the same `(profile, seed)` pair. v0.2.0 is the
 * first real (non-stub) cut; v0.7.0 will land the full ruleset.
 *
 * Kept distinct from the package's `VERSION` constant so the engine can
 * version its output independently of the package's npm lifecycle.
 *
 * @see PLAN.md §5.2 / §6.2
 */
export const CONSISTENCY_ENGINE_VERSION = "0.2.0" as const;
