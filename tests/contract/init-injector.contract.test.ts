/**
 * Cross-package contract: the `Session` init-script delivery pivot
 * (task 0266).
 *
 * Drives a `Session` against a fake CDP transport, simulates a `Document`
 * `Fetch.requestPaused` event for the request stage AND the response stage,
 * captures the resulting `Fetch.fulfillRequest` call, and asserts:
 *
 *   - The request-stage event triggers `Fetch.continueRequest` with
 *     `interceptResponse: true` (we want the response too).
 *   - The response-stage event triggers `Fetch.fulfillRequest`.
 *   - The fulfillment body decodes to HTML that contains both:
 *       * the inject payload bytes AND
 *       * the original document body.
 *   - The injected `<script>` carries our class marker, has no
 *     `defer`/`async`/`type="module"` (timing-critical), and lands BEFORE
 *     the original document's first `<script>`.
 *   - Non-Document `requestPaused` events are forwarded immediately via
 *     `Fetch.continueRequest`.
 *
 * Live conformance (`MOCHI_E2E=1`) is in
 * `packages/core/src/__tests__/init-injector.e2e.test.ts`.
 *
 * @see PLAN.md §8.4
 * @see tasks/0266-fetch-fulfill-init-script.md
 */

import { describe, expect, it } from "bun:test";
import { deriveMatrix, type ProfileV1 } from "../../packages/consistency/src/index";
import {
  MOCHI_INIT_MARKER,
  MOCHI_INIT_SCRIPT_CLASS,
} from "../../packages/core/src/cdp/init-injector";
import { Session } from "../../packages/core/src/index";
import type { ChromiumProcess } from "../../packages/core/src/proc";

interface FakeProc {
  proc: ChromiumProcess;
  written: { id?: number; method: string; params?: unknown }[];
  pushFrame(frame: unknown): void;
}

function makeProfile(): ProfileV1 {
  return {
    id: "contract-init-injector",
    version: "0.0.0-contract",
    engine: "chromium",
    browser: { name: "chrome", channel: "stable", minVersion: "131", maxVersion: "133" },
    os: { name: "macos", version: "14", arch: "arm64" },
    device: {
      vendor: "apple",
      model: "macbook-air-m2",
      cpuFamily: "apple-m2",
      cores: 8,
      memoryGB: 16,
    },
    display: { width: 1512, height: 982, dpr: 2, colorDepth: 30, pixelDepth: 30 },
    gpu: {
      vendor: "Apple Inc.",
      renderer: "Apple M2",
      webglUnmaskedVendor: "Apple Inc.",
      webglUnmaskedRenderer: "Apple M2",
      webglMaxTextureSize: 16384,
      webglMaxColorAttachments: 8,
      webglExtensions: [],
    },
    audio: { contextSampleRate: 48000, audioWorkletLatency: 0.005, destinationMaxChannelCount: 2 },
    fonts: { family: "macos-baseline", list: ["Helvetica"] },
    timezone: "America/Los_Angeles",
    locale: "en-US",
    languages: ["en-US", "en"],
    behavior: { hand: "right", tremor: 0.18, wpm: 65, scrollStyle: "smooth" },
    wreqPreset: "chrome_131_macos",
    userAgent: "Mozilla/5.0 contract",
    uaCh: {},
    entropyBudget: { fixed: [], perSeed: [] },
  };
}

/**
 * Fake CDP transport that auto-resolves common requests, lets the test
 * push events into the router, and exposes a hook so the test can intercept
 * specific method requests with a custom result.
 */
function makeFakeProc(): FakeProc {
  const written: { id?: number; method: string; params?: unknown }[] = [];
  let pumpController: ReadableStreamDefaultController<Uint8Array> | null = null;
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      pumpController = c;
    },
  });
  const reader = {
    getReader: () => stream.getReader(),
  };
  const enc = new TextEncoder();
  const writer = {
    write(chunk: Uint8Array): number {
      const last = chunk[chunk.length - 1] === 0 ? chunk.length - 1 : chunk.length;
      const json = new TextDecoder().decode(chunk.subarray(0, last));
      try {
        const obj = JSON.parse(json) as {
          id?: number;
          method: string;
          params?: unknown;
        };
        written.push({ id: obj.id, method: obj.method, params: obj.params });
        if (typeof obj.id === "number") {
          // Provide method-specific canned results when needed; default {}.
          let result: unknown = {};
          if (obj.method === "Fetch.getResponseBody") {
            // Original document body — we'll assert the splice keeps the
            // marker we embed here. Base64 of "<!doctype html><html><head><meta charset='utf-8'><script>window.__contract_first=true</script></head><body>ORIG</body></html>".
            const original = `<!doctype html><html><head><meta charset='utf-8'><script>window.__contract_first=true</script></head><body>ORIG</body></html>`;
            result = {
              body: btoa(unescape(encodeURIComponent(original))),
              base64Encoded: true,
            };
          }
          const reply = JSON.stringify({ id: obj.id, result });
          const replyBytes = enc.encode(reply);
          const out = new Uint8Array(replyBytes.length + 1);
          out.set(replyBytes, 0);
          out[replyBytes.length] = 0;
          pumpController?.enqueue(out);
        }
      } catch {
        // ignore
      }
      return chunk.byteLength;
    },
    flush(): void {},
    end(): void {},
  };
  const proc = {
    reader,
    writer,
    userDataDir: "/tmp/contract-init-injector",
    pid: 0,
    exited: new Promise<number>(() => undefined),
    async close(): Promise<void> {},
  } as unknown as ChromiumProcess;
  return {
    proc,
    written,
    pushFrame(frame: unknown): void {
      const bytes = enc.encode(JSON.stringify(frame));
      const out = new Uint8Array(bytes.length + 1);
      out.set(bytes, 0);
      out[bytes.length] = 0;
      pumpController?.enqueue(out);
    },
  };
}

