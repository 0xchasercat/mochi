import { describe, expect, it } from "bun:test";
import {
  defaultProfilesDir,
  diffAndReport,
  loadBaseline,
  loadExpectedDivergences,
  loadProfile,
} from "../run";

describe("@mochi.js/harness — run.diffAndReport (offline)", () => {
  it("produces EQUIVALENT when baseline is diffed against itself", () => {
    const baseline = { foo: { bar: 1 }, list: [1, 2, 3] };
    const r = diffAndReport({
      profileId: "self-diff",
      baseline,
      captured: structuredClone(baseline),
    });
    expect(r.verdict).toBe("EQUIVALENT");
    expect(r.counts).toEqual({ material: 0, intentional: 0, guidClass: 0 });
    expect(r.structuralMatchPct).toBe(100);
  });

  it("respects expectedDivergencePaths when categorizing", () => {
    const baseline = { audio: { hash: "a" }, navigator: { userAgent: "real-ua" } };
    const captured = { audio: { hash: "b" }, navigator: { userAgent: "spoofed-ua" } };
    const r = diffAndReport({
      profileId: "intentional-test",
      baseline,
      captured,
      expectedDivergencePaths: ["audio.**"],
    });
    expect(r.counts.intentional).toBe(1);
    expect(r.counts.material).toBe(1);
    expect(r.verdict).toBe("DIVERGED");
  });

  it("counts per-session GUIDs as guid-class via normalize", () => {
    const baseline = {
      mediaDevices: {
        devices: [{ deviceId: "real-id-A", groupId: "real-grp-X", kind: "audioinput" }],
      },
    };
    const captured = {
      mediaDevices: {
        devices: [{ deviceId: "real-id-B", groupId: "real-grp-Y", kind: "audioinput" }],
      },
    };
    const r = diffAndReport({
      profileId: "guid-test",
      baseline,
      captured,
    });
    // Both deviceId and groupId end up sentinelized — they collapse to
    // guid-class diffs (zero diffs because they're now equal).
    expect(r.counts.material).toBe(0);
  });
});

describe("@mochi.js/harness — run.loadProfile / loadBaseline / loadExpectedDivergences", () => {
  it("resolves the mac-m4-chrome-stable profile + baseline + expected list", async () => {
    const dir = `${defaultProfilesDir()}/mac-m4-chrome-stable`;
    const profile = await loadProfile(dir);
    expect(profile.id).toBe("mac-m4-chrome-stable");

    const baseline = await loadBaseline(dir);
    // Sanity: baseline is shape-compatible with the probe-page output.
    expect(baseline).toHaveProperty("navigator");
    expect(baseline).toHaveProperty("screen");

    const expected = await loadExpectedDivergences(dir);
    expect(expected).not.toBeNull();
    expect(Array.isArray(expected?.paths)).toBe(true);
    // Phase 0.7 trims the expected-divergences list to just `audio.**` +
    // `canvas.**` (deferred to task 0071 with precomputed blob fixtures).
    // Every other surface previously listed here is now spoofed by the
    // expanded consistency engine + inject pipeline; the harness should
    // see them as matches, not intentional. tasks/0070.
    const paths = (expected?.paths ?? []).map((p) => p.path);
    expect(paths).toContain("audio.**");
    expect(paths).toContain("canvas.**");
  });

  it("returns null when expected-divergences.json is absent", async () => {
    // Use this very test directory — no profile JSON, no expected list.
    const noSuchDir = "/tmp/__mochi_harness_does_not_exist__";
    const r = await loadExpectedDivergences(noSuchDir);
    expect(r).toBeNull();
  });
});
