/**
 * Unit tests for `Page.screenshot` (task 0265).
 *
 * Exercises the CDP wire shape against a `MessageRouter` driven over a fake
 * pipe — no real Chromium spawn, no real `Session`. The router still applies
 * the §8.2 forbidden-method assertion on every send, so this test also
 * implicitly verifies that `Page.captureScreenshot` is NOT on the forbidden
 * list.
 *
 * Coverage:
 *   - PNG/JPEG params (format, quality)
 *   - clip with default scale
 *   - omitBackground passthrough
 *   - encoding: "base64" returns the raw string
 *   - encoding: "binary" (default) decodes to a Uint8Array — verified by
 *     constructing a known byte sequence, base64-encoding it, and asserting
 *     round-trip equality including the PNG magic bytes
 *   - fullPage: drives `Page.getLayoutMetrics` + `setDeviceMetricsOverride`
 *     + capture + `clearDeviceMetricsOverride` (in that order)
 *   - fullPage cleanup: `clearDeviceMetricsOverride` is called even when the
 *     capture itself rejects
 */

import { describe, expect, it } from "bun:test";
import { MessageRouter } from "../cdp/router";
import type { PipeReader, PipeWriter } from "../cdp/transport";
import { Page } from "../page";

interface RecordedRequest {
  id: number;
  method: string;
  params?: unknown;
  sessionId?: string;
}

interface FakeRouter {
  router: MessageRouter;
  requests: RecordedRequest[];
  /** Auto-respond to a method with a result (or error). */
  on(method: string, responder: (req: RecordedRequest) => unknown | { __error: string }): void;
  close(): Promise<void>;
}

function makeFakeRouter(): FakeRouter {
  const requests: RecordedRequest[] = [];
  let pumpController: ReadableStreamDefaultController<Uint8Array> | null = null;
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      pumpController = c;
    },
  });
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  const responders: Array<{
    method: string;
    fn: (req: RecordedRequest) => unknown | { __error: string };
  }> = [];

  const push = (obj: unknown): void => {
    const bytes = enc.encode(JSON.stringify(obj));
    const out = new Uint8Array(bytes.length + 1);
    out.set(bytes, 0);
    out[bytes.length] = 0;
    pumpController?.enqueue(out);
  };

  const reader: PipeReader = {
    getReader: () => stream.getReader(),
  };
  const writer: PipeWriter = {
    write: (chunk) => {
      const last = chunk[chunk.length - 1] === 0 ? chunk.length - 1 : chunk.length;
      const json = dec.decode(chunk.subarray(0, last));
      try {
        const parsed = JSON.parse(json) as RecordedRequest;
        requests.push(parsed);
        const r = responders.find((x) => x.method === parsed.method);
        if (r !== undefined && typeof parsed.id === "number") {
          queueMicrotask(() => {
            const result = r.fn(parsed);
            if (
              result !== null &&
              typeof result === "object" &&
              "__error" in result &&
              typeof (result as { __error: string }).__error === "string"
            ) {
              push({
                id: parsed.id,
                error: { code: -32000, message: (result as { __error: string }).__error },
              });
            } else {
              push({ id: parsed.id, result });
            }
          });
        }
      } catch {
        // ignore
      }
    },
    flush: () => undefined,
    end: () => undefined,
  };

  const router = new MessageRouter(reader, writer);
  router.start();

  return {
    router,
    requests,
    on(method, fn) {
      responders.push({ method, fn });
    },
    async close() {
      pumpController?.close();
      await router.close();
    },
  };
}

/** Build a Page wired to the fake router, no inject script. */
function makePage(fake: FakeRouter): Page {
  return new Page({
    router: fake.router,
    targetId: "target-1",
    sessionId: "session-1",
    initialUrl: "about:blank",
  });
}

