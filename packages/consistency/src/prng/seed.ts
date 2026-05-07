/**
 * Seed derivation for the consistency engine PRNG.
 *
 * Given a `(profile.id, seed)` pair we hash `${profile.id}:${seed}` with
 * SHA-256 (Bun.CryptoHasher) and slice the 32-byte digest into four
 * little-endian u64 words. Those four words form the xoshiro256** state.
 *
 * This guarantees:
 *   - Same input → same digest → same sequence (determinism).
 *   - Different `profile.id` produce isolated sequences even with the same
 *     `seed` (cross-profile isolation, PLAN.md I-5).
 *   - Different `seed` on the same profile produce divergent sequences
 *     (per-session entropy).
 *   - The vanishingly unlikely all-zero digest (probability ~ 2^-256) is
 *     handled by xoshiro construction, which throws.
 *
 * @see PLAN.md §5.2
 */

import { makeXoshiro256ss, type SeededPrng } from "./xoshiro256ss";

/** Read 8 little-endian bytes at `offset` as a `bigint` in `[0, 2^64)`. */
function readU64LE(buf: Uint8Array, offset: number): bigint {
  let value = 0n;
  for (let i = 7; i >= 0; i--) {
    const byte = buf[offset + i];
    if (byte === undefined) {
      throw new Error("[mochi/consistency] seed digest truncated");
    }
    value = (value << 8n) | BigInt(byte);
  }
  return value;
}

/**
 * Derive a 4×u64 xoshiro256** state from the SHA-256 digest of
 * `${profileId}:${seed}`. Exposed for tests; rules call `seedToPrng`.
 */
export function deriveSeedState(
  profileId: string,
  seed: string,
): readonly [bigint, bigint, bigint, bigint] {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(`${profileId}:${seed}`);
  const digest = new Uint8Array(hasher.digest().buffer);
  if (digest.length !== 32) {
    throw new Error(
      `[mochi/consistency] expected 32-byte SHA-256 digest, got ${digest.length} bytes`,
    );
  }
  return [
    readU64LE(digest, 0),
    readU64LE(digest, 8),
    readU64LE(digest, 16),
    readU64LE(digest, 24),
  ] as const;
}

/** Build a fresh `SeededPrng` for `(profileId, seed)`. */
export function seedToPrng(profileId: string, seed: string): SeededPrng {
  return makeXoshiro256ss(deriveSeedState(profileId, seed));
}
