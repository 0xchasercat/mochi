/**
 * report.ts — build a `DiffReportV1` from categorized diffs and render
 * an HTML view for the orchestrator.
 *
 * @see PLAN.md §6.4 / §13.6
 * @see schemas/diff-report.schema.json
 */

import type { DiffEntry, DiffReportV1 } from "./generated/diff-report";

/**
 * Build a `DiffReportV1` from the categorized diff list.
 *
 * @param profileId       the profile this report targets (`ProfileV1.id`)
 * @param diffs           the post-`categorize` diff entries
 * @param baselineLeaves  optional total leaf count of the baseline
 *                        manifest, used to compute `structuralMatchPct`.
 *                        When omitted the percentage is computed from the
 *                        diff count alone (less informative, but always
 *                        non-NaN).
 * @param now             clock seam for tests; defaults to `() => new Date()`.
 */
export function report(
  profileId: string,
  diffs: readonly DiffEntry[],
  baselineLeaves?: number,
  now: () => Date = () => new Date(),
): DiffReportV1 {
  const counts = {
    material: 0,
    intentional: 0,
    guidClass: 0,
  };
  for (const d of diffs) {
    if (d.category === "material") counts.material += 1;
    else if (d.category === "intentional") counts.intentional += 1;
    else if (d.category === "guid-class") counts.guidClass += 1;
  }
  const verdict: DiffReportV1["verdict"] = counts.material === 0 ? "EQUIVALENT" : "DIVERGED";

  // structuralMatchPct: fraction of leaves that matched. We approximate
  // "matched" as `baselineLeaves - diffs.length`. When baseline leaves are
  // not provided, fall back to a percentage that's monotone in diff count.
  const totalLeaves = Math.max(baselineLeaves ?? diffs.length, diffs.length);
  const matched = Math.max(totalLeaves - diffs.length, 0);
  const pct = totalLeaves === 0 ? 100 : (matched / totalLeaves) * 100;
  // Clamp + round to 2 decimals so the schema's [0, 100] bounds are safe
  // against floating-point drift.
  const structuralMatchPct = Math.max(0, Math.min(100, Math.round(pct * 100) / 100));

  // Sort: path ASC, category ASC (so material rows surface first inside a
  // path collision, alphabetically `intentional` < `material`).
  const sorted = [...diffs].sort((a, b) => {
    const byPath = a.path.localeCompare(b.path);
    if (byPath !== 0) return byPath;
    return categoryRank(a.category) - categoryRank(b.category);
  });

  return {
    reportVersion: "1",
    generatedAt: now().toISOString(),
    profile: profileId,
    verdict,
    counts,
    structuralMatchPct,
    diffs: sorted,
  };
}

/**
 * Render a `DiffReportV1` as a stand-alone HTML document. Hand-rolled
 * inline CSS — no React, no build step. The orchestrator opens this with
 * `open <path>` for review.
 */
export function html(report: DiffReportV1): string {
  const verdictClass = report.verdict === "EQUIVALENT" ? "ok" : "diverged";
  const rows = report.diffs.map(renderRow).join("\n");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>mochi harness — ${escapeHtml(report.profile)}</title>
<style>
  body {
    font: 13px/1.5 -apple-system, system-ui, sans-serif;
    margin: 0; padding: 1.5rem; background: #fafafa; color: #1a1a1a;
  }
  h1 { font-size: 1.4rem; margin: 0 0 0.5rem; }
  .meta { color: #666; font-size: 12px; margin-bottom: 1rem; }
  .verdict { display: inline-block; padding: 0.2rem 0.6rem; border-radius: 4px;
             font-weight: 600; letter-spacing: 0.02em; }
  .verdict.ok       { background: #dff5e1; color: #18632b; }
  .verdict.diverged { background: #fde2e2; color: #8b1a1a; }
  .counts { display: flex; gap: 1.5rem; margin: 0.75rem 0 1rem; }
  .count { font-variant-numeric: tabular-nums; }
  .count .n { font-size: 1.4rem; font-weight: 700; }
  .count.material .n     { color: #b91c1c; }
  .count.intentional .n  { color: #b45309; }
  .count.guidClass .n    { color: #475569; }
  table { border-collapse: collapse; width: 100%; background: white;
          box-shadow: 0 1px 3px rgba(0,0,0,0.06); border-radius: 6px; overflow: hidden; }
  th, td { padding: 0.5rem 0.75rem; text-align: left; vertical-align: top;
           border-bottom: 1px solid #eee; font-family: ui-monospace, Menlo, Monaco, monospace; }
  th { background: #f3f4f6; font-weight: 600; font-size: 11px;
       text-transform: uppercase; letter-spacing: 0.04em; color: #6b7280; }
  td.path     { color: #1f2937; white-space: nowrap; }
  td.expected { color: #166534; max-width: 28rem; overflow: hidden; text-overflow: ellipsis; }
  td.actual   { color: #92400e; max-width: 28rem; overflow: hidden; text-overflow: ellipsis; }
  td.cat .pill { display: inline-block; padding: 0.1rem 0.4rem; border-radius: 999px;
                 font-size: 11px; font-weight: 600; }
  td.cat .material    { background: #fee2e2; color: #b91c1c; }
  td.cat .intentional { background: #fef3c7; color: #92400e; }
  td.cat .guid-class  { background: #f1f5f9; color: #334155; }
  .empty { color: #6b7280; font-style: italic; padding: 2rem; text-align: center; }
</style>
</head>
<body>
  <h1>mochi harness — ${escapeHtml(report.profile)}</h1>
  <div class="meta">
    generated <code>${escapeHtml(report.generatedAt)}</code>
    · structural match <strong>${report.structuralMatchPct.toFixed(2)}%</strong>
    · <span class="verdict ${verdictClass}">${escapeHtml(report.verdict)}</span>
  </div>
  <div class="counts">
    <div class="count material"><span class="n">${report.counts.material}</span> material</div>
    <div class="count intentional"><span class="n">${report.counts.intentional}</span> intentional</div>
    <div class="count guidClass"><span class="n">${report.counts.guidClass}</span> guid-class</div>
  </div>
  ${
    report.diffs.length === 0
      ? `<div class="empty">No divergences. Profile is Zero-Diff against the local fixture.</div>`
      : `<table>
        <thead>
          <tr>
            <th>path</th>
            <th>expected (baseline)</th>
            <th>actual (mochi)</th>
            <th>category</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>`
  }
</body>
</html>
`;
}

/**
 * One-line summary suitable for stdout.
 */
export function summary(report: DiffReportV1): string {
  return [
    `verdict: ${report.verdict}`,
    `counts: { material: ${report.counts.material}, intentional: ${report.counts.intentional}, guidClass: ${report.counts.guidClass} }`,
    `structuralMatchPct: ${report.structuralMatchPct.toFixed(2)}%`,
  ].join("\n");
}

// ---- helpers ----------------------------------------------------------------

function categoryRank(c: DiffEntry["category"]): number {
  // material first within a path so the eye lands on real bugs.
  if (c === "material") return 0;
  if (c === "intentional") return 1;
  return 2;
}

function renderRow(d: DiffEntry): string {
  const cat = d.category;
  return `<tr>
    <td class="path">${escapeHtml(d.path)}</td>
    <td class="expected">${escapeJsonHtml(d.expected)}</td>
    <td class="actual">${escapeJsonHtml(d.actual)}</td>
    <td class="cat"><span class="pill ${cat}">${cat}</span></td>
  </tr>`;
}

function escapeJsonHtml(v: unknown): string {
  if (v === undefined) return `<em>(missing)</em>`;
  return escapeHtml(JSON.stringify(v));
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
