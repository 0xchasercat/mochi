import { describe, expect, it } from "bun:test";
import { buildPayload, VERSION } from "../index";

describe("@mochi.js/inject (claim release)", () => {
  it("exports VERSION", () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("buildPayload throws until phase 0.3", () => {
    expect(() => buildPayload({})).toThrow(/not yet implemented/);
  });
});
