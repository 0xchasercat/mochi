/**
 * Fitts's Law movement-time model.
 *
 * `MT = a + b * log2(D / W + 1)` (Shannon formulation; more commonly cited and
 * better-behaved than the original Fitts 1954 form when D ≈ W). Per PLAN.md §11.1:
 *
 *   - `a = 200 ms` — per-profile reaction time intercept.
 *   - `b = 90 ms/bit` — per-profile motor speed slope.
 *
 * `D` is Euclidean pixel distance, `W` is the target's minimum dimension. We
 * floor `W` at 1px so a vanishingly small target doesn't blow MT to infinity
 * — that's the literature-cited mitigation (see MacKenzie 1992, "Fitts' law as
 * a research and design tool").
 *
 * The constants are within the conventional human-pointing literature range
 * (a ∈ [50, 250], b ∈ [50, 200]); 200/90 sits squarely in mid-range and
 * produces visible-but-snappy motion suitable for a default profile.
 */

/** Compute Fitts MT in milliseconds. */
export function fittsMT(distancePx: number, targetWidthPx: number, a = 200, b = 90): number {
  const D = Math.max(0, distancePx);
  const W = Math.max(1, targetWidthPx);
  // log2(D/W + 1) — the +1 is the Shannon form, which keeps MT >= a even
  // when D = 0 (no movement still costs reaction time).
  const id = Math.log2(D / W + 1);
  return a + b * id;
}
