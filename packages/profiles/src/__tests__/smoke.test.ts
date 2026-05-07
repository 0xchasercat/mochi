import { describe, expect, it } from "bun:test";
import { getProfile, KNOWN_PROFILE_IDS, VERSION } from "../index";

describe("@mochi.js/profiles (claim release)", () => {
  it("exports VERSION", () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("declares the v1 profile catalog", () => {
    expect(KNOWN_PROFILE_IDS).toContain("mac-m2-chrome-stable");
    expect(KNOWN_PROFILE_IDS.length).toBeGreaterThanOrEqual(6);
  });

  it("getProfile throws until phase 0.4", () => {
    expect(() => getProfile("mac-m2-chrome-stable")).toThrow(/not yet implemented/);
  });
});
