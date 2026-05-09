/**
 * Seeded PRNG for the behavioral engine.
 *
 * Reuses the xoshiro256** PRNG and SHA-256 seed-derivation primitives owned by
 * `@mochi.js/consistency`. PLAN.md §5.5 mandates that the behavioral engine's
 * determinism share the same primitive — divergent PRNGs would mean two
 * different `(profile, seed)` deterministic universes, which is a footgun.
 *
 * This file is a thin wrapper. It does NOT introduce any new randomness or
 * re-implement xoshiro. Its only responsibility is the synth-side namespacing
 * convention: every behavioral synth call namespaces its seed under a stable
 * label (`mouse:`, `keys:`, `scroll:`) so that an end-user seed string of e.g.
 * `"session-42"` produces three independent PRNG streams (one per surface).
 *
 * Cross-package dependency: see `packages/behavioral/package.json` —
 * `@mochi.js/consistency: workspace:*`. This is the only consumer-side
 * dependency the behavioral package declares (PLAN.md §5.5 is otherwise
 * "imports: nothing"). Documented as a deliberate exception; the
 * alternative was duplicating the PRNG, which contradicts I-5
 * (relational consistency = single source of randomness).
 */

import { type SeededPrng, seedToPrng } from "@mochi.js/consistency/prng";

/** Namespace tag — keeps each surface's stream independent for the same seed. */
export type SeedNamespace = "mouse" | "keys" | "scroll";

/**
 * Build a `SeededPrng` for `(namespace, seed)`. When `seed` is undefined we
 * fall back to a stable per-namespace literal so that *unseeded* calls are
 * still deterministic within a single process — a non-deterministic stream is
 * the caller's responsibility to opt into by passing a fresh per-call seed.
 *
 * Determinism contract:
 *   - `prngFor(ns, "abc") === prngFor(ns, "abc")` byte-for-byte (modulo state
 *     advancement; the function returns a *new* PRNG every call).
 *   - `prngFor("mouse", "abc")` and `prngFor("keys", "abc")` produce
 *     **independent** sequences (different SHA-256 inputs → divergent state).
 *   - `prngFor(ns, undefined)` falls through to a literal default seed so
 *     test callers without a seed still get a reproducible stream.
 */
export function prngFor(namespace: SeedNamespace, seed: string | undefined): SeededPrng {
  // We use the namespace as the consistency engine's `profileId` slot and the
  // user-provided seed as the `seed` slot. SHA-256 mixes them in `seed.ts`.
  return seedToPrng(`mochi.behavioral:${namespace}`, seed ?? "default");
}

export type { SeededPrng };
