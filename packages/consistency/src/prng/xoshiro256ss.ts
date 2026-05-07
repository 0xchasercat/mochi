/**
 * xoshiro256** — a fast, high-quality 64-bit PRNG by Blackman & Vigna.
 *
 * Reference: https://prng.di.unimi.it/xoshiro256starstar.c (public domain).
 *
 * The implementation uses BigInt to retain 64-bit semantics on Bun (where
 * Number precision tops out at 53 bits). Every step masks the working
 * registers back into the 64-bit envelope. The returned value of `nextU64`
 * is a positive `bigint` in `[0, 2^64)`.
 *
 * Determinism contract:
 *   - Construction with the same 4×u64 state ALWAYS yields the same sequence.
 *   - Two PRNGs whose states differ in any bit produce divergent sequences.
 *   - No globals are touched.
 *   - `Math.random` is NEVER called.
 *
 * @see PLAN.md §5.2 — "Seeded PRNG (deterministic; xoshiro256** with seed = sha256(profile.id + seed))"
 */

const U64_MASK = 0xffff_ffff_ffff_ffffn;

/** Rotate-left for u64. `bits` is assumed in [1, 63]. */
function rotl(x: bigint, bits: number): bigint {
  const b = BigInt(bits);
  return ((x << b) | (x >> (64n - b))) & U64_MASK;
}

/**
 * Public PRNG surface consumed by rules. Methods return primitive JS numbers
 * (or bigints where the full 64-bit range matters) and never expose state.
 */
export interface SeededPrng {
  /** Next raw u64 as a non-negative bigint. */
  nextU64(): bigint;
  /** Next u32 in `[0, 2^32)` as a number. */
  nextU32(): number;
  /** Next IEEE-754 double in `[0, 1)`, evenly distributed. */
  nextFloat01(): number;
  /** Inclusive integer in `[lo, hi]`. Throws if `lo > hi`. */
  nextIntInclusive(lo: number, hi: number): number;
  /** Pick one element of `arr`. Throws if `arr` is empty. */
  pick<T>(arr: readonly T[]): T;
  /** Hex string of `byteLength` bytes (so `byteLength*2` hex chars). */
  nextHex(byteLength: number): string;
}

/**
 * Construct a xoshiro256** PRNG from a 4×u64 state. At least one of the
 * four words must be non-zero (the all-zero seed is a fixed point of the
 * algorithm and produces a degenerate sequence).
 */
export function makeXoshiro256ss(state: readonly [bigint, bigint, bigint, bigint]): SeededPrng {
  let s0 = state[0] & U64_MASK;
  let s1 = state[1] & U64_MASK;
  let s2 = state[2] & U64_MASK;
  let s3 = state[3] & U64_MASK;

  if (s0 === 0n && s1 === 0n && s2 === 0n && s3 === 0n) {
    throw new Error("[mochi/consistency] xoshiro256** seed must not be all zero");
  }

  function nextU64(): bigint {
    // result = rotl(s1 * 5, 7) * 9
    const result = (rotl((s1 * 5n) & U64_MASK, 7) * 9n) & U64_MASK;
    const t = (s1 << 17n) & U64_MASK;
    s2 ^= s0;
    s3 ^= s1;
    s1 ^= s2;
    s0 ^= s3;
    s2 ^= t;
    s3 = rotl(s3, 45);
    return result;
  }

  function nextU32(): number {
    return Number(nextU64() >> 32n);
  }

  function nextFloat01(): number {
    // Standard xoshiro recipe: take the high 53 bits and divide by 2^53.
    const hi53 = nextU64() >> 11n;
    return Number(hi53) / 2 ** 53;
  }

  function nextIntInclusive(lo: number, hi: number): number {
    if (!Number.isInteger(lo) || !Number.isInteger(hi)) {
      throw new Error("[mochi/consistency] nextIntInclusive requires integer bounds");
    }
    if (lo > hi) {
      throw new Error(`[mochi/consistency] nextIntInclusive lo (${lo}) > hi (${hi})`);
    }
    const span = BigInt(hi - lo + 1);
    // Modulo bias on a 64-bit draw with span <= 2^53 is below the IEEE-754
    // resolution we ever observe; rules use this for small ranges.
    return lo + Number(nextU64() % span);
  }

  function pick<T>(arr: readonly T[]): T {
    if (arr.length === 0) {
      throw new Error("[mochi/consistency] pick: array is empty");
    }
    const idx = nextIntInclusive(0, arr.length - 1);
    // We just bounds-checked; non-null assert is safe.
    return arr[idx] as T;
  }

  function nextHex(byteLength: number): string {
    if (!Number.isInteger(byteLength) || byteLength <= 0) {
      throw new Error("[mochi/consistency] nextHex: byteLength must be a positive integer");
    }
    let out = "";
    let remaining = byteLength;
    while (remaining > 0) {
      const word = nextU64();
      // Each u64 yields 16 hex chars; we may trim the last word.
      const hex = word.toString(16).padStart(16, "0");
      const take = Math.min(remaining, 8) * 2;
      out += hex.slice(0, take);
      remaining -= 8;
    }
    return out;
  }

  return { nextU64, nextU32, nextFloat01, nextIntInclusive, pick, nextHex };
}
