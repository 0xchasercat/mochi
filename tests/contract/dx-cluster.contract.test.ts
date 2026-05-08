/**
 * Cross-package contract: DX cluster (task 0257).
 *
 * Pins the wire shape consumed by `@mochi.js/core`'s DX-cluster surface so a
 * future refactor can't silently change the on-disk cookie format, the
 * DOMStorage CDP params, or the Browser.grantPermissions descriptor list.
 *
 * Three contracts captured here:
 *
 *   1. **Cookie file shape** — `Session.cookies.save(path)` produces the
 *      {@link CookieJarFile} struct exactly: `version` (currently `1`),
 *      `savedAt` (ISO-8601 UTC), `mochiVersion` (the package version string),
 *      `pattern` (regex source, default `".*"`), `count`, `cookies`. Loading
 *      a file with the wrong `version` MUST throw.
 *
 *   2. **DOMStorage CDP params** — `Page.localStorage.get()` /
 *      `Page.localStorage.set()` / `Page.sessionStorage.{get,set}` send
 *      `DOMStorage.getDOMStorageItems` and `DOMStorage.setDOMStorageItem`
 *      with `storageId.{ securityOrigin, isLocalStorage }`. The
 *      `isLocalStorage` flag MUST be `true` for `localStorage`, `false` for
 *      `sessionStorage`.
 *
 *   3. **`Browser.grantPermissions` payload** — `Page.grantAllPermissions`
 *      sends `Browser.grantPermissions` with the FULL
 *      {@link ALL_BROWSER_PERMISSIONS} descriptor list and an `origin`. No
 *      `browserContextId` (we drive a single root browser context).
 *
 * The contract tests don't spawn Chromium — they drive `Session`/`Page`
 * directly with a fake CDP transport and capture every outbound frame.
 *
 * @see tasks/0257-dx-cluster-cookies-storage-permissions.md
 * @see PLAN.md §8.2 (CDP method allow-list — none of the methods used here
 *   appear on the forbidden list).
 */

import { describe, expect, it } from "bun:test";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deriveMatrix, type ProfileV1 } from "../../packages/consistency/src/index";
import { MessageRouter } from "../../packages/core/src/cdp/router";
import {
  ALL_BROWSER_PERMISSIONS,
  COOKIE_JAR_FORMAT_VERSION,
  type CookieJarFile,
  Page,
  Session,
} from "../../packages/core/src/index";
import type { ChromiumProcess } from "../../packages/core/src/proc";

// ---- shared fake-CDP plumbing ----------------------------------------------

interface FakeFrame {
  id?: number;
  method?: string;
  params?: unknown;
  sessionId?: string;
}

interface FakeBrowser {
  proc: ChromiumProcess;
  written: FakeFrame[];
  push(obj: unknown): void;
  autoRespond(predicate: (m: string) => boolean, result: unknown): void;
}

function makeFake(): FakeBrowser {
  const written: FakeFrame[] = [];
  let pumpController: ReadableStreamDefaultController<Uint8Array> | null = null;
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      pumpController = c;
    },
  });
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  const autoResponders: Array<{ pred: (m: string) => boolean; result: unknown }> = [];

  const reader = { getReader: () => stream.getReader() };
  const push = (obj: unknown): void => {
    const bytes = enc.encode(JSON.stringify(obj));
    const out = new Uint8Array(bytes.length + 1);
    out.set(bytes, 0);
    out[bytes.length] = 0;
    pumpController?.enqueue(out);
  };
  const writer = {
    write(chunk: Uint8Array): number {
      const last = chunk[chunk.length - 1] === 0 ? chunk.length - 1 : chunk.length;
      const json = dec.decode(chunk.subarray(0, last));
      try {
        const parsed = JSON.parse(json) as FakeFrame;
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
      return chunk.byteLength;
    },
    flush(): void {},
    end(): void {},
  };

  const proc: ChromiumProcess = {
    reader,
    writer,
    userDataDir: "/tmp/contract-dx-cluster",
    pid: 0,
    exited: new Promise<number>(() => undefined),
    async close() {
      try {
        pumpController?.close();
      } catch {
        // ignore
      }
    },
  };
  return {
    proc,
    written,
    push,
    autoRespond(pred, result) {
      autoResponders.push({ pred, result });
    },
  };
}