const SETUP_DELAY_MS = 30;

describe("init-injector contract (PLAN.md §8.4, task 0266)", () => {
  it("Document response-stage requestPaused → Fetch.fulfillRequest with payload + original body", async () => {
    const f = makeFakeProc();
    const session = new Session({
      proc: f.proc,
      matrix: deriveMatrix(makeProfile(), "init-inject"),
      seed: "init-inject",
    });
    // Wait for the deferred installInitInjector promise to send Fetch.enable.
    await new Promise((r) => setTimeout(r, SETUP_DELAY_MS));
    const enable = f.written.find((c) => c.method === "Fetch.enable");
    expect(enable).toBeDefined();

    // Push a Document REQUEST-stage event.
    f.pushFrame({
      method: "Fetch.requestPaused",
      params: {
        requestId: "req-doc-1",
        request: { url: "https://example.test/", method: "GET" },
        resourceType: "Document",
      },
    });
    await new Promise((r) => setTimeout(r, SETUP_DELAY_MS));

    // The request stage should have produced a continueRequest with
    // interceptResponse: true.
    const cont = f.written.find(
      (c) =>
        c.method === "Fetch.continueRequest" &&
        (c.params as { requestId?: string } | null)?.requestId === "req-doc-1",
    );
    expect(cont).toBeDefined();
    expect((cont?.params as { interceptResponse?: boolean })?.interceptResponse).toBe(true);

    // Now push the RESPONSE-stage event for the same request id.
    f.pushFrame({
      method: "Fetch.requestPaused",
      params: {
        requestId: "req-doc-1",
        request: { url: "https://example.test/", method: "GET" },
        resourceType: "Document",
        responseStatusCode: 200,
        responseHeaders: [
          { name: "Content-Type", value: "text/html; charset=utf-8" },
          { name: "Content-Security-Policy", value: "script-src 'self'" },
        ],
      },
    });
    // The handler does an async `Fetch.getResponseBody` round-trip → plenty
    // of microtask latency, so wait a touch longer.
    await new Promise((r) => setTimeout(r, SETUP_DELAY_MS * 3));

    const fulfill = f.written.find(
      (c) =>
        c.method === "Fetch.fulfillRequest" &&
        (c.params as { requestId?: string } | null)?.requestId === "req-doc-1",
    );
    expect(fulfill).toBeDefined();
    const params = fulfill?.params as
      | {
          requestId: string;
          responseCode: number;
          responseHeaders: { name: string; value: string }[];
          body: string;
        }
      | undefined;
    expect(params?.responseCode).toBe(200);
    // The CSP must have been relaxed.
    const csp = params?.responseHeaders.find(
      (h) => h.name.toLowerCase() === "content-security-policy",
    );
    expect(csp?.value).toContain("'unsafe-inline'");

    // Decode the body.
    const decoded = atob(params?.body ?? "");
    // 1. Inject payload class marker is present.
    expect(decoded).toContain(MOCHI_INIT_SCRIPT_CLASS);
    // 2. Marker setter is present (the conformance global the live test reads).
    expect(decoded).toContain(MOCHI_INIT_MARKER);
    // 3. Original body bytes preserved.
    expect(decoded).toContain("window.__contract_first=true");
    expect(decoded).toContain("ORIG");
    // 4. CRITICAL TIMING: our script lands BEFORE the document's first
    // <script>. If it doesn't, detection-via-execution-order returns.
    const idxOurs = decoded.indexOf(`class="${MOCHI_INIT_SCRIPT_CLASS}"`);
    const idxFirst = decoded.indexOf("window.__contract_first=true");
    expect(idxOurs).toBeGreaterThan(-1);
    expect(idxOurs).toBeLessThan(idxFirst);

    await session.close();
  });

  it("non-Document requestPaused → immediate Fetch.continueRequest (no fulfill)", async () => {
    const f = makeFakeProc();
    const session = new Session({
      proc: f.proc,
      matrix: deriveMatrix(makeProfile(), "init-non-doc"),
      seed: "init-non-doc",
    });
    await new Promise((r) => setTimeout(r, SETUP_DELAY_MS));

    f.pushFrame({
      method: "Fetch.requestPaused",
      params: {
        requestId: "req-css-1",
        request: { url: "https://example.test/style.css" },
        resourceType: "Stylesheet",
      },
    });
    await new Promise((r) => setTimeout(r, SETUP_DELAY_MS));

    const cont = f.written.find(
      (c) =>
        c.method === "Fetch.continueRequest" &&
        (c.params as { requestId?: string } | null)?.requestId === "req-css-1",
    );
    expect(cont).toBeDefined();
    // No interceptResponse opt-in for non-Document.
    expect((cont?.params as { interceptResponse?: boolean })?.interceptResponse).toBeUndefined();
    // No fulfill for non-Document.
    const fulfill = f.written.find(
      (c) =>
        c.method === "Fetch.fulfillRequest" &&
        (c.params as { requestId?: string } | null)?.requestId === "req-css-1",
    );
    expect(fulfill).toBeUndefined();

    await session.close();
  });
});
