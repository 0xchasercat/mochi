/**
 * `installTurnstileAutoClick(page, opts)` — opt-in Turnstile auto-click.
 *
 * The convenience layer that wires the `@mochi.js/challenges` inject script
 * into a `Page`, polls for Turnstile widgets, and dispatches a behavioral
 * synth click when a visible-checkbox variant is detected. Click happens on
 * the parent page (NOT inside the iframe — Cloudflare scripts the click on
 * the parent per their own Recipe blog and observed wire behavior).
 *
 * Click + dwell math comes from `@mochi.js/behavioral` (Bezier path +
 * Fitts's-Law dwell) via `Page.humanClick`. We never reinvent the synth.
 *
 * Detection model:
 *   - The inject script's MutationObserver populates a Symbol-keyed reader
 *     on the document (see `./inject.ts`). Mochi-side polls that reader at
 *     `pollIntervalMs` (default 500ms) cadence and reacts on state change.
 *   - If the inject reader isn't installed (e.g. the user constructed Page
 *     directly without the `challenges` launch option), the poller falls
 *     back to a direct `document.querySelector('iframe[src*=...]')` probe.
 *   - On detection, we translate the iframe's bounding rect into a click
 *     selector via `Page.humanClick` against an iframe selector — humanClick
 *     resolves the box internally via `DOM.getBoxModel`.
 *
 * Escalation handling (per task brief):
 *   - If the iframe src matches `/challenge.html` or `/managed.html` (the
 *     image/audio + managed-failed variants), fire `onEscalation("image-challenge")`
 *     and stop. We do NOT click randomly.
 *   - If the response token doesn't appear within `opts.timeout` (default
 *     30s after click), fire `onEscalation("timeout")`.
 *
 * Multiple-widget handling: each detected widget gets its own click; the
 * inject reader assigns stable per-widget ids.
 *
 * @see PLAN.md §11 (behavioral synth)
 * @see tasks/0220-turnstile-auto-click.md
 */

import { buildTurnstileInjectScript } from "./inject";

/**
 * Structural type for the subset of `@mochi.js/core`'s `Page` we consume.
 *
 * We do NOT import `@mochi.js/core` here because `@mochi.js/core` depends on
 * `@mochi.js/challenges` (the launch path wires this module on every newPage
 * when the option is set) — a direct import would form a workspace cycle and
 * break ts-resolution under bundler moduleResolution.
 *
 * Both shapes (this structural alias, and the real `core.Page`) implement the
 * same surface: `humanClick(selector, opts)` for the synth-backed click, and
 * `evaluate<T>(fn)` for the snapshot probe in the page's main world.
 */
export interface PageLike {
  humanClick(
    selector: string,
    opts?: { duration?: number; preMoveSettle?: boolean },
  ): Promise<void>;
  evaluate<T>(fn: () => T): Promise<T>;
  /**
   * Install a main-world script via
   * `Page.addScriptToEvaluateOnNewDocument({ runImmediately:true, worldName:"" })`.
   * Returns the CDP identifier so the caller can later remove it.
   *
   * Optional on the structural type only because legacy direct-Page
   * callers might construct minimal stubs in tests; the real
   * `@mochi.js/core.Page` always provides this method as of v0.2.
   */
  addInitScript?(source: string): Promise<string>;
  /** Remove a previously-installed init script by identifier. */
  removeInitScript?(identifier: string): Promise<void>;
}

