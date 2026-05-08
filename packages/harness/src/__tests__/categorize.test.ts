import { describe, expect, it } from "bun:test";
import { categorize, categorizeAll, isGuidClassPair } from "../categorize";
import type { DiffEntry } from "../generated/diff-report";
import { SENTINELS } from "../normalize";

function entry(over: Partial<DiffEntry>): DiffEntry {
  return {
    path: over.path ?? "x",
    category: over.category ?? "material",
    expected: over.expected ?? null,
    actual: over.actual ?? null,
    ...(over.rule !== undefined ? { rule: over.rule } : {}),
  };
}

describe("@mochi.js/harness — categorize()", () => {
  it("classifies a same-sentinel pair as guid-class", () => {
    const d = entry({
      path: "mediaDevices.devices[0].deviceId",
      expected: SENTINELS.hex32Guid,
      actual: SENTINELS.hex32Guid,
    });
    expect(categorize(d)).toBe("guid-class");
  });

  it("classifies sentinel-class equivalents (HEX32 vs EVENT_ID alone) as guid-class", () => {
    const d = entry({
      path: "x",
      expected: SENTINELS.hex32Guid,
      actual: SENTINELS.eventId,
    });
    expect(categorize(d)).toBe("guid-class");
  });

  it("classifies a real-string mismatch with no sentinels as material", () => {
    const d = entry({
      path: "navigator.userAgent",
      expected: "Mozilla/5.0 ... HeadlessChrome/147.0.0.0 ...",
      actual: "Mozilla/5.0 ... Chrome/147.0.0.0 ...",
    });
    expect(categorize(d)).toBe("material");
  });

  it("classifies as intentional when the path matches an expected glob", () => {
    const d = entry({ path: "audio.audioHash", expected: "abc", actual: "def" });
    expect(categorize(d, ["audio.**"])).toBe("intentional");
  });

  it("does NOT promote material to intentional for an unmatched glob", () => {
    const d = entry({ path: "audio.audioHash", expected: "abc", actual: "def" });
    expect(categorize(d, ["canvas.**"])).toBe("material");
  });

  it("guid-class beats intentional (sentinel match short-circuits)", () => {
    const d = entry({
      path: "audio.foo",
      expected: SENTINELS.hex32Guid,
      actual: SENTINELS.hex32Guid,
    });
    expect(categorize(d, ["audio.**"])).toBe("guid-class");
  });

  it("isGuidClassPair returns false for two non-sentinel strings", () => {
    expect(isGuidClassPair("abc", "def")).toBe(false);
  });

  it("isGuidClassPair returns false when only one side has a sentinel", () => {
    expect(isGuidClassPair(SENTINELS.hex32Guid, "real-value")).toBe(false);
  });

  it("isGuidClassPair returns true on sentinel-collapse equality", () => {
    expect(
      isGuidClassPair(`prefix-${SENTINELS.hex32Guid}-suffix`, `prefix-${SENTINELS.eventId}-suffix`),
    ).toBe(true);
  });

  it("categorizeAll re-stamps every entry's category", () => {
    const ds: DiffEntry[] = [
      entry({ path: "a", expected: 1, actual: 2 }),
      entry({ path: "audio.x", expected: "x", actual: "y" }),
      entry({
        path: "z",
        expected: SENTINELS.hex32Guid,
        actual: SENTINELS.hex32Guid,
      }),
    ];
    const out = categorizeAll(ds, ["audio.**"]);
    expect(out[0]?.category).toBe("material");
    expect(out[1]?.category).toBe("intentional");
    expect(out[2]?.category).toBe("guid-class");
  });
});
