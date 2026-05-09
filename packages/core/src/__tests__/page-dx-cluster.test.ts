/**
 * Unit tests for the Page DX cluster:
 *   - `Page.localStorage.{get,set}`   → DOMStorage.getDOMStorageItems /
 *                                       DOMStorage.setDOMStorageItem.
 *   - `Page.sessionStorage.{get,set}` → same shape, `isLocalStorage: false`.
 *   - `Page.grantAllPermissions()`    → Browser.grantPermissions with the
 *                                       full descriptor list.
 *
 * Driven against a hand-rolled fake CDP transport — same fixture pattern as
 * the cookies-jar tests, kept inline here so each test file stands alone.
 *
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { MessageRouter } from "../cdp/router";
import type { PipeReader, PipeWriter } from "../cdp/transport";
import { ALL_BROWSER_PERMISSIONS, Page } from "../page";

interface FakeBrowser {
  reader: PipeReader;
  writer: PipeWriter;
  written: Array<{ id?: number; method?: string; params?: unknown; sessionId?: string }>;
  push(obj: unknown): void;
  autoRespond(methodPredicate: (m: string) => boolean, result: unknown): void;
  close(): void;
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

  return {
    reader,
    writer,
    written,
    push,
    autoRespond(pred, result) {
      autoResponders.push({ pred, result });
    },
    close() {
      try {
        pumpController?.close();
      } catch {
        // ignore
      }
    },
  };
}

/**
 * Auto-respond to the DOM-resolution chain `resolveOrigin` triggers. Two CDP
 * calls fire:
 *   1. `DOM.getDocument` → returns a synthetic root with a `backendNodeId`.
 *   2. `DOM.resolveNode({ backendNodeId })` → returns `{ object: { objectId } }`.
 *   3. `Runtime.callFunctionOn` → returns `{ result: { value: <origin> } }`.
 *
 * Used for the default-origin path; tests passing an explicit `origin` skip
 * this fixture.
 */
function wireOriginResolver(fake: FakeBrowser, origin: string): void {
  fake.autoRespond((m) => m === "DOM.getDocument", {
    root: { nodeId: 1, backendNodeId: 100 },
  });
  fake.autoRespond((m) => m === "DOM.resolveNode", {
    object: { objectId: "doc-obj-1" },
  });
  fake.autoRespond((m) => m === "Runtime.callFunctionOn", {
    result: { value: origin },
  });
}

describe("Page.localStorage / Page.sessionStorage", () => {
  let fake: FakeBrowser;
  let router: MessageRouter;
  let page: Page;

  beforeEach(() => {
    fake = makeFakeBrowser();
    router = new MessageRouter(fake.reader, fake.writer);
    router.start();
    page = new Page({
      router,
      targetId: "page-target",
      sessionId: "page-session",
      initialUrl: "https://example.com/",
    });
  });

  afterEach(async () => {
    await router.close();
    fake.close();
  });

  it("localStorage.get() sends DOMStorage.getDOMStorageItems with isLocalStorage:true", async () => {
    fake.autoRespond((m) => m === "DOMStorage.getDOMStorageItems", {
      entries: [
        ["foo", "bar"],
        ["baz", "qux"],
      ],
    });

    const items = await page.localStorage.get({ origin: "https://example.com" });
    expect(items).toEqual({ foo: "bar", baz: "qux" });

    const call = fake.written.find((w) => w.method === "DOMStorage.getDOMStorageItems");
    expect(call).toBeDefined();
    expect(call?.params).toEqual({
      storageId: { securityOrigin: "https://example.com", isLocalStorage: true },
    });
  });

  it("localStorage.get() defaults origin to current page origin", async () => {
    wireOriginResolver(fake, "https://defaulted.test");
    fake.autoRespond((m) => m === "DOMStorage.getDOMStorageItems", { entries: [] });
    await page.localStorage.get();
    const call = fake.written.find((w) => w.method === "DOMStorage.getDOMStorageItems");
    expect(call?.params).toEqual({
      storageId: { securityOrigin: "https://defaulted.test", isLocalStorage: true },
    });
  });

  it("localStorage.set() fans out one DOMStorage.setDOMStorageItem per key", async () => {
    fake.autoRespond((m) => m === "DOMStorage.setDOMStorageItem", {});
    await page.localStorage.set({ foo: "bar", baz: "qux" }, { origin: "https://example.com" });
    const calls = fake.written.filter((w) => w.method === "DOMStorage.setDOMStorageItem");
    expect(calls.length).toBe(2);
    expect(calls[0]?.params).toEqual({
      storageId: { securityOrigin: "https://example.com", isLocalStorage: true },
      key: "foo",
      value: "bar",
    });
    expect(calls[1]?.params).toEqual({
      storageId: { securityOrigin: "https://example.com", isLocalStorage: true },
      key: "baz",
      value: "qux",
    });
  });

  it("sessionStorage.get() flips isLocalStorage to false", async () => {
    fake.autoRespond((m) => m === "DOMStorage.getDOMStorageItems", {
      entries: [["k", "v"]],
    });
    const items = await page.sessionStorage.get({ origin: "https://example.com" });
    expect(items).toEqual({ k: "v" });
    const call = fake.written.find((w) => w.method === "DOMStorage.getDOMStorageItems");
    expect(call?.params).toEqual({
      storageId: { securityOrigin: "https://example.com", isLocalStorage: false },
    });
  });

  it("sessionStorage.set() also flips isLocalStorage to false", async () => {
    fake.autoRespond((m) => m === "DOMStorage.setDOMStorageItem", {});
    await page.sessionStorage.set({ a: "1" }, { origin: "https://example.com" });
    const call = fake.written.find((w) => w.method === "DOMStorage.setDOMStorageItem");
    expect(call?.params).toEqual({
      storageId: { securityOrigin: "https://example.com", isLocalStorage: false },
      key: "a",
      value: "1",
    });
  });

  it("localStorage.get() throws when origin defaults to opaque about:blank", async () => {
    // resolveOrigin returns "" or "null" for opaque origins. Wire that.
    fake.autoRespond((m) => m === "DOM.getDocument", {
      root: { nodeId: 1, backendNodeId: 100 },
    });
    fake.autoRespond((m) => m === "DOM.resolveNode", {
      object: { objectId: "doc-obj-1" },
    });
    fake.autoRespond((m) => m === "Runtime.callFunctionOn", { result: { value: "null" } });
    let threw = false;
    try {
      await page.localStorage.get();
    } catch (err) {
      threw = true;
      expect(String(err)).toContain("opaque");
    }
    expect(threw).toBe(true);
  });
});

