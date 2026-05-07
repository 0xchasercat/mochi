/**
 * Unit tests for the dotted-path helpers used by the rule runner.
 */
import { describe, expect, it } from "bun:test";
import { type DeepRecord, getByPath, isValidPath, setByPath } from "../path";

describe("dotted-path helpers", () => {
  it("getByPath retrieves nested values", () => {
    const obj: DeepRecord = { a: { b: { c: 42 } } };
    expect(getByPath(obj, "a.b.c")).toBe(42);
    expect(getByPath(obj, "a.b")).toEqual({ c: 42 });
    expect(getByPath(obj, "a.x")).toBeUndefined();
  });

  it("getByPath returns undefined for empty path", () => {
    const obj: DeepRecord = { a: 1 };
    expect(getByPath(obj, "")).toBeUndefined();
  });

  it("setByPath writes nested values, creating intermediates", () => {
    const obj: DeepRecord = {};
    setByPath(obj, "a.b.c", 7);
    expect(obj).toEqual({ a: { b: { c: 7 } } });
  });

  it("setByPath overwrites an existing leaf", () => {
    const obj: DeepRecord = { a: { b: 1 } };
    setByPath(obj, "a.b", 99);
    expect(obj.a).toEqual({ b: 99 });
  });

  it("setByPath throws when attempting to descend through a primitive", () => {
    const obj: DeepRecord = { a: "leaf" };
    expect(() => setByPath(obj, "a.b", 1)).toThrow();
  });

  it("setByPath throws on empty path", () => {
    const obj: DeepRecord = {};
    expect(() => setByPath(obj, "", 1)).toThrow();
  });

  it("isValidPath accepts well-formed paths and rejects malformed ones", () => {
    expect(isValidPath("a")).toBe(true);
    expect(isValidPath("a.b.c")).toBe(true);
    expect(isValidPath("a.b-c")).toBe(true);
    expect(isValidPath("a.b_c")).toBe(true);
    expect(isValidPath("")).toBe(false);
    expect(isValidPath("a..b")).toBe(false);
    expect(isValidPath("a.b.")).toBe(false);
    expect(isValidPath("a.b!c")).toBe(false);
  });
});
