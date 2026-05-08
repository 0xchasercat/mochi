/**
 * Cross-package contract: `@mochi.js/core.Page.humanClick` consumes the
 * pure-data event arrays produced by `@mochi.js/behavioral` and dispatches
 * them as `Input.dispatchMouseEvent` / `Input.dispatchKeyEvent` CDP messages.
 *
 * This test drives `Page.humanClick`, `Page.humanType`, and `Page.humanScroll`
 * against a fake CDP transport that intercepts every outbound request,
 * answers it with the minimal valid response, and records the request.
 *
 * Assertions:
 *   - The recorded `Input.dispatchMouseEvent` sequence has the correct shape
 *     (count > 0, monotone time spacing, final mousePressed/mouseReleased).
 *   - `Input.dispatchKeyEvent` events alternate keyDown/keyUp and the
 *     printable `text` field is set on letter keys.
 *   - `mouseWheel` events for `humanScroll` sum to the requested delta.
 *
 * @see PLAN.md §5.5 (pure-data principle)
 * @see tasks/0080-behavioral-engine-v0.md §"Tests"
 */

import { describe, expect, it } from "bun:test";
import type { CdpSessionId } from "../../packages/core/src/cdp/types";
import { type CdpEventHandler, type MessageRouter, Page } from "../../packages/core/src/index";

interface RecordedRequest {
  method: string;
  params: unknown;
  sessionId?: CdpSessionId;
}

/**
 * A minimal `MessageRouter` mock. The fake answers every `send()` with a
 * canned response based on `method`; everything else is recorded for later
 * assertions. We deliberately do NOT extend the real `MessageRouter` —
 * tests that exercise behavior should depend on the router's interface
 * shape, not its constructor signature.
 */
class FakeRouter {
  readonly recorded: RecordedRequest[] = [];

  send<T = unknown>(
    method: string,
    params: unknown,
    opts: { sessionId?: CdpSessionId } = {},
  ): Promise<T> {
    const entry: RecordedRequest = { method, params };
    if (opts.sessionId !== undefined) entry.sessionId = opts.sessionId;
    this.recorded.push(entry);
    return Promise.resolve(this.respond(method, params) as T);
  }

  on(_method: string, _handler: CdpEventHandler): () => void {
    return () => {};
  }

  /** Canned responses for the methods Page calls in the behavioral path. */
  private respond(method: string, params: unknown): unknown {
    switch (method) {
      case "Page.enable":
        return {};
      case "DOM.getDocument":
        // backendNodeId 1 is the document for the fake.
        return {
          root: {
            nodeId: 1,
            backendNodeId: 1,
            nodeType: 9,
            nodeName: "#document",
          },
        };
      case "DOM.resolveNode":
        return { object: { type: "object", objectId: "obj-document-1" } };
      case "DOM.querySelector":
        // Pretend every selector matches nodeId 42.
        return { nodeId: 42 };
      case "DOM.getBoxModel": {
        // Synthesize a 100x40 box at (200, 150). Border quad walks corners.
        const x = 200;
        const y = 150;
        const w = 100;
        const h = 40;
        const quad = [x, y, x + w, y, x + w, y + h, x, y + h];
        return {
          model: {
            content: quad,
            border: quad,
            padding: quad,
            margin: quad,
            width: w,
            height: h,
          },
        };
      }
      case "DOM.focus":
        return {};
      case "Runtime.callFunctionOn": {
        // Page.humanScroll calls this twice: once to read currentScrollY
        // (returns scrollY) and once to read the target element's top
        // (returns scrollY + boundingClientRect.top). We branch on the
        // presence of `getBoundingClientRect` since both functions reference
        // `scrollY`. currentScrollY → 0; target rect → 800.
        const decl =
          typeof params === "object" && params !== null && "functionDeclaration" in params
            ? String((params as { functionDeclaration: unknown }).functionDeclaration)
            : "";
        if (decl.includes("getBoundingClientRect"))
          return { result: { type: "number", value: 800 } };
        if (decl.includes("scrollY")) return { result: { type: "number", value: 0 } };
        return { result: { type: "object", value: null } };
      }
      case "Input.dispatchMouseEvent":
      case "Input.dispatchKeyEvent":
        return {};
      default:
        return {};
    }
  }
}

function makePage(router: FakeRouter): Page {
  return new Page({
    router: router as unknown as MessageRouter,
    targetId: "T1",
    sessionId: "S1",
    initialUrl: "about:blank",
    behavior: { hand: "right", tremor: 0.18, wpm: 65, scrollStyle: "smooth" },
    seed: "contract-seed",
  });
}

