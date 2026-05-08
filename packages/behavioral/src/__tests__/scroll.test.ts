/**
 * Scroll unit tests:
 *   - monotonic delta direction (all same sign)
 *   - sum of deltaY equals to-from (after sign)
 *   - frame rate ~60fps
 *   - per-frame delta capped at ±100px
 */

import { describe, expect, it } from "bun:test";
import type { ScrollEvent } from "../index";
import { synthesizeScroll } from "../index";

function at(arr: readonly ScrollEvent[], i: number): ScrollEvent {
  const v = arr[i];
  if (v === undefined) throw new Error(`index ${i} out of range (${arr.length})`);
  return v;
}

describe("synthesizeScroll", () => {
  it("returns empty for zero distance", () => {
    expect(synthesizeScroll({ from: 100, to: 100, seed: "z" })).toEqual([]);
  });

  it("monotonic delta direction (down)", () => {
    const ev = synthesizeScroll({ from: 0, to: 800, seed: "down" });
    for (const e of ev) expect(e.deltaY).toBeGreaterThan(0);
  });

  it("monotonic delta direction (up)", () => {
    const ev = synthesizeScroll({ from: 800, to: 0, seed: "up" });
    for (const e of ev) expect(e.deltaY).toBeLessThan(0);
  });

  it("sum of deltaY equals to - from", () => {
    for (const target of [100, 500, 1500, -250, -800]) {
      const ev = synthesizeScroll({ from: 0, to: target, seed: `sum-${target}` });
      let total = 0;
      for (const e of ev) total += e.deltaY;
      expect(total).toBe(target);
    }
  });

  it("|deltaY| capped at 100 per frame", () => {
    const ev = synthesizeScroll({ from: 0, to: 5000, seed: "cap" });
    for (const e of ev) expect(Math.abs(e.deltaY)).toBeLessThanOrEqual(100);
  });

  it("inter-frame spacing ≈ 16.67 ms (60Hz)", () => {
    const ev = synthesizeScroll({ from: 0, to: 1000, seed: "rate" });
    expect(ev.length).toBeGreaterThan(2);
    // Skip the very last frame which may be a short residual.
    for (let i = 1; i < ev.length - 1; i++) {
      const dt = at(ev, i).tMs - at(ev, i - 1).tMs;
      expect(dt).toBeCloseTo(1000 / 60, 0);
    }
  });

  it('"stepped" profile emits notched 100px multiples (last frame may be residual)', () => {
    const ev = synthesizeScroll({
      from: 0,
      to: 1000,
      seed: "stepped",
      profile: { scrollStyle: "stepped" },
    });
    for (let i = 0; i < ev.length - 1; i++) {
      expect(Math.abs(at(ev, i).deltaY) % 100).toBe(0);
    }
  });
});
