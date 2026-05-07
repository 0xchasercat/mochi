/**
 * Unit tests for `MessageRouter`. Use a fake transport (no Bun.spawn / no
 * Chromium) — we simulate inbound frames by calling the listener directly.
 *
 * Coverage targets:
 *   - request/response correlation by id
 *   - error responses surface as CdpRemoteError
 *   - timeouts surface as CdpTimeoutError
 *   - event subscriptions: on, once, off
 *   - close rejects pending calls with BrowserCrashedError
 *   - ForbiddenCdpMethodError surfaces synchronously through `.send()`
 */

import { describe, expect, it } from "bun:test";
import { ForbiddenCdpMethodError } from "../cdp/forbidden";
import { BrowserCrashedError, CdpRemoteError, CdpTimeoutError, MessageRouter } from "../cdp/router";
import type { PipeReader, PipeWriter } from "../cdp/transport";

interface FakeTransport {
  router: MessageRouter;
  /** All bytes the router has written, decoded as JSON-RPC objects. */
  written: unknown[];
  /** Inject one inbound JSON frame (router parses + dispatches). */
  push(json: unknown): void;
  /** Simulate browser exit / pipe close. */
  closeFromBrowser(reason?: Error): Promise<void>;
}

function makeRouter(opts: { defaultTimeoutMs?: number } = {}): FakeTransport {
  const written: unknown[] = [];
  // The fake reader never produces data on its own — we drive the router by
  // calling the framer-bypass pathway via the transport's onFrame listener.
  // To do that we re-construct: keep a reference to the listener, then create
  // the router with a stream that we control.
  let pumpController: ReadableStreamDefaultController<Uint8Array> | null = null;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      pumpController = controller;
    },
  });
  const reader: PipeReader = {
    getReader: () => stream.getReader(),
  };
  const writer: PipeWriter = {
    write: (chunk) => {
      // Strip trailing NUL and decode.
      const u8 = chunk;
      const last = u8[u8.length - 1] === 0 ? u8.length - 1 : u8.length;
      const json = new TextDecoder().decode(u8.subarray(0, last));
      try {
        written.push(JSON.parse(json));
      } catch {
        written.push(json);
      }
    },
    flush: () => undefined,
    end: () => undefined,
  };
  const router = new MessageRouter(reader, writer, opts);
  router.start();
  const enc = new TextEncoder();
  return {
    router,
    written,
    push(obj: unknown) {
      const bytes = enc.encode(JSON.stringify(obj));
      const out = new Uint8Array(bytes.length + 1);
      out.set(bytes, 0);
      out[bytes.length] = 0;
      pumpController?.enqueue(out);
    },
    async closeFromBrowser(reason?: Error) {
      pumpController?.close();
      await router.close(reason);
    },
  };
}

describe("MessageRouter", () => {
  it("correlates a response by id and resolves with `result`", async () => {
    const t = makeRouter();
    const p = t.router.send<{ ok: true }>("Page.enable");
    // The router assigned id=1 (first send).
    t.push({ id: 1, result: { ok: true } });
    const result = await p;
    expect(result).toEqual({ ok: true });
    expect((t.written[0] as { method: string }).method).toBe("Page.enable");
    await t.closeFromBrowser();
  });

  it("rejects with CdpRemoteError on a CDP error response", async () => {
    const t = makeRouter();
    const p = t.router.send("Page.navigate", { url: "bad" });
    t.push({ id: 1, error: { code: -32000, message: "Cannot navigate" } });
    let caught: unknown;
    try {
      await p;
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(CdpRemoteError);
    expect((caught as CdpRemoteError).method).toBe("Page.navigate");
    expect((caught as CdpRemoteError).code).toBe(-32000);
    await t.closeFromBrowser();
  });

  it("rejects with CdpTimeoutError after the deadline", async () => {
    const t = makeRouter({ defaultTimeoutMs: 50 });
    let caught: unknown;
    try {
      await t.router.send("Slow.method");
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(CdpTimeoutError);
    expect((caught as CdpTimeoutError).method).toBe("Slow.method");
    await t.closeFromBrowser();
  });

  it("dispatches events to on() handlers; supports unsubscribe", async () => {
    const t = makeRouter();
    const seen: unknown[] = [];
    const off = t.router.on("Page.frameNavigated", (params) => seen.push(params));
    t.push({ method: "Page.frameNavigated", params: { frame: { id: "f1" } } });
    t.push({ method: "Page.frameNavigated", params: { frame: { id: "f2" } } });
    await new Promise<void>((r) => setTimeout(r, 5));
    off();
    t.push({ method: "Page.frameNavigated", params: { frame: { id: "f3" } } });
    await new Promise<void>((r) => setTimeout(r, 5));
    expect(seen).toHaveLength(2);
    await t.closeFromBrowser();
  });

  it("once() handlers fire exactly once", async () => {
    const t = makeRouter();
    let count = 0;
    t.router.once("Page.loadEventFired", () => {
      count++;
    });
    t.push({ method: "Page.loadEventFired", params: {} });
    t.push({ method: "Page.loadEventFired", params: {} });
    await new Promise<void>((r) => setTimeout(r, 5));
    expect(count).toBe(1);
    await t.closeFromBrowser();
  });

  it("rejects pending calls with BrowserCrashedError when transport closes", async () => {
    const t = makeRouter();
    const p = t.router.send("Page.enable");
    await t.closeFromBrowser();
    let caught: unknown;
    try {
      await p;
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(BrowserCrashedError);
  });

  it("forbidden methods reject through .send() with ForbiddenCdpMethodError", async () => {
    const t = makeRouter();
    let caught: unknown;
    try {
      await t.router.send("Runtime.enable");
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ForbiddenCdpMethodError);

    let caught2: unknown;
    try {
      await t.router.send("Page.createIsolatedWorld", { frameId: "x" });
    } catch (err) {
      caught2 = err;
    }
    expect(caught2).toBeInstanceOf(ForbiddenCdpMethodError);

    let caught3: unknown;
    try {
      await t.router.send("Runtime.evaluate", {
        expression: "1+1",
        includeCommandLineAPI: true,
      });
    } catch (err) {
      caught3 = err;
    }
    expect(caught3).toBeInstanceOf(ForbiddenCdpMethodError);

    // None of those should have actually written anything to the transport.
    expect(t.written).toEqual([]);
    await t.closeFromBrowser();
  });
});