/** Public options for `installTurnstileAutoClick`. */
export interface TurnstileOptions {
  /**
   * How long to wait for the response token after a click before firing
   * `onEscalation("timeout")`. Default 30_000ms.
   */
  timeout?: number;
  /**
   * Whether to use the behavioral synth (Bezier+Fitts) for the click. When
   * `false`, falls back to a hard mid-element click — useful for tests that
   * want fast deterministic behavior. Default `true`.
   */
  humanize?: boolean;
  /**
   * Fired when the Turnstile widget reports a response token. Receives the
   * token string. Called at most once per widget per session.
   */
  onSolved?: (token: string) => void;
  /**
   * Fired when escalation is detected — image/audio challenge, managed
   * variant, or post-click timeout. Receives a short reason code:
   *   - `"image-challenge"`: src matched the escalated challenge URL
   *   - `"managed"`: src matched the managed (failed-bot) URL
   *   - `"timeout"`: clicked but the response token never appeared
   */
  onEscalation?: (reason: TurnstileEscalationReason) => void;
  /**
   * Polling cadence for DOM scanning. Smaller = more responsive but more
   * CDP traffic. Default 500ms.
   */
  pollIntervalMs?: number;
}

/** All escalation reasons mochi reports to `onEscalation`. */
export type TurnstileEscalationReason = "image-challenge" | "managed" | "timeout";

/** A disposable handle returned by `installTurnstileAutoClick`. */
export interface Disposable {
  dispose(): void;
  /** Whether `dispose()` was called. */
  readonly disposed: boolean;
}

/** Internal: state we track per detected widget. */
interface WidgetState {
  id: string;
  src: string;
  clickedAt: number | null;
  solved: boolean;
  escalated: boolean;
}

/**
 * Install a Turnstile auto-click handler on the given `Page`. Returns a
 * disposable that, when called, stops further polling/clicking. The handle
 * is also disposed automatically if the page closes.
 *
 * The function is non-blocking: it returns immediately after starting the
 * background poller. The caller can `await page.goto(...)` and the auto-
 * click runs in the background.
 */
