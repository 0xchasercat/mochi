/**
 * Cross-package contract: the post-reconciliation matrix's `timezone` MUST
 * be sent to Chromium via `Emulation.setTimezoneOverride` on every new page
 * session, AFTER `Target.attachToTarget` and BEFORE the inject script
 * install. This pins the JS-side timezone spoof that drives both
 * `Intl.DateTimeFormat().resolvedOptions().timeZone` AND
 * `Date.getTimezoneOffset()` (Chromium's V8 reads from the same internal
 * source for both, per the brief — so a single CDP send covers both
 * surfaces).
 *
 * Per `Emulation.setTimezoneOverride` docs (chromium.googlesource.com),
 * the method does NOT require `Emulation.enable`; it stores override
 * state directly on the `EmulationAgent`. PLAN.md §8.2's bans
 * (`Runtime.enable`, `Page.createIsolatedWorld`, etc.) are unaffected.
 *
 * The reconciler half of task 0262 is unit-tested in
 * `packages/core/src/__tests__/geo-consistency.test.ts`. This contract
 * test pins the SESSION-LEVEL wiring: matrix.timezone in → CDP frame out,
 * with the right session id, before inject script install.
 *
 * @see PLAN.md §8.2 / §9 / I-5
 * @see tasks/0262-ip-tz-locale-exit-consistency.md
 */

import { describe, expect, it } from "bun:test";
import { deriveMatrix, type ProfileV1 } from "../../packages/consistency/src/index";
import type { PipeReader, PipeWriter } from "../../packages/core/src/cdp/transport";
import { Session } from "../../packages/core/src/session";

function fixtureProfile(): ProfileV1 {
  return {
    id: "geo-tz-contract",
    version: "0.0.0",
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
    timezone: "Europe/Berlin",
    locale: "de-DE",
    languages: ["de-DE", "de", "en"],
    behavior: { hand: "right", tremor: 0.18, wpm: 60, scrollStyle: "smooth" },
    wreqPreset: "chrome_131_macos",
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.6778.86 Safari/537.36",
    uaCh: {},
    entropyBudget: { fixed: [], perSeed: [] },
  };
}

interface RecordedFrame {
  raw: string;
  parsed: {
    id?: number;
    method?: string;
    params?: unknown;
    sessionId?: string;
  };
  __responded?: boolean;
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
      // CDP frames are NUL-delimited (PLAN.md §8.1) — append \0, not space.
      const json = JSON.stringify(msg);
      const utf8 = new TextEncoder().encode(json);
      const out = new Uint8Array(utf8.length + 1);
      out.set(utf8, 0);
      out[utf8.length] = 0;
      pushChunk(out);
    },
  };
}

