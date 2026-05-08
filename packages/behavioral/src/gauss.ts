/**
 * Box-Muller Gaussian sampling on top of an injected `SeededPrng`.
 *
 * The transform consumes two uniform `[0, 1)` draws and produces two N(0, 1)
 * draws. Cache the second so the second call to `gaussian()` is free.
 *
 * Determinism contract: same PRNG state in → same Gaussian sequence out. We
 * reject `u1 === 0` (the sole pathological input that yields `+Infinity`)
 * by sampling the next u1 instead — guaranteed to terminate in expectation
 * (probability of u1 === 0 is ≤ 2^-52 per draw on a uniform `[0, 1)` PRNG).
 *
 * Reference: G. E. P. Box, M. E. Muller, "A Note on the Generation of Random
 * Normal Deviates", Annals of Mathematical Statistics, 1958.
 */

import type { SeededPrng } from "./prng";

/**
 * Stateful Gaussian sampler. Construct once per synthesis call; pass to all
 * helpers that need normal noise. The `cached` member holds the second
 * Box-Muller output until consumed.
 */
export class GaussianSampler {
  private cached: number | null = null;
  private readonly prng: SeededPrng;

  constructor(prng: SeededPrng) {
    this.prng = prng;
  }

  /** Draw one N(mean, stdDev) sample. */
  next(mean = 0, stdDev = 1): number {
    if (this.cached !== null) {
      const z = this.cached;
      this.cached = null;
      return mean + stdDev * z;
    }
    let u1 = this.prng.nextFloat01();
    while (u1 === 0) u1 = this.prng.nextFloat01();
    const u2 = this.prng.nextFloat01();
    const r = Math.sqrt(-2 * Math.log(u1));
    const theta = 2 * Math.PI * u2;
    const z0 = r * Math.cos(theta);
    const z1 = r * Math.sin(theta);
    this.cached = z1;
    return mean + stdDev * z0;
  }

  /**
   * Draw a *clamped* Gaussian: same as `next` but truncates to `[lo, hi]`
   * by re-sampling. `tries` caps the loop so a pathologically narrow range
   * doesn't spin forever; on cap we return the clamped boundary.
   */
  nextClamped(mean: number, stdDev: number, lo: number, hi: number, tries = 16): number {
    for (let i = 0; i < tries; i++) {
      const v = this.next(mean, stdDev);
      if (v >= lo && v <= hi) return v;
    }
    // Pathological narrow range — return the nearest boundary.
    const fallback = this.next(mean, stdDev);
    return Math.min(hi, Math.max(lo, fallback));
  }
}

/**
 * Lognormal sample: `exp(N(mu, sigma))`. Used for keystroke inter-key delays
 * per PLAN.md §11.2 (digraph timing).
 */
export function lognormal(g: GaussianSampler, mu: number, sigma: number): number {
  return Math.exp(g.next(mu, sigma));
}
