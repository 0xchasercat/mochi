/**
 * Cross-package contract: proxy auth wiring (task 0160).
 *
 * Verifies the structural-wiring contract between `LaunchOptions.proxy`
 * (string + `ProxyConfig` shapes) and the CDP `Fetch.authRequired`
 * handler:
 *
 *   1. `Session({ proxyAuth: { ... } })` calls `Fetch.enable`
 *      with `handleAuthRequests: true, patterns: []` and answers
 *      `Fetch.authRequired` events with `Fetch.continueWithAuth`.
 *   2. `Session()` without `proxyAuth` does NOT call `Fetch.enable`
 *      (no protocol surface, no perf cost).
 *   3. `Session.close()` sends `Fetch.disable` and tears down the listeners.
 *
 * We don't call `mochi.launch()` here because that would spawn Chromium —
 * we drive `Session` directly with a fake CDP transport.
 *
 * @see PLAN.md §8.2 / §10
 * @see tasks/0160-proxy-auth-and-ci-fix.md
 */

import { describe, expect, it } from "bun:test";
import { deriveMatrix, type ProfileV1 } from "../../packages/consistency/src/index";
import { Session } from "../../packages/core/src/index";
import type { ChromiumProcess } from "../../packages/core/src/proc";

interface FakeProc {
  proc: ChromiumProcess;
  written: { method: string; params?: unknown }[];
  pushFrame(frame: unknown): void;
}

function makeProfile(): ProfileV1 {
  return {
    id: "contract-proxy",
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

function makeFakeProc(): FakeProc {
  const written: { method: string; params?: unknown }[] = [];
  let pumpController: ReadableStreamDefaultController<Uint8Array> | null = null;
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      pumpController = c;
    },
  });
  const reader = {
    getReader: () => stream.getReader(),
  };
  const writer = {
    write(chunk: Uint8Array): number {
      const last = chunk[chunk.length - 1] === 0 ? chunk.length - 1 : chunk.length;
      const json = new TextDecoder().decode(chunk.subarray(0, last));
      try {
        const obj = JSON.parse(json) as { id?: number; method: string; params?: unknown };
        written.push({ method: obj.method, params: obj.params });
        // Auto-resolve the request so installProxyAuth's await doesn't hang.
        if (typeof obj.id === "number") {
          const reply = JSON.stringify({ id: obj.id, result: {} });
          const enc = new TextEncoder().encode(reply);
          const out = new Uint8Array(enc.length + 1);
          out.set(enc, 0);
          out[enc.length] = 0;
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
    userDataDir: "/tmp/contract-proxy",
    pid: 0,
    exited: new Promise<number>(() => undefined),
    async close(): Promise<void> {},
  } as unknown as ChromiumProcess;
  const enc = new TextEncoder();
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

describe("proxy-auth contract (PLAN.md §8.2 / §10, task 0160)", () => {
  it("with proxy auth: sends Fetch.enable on construction", async () => {
    const f = makeFakeProc();
    const session = new Session({
      proc: f.proc,
      matrix: deriveMatrix(makeProfile(), "seed"),
      seed: "seed",
      proxyAuth: { username: "u", password: "p" },
    });
    // Wait for the deferred installProxyAuth to settle.
    await new Promise((r) => setTimeout(r, SETUP_DELAY_MS));
    const enable = f.written.find((c) => c.method === "Fetch.enable");
    expect(enable).toBeDefined();
    expect(enable?.params).toEqual({ handleAuthRequests: true, patterns: [] });
    await session.close();
  });

  it("with proxy auth: answers Fetch.authRequired with credentials", async () => {
    const f = makeFakeProc();
    const session = new Session({
      proc: f.proc,
      matrix: deriveMatrix(makeProfile(), "seed"),
      seed: "seed",
      proxyAuth: { username: "alice", password: "s3cret" },
    });
    await new Promise((r) => setTimeout(r, SETUP_DELAY_MS));
    f.pushFrame({
      method: "Fetch.authRequired",
      params: { requestId: "req-1", authChallenge: { source: "Proxy" } },
    });
    await new Promise((r) => setTimeout(r, SETUP_DELAY_MS));
    const reply = f.written.find((c) => c.method === "Fetch.continueWithAuth");
    expect(reply).toBeDefined();
    expect(reply?.params).toEqual({
      requestId: "req-1",
      authChallengeResponse: {
        response: "ProvideCredentials",
        username: "alice",
        password: "s3cret",
      },
    });
    await session.close();
  });

  it("without proxy auth: NEVER sends Fetch.enable", async () => {
    const f = makeFakeProc();
    const session = new Session({
      proc: f.proc,
      matrix: deriveMatrix(makeProfile(), "seed"),
      seed: "seed",
    });
    await new Promise((r) => setTimeout(r, SETUP_DELAY_MS));
    const enable = f.written.find((c) => c.method === "Fetch.enable");
    expect(enable).toBeUndefined();
    await session.close();
  });

  it("close() sends Fetch.disable when proxy auth was active", async () => {
    const f = makeFakeProc();
    const session = new Session({
      proc: f.proc,
      matrix: deriveMatrix(makeProfile(), "seed"),
      seed: "seed",
      proxyAuth: { username: "u", password: "p" },
    });
    await new Promise((r) => setTimeout(r, SETUP_DELAY_MS));
    await session.close();
    const disable = f.written.find((c) => c.method === "Fetch.disable");
    expect(disable).toBeDefined();
  });

  it("close() does NOT send Fetch.disable when no proxy auth", async () => {
    const f = makeFakeProc();
    const session = new Session({
      proc: f.proc,
      matrix: deriveMatrix(makeProfile(), "seed"),
      seed: "seed",
    });
    await new Promise((r) => setTimeout(r, SETUP_DELAY_MS));
    await session.close();
    const disable = f.written.find((c) => c.method === "Fetch.disable");
    expect(disable).toBeUndefined();
  });
});
