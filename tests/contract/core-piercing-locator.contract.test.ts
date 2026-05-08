/**
 * Cross-package contract: `Page.querySelectorPiercing` finds elements behind
 * **closed** shadow roots — the v0.2 capability task 0253 ships and the
 * pre-existing `Page.text` / `Page.humanClick` (which use plain
 * `DOM.querySelector`) intentionally cannot.
 *
 * Strategy: drive a `Page` against a fake-pipe transport (via the shared
 * `tests/helpers/cdp-fixture.ts` helper), respond to
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
import type { PierceDomNode } from "../../packages/core/src/cdp/types";
import { ElementHandle } from "../../packages/core/src/index";
import { Page } from "../../packages/core/src/page";
import { type CdpResponders, makeFakePipe } from "../helpers/cdp-fixture";

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

/**
 * The piercing path needs a small set of dynamic responders: `DOM.getDocument`
 * branches on whether `pierce: true` was requested, and `DOM.resolveNode`
 * echoes the input `backendNodeId` into a synthetic `objectId`. Express
 * those as a `CdpResponders` map and pass them to `makeFakePipe`.
 */
function piercingResponders(closedShadowTree: PierceDomNode): CdpResponders {
  return {
    "DOM.getDocument": (params: unknown) => {
      const p = params as { depth?: number; pierce?: boolean } | undefined;
      if (p?.depth === -1 && p?.pierce === true) {
        return { root: closedShadowTree };
      }
      // Non-piercing fallback (used by `page.text` etc.) — a shallow tree
      // *without* the closed shadow descendants. This is what real CDP
      // returns for depth: 1.
      return {
        root: { nodeId: 1, backendNodeId: 1, nodeType: 9, nodeName: "#document" },
      };
    },
    // The light-DOM querySelector cannot see into the closed shadow root —
    // return nodeId: 0 to model the real CDP behavior.
    "DOM.querySelector": () => ({ nodeId: 0 }),
    "DOM.resolveNode": (params: unknown) => {
      const p = params as { backendNodeId?: number } | undefined;
      const id = p?.backendNodeId ?? 0;
      return {
        object: {
          type: "object",
          subtype: "node",
          objectId: `obj-${id}`,
          description: `Element[${id}]`,
        },
      };
    },
  };
}

describe("contract: Page.querySelectorPiercing finds elements inside CLOSED shadow roots", () => {
  it("resolves an iframe behind a closed-shadow host", async () => {
    const tree = buildClosedShadowTree();
    const pipe = makeFakePipe({ responders: piercingResponders(tree) });
    const router = new MessageRouter(pipe.reader, pipe.writer, { defaultTimeoutMs: 2000 });
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
      await router.close();
    }
  }, 5000);

  it("querySelectorAllPiercing returns every match in pre-order", async () => {
    const tree = buildClosedShadowTree();
    const pipe = makeFakePipe({ responders: piercingResponders(tree) });
    const router = new MessageRouter(pipe.reader, pipe.writer, { defaultTimeoutMs: 2000 });
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
      await router.close();
    }
  }, 5000);

  it("returns null when nothing matches — even with a piercing walk", async () => {
    const tree = buildClosedShadowTree();
    const pipe = makeFakePipe({ responders: piercingResponders(tree) });
    const router = new MessageRouter(pipe.reader, pipe.writer, { defaultTimeoutMs: 2000 });
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
      await router.close();
    }
  }, 5000);

  it("the pre-existing page.text(...) returns null for closed-shadow targets — confirming piercing is required", async () => {
    const tree = buildClosedShadowTree();
    const pipe = makeFakePipe({ responders: piercingResponders(tree) });
    const router = new MessageRouter(pipe.reader, pipe.writer, { defaultTimeoutMs: 2000 });
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
      await router.close();
    }
  }, 5000);
});
