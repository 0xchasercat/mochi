/**
 * Cross-package contract: when `Session` is launched with
 * `challenges.turnstile.autoClick: true`, every `newPage()` ends up sending
 * a SECOND `Page.addScriptToEvaluateOnNewDocument` (the Turnstile detector
 * inject) on top of the matrix payload.
 *
 * This pins the §8.4 invariant the brief calls out explicitly: the Turnstile
 * detector MUST be installed via
 * `Page.addScriptToEvaluateOnNewDocument({ runImmediately:true, worldName:"" })`
 * — NOT via `page.evaluate(...)` after navigation.
 *
 * Strategy: drive a `Session` against the same fake-pipe transport used by
 * `inject-no-runtime-enable.contract.test.ts`, count the
 * `Page.addScriptToEvaluateOnNewDocument` frames per `newPage`, and assert
 * the second frame's `source` carries the Turnstile detector's wire markers
 * (the `__mochi_event` magic tag + the cf-turnstile-response selector).
 *
 * @see PLAN.md §8.4
 * @see tasks/0220-turnstile-auto-click.md §"Detection"
 */

import { describe, expect, it } from "bun:test";
import {
  buildTurnstileInjectScript,
  installTurnstileAutoClick,
  TURNSTILE_EVENT_NAMES,
  TURNSTILE_READER_KEY,
} from "../../packages/challenges/src/index";
import type { ProfileV1 } from "../../packages/consistency/src/index";
import { deriveMatrix } from "../../packages/consistency/src/index";
import type { PipeReader, PipeWriter } from "../../packages/core/src/cdp/transport";
import { Session } from "../../packages/core/src/session";

interface RecordedFrame {
  raw: string;
  parsed: { id?: number; method?: string; params?: unknown; sessionId?: string };
}

function makeFakePipes(): {
  reader: PipeReader;
  writer: PipeWriter;
  written: RecordedFrame[];
  inject: (msg: object) => void;
} {
  const written: RecordedFrame[] = [];
  let pushChunk: ((chunk: Uint8Array) => void) | null = null;
  const stream = new ReadableStream<Uint8Array>({
    start(ctrl) {
      pushChunk = (chunk) => ctrl.enqueue(chunk);
    },
  });
  return {
    reader: { getReader: () => stream.getReader() },
    writer: {
      write(chunk) {
        const buf = chunk as Uint8Array;
        const end = buf[buf.length - 1] === 0 ? buf.length - 1 : buf.length;
        const raw = new TextDecoder().decode(buf.subarray(0, end));
        let parsed: RecordedFrame["parsed"] = {};
        try {
          parsed = JSON.parse(raw) as RecordedFrame["parsed"];
        } catch {
          // ignore
        }
        written.push({ raw, parsed });
      },
      flush() {},
      end() {},
    },
    written,
    inject(msg) {
      if (pushChunk === null) throw new Error("pipe not ready");
      // CDP pipe protocol: frames are NUL-delimited (see cdp/framer.ts).
      const json = JSON.stringify(msg);
      const utf8 = new TextEncoder().encode(json);
      const out = new Uint8Array(utf8.length + 1);
      out.set(utf8, 0);
      out[utf8.length] = 0;
      pushChunk(out);
    },
  };
}

