/**
 * Cross-package contract: `@mochi.js/core.Page.evaluate` MUST send
 * `Runtime.callFunctionOn` with `awaitPromise: true` AND `returnByValue: true`,
 * AND its TypeScript signature MUST accept Promise-returning functions
 * (`() => T | Promise<T>`).
 *
 * Why this is a contract test (not just a unit test): mochi has a hard rule
 * (PLAN.md §8.3) that page evaluation routes through `DOM.resolveNode` →
 * `Runtime.callFunctionOn` against the document objectId — never via
 * `Runtime.evaluate`, never inside an isolated world. The `awaitPromise: true`
 * flag is the canonical CDP mechanism for waiting on a page-side Promise; per
 * §8.2 only `Runtime.enable` and `Page.createIsolatedWorld` are forbidden, so
 * `awaitPromise` is fine. Without it, every async page-side surface
 * (`navigator.userAgentData.getHighEntropyValues`, `fetch`, IndexedDB,
 * Permissions, etc.) round-trips its returned Promise as `undefined` and the
 * cross-layer parity tests (0261 UA-CH, 0262 IP/TZ/locale) silently fail.
 *
 * @see tasks/0263-page-evaluate-awaitpromise.md
 * @see PLAN.md §8.2 / §8.3
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
 * Minimal `MessageRouter` mock. Records every `send()` and answers with a
 * canned response keyed on `method`. The `Runtime.callFunctionOn` response is
 * driven by a per-instance closure so individual tests can plant either a
 * direct value or a "Promise-resolved" value.
 */
class FakeRouter {
  readonly recorded: RecordedRequest[] = [];
  callFunctionOnResult: unknown = { type: "undefined" };

  send<T = unknown>(
    method: string,
    params: unknown,
    opts: { sessionId?: CdpSessionId } = {},
  ): Promise<T> {
    const entry: RecordedRequest = { method, params };
    if (opts.sessionId !== undefined) entry.sessionId = opts.sessionId;
    this.recorded.push(entry);
    return Promise.resolve(this.respond(method) as T);
  }

  on(_method: string, _handler: CdpEventHandler): () => void {
    return () => {};
  }

  private respond(method: string): unknown {
    switch (method) {
      case "DOM.getDocument":
        return { root: { nodeId: 1, backendNodeId: 1, nodeType: 9, nodeName: "#document" } };
      case "DOM.resolveNode":
        return { object: { type: "object", objectId: "obj-document-1" } };
      case "Runtime.callFunctionOn":
        return { result: this.callFunctionOnResult };
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
  });
}

describe("contract: Page.evaluate → Runtime.callFunctionOn includes awaitPromise:true", () => {
  it("sends awaitPromise:true on every callFunctionOn", async () => {
    const router = new FakeRouter();
    router.callFunctionOnResult = { type: "number", value: 42 };
    const page = makePage(router);
    const value = await page.evaluate(() => 42);
    expect(value).toBe(42);

    const calls = router.recorded.filter((r) => r.method === "Runtime.callFunctionOn");
    expect(calls.length).toBe(1);
    const params = calls[0]?.params as Record<string, unknown>;
    expect(params.awaitPromise).toBe(true);
  });

  it("preserves returnByValue:true alongside awaitPromise (load-bearing for serialization)", async () => {
    const router = new FakeRouter();
    router.callFunctionOnResult = { type: "string", value: "ok" };
    const page = makePage(router);
    await page.evaluate(() => "ok");

    const params = router.recorded.find((r) => r.method === "Runtime.callFunctionOn")
      ?.params as Record<string, unknown>;
    expect(params.returnByValue).toBe(true);
    expect(params.awaitPromise).toBe(true);
  });

  it("targets the document objectId via DOM.resolveNode (PLAN.md §8.3 — no Runtime.evaluate, no isolated world)", async () => {
    const router = new FakeRouter();
    router.callFunctionOnResult = { type: "number", value: 1 };
    const page = makePage(router);
    await page.evaluate(() => 1);

    // Must resolve through DOM.getDocument → DOM.resolveNode → Runtime.callFunctionOn.
    const ordered = router.recorded.map((r) => r.method);
    expect(ordered.indexOf("DOM.getDocument")).toBeLessThan(ordered.indexOf("DOM.resolveNode"));
    expect(ordered.indexOf("DOM.resolveNode")).toBeLessThan(
      ordered.indexOf("Runtime.callFunctionOn"),
    );
    // And NEVER via Runtime.evaluate.
    expect(router.recorded.find((r) => r.method === "Runtime.evaluate")).toBeUndefined();
    // And NEVER via isolated-world creation.
    expect(router.recorded.find((r) => r.method === "Page.createIsolatedWorld")).toBeUndefined();
    // And NEVER turn on Runtime (forbidden per §8.2).
    expect(router.recorded.find((r) => r.method === "Runtime.enable")).toBeUndefined();

    // The objectId pinned to callFunctionOn is the one DOM.resolveNode produced.
    const callParams = router.recorded.find((r) => r.method === "Runtime.callFunctionOn")
      ?.params as Record<string, unknown>;
    expect(callParams.objectId).toBe("obj-document-1");
  });

  it("returns the resolved value when the page-side function is async (Promise round-trip)", async () => {
    const router = new FakeRouter();
    // CDP semantics with awaitPromise:true: the response carries the
    // RESOLVED value of the Promise, NOT a Promise-typed RemoteObject. The
    // fake router emulates that successful path here.
    router.callFunctionOnResult = { type: "number", value: 7 };
    const page = makePage(router);
    const value = await page.evaluate(async () => {
      await new Promise((r) => setTimeout(r, 1));
      return 7;
    });
    expect(value).toBe(7);
    // awaitPromise:true is what makes that resolution shape possible.
    const params = router.recorded.find((r) => r.method === "Runtime.callFunctionOn")
      ?.params as Record<string, unknown>;
    expect(params.awaitPromise).toBe(true);
  });

  it("ships fn.toString() as the functionDeclaration (no closure capture)", async () => {
    const router = new FakeRouter();
    router.callFunctionOnResult = { type: "number", value: 0 };
    const page = makePage(router);
    await page.evaluate(function selfNamed(this: Document) {
      return this.title.length;
    });
    const params = router.recorded.find((r) => r.method === "Runtime.callFunctionOn")
      ?.params as Record<string, unknown>;
    expect(typeof params.functionDeclaration).toBe("string");
    expect(params.functionDeclaration as string).toContain("this.title.length");
  });
});
