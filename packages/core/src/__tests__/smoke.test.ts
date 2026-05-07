import { describe, expect, it } from "bun:test";
import { mochi, NotImplementedError, VERSION } from "../index";

describe("@mochi.js/core (claim release)", () => {
  it("exports a VERSION string", () => {
    expect(typeof VERSION).toBe("string");
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("exports a mochi namespace with launch", () => {
    expect(typeof mochi).toBe("object");
    expect(typeof mochi.launch).toBe("function");
    expect(mochi.version).toBe(VERSION);
  });

  it("mochi.launch throws NotImplementedError until phase 0.1", () => {
    expect(() => mochi.launch()).toThrow(NotImplementedError);
    expect(() => mochi.launch()).toThrow(/not yet implemented/);
  });
});
