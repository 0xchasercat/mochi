/**
 * Cross-package contract: `@mochi.js/harness` exports the surface the CLI
 * + the orchestrator depend on. The shape pinned here is load-bearing —
 * changing it requires bumping `@mochi.js/harness` major and updating
 * `@mochi.js/cli`'s `harness/subcommand.ts` in lockstep.
 *
 * @see PLAN.md §5.7
 * @see tasks/0050-harness-mvp.md
 */

import { describe, expect, it } from "bun:test";
import {
  ALL_SENTINELS,
  type CapturedProbeManifest,
  type Category,
  capture,
  categorize,
  categorizeAll,
  countLeaves,
  type DiffEntry,
  type DiffReportV1,
  diff,
  diffAndReport,
  type ExpectedDivergenceEntry,
  type ExpectedDivergences,
  html,
  isGuidClassPair,
  isNormalized,
  type JsonValue,
  listProfiles,
  loadBaseline,
  loadExpectedDivergences,
  loadProfile,
  match,
  matchAny,
  type NormalizedManifest,
  normalize,
  type ProbeManifestV1,
  type RunHarnessOptions,
  report,
  runHarnessAgainstProfile,
  SENTINELS,
  type Sentinel,
  summary,
  VERSION,
  type Verdict,
} from "../../packages/harness/src/index";

describe("@mochi.js/harness — public-surface contract", () => {
  it("VERSION is a non-empty semver-shaped string", () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("the five canonical functions are exported", () => {
    expect(typeof capture).toBe("function");
    expect(typeof normalize).toBe("function");
    expect(typeof diff).toBe("function");
    expect(typeof categorize).toBe("function");
    expect(typeof report).toBe("function");
  });

  it("the orchestrator + CLI helpers are exported", () => {
    expect(typeof runHarnessAgainstProfile).toBe("function");
    expect(typeof diffAndReport).toBe("function");
    expect(typeof loadProfile).toBe("function");
    expect(typeof loadBaseline).toBe("function");
    expect(typeof loadExpectedDivergences).toBe("function");
    expect(typeof listProfiles).toBe("function");
  });

  it("the supporting helpers are exported", () => {
    expect(typeof match).toBe("function");
    expect(typeof matchAny).toBe("function");
    expect(typeof categorizeAll).toBe("function");
    expect(typeof isGuidClassPair).toBe("function");
    expect(typeof isNormalized).toBe("function");
    expect(typeof countLeaves).toBe("function");
    expect(typeof html).toBe("function");
    expect(typeof summary).toBe("function");
  });

  it("SENTINELS + ALL_SENTINELS are stable", () => {
    expect(SENTINELS.hex32Guid).toBe("<HEX32_GUID>");
    expect(SENTINELS.eventId).toBe("<EVENT_ID>");
    expect(SENTINELS.timestamp).toBe("<TS>");
    expect(ALL_SENTINELS).toContain(SENTINELS.hex32Guid);
  });
});

describe("@mochi.js/harness — type pin (compile-time)", () => {
  it("DiffEntry / DiffReportV1 / Verdict / ProbeManifestV1 are nameable", () => {
    const v: Verdict = "EQUIVALENT";
    const dr: DiffReportV1 = {
      reportVersion: "1",
      generatedAt: "2026-05-08T00:00:00.000Z",
      profile: "p",
      verdict: v,
      counts: { material: 0, intentional: 0, guidClass: 0 },
      structuralMatchPct: 100,
      diffs: [],
    };
    const de: DiffEntry = { path: "x", category: "material", expected: 1, actual: 2 };
    const c: Category = "material";
    const j: JsonValue = { foo: [1, "x", null, true] };
    const sentinel: Sentinel = SENTINELS.hex32Guid;
    expect(dr.profile).toBe("p");
    expect(de.path).toBe("x");
    expect(c).toBe("material");
    expect(j).toBeTruthy();
    expect(sentinel).toBe("<HEX32_GUID>");
  });

  it("ExpectedDivergences shape is pin-able", () => {
    const ev: ExpectedDivergenceEntry = { path: "audio.**", comment: "phase-0.7 deferral" };
    const exp: ExpectedDivergences = { version: "1", paths: [ev] };
    expect(exp.paths[0]?.path).toBe("audio.**");
  });

  it("RunHarnessOptions / NormalizedManifest / CapturedProbeManifest / ProbeManifestV1 names compile", () => {
    const opts: RunHarnessOptions = { online: false, headless: true };
    const cap: CapturedProbeManifest = { foo: 1 };
    const norm: NormalizedManifest = normalize(cap);
    const _pm: ProbeManifestV1 | undefined = undefined;
    expect(opts.headless).toBe(true);
    expect(cap.foo).toBe(1);
    expect(norm.__mochiNormalized).toBe(true);
    expect(_pm).toBeUndefined();
  });
});

describe("@mochi.js/harness — round-trip contract (offline)", () => {
  it("normalize → diff → categorize → report yields a schema-shaped DiffReportV1", () => {
    const baseline = {
      __meta: { capturedAt: "2026-05-08T02:02:42.251Z", elapsedMs: 1234 },
      navigator: { userAgent: "real" },
    };
    const captured = {
      __meta: { capturedAt: "2026-05-08T02:03:00.999Z", elapsedMs: 4321 },
      navigator: { userAgent: "spoofed" },
    };
    const r = diffAndReport({
      profileId: "round-trip",
      baseline,
      captured,
      expectedDivergencePaths: ["navigator.userAgent"],
    });
    expect(r.reportVersion).toBe("1");
    expect(r.profile).toBe("round-trip");
    expect(r.counts.material).toBe(0);
    expect(r.counts.intentional).toBe(1);
    expect(r.verdict).toBe("EQUIVALENT");
  });
});