function fixtureProfile(): ProfileV1 {
  return {
    id: "challenges-turnstile-contract",
    version: "0.0.0",
    engine: "chromium",
    browser: { name: "chrome", channel: "stable", minVersion: "131", maxVersion: "133" },
    os: { name: "macos", version: "14", arch: "arm64" },
    device: { vendor: "Apple", model: "M2", cpuFamily: "apple-silicon-m2", cores: 8, memoryGB: 16 },
    display: { width: 1728, height: 1117, dpr: 2, colorDepth: 30, pixelDepth: 30 },
    gpu: {
      vendor: "Apple Inc.",
      renderer: "Apple M2",
      webglUnmaskedVendor: "Google Inc. (Apple)",
      webglUnmaskedRenderer: "ANGLE (Apple, ANGLE Metal Renderer: Apple M2)",
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
    userAgent: "Mozilla/5.0 contract",
    uaCh: {},
    entropyBudget: { fixed: [], perSeed: [] },
  };
}

/** Install the canned-response responder used by every test below. */
function startResponder(written: RecordedFrame[], inject: (msg: object) => void): NodeJS.Timeout {
  let identifierCounter = 0;
  let pollCount = 0;
  const responder = setInterval(() => {
    pollCount++;
    for (const frame of written) {
      const f = frame.parsed;
      const responded = (frame as unknown as { __responded?: boolean }).__responded;
      if (responded === true) continue;
      if (typeof f.id !== "number") continue;
      const tag = frame as unknown as { __responded: boolean };
      if (f.method === "Target.setAutoAttach") {
        inject({ id: f.id, result: {} });
        tag.__responded = true;
      } else if (f.method === "Target.createTarget") {
        inject({ id: f.id, result: { targetId: `tgt-${++identifierCounter}` } });
        tag.__responded = true;
      } else if (f.method === "Target.attachToTarget") {
        inject({ id: f.id, result: { sessionId: `sess-${identifierCounter}` } });
        tag.__responded = true;
      } else if (f.method === "Page.enable") {
        inject({ id: f.id, result: {} });
        tag.__responded = true;
      } else if (f.method === "Page.addScriptToEvaluateOnNewDocument") {
        inject({ id: f.id, result: { identifier: `scr-${++identifierCounter}` } });
        tag.__responded = true;
      } else if (f.method === "Page.removeScriptToEvaluateOnNewDocument") {
        inject({ id: f.id, result: {} });
        tag.__responded = true;
      } else if (f.method === "Target.closeTarget") {
        inject({ id: f.id, result: { success: true } });
        tag.__responded = true;
      }
    }
    if (pollCount > 400) clearInterval(responder);
  }, 5);
  return responder;
}

describe("contract: challenges.turnstile.autoClick wires the inject script", () => {
  it("Session.newPage with autoClick:true installs the Turnstile detector via addScriptToEvaluateOnNewDocument", async () => {
    const { reader, writer, written, inject } = makeFakePipes();
    const matrix = deriveMatrix(fixtureProfile(), "contract");

    const session = new Session({
      proc: {
        reader,
        writer,
        userDataDir: "/tmp/contract-fake",
        pid: 0,
        exited: new Promise<number>(() => undefined),
        close: async () => undefined,
      },
      matrix,
      seed: "contract",
      defaultTimeoutMs: 2000,
      challenges: { turnstile: { autoClick: true } },
    });

    const responder = startResponder(written, inject);
    try {
      const page = await session.newPage();
      // The detector inject is fire-and-forget after newPage. Give the
      // event loop a few ticks for the second addScript frame to land.
      await new Promise((r) => setTimeout(r, 100));

      const installFrames = written.filter(
        (f) => f.parsed.method === "Page.addScriptToEvaluateOnNewDocument",
      );
      // The matrix payload is the first install; the Turnstile detector
      // is the second. We assert >= 2 because this is the contract.
      expect(installFrames.length).toBeGreaterThanOrEqual(2);

      // The Turnstile detector frame is the one whose source mentions the
      // detector's wire markers — the magic-tag event name and the
      // cf-turnstile-response selector — neither of which appears in the
      // matrix payload.
      const detectorFrame = installFrames.find((f) => {
        const params = f.parsed.params as { source?: string } | undefined;
        const src = params?.source ?? "";
        return (
          src.indexOf(TURNSTILE_EVENT_NAMES.detected) >= 0 &&
          src.indexOf("cf-turnstile-response") >= 0
        );
      });
      expect(detectorFrame).toBeDefined();

      const detectorParams = detectorFrame?.parsed.params as {
        worldName?: string;
        runImmediately?: boolean;
        source?: string;
        includeCommandLineAPI?: boolean;
      };
      // PLAN.md §8.4: main world (worldName: "") and run immediately so the
      // MutationObserver beats the page's own Turnstile bootstrap.
      expect(detectorParams.worldName).toBe("");
      expect(detectorParams.runImmediately).toBe(true);
      expect(detectorParams.includeCommandLineAPI).toBeUndefined();
      // The reader-key Symbol must be in the script — that's how the mochi-
      // side poller finds the snapshot reader.
      expect(detectorParams.source).toContain(TURNSTILE_READER_KEY);

      await page.close();
    } finally {
      clearInterval(responder);
      await session.close();
    }
  }, 10_000);

  it("Session.newPage with autoClick:false (default) does NOT install the detector", async () => {
    const { reader, writer, written, inject } = makeFakePipes();
    const matrix = deriveMatrix(fixtureProfile(), "contract");

    // No `challenges` — should match v0.1 behavior exactly.
    const session = new Session({
      proc: {
        reader,
        writer,
        userDataDir: "/tmp/contract-fake-2",
        pid: 0,
        exited: new Promise<number>(() => undefined),
        close: async () => undefined,
      },
      matrix,
      seed: "contract",
      defaultTimeoutMs: 2000,
    });

    const responder = startResponder(written, inject);
    try {
      const page = await session.newPage();
      await new Promise((r) => setTimeout(r, 100));

      const detectorFrame = written.find((f) => {
        if (f.parsed.method !== "Page.addScriptToEvaluateOnNewDocument") return false;
        const params = f.parsed.params as { source?: string } | undefined;
        const src = params?.source ?? "";
        return src.indexOf(TURNSTILE_EVENT_NAMES.detected) >= 0;
      });
      expect(detectorFrame).toBeUndefined();

      await page.close();
    } finally {
      clearInterval(responder);
      await session.close();
    }
  }, 10_000);
});

describe("contract: installTurnstileAutoClick PageLike surface", () => {
  it("calls page.addInitScript with the buildTurnstileInjectScript output", async () => {
    const calls: { source: string; identifier: string }[] = [];
    const fakePage = {
      humanClick: async (): Promise<void> => undefined,
      evaluate: async <T>(): Promise<T> => ({ found: false, frames: [], token: null }) as T,
      addInitScript: async (source: string): Promise<string> => {
        const id = `id-${calls.length + 1}`;
        calls.push({ source, identifier: id });
        return id;
      },
      removeInitScript: async (): Promise<void> => undefined,
    };

    const handle = installTurnstileAutoClick(fakePage, { pollIntervalMs: 10_000 });
    // Give the fire-and-forget addInitScript microtask a chance to land.
    await new Promise((r) => setTimeout(r, 10));
    handle.dispose();

    expect(calls.length).toBe(1);
    const expected = buildTurnstileInjectScript();
    expect(calls[0]?.source).toBe(expected);
    // §8.4 invariants — the inject script declares the wire markers.
    expect(calls[0]?.source).toContain(TURNSTILE_EVENT_NAMES.detected);
    expect(calls[0]?.source).toContain(TURNSTILE_EVENT_NAMES.escalated);
    expect(calls[0]?.source).toContain(TURNSTILE_READER_KEY);
  });

  it("removes the init script on dispose()", async () => {
    const removed: string[] = [];
    const fakePage = {
      humanClick: async (): Promise<void> => undefined,
      evaluate: async <T>(): Promise<T> => ({ found: false, frames: [], token: null }) as T,
      addInitScript: async (): Promise<string> => "id-xyz",
      removeInitScript: async (id: string): Promise<void> => {
        removed.push(id);
      },
    };

    const handle = installTurnstileAutoClick(fakePage, { pollIntervalMs: 10_000 });
    // Wait for addInitScript microtask to set initScriptId.
    await new Promise((r) => setTimeout(r, 10));
    handle.dispose();
    // dispose runs removeInitScript fire-and-forget — drain a tick.
    await new Promise((r) => setTimeout(r, 10));

    expect(removed).toEqual(["id-xyz"]);
  });
});
