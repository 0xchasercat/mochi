/**
 * Phase 0.5 GATE — end-to-end harness against `mac-m4-chrome-stable`.
 *
 * Drives a real Mochi-spoofed session through `tests/fixtures/probe-page.html`,
 * normalizes both sides, diffs against the committed baseline, categorizes
 * each entry, and asserts `report.counts.material === 0`.
 *
 * Gated by `MOCHI_E2E=1`. Set `MOCHI_CHROMIUM_PATH` to a real Chrome /
 * Chromium-for-Testing binary that satisfies the profile's
 * browser.minVersion/maxVersion (147 for the M4 baseline).
 *
 * Budget: < 30 seconds total (single session, single fixture, no online).
 *
 * @see PLAN.md §13.6 ("Zero-Diff" definition)
 */

import { describe, expect, it } from "bun:test";
import { runHarnessAgainstProfile } from "../run";

const E2E_ENABLED = process.env.MOCHI_E2E === "1";
const TEST_TIMEOUT_MS = 30_000;
const describeOrSkip = E2E_ENABLED ? describe : describe.skip;

describeOrSkip("@mochi.js/harness E2E gate (MOCHI_E2E=1)", () => {
  it(
    "mac-m4-chrome-stable: counts.material === 0 against the committed baseline",
    async () => {
      const report = await runHarnessAgainstProfile("mac-m4-chrome-stable", { headless: true });
      // The phase 0.5 gate. Material divergences are PR-blocking bugs.
      // Intentional + guid-class are expected.
      if (report.counts.material > 0) {
        // Surface the offenders so a failing run is debuggable in CI logs.
        const offenders = report.diffs.filter((d) => d.category === "material");
        const lines = offenders.slice(0, 20).map((d) => {
          const exp = JSON.stringify(d.expected);
          const act = JSON.stringify(d.actual);
          return `  ${d.path}: expected=${exp} actual=${act}`;
        });
        process.stderr.write(
          `\n[mochi harness E2E] ${report.counts.material} material divergence(s):\n` +
            `${lines.join("\n")}\n` +
            (offenders.length > 20 ? `  … and ${offenders.length - 20} more\n` : ""),
        );
      }
      expect(report.counts.material).toBe(0);
      expect(report.verdict).toBe("EQUIVALENT");
      // structuralMatchPct: at v0.5 we expect ≥ 95% — the gap to 100% is
      // the phase-0.7-deferred surfaces (audio bytes, full canvas, full
      // WebGL extensions, full font lists, MediaDevices, SpeechSynthesis),
      // tracked as intentional in expected-divergences.json. This bar
      // climbs to 99% when phase 0.7 lands.
      expect(report.structuralMatchPct).toBeGreaterThanOrEqual(95);
    },
    TEST_TIMEOUT_MS,
  );
});
