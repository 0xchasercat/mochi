/**
 * Inertial scroll synthesis — pure data, no CDP.
 *
 * Per PLAN.md §11.3:
 *
 *   - Initial velocity = (target distance / 0.5s)  [px/s].
 *   - Friction-decay exponentially with τ ≈ 350ms.
 *   - Per-frame deltaY capped at 100 px/frame (browsers throttle higher).
 *
 * Continuous model: v(t) = v0 * exp(-t/τ).
 * Total distance from t=0 to ∞ is v0 * τ. We pick v0 so that the time-budget
 * delivers the requested distance: solving `D = v0 * τ * (1 - exp(-T/τ))` for
 * v0 given target time-budget T (default 500 ms) yields a reasonable initial
 * flick. We then sample at 60Hz, integrate per-frame, clamp to ±100 px/frame,
 * and emit a frame whenever a non-zero rounded delta is produced.
 *
 * Sign handling: scroll up (negative deltaY) and scroll down (positive deltaY)
 * are symmetric; we work in absolute value and re-sign at output.
 *
 * `scrollStyle` profile parameter:
 *   - "smooth" / "inertial" → the main path described above.
 *   - "stepped" → every frame's deltaY is rounded toward the spec's nominal
 *     wheel-notch (100 px) — produces a pronouncedly chunky scroll
 *     appropriate for users with notched-wheel mice.
 *
 * Determinism contract: `(opts, seed)` → byte-identical event array.
 */

import { GaussianSampler } from "./gauss";
import { prngFor } from "./prng";
import { type BehaviorProfile, DEFAULT_BEHAVIOR_PROFILE, type ScrollEvent } from "./types";

/** Public options for `synthesizeScroll`. */
export interface ScrollOptions {
  /** Starting scroll position in CSS pixels. */
  readonly from: number;
  /** Target scroll position in CSS pixels. */
  readonly to: number;
  /**
   * Total time budget in ms. Defaults to 500ms (the spec's "flick" window);
   * the actual scroll usually completes within ~3τ ≈ 1050ms regardless of
   * this value because we sample until the integrated distance is reached.
   */
  readonly duration?: number;
  readonly profile?: Partial<BehaviorProfile>;
  readonly seed?: string;
}

const FRAME_RATE_HZ = 60;
const FRAME_DT_MS = 1000 / FRAME_RATE_HZ;
const MAX_DELTA_PER_FRAME = 100;
const TAU_MS = 350;
/** Hard cap on emitted frames so a pathological D doesn't loop forever. */
const MAX_FRAMES = 600;

/** Synthesize an inertial-scroll event sequence. */
export function synthesizeScroll(opts: ScrollOptions): ScrollEvent[] {
  const profile: BehaviorProfile = {
    ...DEFAULT_BEHAVIOR_PROFILE,
    ...(opts.profile ?? {}),
  };
  const prng = prngFor("scroll", opts.seed);
  const g = new GaussianSampler(prng);

  const totalDelta = opts.to - opts.from;
  const sign = totalDelta < 0 ? -1 : 1;
  const D = Math.abs(totalDelta);
  if (D === 0) return [];

  const T = Math.max(50, opts.duration ?? 500);
  // v0 from D = v0 * τ * (1 - exp(-T/τ)) → v0 = D / (τ * (1 - exp(-T/τ)))
  const decay = 1 - Math.exp(-T / TAU_MS);
  const v0 = D / (TAU_MS * Math.max(1e-6, decay)); // px / ms

  let acc = 0;
  let t = 0;
  const out: ScrollEvent[] = [];
  // Per-frame jitter (small Gaussian on velocity) so realized cadence isn't
  // a perfect exponential — humans flicking a scroll wheel never produce a
  // pure exponential.
  const jitterSigma = 0.05;
  while (acc < D && out.length < MAX_FRAMES) {
    // Average velocity over the frame:
    //   v_avg = v0 * (exp(-t/τ) - exp(-(t+dt)/τ)) * τ / dt
    const e0 = Math.exp(-t / TAU_MS);
    const e1 = Math.exp(-(t + FRAME_DT_MS) / TAU_MS);
    let dx = v0 * TAU_MS * (e0 - e1);
    // Multiplicative jitter — never negative.
    const jitter = 1 + g.nextClamped(0, jitterSigma, -3 * jitterSigma, 3 * jitterSigma);
    dx *= Math.max(0.1, jitter);
    // Don't overshoot.
    if (acc + dx > D) dx = D - acc;
    // Cap per-frame delta.
    if (dx > MAX_DELTA_PER_FRAME) dx = MAX_DELTA_PER_FRAME;

    let frameDelta: number;
    if (profile.scrollStyle === "stepped") {
      // Round to the nearest 100px wheel-notch; minimum one notch if any
      // velocity remains.
      const notch = Math.max(1, Math.round(dx / 100)) * 100;
      frameDelta = Math.min(notch, D - acc);
    } else {
      frameDelta = Math.round(dx);
    }
    if (frameDelta <= 0) {
      // Velocity has decayed below 1 px/frame. Emit the residual as one
      // final frame (or two if it exceeds the cap) and stop.
      const residual = D - acc;
      if (residual <= 0) break;
      if (residual <= MAX_DELTA_PER_FRAME) {
        out.push({ tMs: t, deltaY: sign * residual });
        acc = D;
      } else {
        // Should not happen given v0 derivation, but guard anyway.
        out.push({ tMs: t, deltaY: sign * MAX_DELTA_PER_FRAME });
        acc += MAX_DELTA_PER_FRAME;
      }
      break;
    }
    out.push({ tMs: t, deltaY: sign * frameDelta });
    acc += frameDelta;
    t += FRAME_DT_MS;
  }
  return out;
}
