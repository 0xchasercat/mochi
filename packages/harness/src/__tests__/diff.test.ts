import { describe, expect, it } from "bun:test";
import { countLeaves, diff } from "../diff";

describe("@mochi.js/harness — diff()", () => {
  it("returns no diffs for byte-identical objects", () => {
    const a = { x: 1, y: { z: "hi" }, arr: [1, 2, 3] };
    expect(diff(a, structuredClone(a))).toEqual([]);
  });

  it("emits a single entry on a primitive mismatch", () => {
    const result = diff({ x: 1 }, { x: 2 });
    expect(result.length).toBe(1);
    expect(result[0]?.path).toBe("x");
    expect(result[0]?.expected).toBe(1);
    expect(result[0]?.actual).toBe(2);
    expect(result[0]?.category).toBe("material");
  });

  it("walks objects deeply, dotted paths", () => {
    const result = diff({ a: { b: { c: 1 } } }, { a: { b: { c: 2 } } });
    expect(result.length).toBe(1);
    expect(result[0]?.path).toBe("a.b.c");
  });

  it("walks arrays element-by-element with bracketed indices", () => {
    const result = diff({ list: [1, 2, 3] }, { list: [1, 9, 3] });
    expect(result.length).toBe(1);
    expect(result[0]?.path).toBe("list[1]");
  });

  it("captures missing keys on either side", () => {
    const result = diff({ a: 1, b: 2 }, { a: 1 });
    expect(result.length).toBe(1);
    expect(result[0]?.path).toBe("b");
    expect(result[0]?.expected).toBe(2);
    expect(result[0]?.actual).toBeUndefined();
  });

  it("captures missing array elements", () => {
    const result = diff({ list: [1, 2, 3] }, { list: [1] });
    // index 1 (mismatch) + index 2 (missing actual)
    expect(result.length).toBe(2);
    expect(result.map((d) => d.path).sort()).toEqual(["list[1]", "list[2]"]);
  });

  it("type mismatches surface a single diff at the boundary", () => {
    const result = diff({ x: { a: 1 } }, { x: [1, 2] });
    expect(result.length).toBe(1);
    expect(result[0]?.path).toBe("x");
  });

  it("treats null on both sides as equal", () => {
    expect(diff({ x: null }, { x: null })).toEqual([]);
  });

  it("treats null vs object as a divergence at the parent path", () => {
    const result = diff({ x: null }, { x: { a: 1 } });
    expect(result.length).toBe(1);
    expect(result[0]?.path).toBe("x");
  });

  it("treats both sides undefined as equal", () => {
    expect(diff(undefined, undefined)).toEqual([]);
  });

  it("paths sort lexicographically", () => {
    const result = diff({ z: 1, a: 1, m: 1 }, { z: 2, a: 2, m: 2 });
    expect(result.map((d) => d.path)).toEqual(["a", "m", "z"]);
  });

  it("countLeaves: simple primitives", () => {
    expect(countLeaves(1)).toBe(1);
    expect(countLeaves("x")).toBe(1);
    expect(countLeaves(null)).toBe(1);
    expect(countLeaves(true)).toBe(1);
  });

  it("countLeaves: nested object + arrays", () => {
    expect(countLeaves({ a: 1, b: { c: 2, d: 3 } })).toBe(3);
    expect(countLeaves({ list: [1, 2, 3] })).toBe(3);
    expect(countLeaves({ a: [], b: {} })).toBe(2);
  });
});
