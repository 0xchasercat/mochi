/**
 * `ElementHandle` — lightweight wrapper around a CDP `RemoteObject` that lets
 * callers operate on an element resolved via the closed-shadow piercing
 * locator (`Page.querySelectorPiercing`).
 *
 * The handle is intentionally minimal — Phase 0.2 only needs enough surface
 * for the Turnstile auto-clicker to ask "is this an iframe whose src matches
 * cf-turnstile?" and then position a click. Wider parity with Playwright's
 * `ElementHandle` (waitFor, fill, hover, screenshot…) is deferred — those
 * compose on top of the same primitives once they're needed.
 *
 * Lifecycle: the underlying `objectId` is bound to a CDP `Runtime` execution
 * context. Closing the page invalidates every handle the page produced; we
 * don't try to release them via `Runtime.releaseObject` because there's no
 * `Runtime.enable` in this session (PLAN.md §8.2). Stale handles surface as
 * `Cannot find context with specified id` errors from the next CDP call,
 * which is fine for a v0.2 surface.
 *
 * @see PLAN.md §8.2 / §8.3
 */

import type { MessageRouter } from "../cdp/router";
import type { CdpSessionId, RemoteObject } from "../cdp/types";

export interface ElementHandleInit {
  router: MessageRouter;
  sessionId: CdpSessionId;
  objectId: string;
  /** CDP `backendNodeId` — stable across DOM mutations. */
  backendNodeId: number;
}

/**
 * A handle to a single DOM element exposed to host-side automation. Issued
 * by `Page.querySelectorPiercing` / `Page.querySelectorAllPiercing`.
 */
export class ElementHandle {
  private readonly router: MessageRouter;
  private readonly sessionId: CdpSessionId;
  private readonly objectId: string;
  private readonly _backendNodeId: number;

  constructor(init: ElementHandleInit) {
    this.router = init.router;
    this.sessionId = init.sessionId;
    this.objectId = init.objectId;
    this._backendNodeId = init.backendNodeId;
  }

  /** The CDP `backendNodeId` for the element — stable across DOM mutations. */
  get backendNodeId(): number {
    return this._backendNodeId;
  }

  /**
   * Read a single attribute via `Runtime.callFunctionOn`. Returns `null` when
   * the attribute is absent (mirrors `Element.getAttribute`).
   */
  async getAttribute(name: string): Promise<string | null> {
    const r = await this.router.send<{ result: RemoteObject }>(
      "Runtime.callFunctionOn",
      {
        objectId: this.objectId,
        functionDeclaration:
          "function(n) { var v = this.getAttribute(n); return v === null ? null : String(v); }",
        arguments: [{ value: name }],
        returnByValue: true,
      },
      { sessionId: this.sessionId },
    );
    const v = r.result.value;
    return v === null || v === undefined ? null : String(v);
  }

  /**
   * Get the element's text content via `Runtime.callFunctionOn`.
   */
  async textContent(): Promise<string | null> {
    const r = await this.router.send<{ result: RemoteObject }>(
      "Runtime.callFunctionOn",
      {
        objectId: this.objectId,
        functionDeclaration: "function() { return this.textContent; }",
        returnByValue: true,
      },
      { sessionId: this.sessionId },
    );
    const v = r.result.value;
    return v === null || v === undefined ? null : String(v);
  }

  /**
   * Evaluate a function bound to this element (the handle is `this`). Result
   * is JSON-serialised via `returnByValue: true`. Same contract as
   * `Page.evaluate` — no closures, no arguments, no DOM-node returns.
   */
  async evaluate<T>(fn: (this: Element) => T): Promise<T> {
    const r = await this.router.send<{ result: RemoteObject }>(
      "Runtime.callFunctionOn",
      {
        objectId: this.objectId,
        functionDeclaration: fn.toString(),
        returnByValue: true,
      },
      { sessionId: this.sessionId },
    );
    return r.result.value as T;
  }
}
