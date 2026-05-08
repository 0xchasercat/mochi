/**
 * `@mochi.js/consistency/prng` — public PRNG sub-export.
 *
 * Lifted from internal-only at v0.2.1 so downstream packages (in particular
 * `@mochi.js/behavioral`, phase 0.8) can share the seeded xoshiro256** without
 * re-implementing the algorithm or the seed-derivation contract.
 *
 * Determinism contract carried forward from `xoshiro256ss.ts`:
 *   - `seedToPrng(profileId, seed)` is a pure function of its arguments.
 *   - Two calls with the same `(profileId, seed)` produce identical PRNG
 *     sequences, byte-for-byte.
 *   - No globals, no `Math.random`. SHA-256 of `${profileId}:${seed}` keys
 *     the four-word xoshiro state.
 *
 * @see PLAN.md §5.2, §5.5
 */

export { deriveSeedState, seedToPrng } from "./seed";
export { makeXoshiro256ss, type SeededPrng } from "./xoshiro256ss";
