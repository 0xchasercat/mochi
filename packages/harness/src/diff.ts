/**
 * diff.ts — flat structural deep-diff between two JSON values.
 *
 * Mirrors Peekaboo's `recon/equivalence/diff.py` (research/62-equivalence-harness.md).
 *
 * Output shape: a flat `DiffEntry[]` keyed by dotted JSON path. Object
 * children are walked into; arrays are walked element-by-element with
 * bracketed indices (`list[0]`, `list[1]`, …). Missing on either side is
 * captured as `expected: undefined` or `actual: undefined`.
 *
 * Path syntax (matches `match.ts`):
 *   - `a.b.c`      — object property access
 *   - `a.b[0].c`   — array element access
 *
 * Determinism: the returned array is sorted by `path` ASC, then by
 * `category` (since this module emits no category, the path-sort is the
 * stable tail-break — `categorize` re-sorts later).
 *
 * NOTE: this module produces `DiffEntry` rows with a placeholder
 * `category: "material"` so callers can post-categorize without touching
 * the schema. The `categorize` module is the source of truth for the
 * final classification.
 */

import type { DiffEntry, JsonValue } from "./generated/diff-report";

/** Internal alias to match the public type's discriminator. */
type DraftDiff = Omit<DiffEntry, "category"> & { category?: DiffEntry["category"] };

/**
 * Compute the flat structural diff between `expected` (the baseline) and
 * `actual` (the captured manifest). Each path that disagrees produces one
 * entry. The default `category` is `"material"` — categorize() reclassifies.
 */
export function diff(expected: JsonValue | undefined, actual: JsonValue | undefined): DiffEntry[] {
  const out: DraftDiff[] = [];
  walk("", expected, actual, out);
  out.sort((a, b) => a.path.localeCompare(b.path));
  return out.map((d) => ({
    path: d.path,
    category: d.category ?? "material",
    expected: d.expected,
    actual: d.actual,
  }));
}

function walk(
  path: string,
  expected: JsonValue | undefined,
  actual: JsonValue | undefined,
  out: DraftDiff[],
): void {
  // Both undefined → no diff.
  if (expected === undefined && actual === undefined) return;

  // One side missing.
  if (expected === undefined || actual === undefined) {
    out.push({
      path,
      expected: expected as JsonValue,
      actual: actual as JsonValue,
    });
    return;
  }

  // Both null.
  if (expected === null && actual === null) return;

  // Type mismatch (one null, one not).
  if (expected === null || actual === null) {
    out.push({ path, expected, actual });
    return;
  }

  // Arrays.
  const expArr = Array.isArray(expected);
  const actArr = Array.isArray(actual);
  if (expArr || actArr) {
    if (!expArr || !actArr) {
      out.push({ path, expected, actual });
      return;
    }
    const len = Math.max(expected.length, actual.length);
    for (let i = 0; i < len; i++) {
      const sub = `${path}[${i}]`;
      walk(sub, expected[i], actual[i], out);
    }
    return;
  }

  // Objects.
  if (typeof expected === "object" && typeof actual === "object") {
    const keys = new Set<string>([
      ...Object.keys(expected as Record<string, JsonValue>),
      ...Object.keys(actual as Record<string, JsonValue>),
    ]);
    const sorted = [...keys].sort();
    for (const k of sorted) {
      const sub = path === "" ? k : `${path}.${k}`;
      const expVal = (expected as Record<string, JsonValue | undefined>)[k];
      const actVal = (actual as Record<string, JsonValue | undefined>)[k];
      walk(sub, expVal, actVal, out);
    }
    return;
  }

  // Primitives.
  if (expected === actual) return;
  // Number NaN handling — JSON shouldn't carry NaN but be defensive.
  if (
    typeof expected === "number" &&
    typeof actual === "number" &&
    Number.isNaN(expected) &&
    Number.isNaN(actual)
  ) {
    return;
  }
  out.push({ path, expected, actual });
}

/**
 * Compute the total number of leaf paths in a JSON value. Used by
 * `report.ts` to derive `structuralMatchPct`. A leaf is anything not an
 * object or array (or an empty object/array).
 */
export function countLeaves(value: JsonValue | undefined): number {
  if (value === undefined || value === null) return 1;
  if (Array.isArray(value)) {
    if (value.length === 0) return 1;
    let total = 0;
    for (const item of value) total += countLeaves(item);
    return total;
  }
  if (typeof value === "object") {
    const keys = Object.keys(value);
    if (keys.length === 0) return 1;
    let total = 0;
    for (const k of keys) total += countLeaves((value as Record<string, JsonValue>)[k]);
    return total;
  }
  return 1;
}