describe("Page.screenshot — CDP wire shape", () => {
  it("default opts → Page.captureScreenshot { format: 'png' }, decodes base64 to Uint8Array", async () => {
    const fake = makeFakeRouter();
    try {
      // Construct a known byte sequence (the PNG magic + a few payload bytes)
      // and base64-encode it. The screenshot decoder should round-trip this
      // exactly back to a Uint8Array.
      const knownBytes = new Uint8Array([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xde, 0xad,
      ]);
      const b64 = Buffer.from(knownBytes).toString("base64");
      fake.on("Page.captureScreenshot", () => ({ data: b64 }));

      const page = makePage(fake);
      const result = await page.screenshot();

      expect(result).toBeInstanceOf(Uint8Array);
      expect(Array.from(result)).toEqual(Array.from(knownBytes));
      // PNG magic bytes
      expect(result[0]).toBe(0x89);
      expect(result[1]).toBe(0x50);
      expect(result[2]).toBe(0x4e);
      expect(result[3]).toBe(0x47);

      const captureReq = fake.requests.find((r) => r.method === "Page.captureScreenshot");
      expect(captureReq).toBeDefined();
      expect(captureReq?.params).toEqual({ format: "png" });
      expect(captureReq?.sessionId).toBe("session-1");
    } finally {
      await fake.close();
    }
  });

  it("encoding: 'base64' returns the raw CDP string (no decode)", async () => {
    const fake = makeFakeRouter();
    try {
      const knownBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
      const b64 = Buffer.from(knownBytes).toString("base64");
      fake.on("Page.captureScreenshot", () => ({ data: b64 }));

      const page = makePage(fake);
      const result = await page.screenshot({ encoding: "base64" });
      expect(typeof result).toBe("string");
      expect(result).toBe(b64);
    } finally {
      await fake.close();
    }
  });

  it("format: 'jpeg' + quality → params carry both", async () => {
    const fake = makeFakeRouter();
    try {
      fake.on("Page.captureScreenshot", () => ({ data: "AA==" }));
      const page = makePage(fake);
      await page.screenshot({ format: "jpeg", quality: 80 });

      const req = fake.requests.find((r) => r.method === "Page.captureScreenshot");
      expect(req?.params).toEqual({ format: "jpeg", quality: 80 });
    } finally {
      await fake.close();
    }
  });

  it("format: 'png' + quality → quality is dropped (PNG has no quality knob)", async () => {
    const fake = makeFakeRouter();
    try {
      fake.on("Page.captureScreenshot", () => ({ data: "AA==" }));
      const page = makePage(fake);
      await page.screenshot({ format: "png", quality: 80 });

      const req = fake.requests.find((r) => r.method === "Page.captureScreenshot");
      expect(req?.params).toEqual({ format: "png" });
    } finally {
      await fake.close();
    }
  });

  it("clip without scale → defaults scale to 1", async () => {
    const fake = makeFakeRouter();
    try {
      fake.on("Page.captureScreenshot", () => ({ data: "AA==" }));
      const page = makePage(fake);
      await page.screenshot({ clip: { x: 10, y: 20, width: 100, height: 50 } });

      const req = fake.requests.find((r) => r.method === "Page.captureScreenshot");
      expect(req?.params).toEqual({
        format: "png",
        clip: { x: 10, y: 20, width: 100, height: 50, scale: 1 },
      });
    } finally {
      await fake.close();
    }
  });

  it("clip with explicit scale is preserved", async () => {
    const fake = makeFakeRouter();
    try {
      fake.on("Page.captureScreenshot", () => ({ data: "AA==" }));
      const page = makePage(fake);
      await page.screenshot({ clip: { x: 0, y: 0, width: 50, height: 50, scale: 2 } });

      const req = fake.requests.find((r) => r.method === "Page.captureScreenshot");
      expect(req?.params).toEqual({
        format: "png",
        clip: { x: 0, y: 0, width: 50, height: 50, scale: 2 },
      });
    } finally {
      await fake.close();
    }
  });

  it("omitBackground passes through to params", async () => {
    const fake = makeFakeRouter();
    try {
      fake.on("Page.captureScreenshot", () => ({ data: "AA==" }));
      const page = makePage(fake);
      await page.screenshot({ omitBackground: true });

      const req = fake.requests.find((r) => r.method === "Page.captureScreenshot");
      expect(req?.params).toEqual({ format: "png", omitBackground: true });
    } finally {
      await fake.close();
    }
  });

  it("fullPage: true → getLayoutMetrics + setDeviceMetricsOverride + capture + clearDeviceMetricsOverride", async () => {
    const fake = makeFakeRouter();
    try {
      fake.on("Page.getLayoutMetrics", () => ({
        contentSize: { width: 1280, height: 4321 },
        layoutViewport: { clientWidth: 1280, clientHeight: 800 },
      }));
      fake.on("Emulation.setDeviceMetricsOverride", () => ({}));
      fake.on("Page.captureScreenshot", () => ({ data: "AA==" }));
      fake.on("Emulation.clearDeviceMetricsOverride", () => ({}));

      const page = makePage(fake);
      await page.screenshot({ fullPage: true });

      const methods = fake.requests.map((r) => r.method);
      // The four CDP methods must appear in this exact relative order.
      const idxMetrics = methods.indexOf("Page.getLayoutMetrics");
      const idxOverride = methods.indexOf("Emulation.setDeviceMetricsOverride");
      const idxCapture = methods.indexOf("Page.captureScreenshot");
      const idxClear = methods.indexOf("Emulation.clearDeviceMetricsOverride");
      expect(idxMetrics).toBeGreaterThanOrEqual(0);
      expect(idxOverride).toBeGreaterThan(idxMetrics);
      expect(idxCapture).toBeGreaterThan(idxOverride);
      expect(idxClear).toBeGreaterThan(idxCapture);

      const overrideReq = fake.requests[idxOverride];
      expect(overrideReq?.params).toEqual({
        width: 1280,
        height: 4321,
        deviceScaleFactor: 0,
        mobile: false,
      });

      // captureBeyondViewport must be set on the capture call so the renderer
      // paints past the visible area for the duration of the capture.
      const captureReq = fake.requests[idxCapture];
      expect(captureReq?.params).toEqual({
        format: "png",
        captureBeyondViewport: true,
      });
    } finally {
      await fake.close();
    }
  });

  it("fullPage cleanup: clearDeviceMetricsOverride runs even when capture rejects", async () => {
    const fake = makeFakeRouter();
    try {
      fake.on("Page.getLayoutMetrics", () => ({
        contentSize: { width: 1280, height: 4321 },
        layoutViewport: { clientWidth: 1280, clientHeight: 800 },
      }));
      fake.on("Emulation.setDeviceMetricsOverride", () => ({}));
      fake.on("Page.captureScreenshot", () => ({ __error: "Target detached mid-capture" }));
      fake.on("Emulation.clearDeviceMetricsOverride", () => ({}));

      const page = makePage(fake);
      let caught: unknown;
      try {
        await page.screenshot({ fullPage: true });
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeDefined();

      const methods = fake.requests.map((r) => r.method);
      // Despite the capture rejection, the clear must still have been sent.
      expect(methods).toContain("Emulation.clearDeviceMetricsOverride");
    } finally {
      await fake.close();
    }
  });

  it("fullPage + clip → clip wins, no device-metrics round-trip", async () => {
    const fake = makeFakeRouter();
    try {
      fake.on("Page.captureScreenshot", () => ({ data: "AA==" }));
      const page = makePage(fake);
      await page.screenshot({ fullPage: true, clip: { x: 0, y: 0, width: 10, height: 10 } });

      const methods = fake.requests.map((r) => r.method);
      expect(methods).not.toContain("Page.getLayoutMetrics");
      expect(methods).not.toContain("Emulation.setDeviceMetricsOverride");
      expect(methods).toContain("Page.captureScreenshot");
    } finally {
      await fake.close();
    }
  });

  it("rejects after the page has been closed", async () => {
    const fake = makeFakeRouter();
    try {
      fake.on("Target.closeTarget", () => ({ success: true }));
      const page = makePage(fake);
      await page.close();

      let caught: unknown;
      try {
        await page.screenshot();
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeDefined();
      expect((caught as Error).message).toMatch(/page is closed/);
    } finally {
      await fake.close();
    }
  });
});