function makeProfile(): ProfileV1 {
  return {
    id: "contract-dx",
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
    audio: {
      contextSampleRate: 48000,
      audioWorkletLatency: 0.005,
      destinationMaxChannelCount: 2,
    },
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

// ---- contract: cookie jar file shape ---------------------------------------

describe("DX cluster contract: cookie jar JSON shape", () => {
  it("save() emits the canonical CookieJarFile header + cookies", async () => {
    const fake = makeFake();
    fake.autoRespond((m) => m === "Target.setAutoAttach", {});
    fake.autoRespond((m) => m === "Storage.getCookies", {
      cookies: [
        {
          name: "k",
          value: "v",
          domain: ".example.com",
          path: "/",
          expires: 1_800_000_000,
          size: 2,
          httpOnly: false,
          secure: true,
          session: false,
          sameSite: "Lax",
        },
      ],
    });
    const session = new Session({
      proc: fake.proc,
      matrix: deriveMatrix(makeProfile(), "contract-seed"),
      seed: "contract-seed",
      bypassInject: true,
    });
    const tmp = join(tmpdir(), `mochi-contract-cookies-${Date.now()}.json`);
    try {
      await session.cookies.save(tmp);
      const text = await Bun.file(tmp).text();
      const parsed = JSON.parse(text) as CookieJarFile;
      // Header keys MUST be present, in this exact set.
      expect(Object.keys(parsed).sort()).toEqual([
        "cookies",
        "count",
        "mochiVersion",
        "pattern",
        "savedAt",
        "version",
      ]);
      expect(parsed.version).toBe(COOKIE_JAR_FORMAT_VERSION);
      expect(parsed.version).toBe(1);
      expect(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(parsed.savedAt)).toBe(true);
      expect(parsed.savedAt.endsWith("Z")).toBe(true);
      expect(typeof parsed.mochiVersion).toBe("string");
      expect(parsed.mochiVersion.length).toBeGreaterThan(0);
      expect(parsed.pattern).toBe(".*");
      expect(parsed.count).toBe(parsed.cookies.length);
    } finally {
      await session.close();
      try {
        rmSync(tmp, { force: true });
      } catch {
        // ignore
      }
    }
  });

  it("load() refuses an unknown version with a precise error", async () => {
    const fake = makeFake();
    fake.autoRespond((m) => m === "Target.setAutoAttach", {});
    const session = new Session({
      proc: fake.proc,
      matrix: deriveMatrix(makeProfile(), "contract-seed"),
      seed: "contract-seed",
      bypassInject: true,
    });
    const tmp = join(tmpdir(), `mochi-contract-bad-${Date.now()}.json`);
    try {
      await Bun.write(
        tmp,
        JSON.stringify({
          version: 99,
          savedAt: "2026-05-09T00:00:00Z",
          mochiVersion: "x",
          pattern: ".*",
          count: 0,
          cookies: [],
        }),
      );
      let threw = false;
      try {
        await session.cookies.load(tmp);
      } catch (err) {
        threw = true;
        expect(String(err)).toContain("99");
      }
      expect(threw).toBe(true);
    } finally {
      await session.close();
      try {
        rmSync(tmp, { force: true });
      } catch {
        // ignore
      }
    }
  });
});

// ---- contract: DOMStorage CDP wire shape -----------------------------------

describe("DX cluster contract: DOMStorage CDP wire shape", () => {
  it("localStorage.get() pins DOMStorage.getDOMStorageItems isLocalStorage:true", async () => {
    const fake = makeFake();
    const router = new MessageRouter(fake.proc.reader, fake.proc.writer);
    router.start();
    fake.autoRespond((m) => m === "DOMStorage.getDOMStorageItems", { entries: [] });
    const page = new Page({
      router,
      targetId: "t",
      sessionId: "s",
      initialUrl: "https://example.com/",
    });
    await page.localStorage.get({ origin: "https://example.com" });
    const call = fake.written.find((w) => w.method === "DOMStorage.getDOMStorageItems");
    expect(call?.params).toEqual({
      storageId: { securityOrigin: "https://example.com", isLocalStorage: true },
    });
    await router.close();
  });

  it("sessionStorage.get() pins DOMStorage.getDOMStorageItems isLocalStorage:false", async () => {
    const fake = makeFake();
    const router = new MessageRouter(fake.proc.reader, fake.proc.writer);
    router.start();
    fake.autoRespond((m) => m === "DOMStorage.getDOMStorageItems", { entries: [] });
    const page = new Page({
      router,
      targetId: "t",
      sessionId: "s",
      initialUrl: "https://example.com/",
    });
    await page.sessionStorage.get({ origin: "https://example.com" });
    const call = fake.written.find((w) => w.method === "DOMStorage.getDOMStorageItems");
    expect(call?.params).toEqual({
      storageId: { securityOrigin: "https://example.com", isLocalStorage: false },
    });
    await router.close();
  });

  it("set() pins DOMStorage.setDOMStorageItem with storageId/key/value", async () => {
    const fake = makeFake();
    const router = new MessageRouter(fake.proc.reader, fake.proc.writer);
    router.start();
    fake.autoRespond((m) => m === "DOMStorage.setDOMStorageItem", {});
    const page = new Page({
      router,
      targetId: "t",
      sessionId: "s",
      initialUrl: "https://example.com/",
    });
    await page.localStorage.set({ k: "v" }, { origin: "https://example.com" });
    const call = fake.written.find((w) => w.method === "DOMStorage.setDOMStorageItem");
    expect(call?.params).toEqual({
      storageId: { securityOrigin: "https://example.com", isLocalStorage: true },
      key: "k",
      value: "v",
    });
    await router.close();
  });
});

// ---- contract: Browser.grantPermissions payload ----------------------------

describe("DX cluster contract: Browser.grantPermissions payload", () => {
  it("grantAllPermissions sends the full descriptor list, no browserContextId", async () => {
    const fake = makeFake();
    const router = new MessageRouter(fake.proc.reader, fake.proc.writer);
    router.start();
    fake.autoRespond((m) => m === "Browser.grantPermissions", {});
    const page = new Page({
      router,
      targetId: "t",
      sessionId: "s",
      initialUrl: "https://example.com/",
    });
    await page.grantAllPermissions({ origin: "https://example.com" });
    const call = fake.written.find((w) => w.method === "Browser.grantPermissions");
    expect(call).toBeDefined();
    expect(call?.params).toEqual({
      permissions: [...ALL_BROWSER_PERMISSIONS],
      origin: "https://example.com",
    });
    // Must NOT carry a browserContextId — mochi drives a single root context.
    const params = call?.params as Record<string, unknown> | undefined;
    expect(params).not.toBeUndefined();
    expect(Object.keys(params ?? {}).sort()).toEqual(["origin", "permissions"]);
    // And must route to root target (no sessionId).
    expect(call?.sessionId).toBeUndefined();
    await router.close();
  });

  it("ALL_BROWSER_PERMISSIONS includes the canonical CDP enum entries", () => {
    // Pin a representative subset — a future Chromium revision adding a new
    // permission type should fail this when the bundled list isn't updated.
    const required = [
      "audioCapture",
      "backgroundFetch",
      "backgroundSync",
      "clipboardReadWrite",
      "clipboardSanitizedWrite",
      "displayCapture",
      "geolocation",
      "idleDetection",
      "midi",
      "midiSysex",
      "notifications",
      "paymentHandler",
      "periodicBackgroundSync",
      "protectedMediaIdentifier",
      "sensors",
      "storageAccess",
      "topLevelStorageAccess",
      "videoCapture",
      "videoCapturePanTiltZoom",
      "wakeLockScreen",
      "wakeLockSystem",
      "windowManagement",
    ];
    for (const p of required) {
      expect(ALL_BROWSER_PERMISSIONS).toContain(p);
    }
  });
});
