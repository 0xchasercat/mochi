/**
 * @mochi.js/harness — Probe Manifest validation.
 *
 * Closes mochi's correctness loop: drives a Mochi-spoofed session through
 * `tests/fixtures/probe-page.html`, normalizes per-session entropy on
 * both the captured manifest and the committed baseline, structurally
 * diffs the two, categorizes each divergence as
 * `guid-class | intentional | material`, and gates PRs on `material === 0`.
 *
 * Mirrors Peekaboo's equivalence-harness pattern (research/62-equivalence-harness.md).
 *
 * Public surface (PLAN.md §5.7):
 *   - {@link capture}                 drive a Session through the fixture
 *   - {@link normalize}               strip per-session entropy
 *   - {@link diff}                    flat structural deep-diff
 *   - {@link categorize}              guid-class | intentional | material
 *   - {@link report}                  build a DiffReportV1 + render HTML
 *   - {@link runHarnessAgainstProfile} the orchestrator
 *
 * @see PLAN.md §5.7, §13
 * @see tasks/0050-harness-mvp.md
 */

export const VERSION = "0.5.0" as const;

// ---- generated types --------------------------------------------------------
export type { DiffEntry, DiffReportV1, JsonValue } from "./generated/diff-report";
export type { Probe, ProbeManifestV1 } from "./generated/probe-manifest";

import type { DiffReportV1 } from "./generated/diff-report";

/** Convenience alias: the verdict enum carried by DiffReportV1. */
export type Verdict = DiffReportV1["verdict"];

// ---- public functions -------------------------------------------------------

export { type CapturedProbeManifest, type CaptureOptions, capture } from "./capture";
export {
  type Category,
  categorize,
  categorizeAll,
  type ExpectedDivergenceEntry,
  type ExpectedDivergences,
  isGuidClassPair,
} from "./categorize";
export { countLeaves, diff } from "./diff";
export { match, matchAny } from "./match";
export {
  ALL_SENTINELS,
  isNormalized,
  type NormalizedManifest,
  normalize,
  SENTINELS,
  type Sentinel,
} from "./normalize";
export { html, report, summary } from "./report";
export {
  defaultProfilesDir,
  diffAndReport,
  listProfiles,
  loadBaseline,
  loadExpectedDivergences,
  loadProfile,
  type RunHarnessOptions,
  runHarnessAgainstProfile,
} from "./run";
