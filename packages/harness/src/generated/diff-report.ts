// AUTO-GENERATED — do not edit. Run `bun run codegen` to regenerate.
// Source schema lives in schemas/. See scripts/codegen.ts and tasks/0003-schemas-and-codegen.md.

/**
 * Any JSON-encodable value: null, boolean, number, string, array, or object.
 */
export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | {
      [k: string]: JsonValue;
    };

/**
 * Output of @mochi.js/harness — a structured diff between a captured Probe Manifest and a committed baseline, with categorized verdict. PR gate fails iff counts.material > 0. See PLAN.md §6.4 and §13.3.
 */
export interface DiffReportV1 {
  /**
   * Schema major version. Bump on breaking changes.
   */
  reportVersion: "1";
  /**
   * ISO-8601 timestamp at which the diff was computed.
   */
  generatedAt: string;
  /**
   * ProfileV1.id this report targets.
   */
  profile: string;
  /**
   * EQUIVALENT iff counts.material === 0.
   */
  verdict: "EQUIVALENT" | "DIVERGED";
  counts: {
    /**
     * Non-allowlisted, non-intentional divergences. PR-blocking.
     */
    material: number;
    /**
     * Divergences listed in the profile's expected-divergences.json.
     */
    intentional: number;
    /**
     * Per-session GUID-class entropy that matched the allowlist regex.
     */
    guidClass: number;
  };
  /**
   * Percentage of fields whose paths AND values both matched.
   */
  structuralMatchPct: number;
  /**
   * Per-path diff entries. Order is stable: path-sorted, then category-sorted.
   */
  diffs: DiffEntry[];
}
export interface DiffEntry {
  /**
   * Dotted JSON path into the manifest, e.g. 'page.tls.ja4'.
   */
  path: string;
  /**
   * Categorization rule applied. material is PR-blocking.
   */
  category: "guid-class" | "intentional" | "material";
  /**
   * Value from the baseline manifest at this path. Any JSON value, including null.
   */
  expected:
    | null
    | boolean
    | number
    | string
    | JsonValue[]
    | {
        [k: string]: JsonValue;
      };
  /**
   * Any JSON-encodable value: null, boolean, number, string, array, or object.
   */
  actual:
    | null
    | boolean
    | number
    | string
    | JsonValue[]
    | {
        [k: string]: JsonValue;
      };
  /**
   * Optional human-readable identifier of the categorization rule that fired.
   */
  rule?: string;
}
