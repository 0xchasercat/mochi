/**
 * Unit tests for the closed-shadow piercing walker
 * (`packages/core/src/page/piercing.ts`). Drives a hand-crafted
 * `PierceDomNode` tree that mirrors the CDP `DOM.getDocument({ depth:-1,
 * pierce:true })` shape — including a closed-shadow-rooted iframe, which is
 * the whole point of
 *
 * The findPiercingMatches output is verified by `backendNodeId`, the only
 * field the host-side `Page.querySelectorPiercing` cares about for the
 * `DOM.resolveNode` round-trip.
 */

import { describe, expect, it } from "bun:test";
import type { PierceDomNode } from "../cdp/types";
import { findPiercingMatches } from "../page/piercing";
import { parseSelector } from "../page/selector";

/** Element node helper. */
function elem(
  backendNodeId: number,
  tag: string,
  attrs: Record<string, string>,
  children: PierceDomNode[] = [],
): PierceDomNode {
  const flat: string[] = [];
  for (const [k, v] of Object.entries(attrs)) flat.push(k, v);
  return {
    nodeId: backendNodeId,
    backendNodeId,
    nodeType: 1,
    nodeName: tag.toUpperCase(),
    localName: tag.toLowerCase(),
    attributes: flat,
    children,
  };
}

/** Document node helper. */
function doc(children: PierceDomNode[]): PierceDomNode {
  return {
    nodeId: 0,
    backendNodeId: 0,
    nodeType: 9,
    nodeName: "#document",
    children,
  };
}

/** Shadow-root node helper. */
function shadow(
  backendNodeId: number,
  type: "open" | "closed",
  children: PierceDomNode[],
): PierceDomNode {
  return {
    nodeId: backendNodeId,
    backendNodeId,
    nodeType: 11, // DOCUMENT_FRAGMENT_NODE
    nodeName: "#document-fragment",
    shadowRootType: type,
    children,
  };
}

describe("findPiercingMatches — light DOM only", () => {
  it("finds a top-level iframe by tag", () => {
    const tree = doc([elem(10, "iframe", { src: "https://example.com" })]);
    const matches = findPiercingMatches(tree, parseSelector("iframe"));
    expect(matches.map((m) => m.backendNodeId)).toEqual([10]);
  });

  it("returns matches in depth-first pre-order", () => {
    const tree = doc([
      elem(10, "div", { class: "a" }, [elem(11, "div", { class: "b" })]),
      elem(12, "div", { class: "c" }),
    ]);
    const matches = findPiercingMatches(tree, parseSelector("div"));
    expect(matches.map((m) => m.backendNodeId)).toEqual([10, 11, 12]);
  });

  it("respects the limit parameter", () => {
    const tree = doc([elem(10, "div", {}), elem(11, "div", {}), elem(12, "div", {})]);
    const matches = findPiercingMatches(tree, parseSelector("div"), 2);
    expect(matches.map((m) => m.backendNodeId)).toEqual([10, 11]);
  });
});

describe("findPiercingMatches — open shadow roots", () => {
  it("finds an element inside an open shadow root", () => {
    const target = elem(20, "iframe", {
      src: "https://challenges.cloudflare.com/turnstile/x",
    });
    const host = elem(15, "x-host", {}, []);
    host.shadowRoots = [shadow(16, "open", [target])];
    const tree = doc([host]);
    const matches = findPiercingMatches(
      tree,
      parseSelector('iframe[src*="challenges.cloudflare.com/turnstile"]'),
    );
    expect(matches.map((m) => m.backendNodeId)).toEqual([20]);
  });
});

describe("findPiercingMatches — closed shadow roots (the point of 0253)", () => {
  it("finds an element inside a CLOSED shadow root", () => {
    const target = elem(30, "iframe", {
      src: "https://challenges.cloudflare.com/turnstile/closed",
    });
    const host = elem(25, "cf-host", {}, []);
    host.shadowRoots = [shadow(26, "closed", [target])];
    const tree = doc([host]);

    const matches = findPiercingMatches(
      tree,
      parseSelector('iframe[src*="challenges.cloudflare.com/turnstile"]'),
    );
    expect(matches.map((m) => m.backendNodeId)).toEqual([30]);
  });

  it("walks nested closed shadows", () => {
    // outer-host > [closed shadow] > inner-host > [closed shadow] > iframe
    // Each host's shadow root contains the next host (NOT also as a light-DOM
    // child — that would double-walk the inner subtree).
    const target = elem(40, "iframe", { src: "x" });
    const innerHost = elem(35, "y-host", {});
    innerHost.shadowRoots = [shadow(36, "closed", [target])];
    const outerHost = elem(31, "x-host", {});
    outerHost.shadowRoots = [shadow(32, "closed", [innerHost])];
    const tree = doc([outerHost]);

    const matches = findPiercingMatches(tree, parseSelector("iframe"));
    expect(matches.map((m) => m.backendNodeId)).toEqual([40]);
  });

  it("matches descendant combinator across a closed shadow boundary", () => {
    // <div class="root"><x-host>#shadow-closed{<iframe/>}</x-host></div>
    const iframe = elem(50, "iframe", { src: "y" });
    const host = elem(46, "x-host", {});
    host.shadowRoots = [shadow(47, "closed", [iframe])];
    const root = elem(45, "div", { class: "root" }, [host]);
    const tree = doc([root]);

    const matches = findPiercingMatches(tree, parseSelector(".root iframe"));
    expect(matches.map((m) => m.backendNodeId)).toEqual([50]);
  });
});

describe("findPiercingMatches — iframe contentDocument (same-origin)", () => {
  it("walks into iframe contentDocument trees", () => {
    const buried = elem(60, "button", { id: "go" });
    const subdoc: PierceDomNode = {
      nodeId: 0,
      backendNodeId: 55,
      nodeType: 9,
      nodeName: "#document",
      children: [buried],
    };
    const iframe = elem(54, "iframe", { src: "/sub.html" });
    iframe.contentDocument = subdoc;
    const tree = doc([iframe]);
    const matches = findPiercingMatches(tree, parseSelector("#go"));
    expect(matches.map((m) => m.backendNodeId)).toEqual([60]);
  });
});
