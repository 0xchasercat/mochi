import { describe, expect, it } from "bun:test";
import { _resetCacheForTest, match, matchAny } from "../match";

describe("@mochi.js/harness — match()", () => {
  it("matches literal paths", () => {
    expect(match("probes.audio.fingerprintBytes", "probes.audio.fingerprintBytes")).toBe(true);
    expect(match("a.b.c", "a.b.d")).toBe(false);
  });

  it("`*` matches a single segment", () => {
    expect(match("probes.audio.*", "probes.audio.fingerprintBytes")).toBe(true);
    expect(match("probes.audio.*", "probes.audio.deeper.value")).toBe(false);
    expect(match("a.*.c", "a.b.c")).toBe(true);
    expect(match("a.*.c", "a.b.d.c")).toBe(false);
  });

  it("`**` matches across segments", () => {
    expect(match("probes.**", "probes.audio.fingerprintBytes")).toBe(true);
    expect(match("probes.**", "probes")).toBe(false);
    expect(match("probes.**", "probes.audio.deeper.value")).toBe(true);
  });

  it("`[*]` matches any bracketed array index", () => {
    expect(match("probes.fonts.list[*]", "probes.fonts.list[0]")).toBe(true);
    expect(match("probes.fonts.list[*]", "probes.fonts.list[42]")).toBe(true);
    expect(match("probes.fonts.list[*]", "probes.fonts.list")).toBe(false);
    expect(match("probes.fonts.list[*]", "probes.fonts.list.0")).toBe(false);
  });

  it("composes multiple glob tokens", () => {
    expect(match("probes.webgl.extensions[*]", "probes.webgl.extensions[7]")).toBe(true);
    expect(match("probes.*.extensions[*]", "probes.webgl.extensions[7]")).toBe(true);
    expect(match("probes.**[*]", "probes.webgl.extensions[7]")).toBe(true);
  });

  it("escapes regex metacharacters in literal portions", () => {
    expect(match("a.b+c", "a.b+c")).toBe(true);
    expect(match("a.b.c$", "a.b.c$")).toBe(true);
    expect(match("a.b.c$", "a.b.cX")).toBe(false);
  });

  it("matchAny returns true on any pattern hit", () => {
    expect(matchAny(["probes.audio.*", "probes.canvas.*"], "probes.canvas.hash")).toBe(true);
    expect(matchAny(["probes.audio.*"], "probes.canvas.hash")).toBe(false);
    expect(matchAny([], "probes.canvas.hash")).toBe(false);
  });

  it("compile cache reset is non-throwing", () => {
    expect(() => _resetCacheForTest()).not.toThrow();
  });
});