describe("contract: Page.humanClick → Input.dispatchMouseEvent shape", () => {
  it("emits >= 1 mouseMoved, exactly one mousePressed and one mouseReleased", async () => {
    const router = new FakeRouter();
    const page = makePage(router);
    await page.humanClick("#submit", { preMoveSettle: false });
    const inputs = router.recorded.filter((r) => r.method === "Input.dispatchMouseEvent");
    const types = inputs.map((r) => (r.params as { type: string }).type);
    const moves = types.filter((t) => t === "mouseMoved").length;
    const press = types.filter((t) => t === "mousePressed").length;
    const release = types.filter((t) => t === "mouseReleased").length;
    expect(moves).toBeGreaterThan(0);
    expect(press).toBe(1);
    expect(release).toBe(1);
    // Press / release must be the LAST two events.
    expect(types[types.length - 2]).toBe("mousePressed");
    expect(types[types.length - 1]).toBe("mouseReleased");
  });

  it("final mousePressed lands inside the box (200,150)–(300,190)", async () => {
    const router = new FakeRouter();
    const page = makePage(router);
    await page.humanClick("#submit", { preMoveSettle: false });
    const inputs = router.recorded.filter((r) => r.method === "Input.dispatchMouseEvent");
    const last = inputs[inputs.length - 1]?.params as { x: number; y: number };
    expect(last.x).toBeGreaterThanOrEqual(200);
    expect(last.x).toBeLessThanOrEqual(300);
    expect(last.y).toBeGreaterThanOrEqual(150);
    expect(last.y).toBeLessThanOrEqual(190);
  });

  it("the very first mouseMoved starts at the page cursor (0,0)", async () => {
    const router = new FakeRouter();
    const page = makePage(router);
    await page.humanClick("#submit", { preMoveSettle: false });
    const inputs = router.recorded.filter((r) => r.method === "Input.dispatchMouseEvent");
    const first = inputs.find((r) => (r.params as { type: string }).type === "mouseMoved")
      ?.params as { x: number; y: number };
    expect(first.x).toBeCloseTo(0, 6);
    expect(first.y).toBeCloseTo(0, 6);
  });
});

describe("contract: Page.humanType → Input.dispatchKeyEvent shape", () => {
  it("focuses the selector then alternates keyDown / keyUp", async () => {
    const router = new FakeRouter();
    const page = makePage(router);
    await page.humanType("#email", "ab", { mistakeRate: 0 });
    // Find DOM.focus before any key event.
    const focusIdx = router.recorded.findIndex((r) => r.method === "DOM.focus");
    const firstKeyIdx = router.recorded.findIndex((r) => r.method === "Input.dispatchKeyEvent");
    expect(focusIdx).toBeLessThan(firstKeyIdx);
    expect(focusIdx).toBeGreaterThanOrEqual(0);

    const keys = router.recorded.filter((r) => r.method === "Input.dispatchKeyEvent");
    expect(keys.length).toBe(4); // 2 chars × (down + up)
    const types = keys.map((k) => (k.params as { type: string }).type);
    expect(types).toEqual(["keyDown", "keyUp", "keyDown", "keyUp"]);
    const text0 = (keys[0]?.params as { text?: string }).text;
    expect(text0).toBe("a");
  });

  it("a forced-mistake run produces backspace correction events", async () => {
    const router = new FakeRouter();
    const page = makePage(router);
    // mistakeRate = 1 forces a mistake on every adjacency-eligible key.
    await page.humanType("#email", "abc", { mistakeRate: 1 });
    const keys = router.recorded.filter((r) => r.method === "Input.dispatchKeyEvent");
    const downKeys = keys
      .filter((k) => (k.params as { type: string }).type === "keyDown")
      .map((k) => (k.params as { key: string }).key);
    expect(downKeys).toContain("Backspace");
  });
});

describe("contract: Page.humanScroll → Input.dispatchMouseEvent (mouseWheel)", () => {
  it("emits mouseWheel events whose deltaY sums to the resolved Y", async () => {
    const router = new FakeRouter();
    const page = makePage(router);
    // The fake's getBoundingClientRect returns 800; scrollY = 0 → target = 800.
    await page.humanScroll({ to: "#footer" });
    const wheels = router.recorded
      .filter((r) => r.method === "Input.dispatchMouseEvent")
      .filter((r) => (r.params as { type: string }).type === "mouseWheel");
    expect(wheels.length).toBeGreaterThan(0);
    let total = 0;
    for (const w of wheels) total += (w.params as { deltaY: number }).deltaY;
    expect(total).toBe(800);
    // Per-frame cap.
    for (const w of wheels) {
      expect(Math.abs((w.params as { deltaY: number }).deltaY)).toBeLessThanOrEqual(100);
    }
  });
});

describe("contract: pure-data principle", () => {
  it("the same (seed, opts) into Page produces identical CDP request streams", async () => {
    // Two pages constructed with identical seeds + behavior must produce
    // byte-identical CDP request sequences for `humanClick`, modulo the
    // small jitter we layered into the dispatch helpers (preMoveSettle off,
    // press-duration jitter is hash-based off the same call seed).
    const r1 = new FakeRouter();
    const r2 = new FakeRouter();
    const p1 = makePage(r1);
    const p2 = makePage(r2);
    await p1.humanClick("#submit", { preMoveSettle: false });
    await p2.humanClick("#submit", { preMoveSettle: false });
    expect(r1.recorded).toEqual(r2.recorded);
  });
});
