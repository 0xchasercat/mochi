/**
 * `Page` — public surface for one Chromium tab/target.
 *
 * v0.8 wires the behavioral surface — `humanClick`, `humanType`, `humanScroll`
 * — onto the existing v0.1 base (`goto`, `content`, `text`, `evaluate`,
 * `waitFor`, `cookies`, `close`). `screenshot` remains a placeholder.
 *
 * Critical §8.3 design: NO `Runtime.enable` is ever sent. Evaluation routes
 * through `DOM.resolveNode` → `Runtime.callFunctionOn` against the document
 * node's `objectId`. That implicitly runs in main world without naming a
 * world (which would create a detectable isolated world; PLAN.md §8.4).
 *
 * Behavioral pipeline (PLAN.md §5.5 pure-data principle): trajectory /
 * keystroke / scroll EVENTS are produced by `@mochi.js/behavioral` as plain
 * data; this module is the side-effect layer that dispatches them via
 * `Input.dispatchMouseEvent` / `Input.dispatchKeyEvent`. Per-frame pacing is
 * realized with `setTimeout(0)` chained against the synthesized `tMs` so the
 * realized cadence matches the synthesized cadence on a relaxed best-effort
 * basis (Bun's setTimeout granularity is sub-ms; the model is at 60Hz).
 *
 * @see PLAN.md §5.1 / §5.5 / §7 / §8.3 / §8.4 / §11
 */

import {
  type BehaviorProfile,
  DEFAULT_BEHAVIOR_PROFILE,
  synthesizeKeystrokes,
  synthesizeMouseTrajectory,
  synthesizeScroll,
} from "@mochi.js/behavioral";
import type { MessageRouter } from "./cdp/router";
import type {
  BoxModel,
  DispatchKeyEventParams,
  DispatchMouseEventParams,
  DomNode,
  FrameNavigatedEvent,
  RemoteObject,
} from "./cdp/types";
import { NotImplementedError } from "./errors";

/** Wait conditions for `Page.goto`. */
export type WaitUntil = "load" | "domcontentloaded" | "networkidle";

/** Options for `Page.goto`. */
export interface GotoOptions {
  waitUntil?: WaitUntil;
  timeout?: number;
}

/** State predicates for `Page.waitFor`. */
export type WaitState = "attached" | "visible" | "hidden";

/** Options for `Page.waitFor`. */
export interface WaitForOptions {
  timeout?: number;
  state?: WaitState;
}

/** A CDP cookie shape. Matches `Network.Cookie` minus a few fields we don't surface. */
export interface Cookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number;
  size: number;
  httpOnly: boolean;
  secure: boolean;
  session: boolean;
  sameSite?: "Strict" | "Lax" | "None";
}

/**
 * Construct a `Page` against an existing CDP target. Used internally by
 * `Session.newPage()`; not exported.
 */
export interface PageInit {
  router: MessageRouter;
  /** The CDP target id this page wraps. */
  targetId: string;
  /**
   * The flat-mode CDP session id obtained from `Target.attachToTarget`. All
   * page-level CDP calls (`Page.enable`, `DOM.*`, `Runtime.callFunctionOn`,
   * `Network.getCookies`, etc.) MUST be routed through this session.
   */
  sessionId: string;
  /** Initial URL (typically "about:blank"). */
  initialUrl: string;
  /**
   * Identifier returned by `Page.addScriptToEvaluateOnNewDocument` when the
   * inject payload was installed at session-newPage time. Tracked here so
   * `Page.close()` can call `Page.removeScriptToEvaluateOnNewDocument` —
   * required by PLAN.md §8.4 to keep the per-target identifier list bounded.
   *
   * Optional: zero-spoofing test setups (or future no-inject paths) may omit.
   */
  injectScriptIdentifier?: string;
  /**
   * Behavioral profile for `humanClick`/`humanType`/`humanScroll`. Sourced
   * from {@link MatrixV1.profile.behavior} (PLAN.md I-5: profile data is the
   * single source of truth). Optional; defaults to
   * `DEFAULT_BEHAVIOR_PROFILE` when absent.
   */
  behavior?: BehaviorProfile;
  /**
   * Per-session deterministic seed forwarded to behavioral synth. Combined
   * with a per-call counter so back-to-back `humanClick` calls within the
   * same session still produce divergent (but deterministic) trajectories.
   */
  seed?: string;
}

