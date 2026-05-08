import { describe, expect, it } from "bun:test";
import type { DiffEntry } from "../generated/diff-report";
import { html, report, summary } from "../report";

const NOW = () => new Date("2026-05-08T00:00:00.000Z");

function entry(over: Partial<DiffEntry>): DiffEntry {
  return {
    path: over.path ?? "x",
    category: over.category ?? "material",
    expected: over.expected ?? null,
    actual: over.actual ?? null,
  };
}

describe("@mochi.js/harness — report()", () => {
  it("produces EQUIVALENT verdict on zero material diffs", () => {
    const r = report("p", [entry({ path: "a", category: "guid-class" })], 100, NOW);
    expect(r.verdict).toBe("EQUIVALENT");
    expect(r.counts).toEqual({ material: 0, intentional: 0, guidClass: 1 });
  });

  it("produces DIVERGED verdict on any material diff", () => {
    const r = report("p", [entry({ path: "a", category: "material" })], 100, NOW);
    expect(r.verdict).toBe("DIVERGED");
    expect(r.counts.material).toBe(1);
  });

  it("counts each category accurately", () => {
    const ds: DiffEntry[] = [
      entry({ path: "a", category: "material" }),
      entry({ path: "b", category: "intentional" }),
      entry({ path: "c", category: "intentional" }),
      entry({ path: "d", category: "guid-class" }),
      entry({ path: "e", category: "guid-class" }),
      entry({ path: "f", category: "guid-class" }),
    ];
    const r = report("p", ds, 100, NOW);
    expect(r.counts).toEqual({ material: 1, intentional: 2, guidClass: 3 });
  });

  it("computes structuralMatchPct from baselineLeaves - diffs.length", () => {
    const ds = [entry({ path: "x", category: "material" })];
    const r = report("p", ds, 10, NOW);
    expect(r.structuralMatchPct).toBeCloseTo(90.0, 1);
  });

  it("clamps structuralMatchPct at 0 and 100", () => {
    const r = report("p", [], 0, NOW);
    expect(r.structuralMatchPct).toBe(100);
  });

  it("sorts diffs by path then category (material before intentional)", () => {
    const ds: DiffEntry[] = [
      entry({ path: "z", category: "intentional" }),
      entry({ path: "a", category: "material" }),
      entry({ path: "z", category: "material" }),
    ];
    const r = report("p", ds, 10, NOW);
    expect(r.diffs.map((d) => d.path)).toEqual(["a", "z", "z"]);
    expect(r.diffs[1]?.category).toBe("material");
    expect(r.diffs[2]?.category).toBe("intentional");
  });

  it("stamps profile + reportVersion + generatedAt", () => {
    const r = report("mac-m4-chrome-stable", [], 10, NOW);
    expect(r.profile).toBe("mac-m4-chrome-stable");
    expect(r.reportVersion).toBe("1");
    expect(r.generatedAt).toBe("2026-05-08T00:00:00.000Z");
  });
});

describe("@mochi.js/harness — html()", () => {
  it("renders an EQUIVALENT report with empty-state copy", () => {
    const r = report("p", [], 10, NOW);
    const out = html(r);
    expect(out).toContain("Zero-Diff");
    expect(out).toContain("EQUIVALENT");
    expect(out).toContain("<title>mochi harness — p</title>");
  });

  it("renders a DIVERGED report with table rows + category pills", () => {
    const r = report(
      "p",
      [
        entry({ path: "audio.audioHash", category: "intentional", expected: "x", actual: "y" }),
        entry({ path: "navigator.bogus", category: "material", expected: 1, actual: 2 }),
      ],
      10,
      NOW,
    );
    const out = html(r);
    expect(out).toContain("DIVERGED");
    expect(out).toContain("audio.audioHash");
    expect(out).toContain('class="pill intentional"');
    expect(out).toContain('class="pill material"');
  });

  it("escapes HTML metacharacters", () => {
    const r = report(
      "<script>",
      [entry({ path: "x<y", expected: "<b>", actual: "</b>" })],
      10,
      NOW,
    );
    const out = html(r);
    expect(out).not.toContain("<script>");
    expect(out).toContain("&lt;script&gt;");
  });
});

describe("@mochi.js/harness — summary()", () => {
  it("returns a 3-line, machine-friendly stdout summary", () => {
    const r = report("p", [entry({ path: "a", category: "material" })], 10, NOW);
    const s = summary(r);
    expect(s.split("\n")).toHaveLength(3);
    expect(s).toContain("verdict: DIVERGED");
    expect(s).toContain("material: 1");
    expect(s).toContain("structuralMatchPct:");
  });
});
