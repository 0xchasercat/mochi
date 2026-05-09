/**
 * Unit tests for the `DEFAULT_BEHAVIOR` constant — the fallback used by
 * `@mochi.js/core` when a session was launched with `profile: null`
 * (no-spoof mode) and there's no matrix-derived `behavior` block.
 *
 * Pinned shape: `{ hand: "right", tremor: 0.18, wpm: 60,
 * scrollStyle: "smooth" }`. Locked by the brief — keep stable so
 * downstream consumers can rely on the no-spoof baseline.
 */

import { describe, expect, it } from "bun:test";
import { DEFAULT_BEHAVIOR, DEFAULT_BEHAVIOR_PROFILE, synthesizeKeystrokes } from "../index";

describe("DEFAULT_BEHAVIOR (no-spoof fallback)", () => {
  it("has the locked field shape", () => {
    expect(DEFAULT_BEHAVIOR).toEqual({
      hand: "right",
      tremor: 0.18,
      wpm: 60,
      scrollStyle: "smooth",
    });
  });

  it("is distinct from DEFAULT_BEHAVIOR_PROFILE on `wpm` (the matrix default is 65)", () => {
    expect(DEFAULT_BEHAVIOR.wpm).toBe(60);
    expect(DEFAULT_BEHAVIOR_PROFILE.wpm).toBe(65);
  });

  it("drives synthesizeKeystrokes deterministically when used as the profile", () => {
    const a = synthesizeKeystrokes({
      text: "hello",
      profile: DEFAULT_BEHAVIOR,
      seed: "default-behavior-test",
      mistakeRate: 0,
    });
    const b = synthesizeKeystrokes({
      text: "hello",
      profile: DEFAULT_BEHAVIOR,
      seed: "default-behavior-test",
      mistakeRate: 0,
    });
    expect(a).toEqual(b);
    // Sanity: the synth produced at least one event per character.
    expect(a.length).toBeGreaterThanOrEqual("hello".length);
  });
});
