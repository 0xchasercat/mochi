/**
 * Cubic Bezier sampling helpers. Closed-form rather than De Casteljau —
 * `B(t) = (1-t)^3 P0 + 3(1-t)^2 t P1 + 3(1-t) t^2 P2 + t^3 P3` is simpler
 * and equally numerically stable for our small N (~40–100 samples).
 *
 * @see PLAN.md §11.1
 */

import type { Point } from "./types";

/** Evaluate one cubic Bezier point at parameter `t` in [0, 1]. */
export function cubicBezier(t: number, p0: Point, p1: Point, p2: Point, p3: Point): Point {
  const u = 1 - t;
  const tt = t * t;
  const uu = u * u;
  const uuu = uu * u;
  const ttt = tt * t;
  const w0 = uuu;
  const w1 = 3 * uu * t;
  const w2 = 3 * u * tt;
  const w3 = ttt;
  return {
    x: w0 * p0.x + w1 * p1.x + w2 * p2.x + w3 * p3.x,
    y: w0 * p0.y + w1 * p1.y + w2 * p2.y + w3 * p3.y,
  };
}

/**
 * Sample N evenly-spaced points along a cubic Bezier. The first point is at
 * `t=0` (= P0) and the last at `t=1` (= P3). Used by the trajectory
 * synthesizer; jitter and event-time interpolation are layered on top.
 */
export function sampleCubicBezier(n: number, p0: Point, p1: Point, p2: Point, p3: Point): Point[] {
  if (n < 2) {
    throw new Error("[mochi/behavioral] sampleCubicBezier: n must be >= 2");
  }
  const out: Point[] = new Array<Point>(n);
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    out[i] = cubicBezier(t, p0, p1, p2, p3);
  }
  return out;
}

/**
 * Compute a perpendicular unit vector to (b - a). Returns `(0, 1)` for
 * a degenerate (zero-length) segment to keep the trajectory well-defined.
 */
export function perpendicularUnit(a: Point, b: Point): Point {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len === 0) return { x: 0, y: 1 };
  // Rotate (dx, dy) by 90 degrees CCW: (-dy, dx). Normalize.
  return { x: -dy / len, y: dx / len };
}

/** Euclidean distance. */
export function dist(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}