/** Options for `Page.humanClick`. */
export interface HumanClickOptions {
  button?: "left" | "right" | "middle";
  /** Override movement duration (ms). Default = Fitts. */
  duration?: number;
  /**
   * Add a Gaussian(150, 50) ms idle before movement. Default `true` — gives
   * the page a moment to settle (a real human doesn't snap instantly).
   */
  preMoveSettle?: boolean;
}

/** Options for `Page.humanType`. */
export interface HumanTypeOptions {
  /** Override profile WPM for this call. */
  wpm?: number;
  /** Override mistake rate (0..1). Default = 0.02. */
  mistakeRate?: number;
}

/** Options for `Page.humanScroll`. */
export interface HumanScrollOptions {
  /** Selector or absolute coords to scroll TO. */
  to: string | { x: number; y: number };
  /** Total time budget (ms). Default 500. */
  duration?: number;
}

export class Page {
  private readonly router: MessageRouter;
  private readonly targetId: string;
  private readonly sessionId: string;
  private currentUrl: string;
  private closed = false;
  /**
   * Most recently observed main-frame id (no `parentId`). Captured from
   * `Page.frameNavigated` events. Exposed via `mainFrameId()` so it has at
   * least one reader at v0.1 (future phases consume it for worker fan-out
   * and OOPIF correlation).
   */
  private _mainFrameId: string | null = null;
  /** Inject script identifier (see {@link PageInit.injectScriptIdentifier}). */
  private readonly injectScriptIdentifier: string | null;
  /**
   * Behavioral profile for the human-input surface. Defaults are documented
   * on {@link DEFAULT_BEHAVIOR_PROFILE}; the `MatrixV1.profile.behavior`
   * block is the canonical source (PLAN.md I-5).
   */
  private readonly behavior: BehaviorProfile;
  /** Per-session seed forwarded to behavioral synth (with a per-call counter mixed in). */
  private readonly seed: string;
  /**
   * Per-call counter that disambiguates back-to-back `humanClick` /
   * `humanType` / `humanScroll` calls within the same session. Without this
   * the same `(seed, opts)` would always produce the same trajectory —
   * deterministic but visibly mechanical.
   */
  private callCounter = 0;
  /**
   * Last cursor position. The `humanClick` synth chains from this point so a
   * sequence of clicks produces a continuous movement (which is also what a
   * real user does). Initial value is the viewport origin; the first click
   * always fires from (0,0) absent a prior call.
   */
  private cursor: { x: number; y: number } = { x: 0, y: 0 };

  constructor(init: PageInit) {
    this.router = init.router;
    this.targetId = init.targetId;
    this.sessionId = init.sessionId;
    this.currentUrl = init.initialUrl;
    this.injectScriptIdentifier = init.injectScriptIdentifier ?? null;
    this.behavior = init.behavior ?? DEFAULT_BEHAVIOR_PROFILE;
    this.seed = init.seed ?? "default";
    this.subscribeFrameTopology();
  }

  /** The page's last-observed URL (updated on `Page.frameNavigated`). */
  get url(): string {
    return this.currentUrl;
  }

  /**
   * The CDP frame id of the main frame, or `null` before the first navigation.
   * Mostly diagnostic at v0.1 — future phases use it for worker fan-out and
   * OOPIF correlation per PLAN.md §8.3.
   */
  mainFrameId(): string | null {
    return this._mainFrameId;
  }

