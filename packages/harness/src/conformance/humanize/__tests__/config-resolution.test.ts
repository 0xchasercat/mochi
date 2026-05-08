/**
 * Conformance — config resolution (port of `test_humanize_unit.mjs §1`).
 *
 * Upstream (CloakBrowser) tests its `resolveConfig(preset, overrides)` and
 * supporting `rand` / `randRange` / `sleep` helpers. mochi has no
 * `resolveConfig` — the canonical source of behavioral parameters is
 * `MatrixV1.profile.behavior` (PLAN.md I-5). The semantic equivalents:
 *
 *   - "default config resolves" → mochi's `DEFAULT_BEHAVIOR_PROFILE` is a
 *     sane object with the documented fields.
 *   - "careful config resolves" → the mochi `careful` preset has a higher
 *     mean inter-key delay than `default` (lower WPM).
 *   - "custom config override" → the synth functions accept per-call opts
 *     that override the profile.
 *   - "rand within bounds" / "randRange within bounds" → mochi's seeded
 *     PRNG produces uniformly distributed floats in `[lo, hi)` over many
 *     draws.
 *   - "sleep timing" → not testable as a pure unit (would be a flake);
 *     covered by the E2E mouse-trajectory test which observes wall-clock
 *     pacing of dispatched events.
 *
 * @see tasks/0150-humanize-conformance.md
 * @see tests/fixtures/cloakbrowser/test_humanize_unit.mjs
 */

import { describe, expect, it } from "bun:test";
import {
  DEFAULT_BEHAVIOR_PROFILE,
  synthesizeKeystrokes,
  synthesizeMouseTrajectory,
} from "@mochi.js/behavioral";
import { conformancePrng, mochiBehaviorFor, rand, randRange } from "../helpers";

describe("humanize conformance — config resolution (offline)", () => {
  it("default profile has the documented fields with sane values", () => {
    const cfg = mochiBehaviorFor("default");
    expect(cfg).toBeDefined();
    expect(cfg.hand === "left" || cfg.hand === "right").toBe(true);
    expect(cfg.tremor).toBeGreaterThan(0);
    expect(cfg.wpm).toBeGreaterThan(0);
    expect(["smooth", "stepped", "inertial"]).toContain(cfg.scrollStyle);
    // Equivalent to the upstream `mouse_min_steps > 0`. The mochi mouse
    // synth always produces >=2 events per call (the trajectory lands at
    // least one mid-point + the endpoint).
    const traj = synthesizeMouseTrajectory({
      from: { x: 0, y: 0 },
      to: { x: 200, y: 200 },
      profile: cfg,
      seed: "default-conformance",
      overshootProbability: 0,
    });
    expect(traj.length).toBeGreaterThan(2);
    // Equivalent to `mouse_max_steps > min`: a longer move emits strictly
    // more events than a short one (Fitts says so).
    const longerTraj = synthesizeMouseTrajectory({
      from: { x: 0, y: 0 },
      to: { x: 1500, y: 800 },
      profile: cfg,
      seed: "default-conformance-long",
      overshootProbability: 0,
    });
    expect(longerTraj.length).toBeGreaterThan(traj.length);
    // Equivalent to `typing_delay > 0`: the keystroke synth produces
    // strictly increasing tDownMs across letters.
    const keys = synthesizeKeystrokes({
      text: "ab",
      profile: cfg,
      seed: "default-conformance-keys",
      mistakeRate: 0,
    });
    expect(keys.length).toBe(2);
    const k0 = keys[0];
    const k1 = keys[1];
    if (k0 && k1) expect(k1.tDownMs).toBeGreaterThan(k0.tDownMs);
  });

  it("careful preset types more slowly than default", () => {
    const def = mochiBehaviorFor("default");
    const careful = mochiBehaviorFor("careful");
    expect(careful.wpm).toBeLessThan(def.wpm);
    // Empirical check: synthesize the same string under both presets and
    // assert the careful one takes longer end-to-end.
    const text = "hello world";
    const a = synthesizeKeystrokes({
      text,
      profile: def,
      seed: "preset-cmp-default",
      mistakeRate: 0,
    });
    const b = synthesizeKeystrokes({
      text,
      profile: careful,
      seed: "preset-cmp-careful",
      mistakeRate: 0,
    });
    const aLast = a[a.length - 1];
    const bLast = b[b.length - 1];
    if (aLast && bLast) expect(bLast.tUpMs).toBeGreaterThan(aLast.tUpMs);
  });

  it("custom override changes the realized synthesis", () => {
    // Equivalent to `resolveConfig('default', { mouse_min_steps: 100, mouse_max_steps: 200 })`:
    // mochi takes per-call opts (`durationMs`) that override the synth
    // defaults. Setting a longer duration produces strictly more events.
    const fast = synthesizeMouseTrajectory({
      from: { x: 0, y: 0 },
      to: { x: 400, y: 400 },
      seed: "override-fast",
      durationMs: 100,
      overshootProbability: 0,
    });
    const slow = synthesizeMouseTrajectory({
      from: { x: 0, y: 0 },
      to: { x: 400, y: 400 },
      seed: "override-slow",
      durationMs: 1000,
      overshootProbability: 0,
    });
    expect(slow.length).toBeGreaterThan(fast.length);
  });

  it("rand stays within bounds over 1000 draws", () => {
    const prng = conformancePrng("rand-bounds");
    for (let i = 0; i < 1000; i++) {
      const v = rand(prng, 10, 20);
      expect(v).toBeGreaterThanOrEqual(10);
      expect(v).toBeLessThanOrEqual(20);
    }
  });

  it("randRange stays within bounds over 1000 draws", () => {
    const prng = conformancePrng("randrange-bounds");
    for (let i = 0; i < 1000; i++) {
      const v = randRange(prng, [5, 15]);
      expect(v).toBeGreaterThanOrEqual(5);
      expect(v).toBeLessThanOrEqual(15);
    }
  });

  it("default behavior profile fields match @mochi.js/behavioral export", () => {
    // Sanity: mochiBehaviorFor('default') is the canonical default.
    const cfg = mochiBehaviorFor("default");
    expect(cfg).toEqual(DEFAULT_BEHAVIOR_PROFILE);
  });
});
