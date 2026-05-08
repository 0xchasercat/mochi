/**
 * Mouse trajectory synthesis — pure data, no CDP.
 *
 * Algorithm (PLAN.md §11.1):
 *
 *   1. P0 = `from`. P3 = `to`, optionally re-sampled inside `box` with a
 *      Gaussian-toward-center bias.
 *   2. P1, P2 lie at 0.3..0.5 of |P3 - P0| along the segment, perpendicularly
 *      offset by `tremor * |P3 - P0|`. Sign of the perpendicular offset is
 *      randomized so curves bend either way.
 *   3. With probability 0.10 (range 0.05–0.15), the *first* sub-curve aims
 *      past the target by 1.05–1.15 × D, then a corrective sub-curve runs
 *      from the overshoot point back to the actual target.
 *   4. Sample N points where N = ceil(MT * 60) (60 events/sec).
 *   5. Each sample is jittered by autocorrelated Gaussian noise with τ ≈ 30ms.
 *
 * Determinism contract: `(opts, seed)` → byte-identical event array.
 */

import { dist, perpendicularUnit, sampleCubicBezier } from "./bezier";
import { fittsMT } from "./fitts";
import { GaussianSampler } from "./gauss";
import { prngFor } from "./prng";
import {
  type BehaviorProfile,
  type Box,
  DEFAULT_BEHAVIOR_PROFILE,
  type Point,
  type TrajectoryEvent,
} from "./types";

/** Public options for `synthesizeMouseTrajectory`. */
export interface MouseTrajectoryOptions {
  /** Cursor start position. */
  readonly from: Point;
  /**
   * Target point. If `box` is also supplied, `to` is ignored and the click
   * point is sampled inside the box (Gaussian toward center).
   */
  readonly to: Point;
  /** Optional bounding box of the target element. */
  readonly box?: Box;
  /** Behavioral profile parameters; merged onto {@link DEFAULT_BEHAVIOR_PROFILE}. */
  readonly profile?: Partial<BehaviorProfile>;
  /**
   * Optional Fitts coefficients override. `a` is reaction-time intercept (ms),
   * `b` is motor-speed slope (ms/bit). PLAN.md §11.1 default: 200 / 90.
   */
  readonly fitts?: { a?: number; b?: number };
  /**
   * Override movement duration in ms. When set, bypasses the Fitts model.
   * The dispatch layer uses this when the user passes `duration` to
   * `humanClick`.
   */
  readonly durationMs?: number;
  /**
   * Override the overshoot probability (0..1). Default 0.10.
   * Setting to 0 disables overshoot deterministically.
   */
  readonly overshootProbability?: number;
  /** Deterministic seed; same `(opts, seed)` → byte-identical output. */
  readonly seed?: string;
}

/**
 * Synthesize a cubic-Bezier mouse trajectory from `from` to `to` (or into
 * `box`). Returns a time-ordered array of `{tMs, x, y}` events at ~60Hz.
 *
 * Pure function — no CDP, no timers, no globals.
 */
export function synthesizeMouseTrajectory(opts: MouseTrajectoryOptions): TrajectoryEvent[] {
  const profile: BehaviorProfile = {
    ...DEFAULT_BEHAVIOR_PROFILE,
    ...(opts.profile ?? {}),
  };
  const prng = prngFor("mouse", opts.seed);
  const g = new GaussianSampler(prng);

  // Pick the actual click point: inside box (if given) with Gaussian toward
  // center, else `to`.
  const target: Point = opts.box !== undefined ? sampleInsideBox(opts.box, g) : opts.to;
  const D = dist(opts.from, target);
  const W = opts.box !== undefined ? Math.max(1, Math.min(opts.box.width, opts.box.height)) : 1;

  const a = opts.fitts?.a ?? 200;
  const b = opts.fitts?.b ?? 90;
  const totalMs = opts.durationMs ?? fittsMT(D, W, a, b);

  // Overshoot decision: 10% by default, range 0.05-0.15 in the spec.
  const overshootP = clamp01(opts.overshootProbability ?? 0.1);
  const willOvershoot = D > 0 && prng.nextFloat01() < overshootP;

  if (!willOvershoot) {
    return synthSingleCurve(opts.from, target, totalMs, profile, prng, g, 0);
  }

  // Overshoot path: aim past the target by 1.05-1.15 × D, then correct.
  const overshootFactor = 1.05 + prng.nextFloat01() * 0.1;
  const ux = (target.x - opts.from.x) / Math.max(1e-9, D);
  const uy = (target.y - opts.from.y) / Math.max(1e-9, D);
  const overshootPoint: Point = {
    x: opts.from.x + ux * D * overshootFactor,
    y: opts.from.y + uy * D * overshootFactor,
  };
  // Split the time budget: 75% to the over-curve, 25% to the corrective curve.
  const overMs = totalMs * 0.75;
  const correctMs = totalMs - overMs;
  const first = synthSingleCurve(opts.from, overshootPoint, overMs, profile, prng, g, 0);
  // Drop the first event of the second curve to avoid duplicating overshoot.
  const second = synthSingleCurve(overshootPoint, target, correctMs, profile, prng, g, overMs);
  if (second.length === 0) return first;
  return [...first, ...second.slice(1)];
}

