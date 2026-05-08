/**
 * Cross-package contract: worker context bootstrap follows the patchright
 * idOnly trick (task 0254 / `crServiceWorkerPatch.ts:32-43`,
 * `crPagePatch.ts:404-417`).
 *
 * For every worker-style auto-attach we expect the call sequence:
 *
 *   1. `Runtime.evaluate({ expression: "globalThis", serialization: "idOnly" })`
 *      against the worker session — no `Runtime.enable` first.
 *   2. (mochi parses `result.objectId.split(".")[1]` for the contextId.)
 *   3. `Runtime.callFunctionOn({ functionDeclaration, executionContextId,
 *      returnByValue: true })` against the same worker session, carrying the
 *      compiled inject payload.
 *   4. `Runtime.runIfWaitingForDebugger` against the worker session.
 *
 * Across the entire flow `Runtime.enable` MUST NEVER be sent. PLAN.md §8.2
 * forbids it; the idOnly trick is precisely how we extract the contextId
 * without it.
 *
 * This test pins:
 *  - the order of CDP calls,
 *  - the parameter shapes (idOnly serialisation, executionContextId on
 *    callFunctionOn, the function-declaration wrapping that carries the
 *    payload),
 *  - the negative invariant on `Runtime.enable`.
 *
 * @see PLAN.md §8.2, §8.3, §8.4
 * @see tasks/0254-worker-idonly-bootstrap.md
 * @see docs/audits/patchright.md (HIGH finding)
 */

import { describe, expect, it } from "bun:test";
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
      // CDP pipe-mode framing: one JSON record terminated by a single NUL
      // byte (`0x00`). The framer in `cdp/framer.ts` scans for NUL.
      const json = new TextEncoder().encode(JSON.stringify(msg));
      const out = new Uint8Array(json.length + 1);
      out.set(json, 0);
      out[json.length] = 0x00;
      pushChunk(out);
    },
  };
}

