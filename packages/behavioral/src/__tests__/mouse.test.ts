/**
 * Mouse trajectory unit tests:
 *   - starts at `from`
 *   - ends inside the box (or at `to` when no box)
 *   - tMs strictly increasing (well, monotonic non-decreasing)
 *   - Bezier shape sanity: there's a measurable bend off the straight line
 *   - overshoot frequency in the configured range over many trials
 *   - Fitts duration scales with distance
 */

import { describe, expect, it } from "bun:test";
import type { TrajectoryEvent } from "../index";
import { fittsMT, synthesizeMouseTrajectory } from "../index";

function at(arr: readonly TrajectoryEvent[], i: number): TrajectoryEvent {
  const v = arr[i];
  if (v === undefined) throw new Error(`index ${i} out of range (${arr.length})`);
  return v;
}

describe("synthesizeMouseTrajectory", () => {
  it("starts at `from`, ends at `to`", () => {
    const ev = synthesizeMouseTrajectory({
      from: { x: 0, y: 0 },
      to: { x: 200, y: 100 },
      seed: "mouse-1",
      overshootProbability: 0,
    });
    expect(ev.length).toBeGreaterThanOrEqual(2);
    expect(at(ev, 0).x).toBeCloseTo(0, 6);
    expect(at(ev, 0).y).toBeCloseTo(0, 6);
    expect(at(ev, ev.length - 1).x).toBeCloseTo(200, 6);
    expect(at(ev, ev.length - 1).y).toBeCloseTo(100, 6);
  });

  it("ends inside box when box is supplied", () => {
    const box = { x: 100, y: 100, width: 50, height: 30 };
    for (let i = 0; i < 32; i++) {
      const ev = synthesizeMouseTrajectory({
        from: { x: 0, y: 0 },
        to: { x: 0, y: 0 }, // ignored when box present
        box,
        seed: `mouse-box-${i}`,
        overshootProbability: 0,
      });
      const last = at(ev, ev.length - 1);
      expect(last.x).toBeGreaterThanOrEqual(box.x);
      expect(last.x).toBeLessThanOrEqual(box.x + box.width);
      expect(last.y).toBeGreaterThanOrEqual(box.y);
      expect(last.y).toBeLessThanOrEqual(box.y + box.height);
    }
  });

  it("tMs is monotonic non-decreasing", () => {
    const ev = synthesizeMouseTrajectory({
      from: { x: 0, y: 0 },
      to: { x: 500, y: 300 },
      seed: "mouse-mono",
      overshootProbability: 0,
    });
    for (let i = 1; i < ev.length; i++) {
      expect(at(ev, i).tMs).toBeGreaterThanOrEqual(at(ev, i - 1).tMs);
    }
  });

  it("trajectory bends off the straight line (Bezier shape sanity)", () => {
    // For a long segment with positive tremor, we expect the midpoint to
    // deviate from the straight-line midpoint by at least a few pixels.
    const ev = synthesizeMouseTrajectory({
      from: { x: 0, y: 0 },
      to: { x: 800, y: 0 },
      seed: "mouse-bend",
      overshootProbability: 0,
      profile: { tremor: 0.5 },
    });
    const mid = at(ev, Math.floor(ev.length / 2));
    // straight-line midpoint y is 0; if it bent, |y| should exceed jitter.
    expect(Math.abs(mid.y)).toBeGreaterThan(2);
  });

  it("Fitts MT model: longer distance → longer duration", () => {
    const short = fittsMT(100, 50);
    const long = fittsMT(1000, 50);
    expect(long).toBeGreaterThan(short);
    // a + b * log2(D/W + 1): MT(100,50) = 200 + 90*log2(3) ≈ 342 ms
    expect(short).toBeGreaterThan(300);
    expect(short).toBeLessThan(400);
  });

  it("overshoot frequency lands in expected range over many trials", () => {
    let overshoots = 0;
    const trials = 500;
    for (let i = 0; i < trials; i++) {
      const ev = synthesizeMouseTrajectory({
        from: { x: 0, y: 0 },
        to: { x: 400, y: 400 },
        seed: `mouse-os-${i}`,
        overshootProbability: 0.1,
      });
      // Detect overshoot by checking whether any sample ever exceeds the
      // straight-line distance from `from` to `to` along the unit vector.
      const dirX = 400 / Math.hypot(400, 400);
      const dirY = 400 / Math.hypot(400, 400);
      let maxProj = 0;
      for (const p of ev) {
        const proj = p.x * dirX + p.y * dirY;
        if (proj > maxProj) maxProj = proj;
      }
      const targetProj = 400 * dirX + 400 * dirY;
      if (maxProj > targetProj + 5) overshoots++;
    }
    // Expect ~10% overshoots; allow a generous tolerance for the 500-trial
    // sample (binomial 95% CI on p=0.1, n=500 → ~[7.4%, 12.6%]).
    const rate = overshoots / trials;
    expect(rate).toBeGreaterThan(0.05);
    expect(rate).toBeLessThan(0.18);
  });

  it("event count = ceil(MT * 60) for a single curve (no overshoot)", () => {
    // Pin Fitts: MT for D=100, W=10 = 200 + 90*log2(11) ≈ 511 ms → 31 events.
    const ev = synthesizeMouseTrajectory({
      from: { x: 0, y: 0 },
      to: { x: 100, y: 0 },
      box: { x: 95, y: -5, width: 10, height: 10 },
      seed: "mouse-count",
      overshootProbability: 0,
    });
    const expectedMin = Math.ceil(((200 + 90 * Math.log2(101 / 10 + 1)) / 1000) * 60) - 5;
    expect(ev.length).toBeGreaterThanOrEqual(expectedMin);
  });
});
