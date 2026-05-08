/**
 * Cross-package contract: `Page.querySelectorPiercing` finds elements behind
 * **closed** shadow roots — the v0.2 capability task 0253 ships and the
 * pre-existing `Page.text` / `Page.humanClick` (which use plain
 * `DOM.querySelector`) intentionally cannot.
 *
 * Strategy: drive a `Page` against a fake-pipe transport (same harness used
 * by `inject-no-runtime-enable.contract.test.ts`), respond to
 * `DOM.getDocument({ depth:-1, pierce:true })` with a hand-built tree that
 * embeds an iframe behind a closed shadow root, and verify that:
 *
 *   1. `page.querySelectorPiercing('iframe[...]')` resolves a non-null
 *      `ElementHandle` whose `backendNodeId` is the deeply-nested target.
 *   2. The pre-existing non-piercing `page.text(...)` path returns `null`
 *      for the same selector — confirming the existing surface really
 *      cannot reach closed shadows (i.e. piercing is required).
 *
 * @see tasks/0253-closed-shadow-piercing-locator.md
 * @see PLAN.md §8.2 — `DOM.getDocument` + `DOM.resolveNode` are not on the
 *   forbidden list.
 */

import { describe, expect, it } from "bun:test";
import { MessageRouter } from "../../packages/core/src/cdp/router";
import type { PipeReader, PipeWriter } from "../../packages/core/src/cdp/transport";
import type { PierceDomNode } from "../../packages/core/src/cdp/types";
import { ElementHandle } from "../../packages/core/src/index";
import { Page } from "../../packages/core/src/page";

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
      const json = JSON.stringify(msg);
      const utf8 = new TextEncoder().encode(json);
      const out = new Uint8Array(utf8.length + 1);
      out.set(utf8, 0);
      out[utf8.length] = 0;
      pushChunk(out);
    },
  };
}

/** Build a CDP DOM.getDocument response that nests a turnstile iframe under a CLOSED shadow root. */
function buildClosedShadowTree(): PierceDomNode {
  const iframe: PierceDomNode = {
    nodeId: 100,
    backendNodeId: 9001,
    nodeType: 1,
    nodeName: "IFRAME",
    localName: "iframe",
    attributes: ["src", "https://challenges.cloudflare.com/turnstile/0/abc"],
  };
  const host: PierceDomNode = {
    nodeId: 50,
    backendNodeId: 5000,
    nodeType: 1,
    nodeName: "CF-HOST",
    localName: "cf-host",
    attributes: [],
    shadowRoots: [
      {
        nodeId: 51,
        backendNodeId: 5001,
        nodeType: 11,
        nodeName: "#document-fragment",
        shadowRootType: "closed",
        children: [iframe],
      },
    ],
  };
  return {
    nodeId: 1,
    backendNodeId: 1,
    nodeType: 9,
    nodeName: "#document",
    children: [
      {
        nodeId: 2,
        backendNodeId: 2,
        nodeType: 1,
        nodeName: "HTML",
        localName: "html",
        attributes: [],
        children: [
          {
            nodeId: 3,
            backendNodeId: 3,
            nodeType: 1,
            nodeName: "BODY",
            localName: "body",
            attributes: [],
            children: [host],
          },
        ],
      },
    ],
  };
}

/** Auto-respond to the small CDP method set the piercing path needs. */
function startResponder(
  written: RecordedFrame[],
  inject: (msg: object) => void,
  closedShadowTree: PierceDomNode,
): NodeJS.Timeout {
  const responder = setInterval(() => {
    for (const frame of written) {
      const f = frame.parsed;
      const responded = (frame as unknown as { __responded?: boolean }).__responded;
      if (responded === true) continue;
      if (typeof f.id !== "number") continue;
      const tag = frame as unknown as { __responded: boolean };
      if (f.method === "DOM.getDocument") {
        const params = f.params as { depth?: number; pierce?: boolean } | undefined;
        if (params?.depth === -1 && params?.pierce === true) {
          inject({ id: f.id, result: { root: closedShadowTree } });
        } else {
          // Non-piercing fallback (used by `page.text` etc.) — a shallow tree
          // *without* the closed shadow descendants. This is what real CDP
          // returns for depth: 1.
          inject({
            id: f.id,
            result: {
              root: {
                nodeId: 1,
                backendNodeId: 1,
                nodeType: 9,
                nodeName: "#document",
              },
            },
          });
        }
        tag.__responded = true;
      } else if (f.method === "DOM.querySelector") {
        // The light-DOM querySelector cannot see into the closed shadow
        // root — return nodeId: 0 to model the real CDP behavior.
        inject({ id: f.id, result: { nodeId: 0 } });
        tag.__responded = true;
      } else if (f.method === "DOM.resolveNode") {
        const params = f.params as { backendNodeId?: number } | undefined;
        const id = params?.backendNodeId ?? 0;
        inject({
          id: f.id,
          result: {
            object: {
              type: "object",
              subtype: "node",
              objectId: `obj-${id}`,
              description: `Element[${id}]`,
            },
          },
        });
        tag.__responded = true;
      } else if (f.method === "Page.enable") {
        inject({ id: f.id, result: {} });
        tag.__responded = true;
      } else if (f.method === "Target.closeTarget") {
        inject({ id: f.id, result: { success: true } });
        tag.__responded = true;
      } else if (f.method === "Page.removeScriptToEvaluateOnNewDocument") {
        inject({ id: f.id, result: {} });
        tag.__responded = true;
      }
    }
  }, 5);
  return responder;
}

