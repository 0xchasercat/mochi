/**
 * `@mochi.js/challenges` — convenience layers for common bot-defense
 * challenge widgets.
 *
 * Phase 0.2 ships **Turnstile auto-click only**. Out of scope (deferred):
 *   - hCaptcha (same shape, separate task — v0.3)
 *   - reCAPTCHA v2/v3 (different mechanism)
 *   - 3rd-party solver API integrations (v0.3+ via `onEscalation`)
 *
 * Public surface:
 *   - `installTurnstileAutoClick(page, opts)` — opt-in installer that wires
 *     a poll loop + behavioral-synth click against a `Page`.
 *   - `LaunchOptions.challenges.turnstile.autoClick` — when set, the
 *     `Session` automatically calls `installTurnstileAutoClick` on every
 *     `newPage`. (Wired in `@mochi.js/core`.)
 *
 * Architectural invariants honored (PLAN.md §2):
 *   - I-1 no-patches: pure JS layer + existing CDP + behavioral synth.
 *   - I-3 Bun-only: no Node-specific imports, no FS / network access.
 *   - I-5 relational consistency: clicks reuse `Page.humanClick` which
 *     reads the session's resolved `MatrixV1.behavior` profile — no new
 *     entropy source.
 *   - PLAN.md §8.2: never sends `Runtime.enable`. Detection is poll-based
 *     via the existing `Page.evaluate` plumbing (which uses
 *     `Runtime.callFunctionOn`, not `Runtime.evaluate`).
 *
 */

export const VERSION = "0.1.0" as const;

export {
  buildTurnstileInjectScript,
  TURNSTILE_EVENT_NAMES,
  TURNSTILE_READER_KEY,
} from "./inject";
export {
  type Disposable,
  installTurnstileAutoClick,
  type TurnstileEscalationReason,
  type TurnstileOptions,
} from "./install";