describe("contract: Emulation.setTimezoneOverride pins matrix.timezone per page session", () => {
  it("Session.newPage sends Emulation.setTimezoneOverride with matrix timezone on the page session", async () => {
    const { reader, writer, written, inject } = makeFakePipes();
    const matrix = deriveMatrix(fixtureProfile(), "tz-pin");

    const session = new Session({
      proc: {
        reader,
        writer,
        userDataDir: "/tmp/contract-fake-tz-override",
        pid: 0,
        exited: new Promise<number>(() => {
          /* never resolves */
        }),
        close: async () => {
          /* no-op */
        },
      },
      matrix,
      seed: "tz-pin",
      defaultTimeoutMs: 250,
    });

    let pollCount = 0;
    const responder = setInterval(() => {
      pollCount++;
      for (const frame of written) {
        const f = frame.parsed;
        if (frame.__responded === true) continue;
        if (typeof f.id !== "number") continue;
        if (f.method === "Target.setAutoAttach") {
          inject({ id: f.id, result: {} });
          frame.__responded = true;
        } else if (f.method === "Target.createTarget") {
          inject({ id: f.id, result: { targetId: "tgt-tz-1" } });
          frame.__responded = true;
        } else if (f.method === "Target.attachToTarget") {
          inject({ id: f.id, result: { sessionId: "tz-page-sess" } });
          frame.__responded = true;
        } else if (f.method === "Page.enable") {
          inject({ id: f.id, result: {} });
          frame.__responded = true;
        } else if (f.method === "Emulation.setTimezoneOverride") {
          inject({ id: f.id, result: {} });
          frame.__responded = true;
        } else if (f.method === "Network.setUserAgentOverride") {
          inject({ id: f.id, result: {} });
          frame.__responded = true;
        } else if (f.method === "Page.addScriptToEvaluateOnNewDocument") {
          inject({ id: f.id, result: { identifier: "scr-tz-1" } });
          frame.__responded = true;
        } else if (f.method === "Page.removeScriptToEvaluateOnNewDocument") {
          inject({ id: f.id, result: {} });
          frame.__responded = true;
        } else if (f.method === "Target.closeTarget") {
          inject({ id: f.id, result: { success: true } });
          frame.__responded = true;
        }
      }
      if (pollCount > 200) clearInterval(responder);
    }, 5);

    try {
      const page = await session.newPage();
      expect(page).toBeDefined();

      // The contract assertion: at least one Emulation.setTimezoneOverride
      // frame was written, addressed to the page session, with the matrix tz.
      const tzFrames = written.filter((f) => f.parsed.method === "Emulation.setTimezoneOverride");
      expect(tzFrames.length).toBeGreaterThanOrEqual(1);

      const tzOnPage = tzFrames.find((f) => f.parsed.sessionId === "tz-page-sess");
      expect(tzOnPage).toBeDefined();
      const tzParams = tzOnPage?.parsed.params as { timezoneId?: string } | undefined;
      expect(tzParams?.timezoneId).toBe(matrix.timezone);
      expect(tzParams?.timezoneId).toBe("Europe/Berlin");

      // Ordering: Page.enable BEFORE Emulation.setTimezoneOverride BEFORE
      // the inject install. The inject relies on the timezone override
      // being live so any payload-time `Intl.DateTimeFormat` call sees the
      // spoofed zone.
      const idxPageEnable = written.findIndex(
        (f) => f.parsed.method === "Page.enable" && f.parsed.sessionId === "tz-page-sess",
      );
      const idxTzOverride = written.findIndex(
        (f) =>
          f.parsed.method === "Emulation.setTimezoneOverride" &&
          f.parsed.sessionId === "tz-page-sess",
      );
      const idxInject = written.findIndex(
        (f) => f.parsed.method === "Page.addScriptToEvaluateOnNewDocument",
      );
      expect(idxPageEnable).toBeGreaterThanOrEqual(0);
      expect(idxTzOverride).toBeGreaterThanOrEqual(0);
      expect(idxInject).toBeGreaterThanOrEqual(0);
      expect(idxPageEnable).toBeLessThan(idxTzOverride);
      expect(idxTzOverride).toBeLessThan(idxInject);

      await page.close();
    } finally {
      clearInterval(responder);
      await session.close();
    }
  }, 10_000);

  it("bypassInject sessions do NOT send Emulation.setTimezoneOverride (capture flow needs bare timezone)", async () => {
    const { reader, writer, written, inject } = makeFakePipes();
    const matrix = deriveMatrix(fixtureProfile(), "bypass-no-tz");

    const session = new Session({
      proc: {
        reader,
        writer,
        userDataDir: "/tmp/contract-fake-bypass-tz",
        pid: 0,
        exited: new Promise<number>(() => {}),
        close: async () => {},
      },
      matrix,
      seed: "bypass-no-tz",
      defaultTimeoutMs: 250,
      bypassInject: true,
    });

    let pollCount = 0;
    const responder = setInterval(() => {
      pollCount++;
      for (const frame of written) {
        const f = frame.parsed;
        if (frame.__responded === true) continue;
        if (typeof f.id !== "number") continue;
        if (f.method === "Target.setAutoAttach") {
          inject({ id: f.id, result: {} });
          frame.__responded = true;
        } else if (f.method === "Target.createTarget") {
          inject({ id: f.id, result: { targetId: "tgt-bypass" } });
          frame.__responded = true;
        } else if (f.method === "Target.attachToTarget") {
          inject({ id: f.id, result: { sessionId: "bypass-sess" } });
          frame.__responded = true;
        } else if (f.method === "Page.enable") {
          inject({ id: f.id, result: {} });
          frame.__responded = true;
        } else if (f.method === "Target.closeTarget") {
          inject({ id: f.id, result: { success: true } });
          frame.__responded = true;
        }
      }
      if (pollCount > 200) clearInterval(responder);
    }, 5);

    try {
      const page = await session.newPage();
      expect(page).toBeDefined();
      const tzFrames = written.filter((f) => f.parsed.method === "Emulation.setTimezoneOverride");
      expect(tzFrames.length).toBe(0);
      // Likewise, no UA override (existing contract — confirms bypass scope).
      const uaFrames = written.filter((f) => f.parsed.method === "Network.setUserAgentOverride");
      expect(uaFrames.length).toBe(0);
      await page.close();
    } finally {
      clearInterval(responder);
      await session.close();
    }
  }, 10_000);
});
