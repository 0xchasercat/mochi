/**
 * Shared types for the behavioral synthesis package.
 *
 * Outputs are pure data: arrays of plain objects with no behavior. The CDP
 * dispatch layer lives in `@mochi.js/core/page.ts`; this package only
 * produces the events.
 *
 * @see PLAN.md §5.5, §11
 */

/** A 2D viewport-pixel coordinate. */
export interface Point {
  readonly x: number;
  readonly y: number;
}

/** A 2D viewport-pixel rectangle, used as the target box for `humanClick`. */
export interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * One synthesized mouse-move sample. `tMs` is monotonic from 0 (caller adds
 * any wall-clock offset). The dispatch layer turns this into
 * `Input.dispatchMouseEvent({type: "mouseMoved", x, y, ...})`.
 */
export interface TrajectoryEvent {
  readonly tMs: number;
  readonly x: number;
  readonly y: number;
}

/**
 * One synthesized keystroke. `correctsPrevious` is true on the corrective
 * Backspace that follows a mistake; `text` is the literal string the
 * dispatch layer sends as the `text` field of `Input.dispatchKeyEvent`
 * (empty for Backspace). `key` is the canonical CDP key name. `tDownMs`
 * and `tUpMs` are monotonic from 0 (caller adds any offset).
 */
export interface KeystrokeEvent {
  readonly tDownMs: number;
  readonly tUpMs: number;
  readonly key: string;
  /** Literal text inserted on keydown — empty for control keys. */
  readonly text: string;
  /**
   * `true` when this event is a *mistake*: a wrong character typed before
   * the correct one (followed by a Backspace + the correct keystroke).
   */
  readonly mistake: boolean;
  /**
   * `true` when this event is the corrective Backspace that follows a
   * `mistake` event (so consumers can pair them up).
   */
  readonly correction: boolean;
}

/**
 * One synthesized scroll frame. The dispatch layer turns this into
 * `Input.dispatchMouseEvent({type: "mouseWheel", deltaY, ...})`.
 */
export interface ScrollEvent {
  readonly tMs: number;
  readonly deltaY: number;
}

/**
 * Behavioral profile parameters. Mirrors `MatrixV1.profile.behavior` (see
 * `schemas/matrix.schema.json`); the matrix is the single source of truth
 * (PLAN.md I-5). Per-call opts may override individual fields.
 *
 * `scrollStyle` accepts the matrix-vocabulary `"smooth" | "stepped" | "inertial"`.
 * v0 treats "smooth" and "inertial" identically (the inertial scroll IS the
 * smooth scroll); "stepped" caps each frame to a single 100px notch.
 */
export interface BehaviorProfile {
  readonly hand: "left" | "right";
  /** Per-axis Gaussian jitter amplitude in px. */
  readonly tremor: number;
  /** Mean typing speed in words per minute. */
  readonly wpm: number;
  readonly scrollStyle: "smooth" | "stepped" | "inertial";
}

/** Default profile used when neither a matrix nor opts.profile is supplied. */
export const DEFAULT_BEHAVIOR_PROFILE: BehaviorProfile = {
  hand: "right",
  tremor: 0.18,
  wpm: 65,
  scrollStyle: "smooth",
} as const;

/**
 * Conservative-default `BehaviorProfile` returned when a `Session` was launched
 * with `profile: null` (no-spoof mode) — see `mochi.connect` /
 * `mochi.launch({ profile: null })`. The fields differ slightly from
 * {@link DEFAULT_BEHAVIOR_PROFILE} (which is the in-band default for
 * matrix-derived sessions): the brief pins `wpm: 60` here so the no-spoof
 * default is its own contract surface, independent from the matrix-default
 * baseline.
 *
 * Consumers in `@mochi.js/core/page.ts` use this as the fallback when the
 * Session's `profile` is `null` and per-page `behavior` is also unset.
 */
export const DEFAULT_BEHAVIOR: BehaviorProfile = {
  hand: "right",
  tremor: 0.18,
  wpm: 60,
  scrollStyle: "smooth",
} as const;