  /**
   * Navigate to a URL. v0.1 supports `waitUntil: "load"` (the default) and
   * `"domcontentloaded"`. `"networkidle"` requires Network-domain plumbing
   * that lands later — for now we map it to `"load"` and document the limit.
   */
  async goto(url: string, opts: GotoOptions = {}): Promise<void> {
    this.assertOpen();
    const timeoutMs = opts.timeout ?? 30_000;
    const waitUntil = opts.waitUntil ?? "load";
    const targetEvent =
      waitUntil === "domcontentloaded" ? "Page.domContentEventFired" : "Page.loadEventFired";

    // Page.enable is *not* on the §8.2 forbidden list — it's required for
    // lifecycle events. Only Runtime.enable is forbidden.
    await this.send("Page.enable");

    const settled = new Promise<void>((resolve) => {
      const off = this.router.on(targetEvent, (_params, sessionId) => {
        // Filter to events from our session (flat mode delivers all events
        // to the root listener, tagged by sessionId).
        if (sessionId !== this.sessionId) return;
        off();
        resolve();
      });
    });
    await this.send("Page.navigate", { url });
    await Promise.race([
      settled,
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error(`[mochi] page.goto(${url}) timed out after ${timeoutMs}ms`)),
          timeoutMs,
        ),
      ),
    ]);
    this.currentUrl = url;
  }

  /** Return the full serialized HTML of the document. */
  async content(): Promise<string> {
    this.assertOpen();
    const docId = await this.documentObjectId();
    const result = await this.send<{ result: RemoteObject }>("Runtime.callFunctionOn", {
      objectId: docId,
      functionDeclaration: "function() { return this.documentElement.outerHTML; }",
      returnByValue: true,
    });
    const value = result.result.value;
    if (typeof value !== "string") {
      throw new Error("[mochi] page.content(): expected string from documentElement.outerHTML");
    }
    return value;
  }

  /**
   * Return the `textContent` of the first element matching the selector, or
   * `null` if no match. Uses `DOM.querySelector` + `Runtime.callFunctionOn`
   * exactly per PLAN.md §8.3.
   */
  async text(selector: string): Promise<string | null> {
    this.assertOpen();
    const root = await this.documentNode();
    const result = await this.send<{ nodeId: number }>("DOM.querySelector", {
      nodeId: root.nodeId,
      selector,
    });
    if (result.nodeId === 0) return null;
    const resolved = await this.send<{ object: RemoteObject }>("DOM.resolveNode", {
      nodeId: result.nodeId,
    });
    if (resolved.object.objectId === undefined) return null;
    const callResult = await this.send<{ result: RemoteObject }>("Runtime.callFunctionOn", {
      objectId: resolved.object.objectId,
      functionDeclaration: "function() { return this.textContent; }",
      returnByValue: true,
    });
    const value = callResult.result.value;
    if (value === null || value === undefined) return null;
    if (typeof value !== "string") {
      throw new Error("[mochi] page.text(): expected string textContent");
    }
    return value;
  }

  /**
   * Evaluate a function in the page's main world via `Runtime.callFunctionOn`
   * against the document's objectId. The function runs as a method on the
   * document (so `this` === document). Result is JSON-serialized via
   * `returnByValue: true`.
   *
   * Limitations (documented in docs/limits.md):
   *   - Non-JSON return values (functions, DOM nodes, undefined) are
   *     coerced/dropped per CDP semantics.
   *   - The function must be a syntactically valid `function() { ... }`
   *     expression (closures over outer scope are not supported — this is
   *     standard for any cross-process evaluator).
   *   - Arguments cannot be passed in v0.1; the function takes no args.
   */
  async evaluate<T>(fn: () => T): Promise<T> {
    this.assertOpen();
    const docId = await this.documentObjectId();
    const result = await this.send<{ result: RemoteObject }>("Runtime.callFunctionOn", {
      objectId: docId,
      functionDeclaration: fn.toString(),
      returnByValue: true,
    });
    return result.result.value as T;
  }

  /**
   * Wait for a selector to satisfy the requested `state`. v0.1 supports
   * `attached` (default) and `visible`/`hidden`. Polls every 50ms.
   */
  async waitFor(selector: string, opts: WaitForOptions = {}): Promise<void> {
    this.assertOpen();
    const timeoutMs = opts.timeout ?? 30_000;
    const state = opts.state ?? "attached";
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const ok = await this.evaluateSelectorState(selector, state);
      if (ok) return;
      await new Promise<void>((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(
      `[mochi] page.waitFor("${selector}", state=${state}) timed out after ${timeoutMs}ms`,
    );
  }

  /** All cookies visible to this page (no filter at v0.1). */
  async cookies(): Promise<Cookie[]> {
    this.assertOpen();
    const result = await this.send<{ cookies: Cookie[] }>("Network.getCookies");
    return result.cookies;
  }

  /** Tear down the page. Does not close the session's other pages. */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    // PLAN.md §8.4 — un-register the inject script so the per-target
    // identifier list stays bounded. Best-effort: if the page is already
    // gone the remove call will fail and we ignore it.
    if (this.injectScriptIdentifier !== null) {
      try {
        await this.router.send(
          "Page.removeScriptToEvaluateOnNewDocument",
          { identifier: this.injectScriptIdentifier },
          { sessionId: this.sessionId },
        );
      } catch {
        // Ignore — target might already be gone.
      }
    }
    try {
      // Target.closeTarget runs on the *root* (browser) target, not the page
      // session — it's how we tell the browser to kill that page.
      await this.router.send("Target.closeTarget", { targetId: this.targetId });
    } catch {
      // Ignore — session may already be tearing down.
    }
  }

  // ---- Phase 0.8 — behavioral surface ----------------------------------------

  /**
   * Move the mouse to the matched element with a human-shaped Bezier
   * trajectory, then dispatch a single `mousePressed` + `mouseReleased`.
   *
   * Pipeline (PLAN.md §11.1):
   *   1. Resolve the selector via `DOM.querySelector` + `DOM.getBoxModel`.
   *   2. Synthesize the `TrajectoryEvent[]` via `@mochi.js/behavioral`,
   *      passing the page's resolved `behavior` profile + a deterministic
   *      seed (per-call counter mixed in).
   *   3. Sleep `preMoveSettle` (default Gaussian(150, 50) ms).
   *   4. Dispatch each trajectory event via `Input.dispatchMouseEvent` of
   *      type `mouseMoved`, paced via `setTimeout` to match the synthesized
   *      `tMs` cadence.
   *   5. Dispatch `mousePressed` then `mouseReleased` at the final point
   *      with a realistic press duration (~30..80 ms).
   */
  async humanClick(selector: string, opts: HumanClickOptions = {}): Promise<void> {
    this.assertOpen();
    const root = await this.documentNode();
    const result = await this.send<{ nodeId: number }>("DOM.querySelector", {
      nodeId: root.nodeId,
      selector,
    });
    if (result.nodeId === 0) {
      throw new Error(`[mochi] humanClick: selector "${selector}" matched no element`);
    }
    const box = await this.send<{ model: BoxModel }>("DOM.getBoxModel", {
      nodeId: result.nodeId,
    });
    const targetBox = boxFromBorderQuad(box.model);
    const callSeed = this.nextCallSeed();
    const traj = synthesizeMouseTrajectory({
      from: { x: this.cursor.x, y: this.cursor.y },
      to: { x: targetBox.x + targetBox.width / 2, y: targetBox.y + targetBox.height / 2 },
      box: targetBox,
      profile: this.behavior,
      seed: callSeed,
      ...(opts.duration !== undefined ? { durationMs: opts.duration } : {}),
    });
    if (traj.length === 0) return;

    // Pre-move settle: Gaussian(150, 50) ms idle. Cheaply approximated via
    // the seed-derived Gaussian on a short range.
    const settle = opts.preMoveSettle ?? true;
    if (settle) {
      // 50..300 ms uniform (no need for full Gaussian here — just realism).
      await sleep(150 + (hash01(callSeed) - 0.5) * 100);
    }

    // Dispatch trajectory events at synthesized cadence.
    let prevT = 0;
    for (let i = 0; i < traj.length; i++) {
      const ev = traj[i];
      if (ev === undefined) continue;
      const dt = ev.tMs - prevT;
      if (i > 0 && dt > 0) await sleep(dt);
      prevT = ev.tMs;
      await this.dispatchMouse({
        type: "mouseMoved",
        x: ev.x,
        y: ev.y,
        button: "none",
      });
    }
    const last = traj[traj.length - 1];
    if (last === undefined) return;
    this.cursor = { x: last.x, y: last.y };

    // Press + release.
    const button = opts.button ?? "left";
    const pressMs = 30 + Math.floor(hash01(`${callSeed}:press`) * 50); // 30..80
    await this.dispatchMouse({
      type: "mousePressed",
      x: last.x,
      y: last.y,
      button,
      buttons: buttonsMaskFor(button),
      clickCount: 1,
    });
    await sleep(pressMs);
    await this.dispatchMouse({
      type: "mouseReleased",
      x: last.x,
      y: last.y,
      button,
      buttons: 0,
      clickCount: 1,
    });
  }

  /**
   * Type `text` into the matched input with human-shaped per-key timing,
   * digraph-aware delays, and configurable mistake injection.
   *
   * Pipeline (PLAN.md §11.2):
   *   1. Focus the matched node via `DOM.focus({nodeId})`.
   *   2. Synthesize a `KeystrokeEvent[]` via `@mochi.js/behavioral`.
   *   3. Dispatch each event as `keyDown` (with `text` for printable keys)
   *      then `keyUp`, paced by the synthesized `tDownMs` cadence.
   */
  async humanType(selector: string, text: string, opts: HumanTypeOptions = {}): Promise<void> {
    this.assertOpen();
    const root = await this.documentNode();
    const result = await this.send<{ nodeId: number }>("DOM.querySelector", {
      nodeId: root.nodeId,
      selector,
    });
    if (result.nodeId === 0) {
      throw new Error(`[mochi] humanType: selector "${selector}" matched no element`);
    }
    await this.send("DOM.focus", { nodeId: result.nodeId });

    const profile: BehaviorProfile = {
      ...this.behavior,
      ...(opts.wpm !== undefined ? { wpm: opts.wpm } : {}),
    };
    const callSeed = this.nextCallSeed();
    const events = synthesizeKeystrokes({
      text,
      profile,
      seed: callSeed,
      ...(opts.mistakeRate !== undefined ? { mistakeRate: opts.mistakeRate } : {}),
    });

    let prevT = 0;
    for (const ev of events) {
      const dt = ev.tDownMs - prevT;
      if (dt > 0) await sleep(dt);
      const downParams: DispatchKeyEventParams = {
        type: "keyDown",
        key: ev.key,
      };
      if (ev.text !== "") downParams.text = ev.text;
      await this.dispatchKey(downParams);
      const downDur = ev.tUpMs - ev.tDownMs;
      if (downDur > 0) await sleep(downDur);
      const upParams: DispatchKeyEventParams = {
        type: "keyUp",
        key: ev.key,
      };
      await this.dispatchKey(upParams);
      prevT = ev.tUpMs;
    }
  }

  /**
   * Inertial-scroll the page to a target Y position (or DOM element).
   *
   * Pipeline (PLAN.md §11.3):
   *   1. Resolve `to` to an absolute Y delta (selector → element top, coords
   *      → use the y component directly).
   *   2. Synthesize a `ScrollEvent[]` via `@mochi.js/behavioral`.
   *   3. Dispatch each frame as `Input.dispatchMouseEvent` of type
   *      `mouseWheel` with the synthesized `deltaY`, paced at 60Hz.
   */
  async humanScroll(opts: HumanScrollOptions): Promise<void> {
    this.assertOpen();
    const targetY = await this.resolveScrollTargetY(opts.to);
    const fromY = await this.currentScrollY();
    const callSeed = this.nextCallSeed();
    const events = synthesizeScroll({
      from: fromY,
      to: targetY,
      profile: this.behavior,
      seed: callSeed,
      ...(opts.duration !== undefined ? { duration: opts.duration } : {}),
    });
    let prevT = 0;
    for (const ev of events) {
      const dt = ev.tMs - prevT;
      if (dt > 0) await sleep(dt);
      prevT = ev.tMs;
      // mouseWheel events are dispatched at the current cursor position;
      // x/y here is the wheel point, not a target. Use cursor or viewport
      // center as a sane default.
      await this.dispatchMouse({
        type: "mouseWheel",
        x: this.cursor.x,
        y: this.cursor.y,
        deltaX: 0,
        deltaY: ev.deltaY,
      });
    }
  }

  screenshot(_opts?: unknown): Promise<Uint8Array> {
    return Promise.reject(new NotImplementedError("page.screenshot"));
  }

  // ---- internals --------------------------------------------------------------

  /** Helper: send a CDP method routed to this page's flat-mode session. */
  private send<T = unknown>(method: string, params?: unknown): Promise<T> {
    return this.router.send<T>(method, params, { sessionId: this.sessionId });
  }

  /** Subscribe to frame events to keep `currentUrl` and `mainFrameId` fresh. */
  private subscribeFrameTopology(): void {
    this.router.on("Page.frameNavigated", (params, sessionId) => {
      if (sessionId !== this.sessionId) return;
      const ev = params as FrameNavigatedEvent;
      // The main frame has no `parentId`. (For OOPIF subframes we ignore.)
      if (ev.frame.parentId === undefined) {
        this._mainFrameId = ev.frame.id;
        this.currentUrl = ev.frame.url;
      }
    });
    // Page.frameAttached is consumed for topology bookkeeping that grows in
    // later phases (worker fan-out, OOPIF correlation). v0.1 just acknowledges.
    this.router.on("Page.frameAttached", () => {});
  }

  private async documentNode(): Promise<DomNode> {
    const result = await this.send<{ root: DomNode }>("DOM.getDocument", {
      depth: 1,
    });
    return result.root;
  }

  private async documentObjectId(): Promise<string> {
    const root = await this.documentNode();
    const resolved = await this.send<{ object: RemoteObject }>("DOM.resolveNode", {
      backendNodeId: root.backendNodeId,
    });
    if (resolved.object.objectId === undefined) {
      throw new Error("[mochi] DOM.resolveNode returned no objectId for the document node");
    }
    return resolved.object.objectId;
  }

  private async evaluateSelectorState(selector: string, state: WaitState): Promise<boolean> {
    const docId = await this.documentObjectId();
    const fn =
      state === "attached"
        ? `function(sel) { return !!this.querySelector(sel); }`
        : state === "visible"
          ? `function(sel) {
              const el = this.querySelector(sel);
              if (!el) return false;
              const cs = (this.defaultView || window).getComputedStyle(el);
              const r = el.getBoundingClientRect();
              return cs.visibility !== 'hidden' && cs.display !== 'none' && r.width > 0 && r.height > 0;
            }`
          : `function(sel) {
              const el = this.querySelector(sel);
              if (!el) return true;
              const cs = (this.defaultView || window).getComputedStyle(el);
              const r = el.getBoundingClientRect();
              return cs.visibility === 'hidden' || cs.display === 'none' || r.width === 0 || r.height === 0;
            }`;
    const result = await this.send<{ result: RemoteObject }>("Runtime.callFunctionOn", {
      objectId: docId,
      functionDeclaration: fn,
      arguments: [{ value: selector }],
      returnByValue: true,
    });
    return result.result.value === true;
  }

  private assertOpen(): void {
    if (this.closed) {
      throw new Error("[mochi] page is closed");
    }
  }

  /** Send `Input.dispatchMouseEvent` against this page session. */
  private dispatchMouse(params: DispatchMouseEventParams): Promise<unknown> {
    return this.send("Input.dispatchMouseEvent", params);
  }

  /** Send `Input.dispatchKeyEvent` against this page session. */
  private dispatchKey(params: DispatchKeyEventParams): Promise<unknown> {
    return this.send("Input.dispatchKeyEvent", params);
  }

  /** Compose a per-call deterministic seed; different across humanX calls. */
  private nextCallSeed(): string {
    const n = this.callCounter++;
    return `${this.seed}:${this.targetId}:${n}`;
  }

  /** Read `window.scrollY` via the document objectId. */
  private async currentScrollY(): Promise<number> {
    const docId = await this.documentObjectId();
    const r = await this.send<{ result: RemoteObject }>("Runtime.callFunctionOn", {
      objectId: docId,
      functionDeclaration: "function() { return (this.defaultView || window).scrollY; }",
      returnByValue: true,
    });
    const v = r.result.value;
    return typeof v === "number" ? v : 0;
  }

  /**
   * Resolve a `humanScroll` target into an absolute scroll-Y. Selector → the
   * element's `top` plus current scroll. Coords → the y component.
   */
  private async resolveScrollTargetY(to: HumanScrollOptions["to"]): Promise<number> {
    if (typeof to !== "string") return to.y;
    const root = await this.documentNode();
    const found = await this.send<{ nodeId: number }>("DOM.querySelector", {
      nodeId: root.nodeId,
      selector: to,
    });
    if (found.nodeId === 0) {
      throw new Error(`[mochi] humanScroll: selector "${to}" matched no element`);
    }
    const resolved = await this.send<{ object: RemoteObject }>("DOM.resolveNode", {
      nodeId: found.nodeId,
    });
    if (resolved.object.objectId === undefined) {
      throw new Error("[mochi] humanScroll: failed to resolve node objectId");
    }
    const r = await this.send<{ result: RemoteObject }>("Runtime.callFunctionOn", {
      objectId: resolved.object.objectId,
      functionDeclaration:
        "function() { const r = this.getBoundingClientRect(); const w = this.ownerDocument.defaultView || window; return w.scrollY + r.top; }",
      returnByValue: true,
    });
    const v = r.result.value;
    return typeof v === "number" ? v : 0;
  }
}

