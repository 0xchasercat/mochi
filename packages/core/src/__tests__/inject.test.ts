/**
 * Unit tests for the inject pipeline as it interacts with `Session` —
 * specifically the `bypassInject` short-circuit that capture-style flows
 * (`mochi capture`, the eventual harness baseline collector) need so the
 * browser reports its bare, un-spoofed fingerprint.
 *
 * No real Chromium process is spawned; we drive `Session` against a fake
 * `ChromiumProcess` whose pipe reader/writer let us observe every CDP
 * request sent and inject canned responses. The §8.2 forbidden-method
 * assertions still gate every send through `MessageRouter`, so the test
 * implicitly enforces those too.
 *
 * @see PLAN.md §12.1 — capture must run against bare Chromium.
 * @see tasks/0040-mochi-capture.md — `bypassInject: true` requirement.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { deriveMatrix, type ProfileV1 } from "@mochi.js/consistency";
import type { PipeReader, PipeWriter } from "../cdp/transport";
import type { ChromiumProcess } from "../proc";
import { Session } from "../session";

interface FakeBrowser {
  process: ChromiumProcess;
  /** All CDP requests written to the pipe, decoded as JSON-RPC objects. */
  written: Array<{ id?: number; method?: string; params?: unknown; sessionId?: string }>;
  /** Inject one inbound JSON frame (CDP response or event). */
  push(obj: unknown): void;
  /** Auto-respond to any request matching `methodPredicate`. Returns the unsubscribe. */
  autoRespond(methodPredicate: (m: string) => boolean, result: unknown): void;
  /** Resolve when the next `n` writes have completed. */
  waitForWrites(n: number): Promise<void>;
}

function makeFakeBrowser(): FakeBrowser {
  const written: FakeBrowser["written"] = [];
  let pumpController: ReadableStreamDefaultController<Uint8Array> | null = null;
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      pumpController = c;
    },
  });
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  const autoResponders: Array<{ pred: (m: string) => boolean; result: unknown }> = [];
  const writeListeners: Array<() => void> = [];

  const reader: PipeReader = {
    getReader: () => stream.getReader(),
  };

  const push = (obj: unknown): void => {
    const bytes = enc.encode(JSON.stringify(obj));
    const out = new Uint8Array(bytes.length + 1);
    out.set(bytes, 0);
    out[bytes.length] = 0;
    pumpController?.enqueue(out);
  };

  const writer: PipeWriter = {
    write: (chunk) => {
      const last = chunk[chunk.length - 1] === 0 ? chunk.length - 1 : chunk.length;
      const json = dec.decode(chunk.subarray(0, last));
      try {
        const parsed = JSON.parse(json) as {
          id?: number;
          method?: string;
          params?: unknown;
          sessionId?: string;
        };
        written.push(parsed);
        // Notify listeners.
        const ls = writeListeners.splice(0, writeListeners.length);
        for (const fn of ls) fn();
        // Auto-respond if matched.
        if (typeof parsed.method === "string" && typeof parsed.id === "number") {
          const r = autoResponders.find((a) => a.pred(parsed.method ?? ""));
          if (r) {
            queueMicrotask(() => push({ id: parsed.id, result: r.result }));
          }
        }
      } catch {
        // ignore malformed
      }
    },
    flush: () => undefined,
    end: () => undefined,
  };

  let resolveExit: ((code: number) => void) | undefined;
  const exited = new Promise<number>((res) => {
    resolveExit = res;
  });

  let killed = false;
  const proc: ChromiumProcess = {
    userDataDir: "/tmp/fake-mochi-test",
    pid: 0,
    exited,
    reader,
    writer,
    close: async () => {
      if (killed) return;
      killed = true;
      try {
        pumpController?.close();
      } catch {
        // ignore
      }
      resolveExit?.(0);
    },
  };

  return {
    process: proc,
    written,
    push,
    autoRespond(pred, result) {
      autoResponders.push({ pred, result });
    },
    waitForWrites(n) {
      if (written.length >= n) return Promise.resolve();
      return new Promise<void>((resolve) => {
        const check = (): void => {
          if (written.length >= n) resolve();
          else writeListeners.push(check);
        };
        writeListeners.push(check);
      });
    },
  };
}

const TEST_PROFILE: ProfileV1 = {
  id: "bypass-inject-fixture",
  version: "0.0.0-test",
  engine: "chromium",
  browser: { name: "chrome", channel: "stable", minVersion: "131", maxVersion: "133" },
  os: { name: "macos", version: "14", arch: "arm64" },
  device: {
    vendor: "Apple",
    model: "Mac14,2",
    cpuFamily: "apple-silicon-m2",
    cores: 8,
    memoryGB: 16,
  },
  display: { width: 1728, height: 1117, dpr: 2, colorDepth: 30, pixelDepth: 30 },
  gpu: {
    vendor: "Apple Inc.",
    renderer: "Apple M2",
    webglUnmaskedVendor: "Google Inc. (Apple)",
    webglUnmaskedRenderer: "ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)",
    webglMaxTextureSize: 16384,
    webglMaxColorAttachments: 8,
    webglExtensions: [],
  },
  audio: { contextSampleRate: 48000, audioWorkletLatency: 0.005, destinationMaxChannelCount: 2 },
  fonts: { family: "macos-baseline", list: ["Helvetica"] },
  timezone: "America/Los_Angeles",
  locale: "en-US",
  languages: ["en-US", "en"],
  behavior: { hand: "right", tremor: 0.18, wpm: 60, scrollStyle: "smooth" },
  wreqPreset: "chrome_131_macos",
  userAgent:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.6778.86 Safari/537.36",
  uaCh: {},
  entropyBudget: { fixed: [], perSeed: [] },
};

