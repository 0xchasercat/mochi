import { describe, expect, it } from "bun:test";
import {
  getProfile,
  hasProfile,
  KNOWN_PROFILE_IDS,
  ProfileBaselineMissingError,
  UnknownProfileIdError,
  VERSION,
} from "../index";

describe("@mochi.js/profiles", () => {
  it("exports VERSION", () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("declares the v1 profile catalog", () => {
    expect(KNOWN_PROFILE_IDS).toContain("mac-m2-chrome-stable");
    expect(KNOWN_PROFILE_IDS.length).toBeGreaterThanOrEqual(6);
  });

  it("getProfile loads a captured baseline (linux-chrome-stable)", async () => {
    const p = await getProfile("linux-chrome-stable");
    expect(p.id).toBe("linux-chrome-stable");
    expect(p.engine).toBe("chromium");
    // The captured Linux baseline pins Chrome 147 — guards against the
    // regression where launch.ts's placeholder shipped Chrome/131 to users.
    expect(p.browser.name).toBe("chrome");
    expect(Number.parseInt(p.browser.minVersion, 10)).toBeGreaterThanOrEqual(147);
    expect(p.os.name).toBe("linux");
    expect(p.userAgent).toMatch(/Chrome\/\d+/);
  });

  it("getProfile loads every captured baseline declared in PROFILES_WITH_CAPTURED_BASELINE", async () => {
    // Sanity: every id reported as having a baseline by hasProfile() must
    // also load via getProfile() without throwing.
    for (const id of KNOWN_PROFILE_IDS) {
      const has = await hasProfile(id);
      if (!has) continue;
      const p = await getProfile(id);
      expect(p.id).toBe(id);
    }
  });

  it("hasProfile returns true for ids with a captured baseline", async () => {
    expect(await hasProfile("linux-chrome-stable")).toBe(true);
    expect(await hasProfile("mac-m4-chrome-stable")).toBe(true);
  });

  it("hasProfile returns false for known ids without a captured baseline", async () => {
    expect(await hasProfile("mac-m2-chrome-stable")).toBe(false);
  });

  it("hasProfile returns false for unknown ids", async () => {
    expect(await hasProfile("not-a-real-profile-id")).toBe(false);
  });

  it("getProfile throws ProfileBaselineMissingError for known ids without a baseline", async () => {
    await expect(getProfile("mac-m2-chrome-stable")).rejects.toThrow(ProfileBaselineMissingError);
  });

  it("getProfile throws UnknownProfileIdError for ids outside the catalog", async () => {
    // Cast through unknown — callers using `as ProfileId` may slip past TS.
    await expect(getProfile("not-a-real-profile-id" as never)).rejects.toThrow(UnknownProfileIdError);
  });
});
