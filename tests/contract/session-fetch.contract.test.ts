/**
 * Cross-package contract: `Session.fetch` (PLAN.md §7) is wired to Chromium
 * itself via CDP and exposes a dual-mechanism routing rule:
 *
 *   - **Mechanism A** — simple GETs (no `init` / no method override / no
 *     headers / no body) drive `Network.loadNetworkResource` against a
 *     lazily-allocated `about:blank` scratch frame. The body returns as an
 *     {@link IO.StreamHandle} that we drain via `IO.read` until EOF and
 *     then `IO.close`.
 *
 *   - **Mechanism B** — anything else (POST, custom headers, body) routes
 *     through `Runtime.callFunctionOn` against the scratch frame's
 *     document, evaluating `fetch(url, init)` in the page's main world.
 *     Cookies inherit; CORS applies for cross-origin POSTs.
 *
 * The contract test drives a fake CDP pipe — no Chromium spawn — so it
 * runs on every PR. The wire log captured by the helper is the assertion
 * surface: we pin the exact CDP method sequence each routing branch issues.
 *
 * @see PLAN.md §5.4 / §7
 * @see tasks/0290-drop-wreq-bump-chrome.md
 */

import { describe, expect, it } from "bun:test";
import { deriveMatrix, type ProfileV1 } from "../../packages/consistency/src/index";
import { Session } from "../../packages/core/src/index";
import { type CdpResponders, fakeChromiumProcess, makeFakePipe } from "../helpers/cdp-fixture";

function fixtureProfile(): ProfileV1 {
  return {
    id: "session-fetch-fixture",
    version: "0.0.0-contract",
    engine: "chromium",
    browser: { name: "chrome", channel: "stable", minVersion: "148", maxVersion: "148" },
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
    wreqPreset: "chrome_148_macos",
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36",
    uaCh: {},
    entropyBudget: { fixed: [], perSeed: [] },
  };
}

/**
 * Build a Session against a fake pipe with the responders needed to drive
 * one Session.fetch call.
 */
function makeSession(responders: CdpResponders) {
  const pipe = makeFakePipe({ responders });
  const matrix = deriveMatrix(fixtureProfile(), "contract-seed");
  const session = new Session({
    proc: fakeChromiumProcess(pipe, { userDataDir: "/tmp/session-fetch-contract" }),
    matrix,
    seed: "contract-seed",
    defaultTimeoutMs: 1000,
  });
  return { session, pipe };
}

