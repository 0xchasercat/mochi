/**
 * `Page` — public surface for one Chromium tab/target.
 *
 * v0.1 implements: `goto`, `content`, `text`, `evaluate`, `waitFor`,
 * `cookies()`, `close()`, plus the `url` getter. `humanClick`, `humanType`,
 * `humanScroll`, and `screenshot` remain `NotImplementedError` placeholders
 * for phases 0.8 / later.
 *
 * Critical §8.3 design: NO `Runtime.enable` is ever sent. Evaluation routes
 * through `DOM.resolveNode` → `Runtime.callFunctionOn` against the document
 * node's `objectId`. That implicitly runs in main world without naming a
 * world (which would create a detectable isolated world; PLAN.md §8.4).
 *
 * @see PLAN.md §5.1 / §7 / §8.3 / §8.4
 */

import type { MessageRouter } from "./cdp/router";
import type { DomNode, FrameNavigatedEvent, RemoteObject } from "./cdp/types";
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

  constructor(init: PageInit) {
    this.router = init.router;
    this.targetId = init.targetId;
    this.sessionId = init.sessionId;
    this.currentUrl = init.initialUrl;
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
    try {
      // Target.closeTarget runs on the *root* (browser) target, not the page
      // session — it's how we tell the browser to kill that page.
      await this.router.send("Target.closeTarget", { targetId: this.targetId });
    } catch {
      // Ignore — session may already be tearing down.
    }
  }

  // ---- Phase 0.8 placeholders -------------------------------------------------

  humanClick(_selector: string, _opts?: unknown): Promise<void> {
    return Promise.reject(new NotImplementedError("page.humanClick"));
  }
  humanType(_selector: string, _text: string, _opts?: unknown): Promise<void> {
    return Promise.reject(new NotImplementedError("page.humanType"));
  }
  humanScroll(_opts: unknown): Promise<void> {
    return Promise.reject(new NotImplementedError("page.humanScroll"));
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
}
