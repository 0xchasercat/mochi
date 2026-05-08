/**
 * categorize.ts — classify each `DiffEntry` as guid-class | intentional | material.
 *
 * Mirrors PLAN.md §13.3 verdict rule and Peekaboo's
 * `recon/equivalence/categorize.py`.
 *
 * Decision tree:
 *
 *   1. **guid-class.** Both sides carry a sentinel placeholder produced by
 *      `normalize.ts`. After collapsing all sentinels to a single `<G>`
 *      token, the two strings compare equal (or both are sentinels). This
 *      is allowlisted per-session entropy and DOES NOT count as a divergence.
 *
 *   2. **intentional.** The diff `path` matches a glob in the profile's
 *      `expected-divergences.json`. PLAN.md §13.4 — every entry here MUST
 *      have a corresponding rationale in `docs/limits.md`.
 *
 *   3. **material.** Everything else. PR-blocking.
 *
 * @see PLAN.md §13.3, §13.4, §13.6
 * @see Peekaboo/peekaboo/research/62-equivalence-harness.md
 */

import type { DiffEntry, JsonValue } from "./generated/diff-report";
import { matchAny } from "./match";
import { ALL_SENTINELS } from "./normalize";

/**
 * Classification verdict for a single diff entry.
 */
export type Category = DiffEntry["category"];

/** Per-profile `expected-divergences.json` shape — a flat list of glob paths. */
export interface ExpectedDivergences {
  /** Schema marker. v1 always `"1"`. */
  readonly version?: "1";
  /** Glob paths that should be treated as `intentional`. */
  readonly paths: readonly ExpectedDivergenceEntry[];
}

/**
 * One entry in the expected-divergences list. The `comment` field is for
 * human review — it is preserved through `report()` so reviewers see WHY
 * a given divergence is allowlisted.
 */
export interface ExpectedDivergenceEntry {
  /** Glob pattern (see `match.ts`). */
  readonly path: string;
  /** Human-readable rationale. Should reference `docs/limits.md`. */
  readonly comment?: string;
}

/**
 * Categorize a single diff entry against the optional list of intentional
 * divergence patterns for a profile. Returns the resulting category.
 *
 * @param d the raw diff entry produced by `diff()`. Its `category` field
 *          is overwritten by the return value of this function.
 * @param expectedDivergences glob patterns from
 *          `packages/profiles/data/<id>/expected-divergences.json`. Pass
 *          `undefined` or `[]` for "no profile-specific intentional list".
 */
export function categorize(d: DiffEntry, expectedDivergences?: readonly string[]): Category {
  // 1. guid-class — both sides carry a sentinel that, after collapsing,
  //    compare equal.
  if (isGuidClassPair(d.expected, d.actual)) return "guid-class";

  // 2. intentional — path matches a profile-specific glob.
  if (expectedDivergences !== undefined && expectedDivergences.length > 0) {
    if (matchAny(expectedDivergences, d.path)) return "intentional";
  }

  // 3. material.
  return "material";
}

/**
 * Apply `categorize` to every entry of `diffs`. The returned array is a
 * fresh shallow copy with each entry's `category` field updated.
 */
export function categorizeAll(
  diffs: readonly DiffEntry[],
  expectedDivergences?: readonly string[],
): DiffEntry[] {
  return diffs.map((d) => ({ ...d, category: categorize(d, expectedDivergences) }));
}

// ---- helpers ----------------------------------------------------------------

/**
 * Both values are guid-class iff their sentinel-collapsed projections match.
 * Returns true also when both are EXACTLY the same sentinel string (e.g. both
 * `"<HEX32_GUID>"` because normalize replaced both sides), which is the
 * common case after `normalize()`.
 */
export function isGuidClassPair(
  expected: JsonValue | undefined,
  actual: JsonValue | undefined,
): boolean {
  if (typeof expected !== "string" || typeof actual !== "string") return false;
  // If neither contains a sentinel anywhere, this isn't a guid-class pair.
  if (!stringContainsSentinel(expected) && !stringContainsSentinel(actual)) {
    return false;
  }
  return collapseSentinels(expected) === collapseSentinels(actual);
}

/**
 * Replace each known sentinel with the canonical `<G>` token, then check
 * for equality. This catches "same shape, different placeholder" cases
 * such as `<HEX32_GUID>` vs `<EVENT_ID>` when the underlying entropy is
 * functionally equivalent.
 */
function collapseSentinels(s: string): string {
  let out = s;
  for (const sentinel of ALL_SENTINELS) {
    out = out.split(sentinel).join("<G>");
  }
  return out;
}

function stringContainsSentinel(s: string): boolean {
  for (const sentinel of ALL_SENTINELS) {
    if (s.includes(sentinel)) return true;
  }
  return false;
}
