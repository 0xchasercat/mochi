/**
 * @mochi.js/harness — Probe Manifest validation.
 *
 * Captures a Probe Manifest from a Mochi-driven session, normalizes it,
 * diffs against a committed baseline, categorizes divergences as
 * guid-class | intentional | material, and gates PRs on `material === 0`.
 *
 * Mirrors Peekaboo's equivalence-harness pattern. v0.0.1 claim release;
 * harness lands in phase 0.5.
 *
 * @see PLAN.md §5.7 and §13
 */
export const VERSION = "0.0.1" as const;

export type { DiffEntry, DiffReportV1, JsonValue } from "./generated/diff-report";
// Canonical types are generated from schemas/*.schema.json by `bun run codegen`.
// ProbeManifestV1 is vendored verbatim from Peekaboo (PLAN.md §6.3).
export type { Probe, ProbeManifestV1 } from "./generated/probe-manifest";

import type { DiffReportV1 } from "./generated/diff-report";

/** Convenience alias: the verdict enum carried by DiffReportV1. */
export type Verdict = DiffReportV1["verdict"];

/**
 * Capture a Probe Manifest and diff against the profile baseline. Lands in phase 0.5.
 */
export async function diff(_args: { profile: string; manifest: unknown }): Promise<DiffReportV1> {
  throw new Error(
    "@mochi.js/harness.diff is not yet implemented (v0.0.1 claim). " +
      "Lands in phase 0.5; see PLAN.md §13.",
  );
}
