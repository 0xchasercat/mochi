import { describe, expect, it } from "bun:test";
import { diff, VERSION } from "../index";

describe("@mochi.js/harness (claim release)", () => {
  it("exports VERSION", () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("diff rejects until phase 0.5", async () => {
    await expect(diff({ profile: "mac-m2-chrome-stable", manifest: {} })).rejects.toThrow(
      /not yet implemented/,
    );
  });
});