// ---- module-private helpers -------------------------------------------------

/** Promise wrapper around `setTimeout`. */
function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

/**
 * Convert a CDP `BoxModel.border` quad into a {x, y, width, height} box.
 * The quad walks corners in CCW order; we take min/max for a robust AABB.
 */
function boxFromBorderQuad(model: BoxModel): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  const q = model.border;
  if (q.length < 8) {
    return { x: 0, y: 0, width: model.width, height: model.height };
  }
  const xs = [q[0] ?? 0, q[2] ?? 0, q[4] ?? 0, q[6] ?? 0];
  const ys = [q[1] ?? 0, q[3] ?? 0, q[5] ?? 0, q[7] ?? 0];
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  const width = Math.max(...xs) - x;
  const height = Math.max(...ys) - y;
  return { x, y, width, height };
}

/** CDP `buttons` mask for `Input.dispatchMouseEvent`. */
function buttonsMaskFor(button: "left" | "right" | "middle"): number {
  switch (button) {
    case "left":
      return 1;
    case "right":
      return 2;
    case "middle":
      return 4;
  }
}

/**
 * Cheap deterministic 32-bit hash → [0, 1) of a string. Used for the small
 * settle-delay and press-duration jitter in the dispatch layer (the major
 * randomness lives inside the synthesized event arrays). Not cryptographic.
 */
function hash01(s: string): number {
  let h = 2166136261 >>> 0; // FNV-1a 32-bit
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return (h >>> 0) / 0x1_0000_0000;
}
