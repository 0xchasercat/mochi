/**
 * Conformance — keystroke timing distribution.
 *
 * Upstream (`test_humanize_unit.mjs`) doesn't break out a dedicated keystroke
 * unit; instead it asserts on *realized* timing of `page.locator(sel).fill()`
 * inside an E2E flow ("fill() timing is humanized (>1s)"). The timing comes
 * from CloakBrowser's `typing_delay` config consumed by the dispatch layer.
 *
 * mochi's `synthesizeKeystrokes` is pure data and deterministic per (opts,
 * seed). The conformance bar is the same one CloakBrowser implicitly tests:
 *
 *   1. Realized total time for a non-trivial string is >1s under the
 *      default WPM (60 wpm → ≈200ms inter-key → 11 chars × ~200ms ≈ 2.2s).
 *   2. Inter-key delays are strictly positive AND not constant (variance
 *      bounded away from zero — paces vary).
 *   3. Mistake injection produces a corrective Backspace pair when invoked
 *      with `mistakeRate: 1` (force-mistake every char) and never when
 *      `mistakeRate: 0`.
 *   4. `wpm` parameter scales the realized mean inter-key delay (higher WPM
 *      → lower mean delay).
 *
 * @see PLAN.md §11.2
 */

import { describe, expect, it } from "bun:test";
import { synthesizeKeystrokes } from "@mochi.js/behavioral";
import { mochiBehaviorFor } from "../helpers";

describe("humanize conformance — keystroke timing (offline)", () => {
  it("non-trivial string takes > 1s at default profile WPM", () => {
    const profile = mochiBehaviorFor("default");
    const events = synthesizeKeystrokes({
      text: "Human speed test",
      profile,
      seed: "keys-1s",
      mistakeRate: 0,
    });
    expect(events.length).toBe("Human speed test".length);
    const last = events[events.length - 1];
    expect(last).toBeDefined();
    if (last) {
      // Default profile is 65 wpm. 16 chars * 60_000/(65*5) ≈ 16 * 184ms = 2952ms.
      // Allow a generous lower bound (1s) — the lognormal can dip on short tails.
      expect(last.tUpMs).toBeGreaterThan(1000);
    }
  });

  it("inter-key delays are strictly positive AND non-constant", () => {
    const events = synthesizeKeystrokes({
      text: "abcdefghijklmnop",
      seed: "keys-variance",
      mistakeRate: 0,
    });
    expect(events.length).toBeGreaterThanOrEqual(8);
    const deltas: number[] = [];
    for (let i = 1; i < events.length; i++) {
      const a = events[i - 1];
      const b = events[i];
      if (a && b) deltas.push(b.tDownMs - a.tDownMs);
    }
    expect(deltas.length).toBeGreaterThan(4);
    // All positive.
    for (const d of deltas) expect(d).toBeGreaterThan(0);
    // Not constant: stdev > 0.
    const mean = deltas.reduce((acc, x) => acc + x, 0) / deltas.length;
    const variance = deltas.reduce((acc, x) => acc + (x - mean) * (x - mean), 0) / deltas.length;
    expect(variance).toBeGreaterThan(0);
  });

  it("mistake injection produces a Backspace correction pair", () => {
    // Force a mistake on every char. The synth output for an N-char string
    // becomes ~3N events: (wrong, backspace, correct) per char (when
    // adjacency lookup succeeds; punctuation/digits with no adjacency map
    // are typed cleanly).
    const events = synthesizeKeystrokes({
      text: "abcdef",
      seed: "keys-mistakes",
      mistakeRate: 1,
    });
    const mistakes = events.filter((e) => e.mistake);
    const corrections = events.filter((e) => e.correction);
    expect(mistakes.length).toBeGreaterThan(0);
    expect(corrections.length).toBe(mistakes.length);
    // A correction is always followed in time by another keystroke (the
    // intended char).
    for (const corr of corrections) {
      const followers = events.filter((e) => e.tDownMs > corr.tUpMs && !e.mistake && !e.correction);
      expect(followers.length).toBeGreaterThan(0);
    }
  });

  it("zero mistake rate produces no mistake/correction events", () => {
    const events = synthesizeKeystrokes({
      text: "abcdef",
      seed: "keys-no-mistakes",
      mistakeRate: 0,
    });
    expect(events.every((e) => !e.mistake && !e.correction)).toBe(true);
  });

  it("higher WPM produces lower mean inter-key delay", () => {
    const text = "the quick brown fox jumps";
    const slow = synthesizeKeystrokes({
      text,
      profile: { wpm: 30 },
      seed: "keys-wpm-slow",
      mistakeRate: 0,
    });
    const fast = synthesizeKeystrokes({
      text,
      profile: { wpm: 120 },
      seed: "keys-wpm-fast",
      mistakeRate: 0,
    });

    function meanDelta(evs: typeof slow): number {
      const ds: number[] = [];
      for (let i = 1; i < evs.length; i++) {
        const a = evs[i - 1];
        const b = evs[i];
        if (a && b) ds.push(b.tDownMs - a.tDownMs);
      }
      return ds.reduce((acc, x) => acc + x, 0) / Math.max(1, ds.length);
    }

    const slowMean = meanDelta(slow);
    const fastMean = meanDelta(fast);
    expect(fastMean).toBeLessThan(slowMean);
  });

  it("determinism: same (opts, seed) → byte-identical events", () => {
    const opts = {
      text: "deterministic typing",
      seed: "keys-determinism",
      mistakeRate: 0.02,
    };
    const a = synthesizeKeystrokes(opts);
    const b = synthesizeKeystrokes(opts);
    expect(a).toEqual(b);
  });
});
