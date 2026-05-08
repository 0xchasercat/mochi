/**
 * Smoke tests for the behavioral synthesizer surface.
 *
 * Asserts the package's public exports exist and produce well-formed events.
 * Distribution shape and determinism are tested in dedicated suites.
 */

import { describe, expect, it } from "bun:test";
import {
  synthesizeKeystrokes,
  synthesizeMouseTrajectory,
  synthesizeScroll,
  VERSION,
} from "../index";

describe("@mochi.js/behavioral surface", () => {
  it("exports VERSION", () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("synthesizeMouseTrajectory returns at least 2 events", () => {
    const events = synthesizeMouseTrajectory({
      from: { x: 0, y: 0 },
      to: { x: 100, y: 100 },
      seed: "smoke",
    });
    expect(events.length).toBeGreaterThanOrEqual(2);
    expect(events[0]?.x).toBe(0);
    expect(events[0]?.y).toBe(0);
  });

  it("synthesizeKeystrokes covers each character at least once", () => {
    const events = synthesizeKeystrokes({ text: "ab", seed: "smoke", mistakeRate: 0 });
    // Two key presses (one per char) when mistakeRate = 0.
    expect(events.length).toBe(2);
    expect(events[0]?.text).toBe("a");
    expect(events[1]?.text).toBe("b");
  });

  it("synthesizeScroll emits >0 frames for non-zero distance", () => {
    const events = synthesizeScroll({ from: 0, to: 500, seed: "smoke" });
    expect(events.length).toBeGreaterThan(0);
    let total = 0;
    for (const e of events) total += e.deltaY;
    expect(total).toBe(500);
  });

  it("synthesizeScroll returns empty for zero distance", () => {
    expect(synthesizeScroll({ from: 0, to: 0, seed: "smoke" })).toEqual([]);
  });
});