export function installTurnstileAutoClick(page: PageLike, opts: TurnstileOptions = {}): Disposable {
  const timeoutMs = opts.timeout ?? 30_000;
  const humanize = opts.humanize ?? true;
  const pollIntervalMs = opts.pollIntervalMs ?? 500;
  const onSolved = opts.onSolved;
  const onEscalation = opts.onEscalation;

  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let initScriptId: string | null = null;
  const widgets = new Map<string, WidgetState>();

  // Install the main-world inject script via
  // `Page.addScriptToEvaluateOnNewDocument({ runImmediately:true, worldName:"" })`
  // per PLAN.md §8.4. Fire-and-forget: the poller's direct-DOM fallback
  // tolerates the case where the inject hasn't installed yet (or never
  // does — e.g. a stub Page in tests without `addInitScript`).
  if (typeof page.addInitScript === "function") {
    void page
      .addInitScript(buildTurnstileInjectScript())
      .then((id) => {
        if (disposed) {
          // Race: dispose() landed before install completed. Tear down
          // immediately so we don't leak a CDP-side identifier.
          if (typeof page.removeInitScript === "function") {
            void page.removeInitScript(id).catch(() => {});
          }
          return;
        }
        initScriptId = id;
      })
      .catch((err: unknown) => {
        // Best-effort: log + fall through to the direct-DOM fallback path.
        console.warn("[mochi/challenges] inject install failed:", err);
      });
  }

  const handle: Disposable = {
    get disposed() {
      return disposed;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      if (initScriptId !== null && typeof page.removeInitScript === "function") {
        const id = initScriptId;
        initScriptId = null;
        void page.removeInitScript(id).catch(() => {});
      }
    },
  };

  /** Schedule the next poll tick. */
  const schedule = (): void => {
    if (disposed) return;
    timer = setTimeout(() => {
      void tick().catch((_err) => {
        // Best-effort: a single failed tick (page closed, navigation race,
        // etc.) is logged via console.warn but doesn't kill the poller.
        // The next tick re-tries.
        if (!disposed) {
          // We deliberately don't surface CDP errors as escalations — those
          // are mochi-internal, not Turnstile-state-related.
          console.warn("[mochi/challenges] turnstile poll failed:", _err);
        }
      });
    }, pollIntervalMs);
  };

  /** A single poll cycle. */
  const tick = async (): Promise<void> => {
    if (disposed) return;
    const snapshot = await readSnapshot(page);
    if (snapshot === null) {
      // Page closed / navigation race / other transient CDP failure —
      // re-schedule and try again.
      schedule();
      return;
    }
    // Token observed — fire onSolved on the first widget that hasn't seen
    // it yet. The token is shared across widgets on the same page; we
    // track per-widget delivery so `onSolved` fires once per widget.
    if (typeof snapshot.token === "string" && snapshot.token.length > 0) {
      for (const w of widgets.values()) {
        if (!w.solved && w.clickedAt !== null) {
          w.solved = true;
          if (onSolved !== undefined) {
            try {
              onSolved(snapshot.token);
            } catch (_err) {
              // User callback threw — swallow per task brief: callbacks
              // don't get to take down the poller.
            }
          }
        }
      }
    }

    for (const frame of snapshot.frames) {
      let state = widgets.get(frame.id);
      if (state === undefined) {
        state = {
          id: frame.id,
          src: frame.src,
          clickedAt: null,
          solved: false,
          escalated: false,
        };
        widgets.set(frame.id, state);
      }
      // Update src in case a managed variant escalates by mutating src.
      state.src = frame.src;

      // Escalation: image-challenge or managed variant. Don't click; tell
      // the caller and stop processing this widget.
      if (frame.escalated && !state.escalated) {
        state.escalated = true;
        const reason: TurnstileEscalationReason =
          frame.src.indexOf("/managed.html") >= 0 ? "managed" : "image-challenge";
        if (onEscalation !== undefined) {
          try {
            onEscalation(reason);
          } catch (_err) {
            // swallow
          }
        } else {
          console.warn(`[mochi/challenges] turnstile escalation: ${reason} (${frame.src})`);
        }
        continue;
      }

      // First-time visible-checkbox detection — schedule the click.
      if (state.clickedAt === null && !state.escalated) {
        state.clickedAt = Date.now();
        // Fire-and-forget the click. We don't await here because we want
        // the poller to keep running while the click trajectory plays
        // out. Errors from the click path are surfaced via console.warn.
        void clickWidget(page, frame, humanize).catch((err) => {
          console.warn(`[mochi/challenges] click on ${frame.id} failed:`, err);
        });
        // Schedule the post-click timeout. Each widget gets its own.
        scheduleTimeoutCheck(state);
      }
    }
    schedule();
  };

  /** Per-widget timeout: fire `onEscalation("timeout")` if no token. */
  const scheduleTimeoutCheck = (state: WidgetState): void => {
    setTimeout(() => {
      if (disposed) return;
      if (!state.solved && !state.escalated) {
        state.escalated = true;
        if (onEscalation !== undefined) {
          try {
            onEscalation("timeout");
          } catch (_err) {
            // swallow
          }
        } else {
          console.warn(`[mochi/challenges] turnstile timeout on ${state.id}`);
        }
      }
    }, timeoutMs);
  };

  // Kick off the first tick.
  schedule();
  return handle;
}

/**
 * The shape returned by the inject snapshot reader (mirror of `./inject.ts`).
 */
interface TurnstileSnapshot {
  found: boolean;
  frames: Array<{
    id: string;
    src: string;
    rect: { x: number; y: number; width: number; height: number };
    escalated: boolean;
    at: number;
  }>;
  token: string | null;
}

/**
 * Read the inject reader's snapshot via `page.evaluate`. Falls back to a
 * direct DOM probe when the inject reader isn't installed (raw `Page` use).
 *
 * Returns `null` on any CDP error so the caller can decide whether to
 * re-schedule or bail.
 */
async function readSnapshot(page: PageLike): Promise<TurnstileSnapshot | null> {
  try {
    return await page.evaluate(snapshotProbe);
  } catch (_err) {
    return null;
  }
}

