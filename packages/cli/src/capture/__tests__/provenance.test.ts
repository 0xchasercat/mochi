/**
 * Unit tests for provenance.ts.
 *
 * Interactive prompting is exercised by the e2e gate; here we only cover
 * the non-interactive path (`interactive: false`) which is what tests +
 * CI use.
 */

import { describe, expect, it } from "bun:test";
import { collectProvenance, renderProvenance } from "../provenance";

describe("collectProvenance() — non-interactive", () => {
  it("merges supplied inputs and falls back to 'unknown' for missing fields", async () => {
    const r = await collectProvenance({
      profileId: "x",
      interactive: false,
      inputs: {
        capturer: "@orch",
        machine: "Mac14,2 / serial …F8K2",
        capturedAt: "2026-05-08T00:00:00.000Z",
      },
    });
    expect(r.profileId).toBe("x");
    expect(r.capturer).toBe("@orch");
    expect(r.machine).toContain("Mac14,2");
    expect(r.browserVersion).toBe("unknown");
    expect(r.mochiVersion).toBe("unknown");
    expect(r.capturedAt).toBe("2026-05-08T00:00:00.000Z");
    expect(r.notes).toBe("");
  });

  it("auto-fills capturedAt when missing", async () => {
    const before = Date.now();
    const r = await collectProvenance({ profileId: "y", interactive: false });
    const after = Date.now();
    const t = new Date(r.capturedAt).getTime();
    expect(t).toBeGreaterThanOrEqual(before);
    expect(t).toBeLessThanOrEqual(after);
  });
});

describe("renderProvenance()", () => {
  it("emits a stable, byte-deterministic markdown for given inputs", () => {
    const md = renderProvenance({
      profileId: "mac-m2-chrome-stable",
      capturer: "@orch",
      machine: "Mac14,2 / serial …F8K2",
      browserVersion: "131.0.6778.86",
      mochiVersion: "0.0.1",
      capturedAt: "2026-05-08T00:00:00.000Z",
      notes: "Smoke run.",
    });
    expect(md).toContain("# PROVENANCE — mac-m2-chrome-stable");
    expect(md).toContain("| capturer | @orch |");
    expect(md).toContain("| browser version | 131.0.6778.86 |");
    expect(md).toContain("captured at (UTC)");
    expect(md).toContain("## Notes");
    expect(md).toContain("Smoke run.");
    // determinism: rendering twice produces identical bytes
    expect(
      renderProvenance({
        profileId: "mac-m2-chrome-stable",
        capturer: "@orch",
        machine: "Mac14,2 / serial …F8K2",
        browserVersion: "131.0.6778.86",
        mochiVersion: "0.0.1",
        capturedAt: "2026-05-08T00:00:00.000Z",
        notes: "Smoke run.",
      }),
    ).toBe(md);
  });

  it("omits the Notes section when notes is empty", () => {
    const md = renderProvenance({
      profileId: "x",
      capturer: "u",
      machine: "u",
      browserVersion: "u",
      mochiVersion: "u",
      capturedAt: "u",
      notes: "",
    });
    expect(md.includes("## Notes")).toBe(false);
  });
});