describe("Page.grantAllPermissions", () => {
  let fake: FakeBrowser;
  let router: MessageRouter;
  let page: Page;

  beforeEach(() => {
    fake = makeFakeBrowser();
    router = new MessageRouter(fake.reader, fake.writer);
    router.start();
    page = new Page({
      router,
      targetId: "page-target",
      sessionId: "page-session",
      initialUrl: "https://example.com/",
    });
  });

  afterEach(async () => {
    await router.close();
    fake.close();
  });

  it("grantAllPermissions({ origin }) sends Browser.grantPermissions with the full list", async () => {
    fake.autoRespond((m) => m === "Browser.grantPermissions", {});
    await page.grantAllPermissions({ origin: "https://example.com" });
    const call = fake.written.find((w) => w.method === "Browser.grantPermissions");
    expect(call).toBeDefined();
    expect(call?.params).toEqual({
      permissions: [...ALL_BROWSER_PERMISSIONS],
      origin: "https://example.com",
    });
  });

  it("grantAllPermissions({ origin }) routes to ROOT browser target (no sessionId)", async () => {
    fake.autoRespond((m) => m === "Browser.grantPermissions", {});
    await page.grantAllPermissions({ origin: "https://example.com" });
    const call = fake.written.find((w) => w.method === "Browser.grantPermissions");
    // The router omits sessionId when unset → routes to root target. The
    // fake captures a missing/undefined sessionId.
    expect(call?.sessionId).toBeUndefined();
  });

  it("grantAllPermissions() defaults origin to the page's main-frame origin", async () => {
    wireOriginResolver(fake, "https://granted.test");
    fake.autoRespond((m) => m === "Browser.grantPermissions", {});
    await page.grantAllPermissions();
    const call = fake.written.find((w) => w.method === "Browser.grantPermissions");
    expect(call?.params).toEqual({
      permissions: [...ALL_BROWSER_PERMISSIONS],
      origin: "https://granted.test",
    });
  });

  it("ALL_BROWSER_PERMISSIONS contains canonical descriptors", () => {
    // Sanity check: a couple of well-known permissions must be present so
    // the conformance test catches a typo if someone hand-edits the list.
    expect(ALL_BROWSER_PERMISSIONS).toContain("geolocation");
    expect(ALL_BROWSER_PERMISSIONS).toContain("notifications");
    expect(ALL_BROWSER_PERMISSIONS).toContain("audioCapture");
    expect(ALL_BROWSER_PERMISSIONS).toContain("videoCapture");
    expect(ALL_BROWSER_PERMISSIONS).toContain("clipboardReadWrite");
    expect(ALL_BROWSER_PERMISSIONS).toContain("midiSysex");
    // No duplicates.
    expect(new Set(ALL_BROWSER_PERMISSIONS).size).toBe(ALL_BROWSER_PERMISSIONS.length);
  });
});
