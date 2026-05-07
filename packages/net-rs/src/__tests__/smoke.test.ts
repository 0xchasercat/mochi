import { describe, expect, it } from "bun:test";
import { available, VERSION } from "../index";

describe("@mochi.js/net-rs (claim release)", () => {
  it("exports VERSION", () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("available() returns false until phase 0.6", () => {
    expect(available()).toBe(false);
  });
});
