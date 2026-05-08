/**
 * Cross-package contract: `Network.setUserAgentOverride.userAgentMetadata`
 * is byte-identical to what `@mochi.js/inject`'s `client-hints.ts` module
 * emits for `navigator.userAgentData.getHighEntropyValues(...)`.
 *
 * Both surfaces — the request-header path (CDP-driven, derived inside
 * Chromium from `userAgentMetadata`) and the JS-API path (driven by the
 * inject payload's `client-hints.ts` `SPOOF_*` constants) — must read from
 * the SAME matrix fields. If they drift, a fingerprinter calling
 * `getHighEntropyValues()` and comparing against the request-header
 * `Sec-CH-UA*` set sees a mismatch (PLAN.md I-5 violation — task 0261).
 *
 * Test plan:
 *   1. Drive a real `Session` against a fake CDP transport.
 *   2. Capture the `Network.setUserAgentOverride` frame's
 *      `userAgentMetadata` payload.
 *   3. Build the same matrix's inject payload and parse out the
 *      `SPOOF_BRANDS`, `SPOOF_FULL_VERSION_LIST`, `SPOOF_PLATFORM`,
 *      `SPOOF_PLATFORM_VERSION`, `SPOOF_ARCH`, `SPOOF_BITNESS`,
 *      `SPOOF_MODEL`, `SPOOF_MOBILE`, `SPOOF_UA_FULL_VERSION` constants.
 *   4. Assert each network-metadata field equals the corresponding inject
 *      constant. The two surfaces SHARE THE MATRIX, so equality is the
 *      byte-for-byte parity contract.
 *
 * @see PLAN.md I-5
 * @see tasks/0261-uach-network-metadata.md
 */

import { describe, expect, it } from "bun:test";
import { deriveMatrix, type ProfileV1 } from "../../packages/consistency/src/index";
import type { PipeReader, PipeWriter } from "../../packages/core/src/cdp/transport";
import { Session } from "../../packages/core/src/session";
import { buildPayload } from "../../packages/inject/src/index";

// ---- shared fixture ---------------------------------------------------------

function fixtureProfile(): ProfileV1 {
  return {
    id: "uach-parity-contract",
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
}

// ---- fake CDP pipes (copy from headless-ua-no-leak.contract.test.ts) --------

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
      // CDP pipe-mode framing is NUL-delimited (`packages/core/src/cdp/framer.ts`).
      // String.fromCharCode keeps the NUL byte legible in source rather than
      // smuggling a literal `\0` into the template literal.
      const data = `${JSON.stringify(msg)}${String.fromCharCode(0)}`;
      pushChunk(new TextEncoder().encode(data));
    },
  };
}

// ---- inject-side SPOOF_* constant scraper -----------------------------------

/**
 * Pull a single `var SPOOF_<NAME> = <literal>;` declaration out of the
 * built inject bundle. The bundle is generated from the matrix; the
 * constants embed the values exactly as `JSON.stringify` emitted them, so
 * `JSON.parse` on the captured literal is round-trip safe.
 */
function readSpoofLiteral<T>(code: string, name: string): T {
  // The emitted line is `  var SPOOF_${NAME} = <literal>;` followed by `\n`.
  // We grep for the declaration and parse JSON between `=` and `;`.
  const re = new RegExp(`var\\s+SPOOF_${name}\\s*=\\s*([^;]+);`);
  const m = code.match(re);
  if (m === null || m[1] === undefined) {
    throw new Error(`[uach-parity] SPOOF_${name} not found in inject bundle`);
  }
  // Some constants are emitted as bare booleans (`true` / `false`); JSON.parse
  // accepts those as well as quoted strings and JSON arrays / objects.
  return JSON.parse(m[1].trim()) as T;
}

interface BrandEntry {
  brand: string;
  version: string;
}

interface NetworkUaMetadata {
  brands?: BrandEntry[];
  fullVersionList?: BrandEntry[];
  fullVersion?: string;
  platform?: string;
  platformVersion?: string;
  architecture?: string;
  model?: string;
  mobile?: boolean;
  bitness?: string;
  wow64?: boolean;
}

// ---- the contract test ------------------------------------------------------

