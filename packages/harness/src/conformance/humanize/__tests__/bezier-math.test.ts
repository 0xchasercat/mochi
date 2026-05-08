/**
 * Conformance — Bezier math (port of `test_humanize_unit.mjs §2`).
 *
 * Upstream tests record the points emitted by `humanMove(rawMouse, x0, y0,
 * x1, y1, cfg)` against a fake `rawMouse` whose `move(x, y)` pushes onto an
 * array. mochi's behavioral engine produces the same data via
 * `synthesizeMouseTrajectory(opts)` (PLAN.md §5.5 pure-data principle).
 *
 * Tests:
 *   1. `humanMove generates multiple points` — the trajectory has >=10 events
 *      and the last event lands within tolerance of the target.
 *   2. `humanMove smoothness (no large jumps)` — every consecutive pair has
 *      a Euclidean delta well below the total distance.
 *   3. `humanMove not a straight line` — the perpendicular deviation from
 *      the (from, to) line exceeds a threshold over multiple seeds.
 *   4. `clickTarget within bounding box` — repeated samples of the click
 *      point land inside the requested box. mochi exposes the click-point
 *      computation as part of `synthesizeMouseTrajectory({box})`.
 *
 * @see tasks/0150-humanize-conformance.md
 * @see PLAN.md §11.1
 */

import { describe, expect, it } from "bun:test";
import { synthesizeMouseTrajectory } from "@mochi.js/behavioral";
import { maxPerpDeviation, mochiBehaviorFor, pairwiseJumps } from "../helpers";

describe("humanize conformance — bezier math (offline)", () => {
  it("humanMove-equivalent: synthesizes >= 10 points and lands near target", () => {
    const profile = mochiBehaviorFor("default");
    const traj = synthesizeMouseTrajectory({
      from: { x: 0, y: 0 },
      to: { x: 500, y: 300 },
      profile,
      seed: "bezier-points",
      overshootProbability: 0,
    });
    expect(traj.length).toBeGreaterThanOrEqual(10);
    const last = traj[traj.length - 1];
    expect(last).toBeDefined();
    if (last) {
      // The synth anchors endpoints exactly (no jitter on first/last).
      expect(Math.abs(last.x - 500)).toBeLessThanOrEqual(1);
      expect(Math.abs(last.y - 300)).toBeLessThanOrEqual(1);
    }
  });

  it("humanMove-equivalent: smoothness — no large step relative to total", () => {
    const profile = mochiBehaviorFor("default");
    const from = { x: 0, y: 0 };
    const to = { x: 400, y: 400 };
    const traj = synthesizeMouseTrajectory({
      from,
      to,
      profile,
      seed: "bezier-smooth",
      overshootProbability: 0,
    });
    const total = Math.hypot(to.x - from.x, to.y - from.y);
    const maxJump = total * 0.5;
    const jumps = pairwiseJumps(traj);
    for (const j of jumps) {
      expect(j).toBeLessThanOrEqual(maxJump);
    }
  });

  it("humanMove-equivalent: trajectory bends off the straight line", () => {
    const profile = mochiBehaviorFor("default");
    const from = { x: 0, y: 0 };
    const to = { x: 500, y: 0 };
    let maxDev = 0;
    for (let trial = 0; trial < 5; trial++) {
      const traj = synthesizeMouseTrajectory({
        from,
        to,
        profile,
        seed: `bezier-bend-${trial}`,
        overshootProbability: 0,
      });
      const dev = maxPerpDeviation(traj, from, to);
      if (dev > maxDev) maxDev = dev;
    }
    expect(maxDev).toBeGreaterThan(0.5);
  });

  it("clickTarget-equivalent: synthesized end-point lands inside the box", () => {
    // Upstream's `clickTarget(box, false, cfg)` returns a target point inside
    // the box. mochi's `synthesizeMouseTrajectory({box})` samples the click
    // point internally and chains the trajectory to it; we read the final
    // event's (x, y) and assert it's in-box.
    const profile = mochiBehaviorFor("default");
    const box = { x: 100, y: 200, width: 150, height: 40 };
    for (let i = 0; i < 50; i++) {
      const traj = synthesizeMouseTrajectory({
        from: { x: 0, y: 0 },
        to: { x: 0, y: 0 }, // ignored when box is set
        box,
        profile,
        seed: `click-target-${i}`,
        overshootProbability: 0,
      });
      const last = traj[traj.length - 1];
      expect(last).toBeDefined();
      if (last) {
        expect(last.x).toBeGreaterThanOrEqual(box.x);
        expect(last.x).toBeLessThanOrEqual(box.x + box.width);
        expect(last.y).toBeGreaterThanOrEqual(box.y);
        expect(last.y).toBeLessThanOrEqual(box.y + box.height);
      }
    }
  });

  it("trajectory tMs is monotonic — paced cadence", () => {
    const profile = mochiBehaviorFor("default");
    const traj = synthesizeMouseTrajectory({
      from: { x: 0, y: 0 },
      to: { x: 600, y: 400 },
      profile,
      seed: "bezier-mono",
      overshootProbability: 0,
    });
    for (let i = 1; i < traj.length; i++) {
      const a = traj[i - 1];
      const b = traj[i];
      if (a && b) expect(b.tMs).toBeGreaterThanOrEqual(a.tMs);
    }
  });

  it("determinism: same (opts, seed) → byte-identical events", () => {
    const opts = {
      from: { x: 10, y: 20 },
      to: { x: 800, y: 600 },
      profile: mochiBehaviorFor("default"),
      seed: "determinism",
      overshootProbability: 0,
    };
    const a = synthesizeMouseTrajectory(opts);
    const b = synthesizeMouseTrajectory(opts);
    expect(a).toEqual(b);
  });
});
