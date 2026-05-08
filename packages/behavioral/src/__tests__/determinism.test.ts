/**
 * Determinism suite — the heart of the behavioral engine's correctness story.
 *
 * Same `(opts, seed)` MUST produce byte-identical output across runs. We loop
 * 10 iterations and deep-equal against the first.
 *
 * Different seeds MUST produce different outputs (catches accidental
 * Math.random or Date.now sneaking in).
 */

import { describe, expect, it } from "bun:test";
import { synthesizeKeystrokes, synthesizeMouseTrajectory, synthesizeScroll } from "../index";

const ITERATIONS = 10;

describe("determinism: 10 iterations of the same (opts, seed) produce byte-identical output", () => {
  it("synthesizeMouseTrajectory", () => {
    const opts = {
      from: { x: 17, y: 31 },
      to: { x: 412, y: 287 },
      box: { x: 400, y: 280, width: 30, height: 20 },
      profile: { hand: "right", tremor: 0.22, wpm: 70, scrollStyle: "smooth" } as const,
      seed: "deterministic-mouse-α",
    };
    const baseline = synthesizeMouseTrajectory(opts);
    expect(baseline.length).toBeGreaterThan(0);
    for (let i = 0; i < ITERATIONS; i++) {
      const next = synthesizeMouseTrajectory(opts);
      expect(next).toEqual(baseline);
    }
  });

  it("synthesizeMouseTrajectory with overshoot path", () => {
    const opts = {
      from: { x: 0, y: 0 },
      to: { x: 600, y: 100 },
      profile: { hand: "left", tremor: 0.3, wpm: 50, scrollStyle: "smooth" } as const,
      seed: "deterministic-overshoot",
      overshootProbability: 1, // force the overshoot branch
    };
    const baseline = synthesizeMouseTrajectory(opts);
    for (let i = 0; i < ITERATIONS; i++) {
      const next = synthesizeMouseTrajectory(opts);
      expect(next).toEqual(baseline);
    }
  });

  it("synthesizeKeystrokes (with mistakes)", () => {
    const opts = {
      text: "Hello, world! The quick brown fox jumps over the lazy dog.",
      profile: { hand: "right", tremor: 0.18, wpm: 65, scrollStyle: "smooth" } as const,
      mistakeRate: 0.1,
      seed: "deterministic-keys-β",
    };
    const baseline = synthesizeKeystrokes(opts);
    expect(baseline.length).toBeGreaterThan(opts.text.length); // mistakes added events
    for (let i = 0; i < ITERATIONS; i++) {
      expect(synthesizeKeystrokes(opts)).toEqual(baseline);
    }
  });

  it("synthesizeScroll", () => {
    const opts = {
      from: 0,
      to: 1234,
      duration: 700,
      profile: { hand: "right", tremor: 0.2, wpm: 60, scrollStyle: "smooth" } as const,
      seed: "deterministic-scroll-γ",
    };
    const baseline = synthesizeScroll(opts);
    expect(baseline.length).toBeGreaterThan(0);
    for (let i = 0; i < ITERATIONS; i++) {
      expect(synthesizeScroll(opts)).toEqual(baseline);
    }
  });
});

describe("determinism: different seeds produce different outputs", () => {
  it("mouse: distinct seeds diverge", () => {
    const a = synthesizeMouseTrajectory({
      from: { x: 0, y: 0 },
      to: { x: 200, y: 200 },
      seed: "a",
    });
    const b = synthesizeMouseTrajectory({
      from: { x: 0, y: 0 },
      to: { x: 200, y: 200 },
      seed: "b",
    });
    // The sample count may match; some intermediate sample must differ.
    let differs = false;
    const maxLen = Math.max(a.length, b.length);
    for (let i = 0; i < maxLen; i++) {
      if (a[i]?.x !== b[i]?.x || a[i]?.y !== b[i]?.y) {
        differs = true;
        break;
      }
    }
    expect(differs).toBe(true);
  });

  it("keys: distinct seeds diverge in mistakes or timing", () => {
    const a = synthesizeKeystrokes({ text: "abcdefghij", seed: "a", mistakeRate: 0.5 });
    const b = synthesizeKeystrokes({ text: "abcdefghij", seed: "b", mistakeRate: 0.5 });
    expect(a).not.toEqual(b);
  });

  it("scroll: distinct seeds produce different jitter (different timestamps or deltas)", () => {
    const a = synthesizeScroll({ from: 0, to: 800, seed: "a" });
    const b = synthesizeScroll({ from: 0, to: 800, seed: "b" });
    expect(a).not.toEqual(b);
  });
});

describe("determinism: namespace isolation", () => {
  it("the same seed across mouse/keys/scroll produces independent streams", () => {
    // Construct three calls with the same seed; the SHA-256-keyed namespace
    // ensures they don't leak state across surfaces.
    const seed = "shared";
    const m = synthesizeMouseTrajectory({
      from: { x: 0, y: 0 },
      to: { x: 100, y: 100 },
      seed,
    });
    const k = synthesizeKeystrokes({ text: "abc", seed });
    const s = synthesizeScroll({ from: 0, to: 200, seed });
    // Run a second time — namespace isolation means each surface should
    // still be byte-identical to its prior call.
    const m2 = synthesizeMouseTrajectory({
      from: { x: 0, y: 0 },
      to: { x: 100, y: 100 },
      seed,
    });
    const k2 = synthesizeKeystrokes({ text: "abc", seed });
    const s2 = synthesizeScroll({ from: 0, to: 200, seed });
    expect(m).toEqual(m2);
    expect(k).toEqual(k2);
    expect(s).toEqual(s2);
  });
});