/**
 * Sample one cubic Bezier sub-curve and convert to time-stamped events.
 * `tOffsetMs` lets the caller chain sub-curves (overshoot+correction).
 */
function synthSingleCurve(
  from: Point,
  to: Point,
  durationMs: number,
  profile: BehaviorProfile,
  prng: import("./prng").SeededPrng,
  g: GaussianSampler,
  tOffsetMs: number,
): TrajectoryEvent[] {
  const D = dist(from, to);
  // Place P1, P2 at ~0.3 / ~0.7 along the segment with perpendicular bend.
  const t1 = 0.3;
  const t2 = 0.7;
  // Magnitude of perpendicular offset: 0.3-0.5 × D × tremor-ish factor. We
  // keep the off-axis magnitude bounded so trajectories don't loop back.
  // The spec says "magnitude ~0.3-0.5 of D"; we sample inside that range.
  const mag = D * (0.3 + prng.nextFloat01() * 0.2);
  // Sign of perpendicular: random ±1.
  const sign = prng.nextFloat01() < 0.5 ? -1 : 1;
  // Hand bias: right-handed users tend to bend trajectories slightly clockwise
  // (positive perpendicular when moving right-to-left); left-handed reverse.
  // This is a documented choice (§11.1 doesn't strictly mandate it but the
  // hand parameter exists; we use it as a +/- prior on the bend direction).
  const handBias = profile.hand === "right" ? 1 : -1;
  const perp = perpendicularUnit(from, to);
  const bendMag = mag * profile.tremor * handBias * sign;
  const p1: Point = {
    x: from.x + (to.x - from.x) * t1 + perp.x * bendMag,
    y: from.y + (to.y - from.y) * t1 + perp.y * bendMag,
  };
  const p2: Point = {
    x: from.x + (to.x - from.x) * t2 + perp.x * bendMag * 0.6,
    y: from.y + (to.y - from.y) * t2 + perp.y * bendMag * 0.6,
  };

  // Sample at 60 events/sec.
  const n = Math.max(2, Math.ceil((durationMs / 1000) * 60));
  const samples = sampleCubicBezier(n, from, p1, p2, to);

  // Autocorrelated jitter: AR(1) per axis with α derived from τ ≈ 30ms and
  // dt ≈ durationMs/(n-1). α = exp(-dt/τ).
  const dt = durationMs / Math.max(1, n - 1);
  const alpha = Math.exp(-dt / 30);
  // Jitter σ scales with tremor and "pixel size" ≈ 1.0 (we work in CSS px).
  const sigma = profile.tremor * 1.0;

  let jx = 0;
  let jy = 0;
  const out = new Array<TrajectoryEvent>(n);
  for (let i = 0; i < n; i++) {
    const epsx = g.next(0, sigma);
    const epsy = g.next(0, sigma);
    jx = alpha * jx + Math.sqrt(1 - alpha * alpha) * epsx;
    jy = alpha * jy + Math.sqrt(1 - alpha * alpha) * epsy;
    // Anchor the endpoints exactly to avoid sub-pixel drift on press/release.
    const isEndpoint = i === 0 || i === n - 1;
    const sample = samples[i] as Point;
    const x = isEndpoint ? sample.x : sample.x + jx;
    const y = isEndpoint ? sample.y : sample.y + jy;
    out[i] = {
      tMs: tOffsetMs + (i / Math.max(1, n - 1)) * durationMs,
      x,
      y,
    };
  }
  return out;
}

/**
 * Sample a click point inside `box` using a truncated 2D Gaussian centered
 * on the box midpoint. σ = box dimension / 4 (so 95% of samples land in the
 * inner half of the box). Falls back to the center on degenerate boxes.
 */
function sampleInsideBox(box: Box, g: GaussianSampler): Point {
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  if (box.width <= 0 || box.height <= 0) return { x: cx, y: cy };
  const sx = box.width / 4;
  const sy = box.height / 4;
  const x = g.nextClamped(cx, sx, box.x + 0.5, box.x + box.width - 0.5);
  const y = g.nextClamped(cy, sy, box.y + 0.5, box.y + box.height - 0.5);
  return { x, y };
}

function clamp01(v: number): number {
  if (Number.isNaN(v)) return 0;
  return Math.min(1, Math.max(0, v));
}
