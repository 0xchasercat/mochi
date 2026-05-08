/**
 * Keystroke synthesis — pure data, no CDP.
 *
 * Per PLAN.md §11.2:
 *
 *   - Per-letter press duration = Gaussian(80, 25) ms.
 *   - Inter-key delay model:
 *       same-hand digraphs   → lognormal(μ=4.7, σ=0.35)  ≈ 80–250 ms
 *       cross-hand digraphs  → lognormal(μ=4.4, σ=0.30)  ≈ 60–180 ms
 *       after space          → lognormal(μ=4.9, σ=0.40)  ≈ 100–300 ms
 *       after punctuation    → 1.3 × same-hand delay
 *   - Mistakes (rate = `mistakeRate`, default 0.02): type wrong key (adjacent
 *     QWERTY), 200–500ms delay, Backspace, 100–300ms delay, type correct key.
 *
 * Determinism contract: `(opts, seed)` → byte-identical event array.
 *
 * The `wpm` profile parameter scales all inter-key delays so the realized
 * mean inter-key time matches the requested WPM. Standard CPM ↔ WPM: one
 * "word" = 5 characters; mean inter-key delay = 60_000 / (wpm * 5) ms.
 * The lognormal medians above (e^4.4..4.9 ≈ 81..134 ms) bracket the
 * 60-WPM (200ms) and 90-WPM (133ms) range; we apply a single multiplicative
 * scale factor `targetMean / lognormalMean` so other WPM values stay
 * coherent.
 */

import { GaussianSampler, lognormal } from "./gauss";
import { prngFor } from "./prng";
import { adjacentKey, cdpKeyFor, handFor, isPunctuation, isSpaceLike } from "./qwerty";
import { type BehaviorProfile, DEFAULT_BEHAVIOR_PROFILE, type KeystrokeEvent } from "./types";

/** Public options for `synthesizeKeystrokes`. */
export interface KeystrokeOptions {
  readonly text: string;
  readonly profile?: Partial<BehaviorProfile>;
  /** Mistake rate per character (0..1). Default 0.02. */
  readonly mistakeRate?: number;
  readonly seed?: string;
}

const DEFAULT_MISTAKE_RATE = 0.02;
/** Average lognormal mean across the three regimes — used for WPM scaling. */
const LOGNORMAL_BASELINE_MEAN_MS = 110;

/** Synthesize keystroke events for a literal text string. */
export function synthesizeKeystrokes(opts: KeystrokeOptions): KeystrokeEvent[] {
  const profile: BehaviorProfile = {
    ...DEFAULT_BEHAVIOR_PROFILE,
    ...(opts.profile ?? {}),
  };
  const prng = prngFor("keys", opts.seed);
  const g = new GaussianSampler(prng);
  const mistakeRate = clamp01(opts.mistakeRate ?? DEFAULT_MISTAKE_RATE);
  // WPM scaling: 5 chars/word convention; aim for the mean inter-key delay
  // implied by `wpm`. Cap the multiplier so a pathological WPM (e.g. 5000)
  // doesn't collapse all delays to zero.
  const targetMeanMs = 60_000 / (Math.max(1, profile.wpm) * 5);
  const wpmScale = Math.max(0.25, Math.min(4, targetMeanMs / LOGNORMAL_BASELINE_MEAN_MS));

  const out: KeystrokeEvent[] = [];
  let now = 0;
  let prevChar: string | null = null;

  for (let i = 0; i < opts.text.length; i++) {
    const ch = opts.text[i];
    if (ch === undefined) continue;

    // Inter-key delay (skip before the very first character).
    if (prevChar !== null) {
      const delayMs = interKeyDelayMs(prevChar, ch, g, wpmScale);
      now += delayMs;
    }

    // Mistake injection — only on letters with an adjacency entry.
    const willMistake = mistakeRate > 0 && prng.nextFloat01() < mistakeRate;
    if (willMistake) {
      const wrong = adjacentKey(ch, (n) => prng.nextIntInclusive(0, n - 1));
      if (wrong !== null) {
        // Type wrong key.
        const wrongDown = now;
        const pressMs = pressDuration(g);
        const wrongUp = wrongDown + pressMs;
        out.push({
          tDownMs: wrongDown,
          tUpMs: wrongUp,
          key: cdpKeyFor(wrong),
          text: wrong,
          mistake: true,
          correction: false,
        });
        now = wrongUp;
        // 200..500 ms realisation delay.
        now += 200 + prng.nextFloat01() * 300;
        // Backspace.
        const bsDown = now;
        const bsUp = bsDown + pressDuration(g);
        out.push({
          tDownMs: bsDown,
          tUpMs: bsUp,
          key: "Backspace",
          text: "",
          mistake: false,
          correction: true,
        });
        now = bsUp;
        // 100..300 ms recovery delay.
        now += 100 + prng.nextFloat01() * 200;
      }
    }

    const downMs = now;
    const upMs = downMs + pressDuration(g);
    out.push({
      tDownMs: downMs,
      tUpMs: upMs,
      key: cdpKeyFor(ch),
      text: printableText(ch),
      mistake: false,
      correction: false,
    });
    now = upMs;
    prevChar = ch;
  }

  return out;
}

/** Per-letter press duration: clamped Gaussian(80, 25) ms. */
function pressDuration(g: GaussianSampler): number {
  // Clamp at 20..200 ms so a far-tail draw doesn't produce a 1ms or 1s press.
  return g.nextClamped(80, 25, 20, 200);
}

/**
 * Inter-key delay between two consecutive characters. Picks the regime by
 * inspecting the previous character (space / punctuation / letter) and the
 * hand of both keys (same / cross).
 *
 * The lognormal sigma is unscaled by WPM (variance of inter-key timing is
 * roughly preserved across speeds in real typing). Only the mean shifts.
 */
function interKeyDelayMs(prev: string, curr: string, g: GaussianSampler, wpmScale: number): number {
  if (isSpaceLike(prev)) {
    // After space.
    return lognormal(g, 4.9, 0.4) * wpmScale;
  }
  if (isPunctuation(prev)) {
    // After punctuation: 1.3 × same-hand baseline.
    return lognormal(g, 4.7, 0.35) * 1.3 * wpmScale;
  }
  const prevHand = handFor(prev);
  const currHand = handFor(curr);
  if (prevHand !== null && currHand !== null && prevHand === currHand) {
    return lognormal(g, 4.7, 0.35) * wpmScale;
  }
  // Cross-hand or one-of-the-keys-isn't-on-the-letter-grid: cross-hand model.
  return lognormal(g, 4.4, 0.3) * wpmScale;
}

/** Printable `text` for `Input.dispatchKeyEvent`: empty for control keys. */
function printableText(ch: string): string {
  if (ch === "\n" || ch === "\t") return "";
  return ch;
}

function clamp01(v: number): number {
  if (Number.isNaN(v)) return 0;
  return Math.min(1, Math.max(0, v));
}
