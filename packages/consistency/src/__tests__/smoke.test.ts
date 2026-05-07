import { describe, expect, it } from "bun:test";
import { deriveMatrix, VERSION } from "../index";

describe("@mochi.js/consistency (claim release)", () => {
  it("exports VERSION", () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("deriveMatrix throws until phase 0.2", () => {
    expect(() => deriveMatrix({ id: "x", version: "1" }, "seed")).toThrow(/not yet implemented/);
  });
});
