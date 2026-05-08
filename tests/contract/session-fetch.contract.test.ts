/**
 * Cross-package contract: `Session.fetch` (PLAN.md §7) is wired to
 * `@mochi.js/net.requestOnCtx`, takes the v1-public signature
 * `(url: string, init?: RequestInit) => Promise<Response>`, and lazily
 * opens / closes a per-Session NetCtx.
 *
 * This contract runs without a built cdylib by injecting a stub `NetAdapter`
 * via the (internal) `SessionInit.netAdapter` seam — we never call `loadLib`
 * or hit the network. The structural-wiring assertions are what protect the
 * public API from drift.
 *
 * @see PLAN.md §5.4 / §7 / §10
 * @see tasks/0060-network-ffi.md
 */

import { beforeEach, describe, expect, it } from "bun:test";
import { deriveMatrix, type ProfileV1 } from "../../packages/consistency/src/index";
import { Session } from "../../packages/core/src/index";
import type { NetAdapter } from "../../packages/core/src/session";
import type { NetCtx } from "../../packages/net/src/index";
import { fakeChromiumProcess, makeFakePipe } from "../helpers/cdp-fixture";

interface CallLog {
  opened: number;
  closed: number;
  lastInit: { preset: string; proxy?: string } | undefined;
  requested: number;
  lastRequestUrl: string | undefined;
  lastRequestInit: Record<string, unknown> | undefined;
}

function makeLog(): CallLog {
  return {
    opened: 0,
    closed: 0,
    lastInit: undefined,
    requested: 0,
    lastRequestUrl: undefined,
    lastRequestInit: undefined,
  };
}

function makeAdapter(log: CallLog): NetAdapter {
  return {
    openCtx(spec) {
      log.opened += 1;
      log.lastInit = spec;
      let closed = false;
      return {
        handle: 1 as unknown as NetCtx["handle"],
        close(): void {
          if (closed) return;
          closed = true;
          log.closed += 1;
        },
      };
    },
    requestOnCtx(_ctx, url, init): Response {
      log.requested += 1;
      log.lastRequestUrl = url;
      log.lastRequestInit = init as unknown as Record<string, unknown>;
      return new Response("ok", { status: 200 });
    },
  };
}

function makeMatrix(preset: string) {
  const fixture: ProfileV1 = {
    id: "contract-fixture",
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
    wreqPreset: preset,
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    uaCh: {},
    entropyBudget: { fixed: [], perSeed: [] },
  };
  return deriveMatrix(fixture, "contract-seed");
}

function makeStubSession(
  matrix: ReturnType<typeof makeMatrix>,
  adapter: NetAdapter,
  opts: { netProxy?: string } = {},
): Session {
  // The session-fetch contract doesn't exercise CDP at all — the helper
  // gives us a no-op pipe surface that satisfies the transport, with
  // `manual: true` so the auto-responder does nothing.
  const pipe = makeFakePipe({ manual: true });
  return new Session({
    proc: fakeChromiumProcess(pipe, { userDataDir: "/tmp/contract" }),
    matrix,
    seed: "contract-seed",
    netAdapter: adapter,
    ...(opts.netProxy !== undefined ? { netProxy: opts.netProxy } : {}),
  });
}

describe("Session.fetch contract (PLAN.md §7)", () => {
  let log: CallLog;
  let adapter: NetAdapter;

  beforeEach(() => {
    log = makeLog();
    adapter = makeAdapter(log);
  });

  it("Session.fetch matches the v1 signature and returns a Response", async () => {
    const session = makeStubSession(makeMatrix("chrome_131_macos"), adapter);
    try {
      const res = await session.fetch("https://example.com/api", {
        method: "GET",
        headers: { "x-mochi": "1" },
      });
      expect(res).toBeInstanceOf(Response);
      expect(res.status).toBe(200);
      expect(log.opened).toBe(1);
      expect(log.lastInit?.preset).toBe("chrome_131_macos");
      expect(log.requested).toBe(1);
      expect(log.lastRequestUrl).toBe("https://example.com/api");
      const init = log.lastRequestInit ?? {};
      expect(init.preset).toBe("chrome_131_macos");
      expect(init.method).toBe("GET");
      const headers = init.headers as Record<string, string>;
      expect(headers["x-mochi"]).toBe("1");
    } finally {
      await session.close();
    }
  });

  it("reuses one NetCtx across multiple fetches", async () => {
    const session = makeStubSession(makeMatrix("chrome_131_macos"), adapter);
    try {
      await session.fetch("https://example.com/a");
      await session.fetch("https://example.com/b");
      await session.fetch("https://example.com/c");
      expect(log.opened).toBe(1);
      expect(log.requested).toBe(3);
    } finally {
      await session.close();
    }
    expect(log.closed).toBe(1);
  });

  it("forwards launch-time proxy to the NetCtx", async () => {
    const session = makeStubSession(makeMatrix("chrome_131_macos"), adapter, {
      netProxy: "http://proxy.example:8080",
    });
    try {
      await session.fetch("https://example.com/p");
      expect(log.lastInit?.proxy).toBe("http://proxy.example:8080");
    } finally {
      await session.close();
    }
  });

  it("closes the NetCtx on Session.close (idempotent)", async () => {
    const session = makeStubSession(makeMatrix("chrome_131_macos"), adapter);
    await session.fetch("https://example.com/x");
    await session.close();
    await session.close();
    expect(log.closed).toBe(1);
  });

  it("does not open a NetCtx if fetch is never called", async () => {
    const session = makeStubSession(makeMatrix("chrome_131_macos"), adapter);
    await session.close();
    expect(log.opened).toBe(0);
    expect(log.closed).toBe(0);
  });

  it("rejects unsupported body types per task brief §Deferred", async () => {
    const session = makeStubSession(makeMatrix("chrome_131_macos"), adapter);
    try {
      const formData = new FormData();
      formData.append("k", "v");
      await expect(
        session.fetch("https://example.com", { method: "POST", body: formData }),
      ).rejects.toThrow(/only string, ArrayBuffer/);
    } finally {
      await session.close();
    }
  });

  it("forwards URLSearchParams body as a UTF-8 string", async () => {
    const session = makeStubSession(makeMatrix("chrome_131_macos"), adapter);
    try {
      const params = new URLSearchParams({ a: "1", b: "two" });
      await session.fetch("https://example.com/form", { method: "POST", body: params });
      const init = log.lastRequestInit ?? {};
      expect(init.body).toBe("a=1&b=two");
    } finally {
      await session.close();
    }
  });
});