describe("Session.fetch contract — Chromium-routed dual-mechanism (PLAN.md §7)", () => {
  it("routes simple GET via Network.loadNetworkResource (Mechanism A)", async () => {
    let count = 0;
    const { session, pipe } = makeSession({
      "Network.loadNetworkResource": () => ({
        resource: {
          success: true,
          httpStatusCode: 200,
          headers: { "content-type": "text/plain" },
          stream: "io-handle-1",
        },
      }),
      "IO.read": () => {
        count += 1;
        if (count === 1) return { data: "hello", eof: false };
        return { data: "", eof: true };
      },
      "IO.close": () => ({}),
    });

    try {
      const res = await session.fetch("https://example.com/api");
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("hello");

      const methods = pipe.written
        .map((f) => f.parsed.method)
        .filter((m): m is string => typeof m === "string");
      expect(methods).toContain("Target.createTarget");
      expect(methods).toContain("Target.attachToTarget");
      expect(methods).toContain("Page.enable");
      expect(methods).toContain("Page.getFrameTree");
      expect(methods).toContain("Network.loadNetworkResource");
      expect(methods).toContain("IO.read");
      expect(methods).toContain("IO.close");
      // Mechanism A MUST NOT use Runtime.callFunctionOn for the response.
      expect(methods).not.toContain("Runtime.callFunctionOn");
    } finally {
      await session.close();
    }
  });

  it("routes POST with body via Runtime.callFunctionOn (Mechanism B)", async () => {
    const { session, pipe } = makeSession({
      "DOM.getDocument": () => ({ root: { nodeId: 1 } }),
      "DOM.resolveNode": () => ({ object: { objectId: "doc-obj-1" } }),
      "Runtime.callFunctionOn": () => ({
        result: {
          type: "object",
          value: {
            status: 201,
            headers: { "content-type": "application/json" },
            // base64 of `{"ok":true}`
            bodyB64: "eyJvayI6dHJ1ZX0=",
          },
        },
      }),
    });

    try {
      const res = await session.fetch("https://example.com/api", {
        method: "POST",
        headers: { "x-mochi": "1" },
        body: JSON.stringify({ k: "v" }),
      });
      expect(res.status).toBe(201);
      expect(await res.json()).toEqual({ ok: true });

      const methods = pipe.written
        .map((f) => f.parsed.method)
        .filter((m): m is string => typeof m === "string");
      expect(methods).toContain("DOM.getDocument");
      expect(methods).toContain("DOM.resolveNode");
      expect(methods).toContain("Runtime.callFunctionOn");
      // Mechanism B MUST NOT use Network.loadNetworkResource for the body.
      expect(methods).not.toContain("Network.loadNetworkResource");
    } finally {
      await session.close();
    }
  });

  it("reuses the scratch frame across multiple fetches", async () => {
    let chunkCount = 0;
    const { session, pipe } = makeSession({
      "Network.loadNetworkResource": () => ({
        resource: {
          success: true,
          httpStatusCode: 200,
          headers: {},
          stream: "io-handle-x",
        },
      }),
      "IO.read": () => {
        chunkCount += 1;
        return chunkCount % 2 === 1 ? { data: "x", eof: false } : { data: "", eof: true };
      },
      "IO.close": () => ({}),
    });

    try {
      await session.fetch("https://example.com/a");
      await session.fetch("https://example.com/b");
      await session.fetch("https://example.com/c");

      const createCount = pipe.written.filter(
        (f) => f.parsed.method === "Target.createTarget",
      ).length;
      expect(createCount).toBe(1);
    } finally {
      await session.close();
    }
  });

  it("closes the scratch frame on Session.close", async () => {
    let closeCount = 0;
    const { session } = makeSession({
      "Network.loadNetworkResource": () => ({
        resource: { success: true, httpStatusCode: 200, headers: {}, stream: "io-h" },
      }),
      "IO.read": () => ({ data: "", eof: true }),
      "IO.close": () => ({}),
      "Target.closeTarget": () => {
        closeCount += 1;
        return { success: true };
      },
    });

    await session.fetch("https://example.com/x");
    await session.close();
    expect(closeCount).toBeGreaterThanOrEqual(1);
  });

  it("does not allocate a scratch frame if fetch is never called", async () => {
    const { session, pipe } = makeSession({});
    // Allow the constructor's auto-attach send (Target.setAutoAttach)
    // and its response microtask to settle before tearing down the
    // pipe — otherwise the in-flight response races with router.close
    // and trips a "Controller is already closed" warning that's
    // pre-existing fixture noise unrelated to Session.fetch.
    await new Promise((r) => setTimeout(r, 20));
    await session.close();
    const createCount = pipe.written.filter(
      (f) => f.parsed.method === "Target.createTarget",
    ).length;
    expect(createCount).toBe(0);
  });

  it("rejects FormData bodies eagerly with a clear diagnostic", async () => {
    const { session, pipe } = makeSession({});
    try {
      const fd = new FormData();
      fd.append("k", "v");
      await expect(
        session.fetch("https://example.com", { method: "POST", body: fd }),
      ).rejects.toThrow(/not yet supported/);
      // Validation must fire BEFORE any CDP send — no scratch frame
      // allocated on a body-shape rejection.
      const createCount = pipe.written.filter(
        (f) => f.parsed.method === "Target.createTarget",
      ).length;
      expect(createCount).toBe(0);
    } finally {
      await session.close();
    }
  });

  it("surfaces Network.loadNetworkResource failures with netErrorName", async () => {
    const { session } = makeSession({
      "Network.loadNetworkResource": () => ({
        resource: { success: false, netErrorName: "net::ERR_NAME_NOT_RESOLVED" },
      }),
    });
    try {
      await expect(session.fetch("https://does-not-resolve.example")).rejects.toThrow(
        /ERR_NAME_NOT_RESOLVED/,
      );
    } finally {
      await session.close();
    }
  });
});
