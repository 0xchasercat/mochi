/**
 * Unit tests for the {@link Session.cookies} jar surface (task 0257):
 *
 *   - `cookies.get()`         → `Storage.getCookies` round-trip with optional
 *                               url-host filter.
 *   - `cookies.set(cookies)`  → `Storage.setCookies` round-trip.
 *   - `cookies.save(path)`    → JSON file with the {@link CookieJarFile}
 *                               header (`version`, `savedAt`, `mochiVersion`,
 *                               `pattern`, `count`) and the filtered cookies
 *                               array.
 *   - `cookies.load(path)`    → reads the file, validates the version, and
 *                               replays via `Storage.setCookies`.
 *
 * Round-trip property: `save → load → get` returns a set equal to what
 * `get` originally returned (modulo the regex filter). We verify the wire
 * shape too — the saved JSON is the contract test's reference shape.
 *
 * No real Chromium process is spawned; we drive `Session` against a fake
 * `ChromiumProcess` whose pipe reader/writer let us observe every CDP
 * request sent and inject canned responses.
 *
 * @see tasks/0257-dx-cluster-cookies-storage-permissions.md
 * @see docs/audits/nodriver.md (LOW finding 2 — pickle → JSON port)
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deriveMatrix, type ProfileV1 } from "@mochi.js/consistency";
import type { PipeReader, PipeWriter } from "../cdp/transport";
import type { Cookie } from "../page";
import type { ChromiumProcess } from "../proc";
import { COOKIE_JAR_FORMAT_VERSION, type CookieJarFile, Session } from "../session";

interface FakeBrowser {
  process: ChromiumProcess;
  written: Array<{ id?: number; method?: string; params?: unknown; sessionId?: string }>;
  push(obj: unknown): void;
  autoRespond(methodPredicate: (m: string) => boolean, result: unknown): void;
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

  const reader: PipeReader = { getReader: () => stream.getReader() };

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
        if (typeof parsed.method === "string" && typeof parsed.id === "number") {
          const r = autoResponders.find((a) => a.pred(parsed.method ?? ""));
          if (r) {
            queueMicrotask(() => push({ id: parsed.id, result: r.result }));
          }
        }
      } catch {
        // ignore
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
    userDataDir: "/tmp/fake-mochi-cookies-test",
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
  };
}

const TEST_PROFILE: ProfileV1 = {
  id: "cookies-jar-fixture",
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
  behavior: { hand: "right", tremor: 0.18, wpm: 60, scrollStyle: "smooth" },
  wreqPreset: "chrome_131_macos",
  userAgent: "Mozilla/5.0 (cookies-test)",
  uaCh: {},
  entropyBudget: { fixed: [], perSeed: [] },
};

const SAMPLE_COOKIES: Cookie[] = [
  {
    name: "session_id",
    value: "abc",
    domain: ".example.com",
    path: "/",
    expires: 1_800_000_000,
    size: 12,
    httpOnly: true,
    secure: true,
    session: false,
    sameSite: "Lax",
  },
  {
    name: "consent",
    value: "1",
    domain: "tracker.io",
    path: "/",
    expires: 1_900_000_000,
    size: 4,
    httpOnly: false,
    secure: true,
    session: false,
  },
  {
    name: "ab_test",
    value: "B",
    domain: ".example.com",
    path: "/",
    expires: -1,
    size: 5,
    httpOnly: false,
    secure: false,
    session: true,
  },
];

describe("Session.cookies (task 0257)", () => {
  let fake: FakeBrowser;
  let session: Session;
  let tmpFile: string;

  beforeEach(() => {
    fake = makeFakeBrowser();
    fake.autoRespond((m) => m === "Target.setAutoAttach", {});
    const matrix = deriveMatrix(TEST_PROFILE, "cookies-test");
    session = new Session({
      proc: fake.process,
      matrix,
      seed: "cookies-test",
      bypassInject: true,
    });
    tmpFile = join(
      tmpdir(),
      `mochi-cookies-${Date.now()}-${Math.random().toString(36).slice(2)}.json`,
    );
  });

  afterEach(async () => {
    try {
      await session.close();
    } catch {
      // ignore
    }
    try {
      rmSync(tmpFile, { force: true });
    } catch {
      // ignore
    }
  });

  it("get() returns Storage.getCookies result verbatim when no filter", async () => {
    fake.autoRespond((m) => m === "Storage.getCookies", { cookies: SAMPLE_COOKIES });
    const got = await session.cookies.get();
    expect(got).toEqual(SAMPLE_COOKIES);
    const call = fake.written.find((w) => w.method === "Storage.getCookies");
    expect(call).toBeDefined();
  });

  it("get({ url }) filters by hostname", async () => {
    fake.autoRespond((m) => m === "Storage.getCookies", { cookies: SAMPLE_COOKIES });
    const got = await session.cookies.get({ url: "https://example.com/path" });
    // .example.com matches "example.com" (endsWith on either direction).
    const names = got.map((c) => c.name).sort();
    expect(names).toEqual(["ab_test", "session_id"]);
  });

  it("set(cookies) sends Storage.setCookies with the full array", async () => {
    fake.autoRespond((m) => m === "Storage.setCookies", {});
    await session.cookies.set(SAMPLE_COOKIES);
    const call = fake.written.find((w) => w.method === "Storage.setCookies");
    expect(call).toBeDefined();
    expect(call?.params).toEqual({ cookies: SAMPLE_COOKIES });
  });

  it("save() writes JSON with the version header + filtered cookies", async () => {
    fake.autoRespond((m) => m === "Storage.getCookies", { cookies: SAMPLE_COOKIES });
    await session.cookies.save(tmpFile);
    const text = await Bun.file(tmpFile).text();
    const parsed = JSON.parse(text) as CookieJarFile;
    expect(parsed.version).toBe(COOKIE_JAR_FORMAT_VERSION);
    expect(typeof parsed.savedAt).toBe("string");
    expect(parsed.savedAt.endsWith("Z")).toBe(true);
    expect(typeof parsed.mochiVersion).toBe("string");
    expect(parsed.pattern).toBe(".*");
    expect(parsed.count).toBe(SAMPLE_COOKIES.length);
    expect(parsed.cookies).toEqual(SAMPLE_COOKIES);
  });

  it("save({ pattern }) only writes matching domains", async () => {
    fake.autoRespond((m) => m === "Storage.getCookies", { cookies: SAMPLE_COOKIES });
    await session.cookies.save(tmpFile, { pattern: /example\.com$/ });
    const parsed = JSON.parse(await Bun.file(tmpFile).text()) as CookieJarFile;
    expect(parsed.pattern).toBe("example\\.com$");
    expect(parsed.count).toBe(2);
    expect(parsed.cookies.every((c) => c.domain.endsWith("example.com"))).toBe(true);
  });

  it("load() round-trips: file contents replay via Storage.setCookies", async () => {
    // Stage: save once, then forget the in-memory state and load it back.
    fake.autoRespond((m) => m === "Storage.getCookies", { cookies: SAMPLE_COOKIES });
    fake.autoRespond((m) => m === "Storage.setCookies", {});
    await session.cookies.save(tmpFile);

    await session.cookies.load(tmpFile);
    const setCall = fake.written.find((w) => w.method === "Storage.setCookies");
    expect(setCall).toBeDefined();
    expect(setCall?.params).toEqual({ cookies: SAMPLE_COOKIES });
  });

  it("load({ pattern }) skips cookies that don't match", async () => {
    fake.autoRespond((m) => m === "Storage.getCookies", { cookies: SAMPLE_COOKIES });
    fake.autoRespond((m) => m === "Storage.setCookies", {});
    await session.cookies.save(tmpFile);

    await session.cookies.load(tmpFile, { pattern: /tracker/ });
    const setCall = fake.written.find((w) => w.method === "Storage.setCookies");
    expect(setCall).toBeDefined();
    const params = setCall?.params as { cookies: Cookie[] };
    expect(params.cookies.length).toBe(1);
    expect(params.cookies[0]?.domain).toBe("tracker.io");
  });

  it("load() throws when the file is missing", async () => {
    let threw = false;
    try {
      await session.cookies.load(`${tmpFile}-missing`);
    } catch (err) {
      threw = true;
      expect(String(err)).toContain("file not found");
    }
    expect(threw).toBe(true);
  });

  it("load() throws on version mismatch", async () => {
    const bad = {
      version: 999,
      savedAt: "2026-05-09T00:00:00Z",
      mochiVersion: "x",
      pattern: ".*",
      count: 0,
      cookies: [],
    };
    await Bun.write(tmpFile, JSON.stringify(bad));
    let threw = false;
    try {
      await session.cookies.load(tmpFile);
    } catch (err) {
      threw = true;
      expect(String(err)).toContain("version");
    }
    expect(threw).toBe(true);
  });

  it("load() throws on malformed JSON", async () => {
    await Bun.write(tmpFile, "not json {");
    let threw = false;
    try {
      await session.cookies.load(tmpFile);
    } catch (err) {
      threw = true;
      expect(String(err)).toContain("not valid JSON");
    }
    expect(threw).toBe(true);
  });

  it("save() then load() is idempotent on the saved set", async () => {
    fake.autoRespond((m) => m === "Storage.getCookies", { cookies: SAMPLE_COOKIES });
    fake.autoRespond((m) => m === "Storage.setCookies", {});
    await session.cookies.save(tmpFile);

    // Load once.
    await session.cookies.load(tmpFile);
    const calls1 = fake.written.filter((w) => w.method === "Storage.setCookies");
    expect(calls1.length).toBe(1);

    // Load again — same wire shape.
    await session.cookies.load(tmpFile);
    const calls2 = fake.written.filter((w) => w.method === "Storage.setCookies");
    expect(calls2.length).toBe(2);
    expect(calls2[0]?.params).toEqual(calls2[1]?.params);
  });
});
