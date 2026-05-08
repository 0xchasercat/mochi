/**
 * Keystroke unit tests:
 *   - ordered tDownMs (monotonic)
 *   - mistake rate within ±2% over 1000-char run with mistakeRate=0.05
 *   - digraph timing distributions match expected shape (median in ballpark)
 *   - press duration is positive and inside the 20-200ms clamp
 *   - mistakes always pair with a corrective Backspace
 */

import { describe, expect, it } from "bun:test";
import type { KeystrokeEvent } from "../index";
import { adjacentKey, handFor, synthesizeKeystrokes } from "../index";

function at(arr: readonly KeystrokeEvent[], i: number): KeystrokeEvent {
  const v = arr[i];
  if (v === undefined) throw new Error(`index ${i} out of range (${arr.length})`);
  return v;
}

describe("synthesizeKeystrokes", () => {
  it("emits one event per character with mistakeRate=0", () => {
    const text = "the quick brown fox";
    const ev = synthesizeKeystrokes({ text, seed: "k-1", mistakeRate: 0 });
    expect(ev.length).toBe(text.length);
    for (let i = 0; i < text.length; i++) {
      const c = text[i] as string;
      expect(at(ev, i).text).toBe(c === "\n" || c === "\t" ? "" : c);
      expect(at(ev, i).mistake).toBe(false);
    }
  });

  it("tDownMs and tUpMs are monotonic non-decreasing", () => {
    const ev = synthesizeKeystrokes({
      text: "Hello, world!",
      seed: "k-mono",
      mistakeRate: 0,
    });
    for (let i = 1; i < ev.length; i++) {
      expect(at(ev, i).tDownMs).toBeGreaterThanOrEqual(at(ev, i - 1).tUpMs);
      expect(at(ev, i).tUpMs).toBeGreaterThan(at(ev, i).tDownMs);
    }
  });

  it("press duration always inside [20, 200] ms", () => {
    const ev = synthesizeKeystrokes({
      text: "abcdefghijklmnopqrstuvwxyz",
      seed: "k-press",
      mistakeRate: 0,
    });
    for (const e of ev) {
      const dur = e.tUpMs - e.tDownMs;
      expect(dur).toBeGreaterThanOrEqual(20);
      expect(dur).toBeLessThanOrEqual(200);
    }
  });

  it("mistake rate is within ±2% of configured rate over 1000-char run", () => {
    // Build a 1000-char letter string (all alphabetic) so every char has an
    // adjacency entry; deliberately avoid digits/punctuation.
    const N = 1000;
    let text = "";
    for (let i = 0; i < N; i++) text += String.fromCharCode(97 + (i % 26));
    const ev = synthesizeKeystrokes({ text, seed: "k-rate", mistakeRate: 0.05 });
    let mistakes = 0;
    let corrections = 0;
    for (const e of ev) {
      if (e.mistake) mistakes++;
      if (e.correction) corrections++;
    }
    expect(mistakes).toBe(corrections); // every mistake must have a correction
    const rate = mistakes / N;
    expect(rate).toBeGreaterThan(0.03);
    expect(rate).toBeLessThan(0.07);
  });

  it("digraph timing: same-hand median ≈ exp(4.7) ≈ 110ms (loose)", () => {
    // "asdf" — same left hand for every digraph.
    const text = "as".repeat(200);
    const ev = synthesizeKeystrokes({
      text,
      seed: "k-digraph-same",
      mistakeRate: 0,
      profile: { wpm: 65 },
    });
    const gaps: number[] = [];
    for (let i = 1; i < ev.length; i++) {
      gaps.push(at(ev, i).tDownMs - at(ev, i - 1).tUpMs);
    }
    gaps.sort((a, b) => a - b);
    const median = gaps[Math.floor(gaps.length / 2)] as number;
    // exp(4.7) ≈ 109.9 ms — accept a wide band (× WPM scaling pulls toward
    // ~185ms at wpm=65, so the band is around the WPM-scaled median).
    expect(median).toBeGreaterThan(60);
    expect(median).toBeLessThan(400);
  });

  it("after-space digraph is slower than same-hand digraph (median)", () => {
    // Compare medians: "as as as ..." (post-space) vs "asdf asdf ..." (same-hand).
    const ssText = "as ".repeat(400);
    const ssEv = synthesizeKeystrokes({ text: ssText, seed: "k-after-sp", mistakeRate: 0 });
    const shText = "asdf".repeat(200);
    const shEv = synthesizeKeystrokes({ text: shText, seed: "k-sh", mistakeRate: 0 });

    const afterSpaceGaps: number[] = [];
    for (let i = 1; i < ssEv.length; i++) {
      const prev = ssText[i - 1];
      if (prev === " ") afterSpaceGaps.push(at(ssEv, i).tDownMs - at(ssEv, i - 1).tUpMs);
    }
    const sameHandGaps: number[] = [];
    for (let i = 1; i < shEv.length; i++) {
      sameHandGaps.push(at(shEv, i).tDownMs - at(shEv, i - 1).tUpMs);
    }
    afterSpaceGaps.sort((a, b) => a - b);
    sameHandGaps.sort((a, b) => a - b);
    const medAfterSpace = afterSpaceGaps[Math.floor(afterSpaceGaps.length / 2)] as number;
    const medSameHand = sameHandGaps[Math.floor(sameHandGaps.length / 2)] as number;
    // After-space lognormal μ=4.9 vs same-hand μ=4.7 → after-space ~22% slower.
    expect(medAfterSpace).toBeGreaterThan(medSameHand);
  });

  it("WPM scaling: faster wpm → smaller average inter-key delay", () => {
    const text = "abcdefghij".repeat(50);
    const slow = synthesizeKeystrokes({
      text,
      seed: "k-wpm-s",
      mistakeRate: 0,
      profile: { wpm: 30 },
    });
    const fast = synthesizeKeystrokes({
      text,
      seed: "k-wpm-f",
      mistakeRate: 0,
      profile: { wpm: 120 },
    });
    const avg = (ev: readonly KeystrokeEvent[]): number => {
      let s = 0;
      let n = 0;
      for (let i = 1; i < ev.length; i++) {
        s += at(ev, i).tDownMs - at(ev, i - 1).tUpMs;
        n++;
      }
      return n === 0 ? 0 : s / n;
    };
    expect(avg(fast)).toBeLessThan(avg(slow));
  });
});

describe("QWERTY hand-table + adjacency", () => {
  it("handFor letters honors the spec partition", () => {
    expect(handFor("q")).toBe("left");
    expect(handFor("a")).toBe("left");
    expect(handFor("z")).toBe("left");
    expect(handFor("p")).toBe("right");
    expect(handFor("h")).toBe("right");
    expect(handFor("m")).toBe("right");
    expect(handFor("Q")).toBe("left"); // case-insensitive
    expect(handFor(" ")).toBe(null);
    expect(handFor("1")).toBe(null);
  });

  it("adjacentKey returns null for non-letters and a plausible neighbour for letters", () => {
    expect(adjacentKey("1", () => 0)).toBe(null);
    // For "a", neighbours are "qwsz" — index 0 → "q".
    expect(adjacentKey("a", () => 0)).toBe("q");
    // Case preserved.
    expect(adjacentKey("A", () => 0)).toBe("Q");
  });
});
