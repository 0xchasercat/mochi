import { describe, expect, it } from "bun:test";
import { fetch as mochiFetch, VERSION } from "../index";

describe("@mochi.js/net (claim release)", () => {
  it("exports VERSION", () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("fetch rejects until phase 0.6", async () => {
    await expect(mochiFetch("https://example.com")).rejects.toThrow(/not yet implemented/);
  });
});