/**
 * The probe runs in the page's main world via `Runtime.callFunctionOn`.
 * Tries the inject reader first; falls back to direct DOM scanning.
 *
 * Defined as a `function` declaration (not an arrow) because mochi's
 * `Page.evaluate` serializes `fn.toString()` — Function.prototype.toString
 * preserves the body verbatim and CDP needs a parseable function expression.
 */
function snapshotProbe(this: Document): TurnstileSnapshot {
  const READER_KEY = "__mochi_ts_q__";
  const TURNSTILE_HOSTS = ["challenges.cloudflare.com/turnstile/"];
  const ESCALATION_PATTERNS = ["/challenge.html", "/managed.html"];

  const syms = Object.getOwnPropertySymbols(this);
  for (const s of syms) {
    if (s.description === READER_KEY) {
      const reader = (this as unknown as Record<symbol, () => TurnstileSnapshot>)[s];
      if (typeof reader === "function") {
        try {
          return reader();
        } catch (_e) {
          // Fall through to direct probe.
          break;
        }
      }
    }
  }

  // Fallback: scan the live DOM directly. Slower (re-walks every poll) but
  // doesn't require the inject script.
  const iframes = this.querySelectorAll("iframe");
  const frames: TurnstileSnapshot["frames"] = [];
  for (let i = 0; i < iframes.length; i++) {
    const fr = iframes[i] as HTMLIFrameElement;
    const src = fr.getAttribute("src") || "";
    let isTurnstile = false;
    for (const h of TURNSTILE_HOSTS) {
      if (src.indexOf(h) >= 0) {
        isTurnstile = true;
        break;
      }
    }
    if (!isTurnstile) continue;
    let escalated = false;
    for (const p of ESCALATION_PATTERNS) {
      if (src.indexOf(p) >= 0) {
        escalated = true;
        break;
      }
    }
    const r = fr.getBoundingClientRect();
    frames.push({
      id: `ts-fallback-${i}`,
      src: src,
      rect: { x: r.left, y: r.top, width: r.width, height: r.height },
      escalated: escalated,
      at: Date.now(),
    });
  }

  // Read the response token from the hidden field.
  let token: string | null = null;
  const inputs = this.querySelectorAll(
    'input[name="cf-turnstile-response"], textarea[name="cf-turnstile-response"]',
  );
  for (let i = 0; i < inputs.length; i++) {
    const el = inputs[i] as HTMLInputElement;
    if (typeof el.value === "string" && el.value.length > 0) {
      token = el.value;
      break;
    }
  }

  return { found: frames.length > 0, frames: frames, token: token };
}

/**
 * Click a detected Turnstile widget. We jitter into a small box around the
 * iframe center (the visible-checkbox region is the left portion of the
 * iframe; clicking center is robust across all known widget themes).
 *
 * Uses `Page.humanClick` so the synth math (Bezier path + Fitts's-Law
 * dwell + tremor jitter) lives in `@mochi.js/behavioral` per task brief.
 */
async function clickWidget(
  page: PageLike,
  frame: TurnstileSnapshot["frames"][number],
  humanize: boolean,
): Promise<void> {
  // The iframe element is targetable by index — we use a CSS attribute
  // selector to find the same iframe humanClick resolved via getBoxModel.
  // Quote-escape the src in the selector (Turnstile srcs contain `/?`).
  // Using `[src*="..."]` is robust because Cloudflare appends a session
  // query string we shouldn't pin to. We narrow by host substring.
  const selector = 'iframe[src*="challenges.cloudflare.com/turnstile"]';
  if (humanize) {
    await page.humanClick(selector, { preMoveSettle: true });
  } else {
    // Non-humanized fallback: also goes through humanClick but with the
    // pre-move settle disabled and trajectory shortened. We deliberately
    // keep this on the synth path — there's no "fast click" CDP method
    // worth using when the synth output IS the realistic input.
    await page.humanClick(selector, { preMoveSettle: false, duration: 80 });
  }
  // Borrow `frame` to silence unused-var lint when callers want to log.
  void frame;
}