function fixtureProfile(): ProfileV1 {
  return {
    id: "worker-idonly-bootstrap-contract",
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

/**
 * Drive a Session with the fake pipes through `Target.setAutoAttach` +
 * a worker `Target.attachedToTarget` event. Auto-respond to any framework
 * traffic (createTarget etc.); the contract assertions live on the worker
 * session traffic.
 *
 * Returns the call frames against the worker session id, in send order.
 */
async function driveWorkerAttach(opts: { workerObjectId: string }): Promise<{
  workerFrames: RecordedFrame[];
  allFrames: RecordedFrame[];
  payloadCode: string;
  cleanup: () => Promise<void>;
}> {
  const { reader, writer, written, inject } = makeFakePipes();
  const matrix = deriveMatrix(fixtureProfile(), "worker-bootstrap");
  const session = new Session({
    proc: {
      reader,
      writer,
      userDataDir: "/tmp/worker-bootstrap-fake",
      pid: 0,
      exited: new Promise<number>(() => {
        /* never resolves */
      }),
      close: async () => {
        /* no-op */
      },
    },
    matrix,
    seed: "worker-bootstrap",
    defaultTimeoutMs: 500,
  });

  // The auto-responder. We answer Runtime.evaluate against the worker
  // session id with the test's chosen objectId — that's the input the
  // bootstrap parses for the contextId.
  const responder = setInterval(() => {
    for (const frame of written) {
      const r = frame as unknown as { __responded?: boolean };
      if (r.__responded === true) continue;
      const f = frame.parsed;
      if (typeof f.id !== "number") continue;
      if (f.method === "Target.setAutoAttach") {
        inject({ id: f.id, result: {} });
        r.__responded = true;
      } else if (f.method === "Runtime.evaluate" && f.sessionId === "worker-sess-1") {
        // The contract: the bootstrap requests `globalThis` with idOnly.
        // We hand back an objectId in the canonical Chromium shape.
        inject({
          id: f.id,
          result: { result: { type: "object", objectId: opts.workerObjectId } },
        });
        r.__responded = true;
      } else if (f.method === "Runtime.callFunctionOn" && f.sessionId === "worker-sess-1") {
        inject({ id: f.id, result: { result: { type: "undefined" } } });
        r.__responded = true;
      } else if (f.method === "Runtime.runIfWaitingForDebugger") {
        inject({ id: f.id, result: {} });
        r.__responded = true;
      }
    }
  }, 5);

  // Wait briefly so the Session's `start()` and event-handler wiring is in
  // place before we synthesise the worker attach. Without this the
  // attachedToTarget event can fire before the on('...') handler is
  // registered, dropping the bootstrap on the floor.
  await new Promise((res) => setTimeout(res, 20));

  // Simulate the worker auto-attach.
  inject({
    method: "Target.attachedToTarget",
    params: {
      sessionId: "worker-sess-1",
      targetInfo: {
        targetId: "worker-1",
        type: "worker",
        title: "",
        url: "",
        attached: true,
      },
      waitingForDebugger: true,
    },
  });

  // Give the inject handler enough time to walk through the full
  // evaluate → callFunctionOn → runIfWaitingForDebugger sequence. The
  // responder polls at 5ms; three round-trips fits comfortably in 250ms.
  await new Promise((res) => setTimeout(res, 250));

  const workerFrames = written.filter((f) => f.parsed.sessionId === "worker-sess-1");
  const payloadCode = session._internalPayload()?.code ?? "";

  return {
    workerFrames,
    allFrames: written,
    payloadCode,
    cleanup: async () => {
      clearInterval(responder);
      await session.close();
    },
  };
}

describe("contract: worker idOnly context bootstrap (task 0254)", () => {
  it("issues Runtime.evaluate(globalThis, idOnly) → callFunctionOn(executionContextId) → runIfWaitingForDebugger, in that order", async () => {
    const driven = await driveWorkerAttach({ workerObjectId: "1.7.2" });
    try {
      const methods = driven.workerFrames
        .map((f) => f.parsed.method)
        .filter((m): m is string => typeof m === "string");

      // Exact ordered sequence on the worker session.
      expect(methods).toEqual([
        "Runtime.evaluate",
        "Runtime.callFunctionOn",
        "Runtime.runIfWaitingForDebugger",
      ]);

      // 1. Runtime.evaluate params: expression "globalThis", idOnly.
      const evalFrame = driven.workerFrames[0];
      const evalParams = evalFrame?.parsed.params as
        | {
            expression?: string;
            serialization?: string;
            includeCommandLineAPI?: boolean;
          }
        | undefined;
      expect(evalParams?.expression).toBe("globalThis");
      expect(evalParams?.serialization).toBe("idOnly");
      // §8.2 — must never set this true.
      expect(evalParams?.includeCommandLineAPI).toBeUndefined();

      // 2. callFunctionOn carries the parsed contextId AND the payload.
      const callFrame = driven.workerFrames[1];
      const callParams = callFrame?.parsed.params as
        | {
            functionDeclaration?: string;
            executionContextId?: number;
            returnByValue?: boolean;
            includeCommandLineAPI?: boolean;
          }
        | undefined;
      // objectId "1.7.2" → contextId is index [1] = 7.
      expect(callParams?.executionContextId).toBe(7);
      expect(callParams?.returnByValue).toBe(true);
      expect(callParams?.includeCommandLineAPI).toBeUndefined();
      // The function-declaration wrapper carries the compiled payload.
      expect(typeof callParams?.functionDeclaration).toBe("string");
      expect(callParams?.functionDeclaration?.length ?? 0).toBeGreaterThan(0);
      expect(driven.payloadCode.length).toBeGreaterThan(0);
      expect(callParams?.functionDeclaration).toContain(driven.payloadCode);
    } finally {
      await driven.cleanup();
    }
  }, 5_000);

  it("never sends Runtime.enable across the worker bootstrap", async () => {
    const driven = await driveWorkerAttach({ workerObjectId: "1.3.4" });
    try {
      for (const frame of driven.allFrames) {
        expect(frame.parsed.method).not.toBe("Runtime.enable");
      }
    } finally {
      await driven.cleanup();
    }
  }, 5_000);

  it("rejects malformed objectIds loudly (parse-failure does not silently degrade)", async () => {
    // An objectId without a dot can't be parsed for a contextId. The
    // bootstrap must fail loudly so a wire-format shift surfaces as a
    // visible warning, not as a silent skipped inject.
    const original = console.warn;
    const captured: string[] = [];
    console.warn = (...args: unknown[]) => {
      captured.push(args.map((a) => (a instanceof Error ? a.message : String(a))).join(" "));
    };
    try {
      const driven = await driveWorkerAttach({ workerObjectId: "no-dots-here" });
      try {
        // The handler swallows the throw with a console.warn — the precise
        // contract is "fail loudly", not "throw upward". Assert the warn
        // happened and named the bootstrap.
        expect(captured.some((m) => m.includes("worker idOnly bootstrap"))).toBe(true);
        // And we still resumed the worker — we don't leave it paused on
        // an inject failure.
        const methods = driven.workerFrames
          .map((f) => f.parsed.method)
          .filter((m): m is string => typeof m === "string");
        expect(methods).toContain("Runtime.runIfWaitingForDebugger");
        // We never sent Runtime.enable as a fallback.
        expect(methods).not.toContain("Runtime.enable");
      } finally {
        await driven.cleanup();
      }
    } finally {
      console.warn = original;
    }
  }, 5_000);
});