describe("contract: Network.setUserAgentOverride.userAgentMetadata mirrors inject client-hints", () => {
  it("every userAgentMetadata field equals the matching inject SPOOF_* constant", async () => {
    const { reader, writer, written, inject } = makeFakePipes();
    const matrix = deriveMatrix(fixtureProfile(), "uach-parity-pin");

    const session = new Session({
      proc: {
        reader,
        writer,
        userDataDir: "/tmp/contract-fake-uach-parity",
        pid: 0,
        exited: new Promise<number>(() => {
          /* never resolves */
        }),
        close: async () => {
          /* no-op */
        },
      },
      matrix,
      seed: "uach-parity-pin",
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
          inject({ id: f.id, result: { targetId: "tgt-uach" } });
          frame.__responded = true;
        } else if (f.method === "Target.attachToTarget") {
          inject({ id: f.id, result: { sessionId: "page-uach" } });
          frame.__responded = true;
        } else if (f.method === "Page.enable") {
          inject({ id: f.id, result: {} });
          frame.__responded = true;
        } else if (f.method === "Emulation.setTimezoneOverride") {
          // Added by task 0262 (geo-consistency) per-target between Page.enable
          // and Network.setUserAgentOverride. This test was written before
          // 0262 landed; auto-respond so the new send doesn't block subsequent
          // frames from being processed.
          inject({ id: f.id, result: {} });
          frame.__responded = true;
        } else if (f.method === "Network.setUserAgentOverride") {
          inject({ id: f.id, result: {} });
          frame.__responded = true;
        } else if (f.method === "Page.addScriptToEvaluateOnNewDocument") {
          inject({ id: f.id, result: { identifier: "scr-uach" } });
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

      // Locate the captured override frame.
      const overrideFrame = written.find(
        (f) =>
          f.parsed.method === "Network.setUserAgentOverride" && f.parsed.sessionId === "page-uach",
      );
      expect(overrideFrame).toBeDefined();
      const params = overrideFrame?.parsed.params as
        | { userAgent?: string; userAgentMetadata?: NetworkUaMetadata }
        | undefined;
      expect(params).toBeDefined();
      const meta = params?.userAgentMetadata;
      expect(meta).toBeDefined();
      if (meta === undefined) throw new Error("unreachable");

      // Build the inject payload from the SAME matrix and pull out the
      // SPOOF_* constants.
      const { code } = buildPayload(matrix);
      const injectBrands = readSpoofLiteral<BrandEntry[]>(code, "BRANDS");
      const injectFullVersionList = readSpoofLiteral<BrandEntry[]>(code, "FULL_VERSION_LIST");
      const injectPlatform = readSpoofLiteral<string>(code, "PLATFORM");
      const injectPlatformVersion = readSpoofLiteral<string>(code, "PLATFORM_VERSION");
      const injectArch = readSpoofLiteral<string>(code, "ARCH");
      const injectBitness = readSpoofLiteral<string>(code, "BITNESS");
      const injectModel = readSpoofLiteral<string>(code, "MODEL");
      const injectMobile = readSpoofLiteral<boolean>(code, "MOBILE");
      const injectFullVersion = readSpoofLiteral<string>(code, "UA_FULL_VERSION");

      // ---- field-by-field parity assertions ---------------------------------

      expect(meta.brands).toEqual(injectBrands);
      expect(meta.fullVersionList).toEqual(injectFullVersionList);
      expect(meta.platform).toBe(injectPlatform);
      expect(meta.platformVersion).toBe(injectPlatformVersion);
      expect(meta.architecture).toBe(injectArch);
      expect(meta.bitness).toBe(injectBitness);
      expect(meta.model).toBe(injectModel);
      expect(meta.mobile).toBe(injectMobile);
      expect(meta.fullVersion).toBe(injectFullVersion);

      // CDP enum invariants — surface them as separate assertions so a
      // future refactor that ships numeric `bitness` (a recurring footgun
      // per the task brief) breaks here with a precise message.
      expect(typeof meta.bitness).toBe("string");
      expect(["arm", "x86", ""]).toContain(meta.architecture);
      expect(["64", "32", ""]).toContain(meta.bitness);
      expect(meta.wow64).toBe(false);

      // Sanity: the MATRIX itself has the values we'd expect for the
      // mac-arm64 fixture profile (R-042..R-046 wired correctly).
      expect(matrix.uaCh["sec-ch-ua-arch"]).toBe('"arm"');
      expect(matrix.uaCh["sec-ch-ua-bitness"]).toBe('"64"');
      expect(matrix.uaCh["sec-ch-ua-mobile"]).toBe("?0");
      expect(matrix.uaCh["sec-ch-ua-model"]).toBe('""');
      expect(typeof matrix.uaCh["ua-full-version"]).toBe("string");
      expect((matrix.uaCh["ua-full-version"] as string).length).toBeGreaterThan(0);

      await page.close();
    } finally {
      clearInterval(responder);
      await session.close();
    }
  }, 10_000);

  it("ua-full-version derived rule (R-046) equals the branded entry of the full-version-list", () => {
    const matrix = deriveMatrix(fixtureProfile(), "r046-derive-pin");
    const fullVersionListRaw = matrix.uaCh["ua-full-version-list"];
    expect(typeof fullVersionListRaw).toBe("string");
    const list = JSON.parse(fullVersionListRaw ?? "[]") as BrandEntry[];
    expect(list.length).toBeGreaterThan(0);
    const brandedVersion = list[0]?.version;
    expect(matrix.uaCh["ua-full-version"]).toBe(brandedVersion);
  });

  it("desktop profile emits empty-string Sec-CH-UA-Model (R-045) on every supported OS", () => {
    for (const osName of ["macos", "windows", "linux"] as const) {
      const profile = fixtureProfile();
      profile.os.name = osName;
      // Linux/Windows force x64; arm64 only valid on macos in the
      // fixture's intent.
      profile.os.arch = osName === "macos" ? "arm64" : "x64";
      const matrix = deriveMatrix(profile, `r045-${osName}-pin`);
      expect(matrix.uaCh["sec-ch-ua-model"]).toBe('""');
      expect(matrix.uaCh["sec-ch-ua-mobile"]).toBe("?0");
    }
  });
});
