import { describe, expect, it } from "bun:test";
import { synthesizeMouseTrajectory, VERSION } from "../index";

describe("@mochi.js/behavioral (claim release)", () => {
  it("exports VERSION", () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("synthesizeMouseTrajectory throws until phase 0.8", () => {
    expect(() => synthesizeMouseTrajectory({ x: 0, y: 0 }, { x: 100, y: 100 })).toThrow(
      /not yet implemented/,
    );
  });
});