describe("Session.bypassInject (PLAN.md §12.1, task 0040)", () => {
  let fake: FakeBrowser;
  let session: Session | undefined;

  beforeEach(() => {
    fake = makeFakeBrowser();
    session = undefined;
  });

  afterEach(async () => {
    if (session !== undefined) {
      try {
        await session.close();
      } catch {
        // best effort
      }
    }
  });

  it("with bypassInject:true — newPage() never sends Page.addScriptToEvaluateOnNewDocument", async () => {
    const matrix = deriveMatrix(TEST_PROFILE, "bypass-test");
    session = new Session({
      proc: fake.process,
      matrix,
      seed: "bypass-test",
      bypassInject: true,
    });

    // Auto-respond to the small set of CDP calls Session/newPage drives:
    // Target.setAutoAttach (constructor), Target.createTarget, Target.attachToTarget,
    // and Page.enable. These are the *only* writes we expect.
    fake.autoRespond((m) => m === "Target.setAutoAttach", {});
    fake.autoRespond((m) => m === "Target.createTarget", { targetId: "page-target-1" });
    fake.autoRespond((m) => m === "Target.attachToTarget", { sessionId: "session-1" });
    fake.autoRespond((m) => m === "Page.enable", {});
    fake.autoRespond((m) => m === "Target.closeTarget", { success: true });
    fake.autoRespond((m) => m === "Page.removeScriptToEvaluateOnNewDocument", {});
    fake.autoRespond((m) => m === "Page.addScriptToEvaluateOnNewDocument", {
      identifier: "should-never-fire",
    });

    const page = await session.newPage();
    expect(page).toBeDefined();

    const methods = fake.written
      .map((w) => w.method)
      .filter((m): m is string => typeof m === "string");
    expect(methods).toContain("Target.createTarget");
    expect(methods).toContain("Target.attachToTarget");
    expect(methods).toContain("Page.enable");
    // The contract: ZERO addScriptToEvaluateOnNewDocument sends.
    expect(methods).not.toContain("Page.addScriptToEvaluateOnNewDocument");
    // And no Runtime.evaluate either (worker injection is also bypassed).
    expect(methods).not.toContain("Runtime.evaluate");
  });

  it("with bypassInject:true — _internalPayload() is null", () => {
    const matrix = deriveMatrix(TEST_PROFILE, "null-payload");
    session = new Session({
      proc: fake.process,
      matrix,
      seed: "null-payload",
      bypassInject: true,
    });
    expect(session._internalPayload()).toBeNull();
    expect(session._internalBypassInject()).toBe(true);
  });

  it("with bypassInject omitted — _internalPayload() is non-null and newPage installs the inject script", async () => {
    const matrix = deriveMatrix(TEST_PROFILE, "default-inject");
    session = new Session({
      proc: fake.process,
      matrix,
      seed: "default-inject",
    });
    expect(session._internalBypassInject()).toBe(false);
    const payload = session._internalPayload();
    expect(payload).not.toBeNull();
    expect(payload?.code.length ?? 0).toBeGreaterThan(0);

    fake.autoRespond((m) => m === "Target.setAutoAttach", {});
    fake.autoRespond((m) => m === "Target.createTarget", { targetId: "page-target-2" });
    fake.autoRespond((m) => m === "Target.attachToTarget", { sessionId: "session-2" });
    fake.autoRespond((m) => m === "Page.enable", {});
    // Task 0262: Session sends Emulation.setTimezoneOverride per page.
    fake.autoRespond((m) => m === "Emulation.setTimezoneOverride", {});
    // Task 0255: Session now sends Network.setUserAgentOverride per page.
    fake.autoRespond((m) => m === "Network.setUserAgentOverride", {});
    fake.autoRespond((m) => m === "Target.closeTarget", { success: true });
    fake.autoRespond((m) => m === "Page.removeScriptToEvaluateOnNewDocument", {});
    fake.autoRespond((m) => m === "Page.addScriptToEvaluateOnNewDocument", {
      identifier: "inj-1",
    });

    const page = await session.newPage();
    expect(page).toBeDefined();

    const methods = fake.written
      .map((w) => w.method)
      .filter((m): m is string => typeof m === "string");
    // Default behavior: the inject script IS installed.
    expect(methods).toContain("Page.addScriptToEvaluateOnNewDocument");
    // And the params carry the compiled payload code.
    const installCall = fake.written.find(
      (w) => w.method === "Page.addScriptToEvaluateOnNewDocument",
    );
    const params = installCall?.params as { source?: string; runImmediately?: boolean } | undefined;
    expect(params?.source).toBe(payload?.code);
    expect(params?.runImmediately).toBe(true);
  });
});