describe("contract: Page.querySelectorPiercing finds elements inside CLOSED shadow roots", () => {
  it("resolves an iframe behind a closed-shadow host", async () => {
    const { reader, writer, written, inject } = makeFakePipes();
    const tree = buildClosedShadowTree();
    const responder = startResponder(written, inject, tree);

    const router = new MessageRouter(reader, writer, { defaultTimeoutMs: 2000 });
    router.start();
    const page = new Page({
      router,
      targetId: "tgt-1",
      sessionId: "sess-1",
      initialUrl: "about:blank",
    });
    try {
      const handle = await page.querySelectorPiercing(
        'iframe[src*="challenges.cloudflare.com/turnstile"]',
      );
      expect(handle).not.toBeNull();
      expect(handle).toBeInstanceOf(ElementHandle);
      // The piercing locator's contract: it found the iframe at
      // backendNodeId 9001, the deeply-nested element under the closed shadow.
      expect(handle?.backendNodeId).toBe(9001);
    } finally {
      clearInterval(responder);
      await router.close();
    }
  }, 5000);

  it("querySelectorAllPiercing returns every match in pre-order", async () => {
    const { reader, writer, written, inject } = makeFakePipes();
    const tree = buildClosedShadowTree();
    const responder = startResponder(written, inject, tree);

    const router = new MessageRouter(reader, writer, { defaultTimeoutMs: 2000 });
    router.start();
    const page = new Page({
      router,
      targetId: "tgt-2",
      sessionId: "sess-2",
      initialUrl: "about:blank",
    });
    try {
      const handles = await page.querySelectorAllPiercing("iframe");
      expect(handles).toHaveLength(1);
      expect(handles[0]?.backendNodeId).toBe(9001);
    } finally {
      clearInterval(responder);
      await router.close();
    }
  }, 5000);

  it("returns null when nothing matches — even with a piercing walk", async () => {
    const { reader, writer, written, inject } = makeFakePipes();
    const tree = buildClosedShadowTree();
    const responder = startResponder(written, inject, tree);

    const router = new MessageRouter(reader, writer, { defaultTimeoutMs: 2000 });
    router.start();
    const page = new Page({
      router,
      targetId: "tgt-3",
      sessionId: "sess-3",
      initialUrl: "about:blank",
    });
    try {
      const handle = await page.querySelectorPiercing(".no-such-class");
      expect(handle).toBeNull();
    } finally {
      clearInterval(responder);
      await router.close();
    }
  }, 5000);

  it("the pre-existing page.text(...) returns null for closed-shadow targets — confirming piercing is required", async () => {
    const { reader, writer, written, inject } = makeFakePipes();
    const tree = buildClosedShadowTree();
    const responder = startResponder(written, inject, tree);

    const router = new MessageRouter(reader, writer, { defaultTimeoutMs: 2000 });
    router.start();
    const page = new Page({
      router,
      targetId: "tgt-4",
      sessionId: "sess-4",
      initialUrl: "about:blank",
    });
    try {
      // page.text uses DOM.querySelector against the document root — does
      // NOT pierce closed shadows. Our responder mirrors real CDP behavior
      // (returning nodeId: 0). Result: null. This is what justifies
      // querySelectorPiercing as a separate API.
      const text = await page.text('iframe[src*="challenges.cloudflare.com/turnstile"]');
      expect(text).toBeNull();
    } finally {
      clearInterval(responder);
      await router.close();
    }
  }, 5000);
});
