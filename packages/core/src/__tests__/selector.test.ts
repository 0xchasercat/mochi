/**
 * Unit tests for the host-side CSS selector parser + matcher used by
 * `Page.querySelectorPiercing`. Covers the exact subset documented in
 * `packages/core/src/page/selector.ts`:
 *
 *   - tag / id / class / attribute / descendant combinator
 *   - comma-separated lists
 *   - quoted attribute values, attribute operators (`=`, `~=`, `|=`, `^=`,
 *     `$=`, `*=`, presence)
 *
 * NOT covered here (intentional out-of-scope per task 0253): `>`/`+`/`~`
 * combinators, pseudo-classes / -elements, XPath. The matcher should reject
 * those at parse time.
 */

import { describe, expect, it } from "bun:test";
import type { PierceDomNode } from "../cdp/types";
import { matchSelector, parseSelector, readAttribute, SelectorParseError } from "../page/selector";

/** Build a minimal element node for matcher tests. */
function el(tag: string, attrs: Record<string, string> = {}): PierceDomNode {
  const flat: string[] = [];
  for (const [k, v] of Object.entries(attrs)) {
    flat.push(k, v);
  }
  return {
    nodeId: 1,
    backendNodeId: 1,
    nodeType: 1,
    nodeName: tag.toUpperCase(),
    localName: tag.toLowerCase(),
    attributes: flat,
  };
}

describe("parseSelector — accepted grammar", () => {
  it("parses a bare tag", () => {
    const p = parseSelector("div");
    expect(p.chains).toHaveLength(1);
    expect(p.chains[0]?.parts).toHaveLength(1);
    expect(p.chains[0]?.parts[0]?.tag).toBe("div");
  });

  it("parses a class selector with no tag (universal)", () => {
    const p = parseSelector(".btn");
    expect(p.chains[0]?.parts[0]?.tag).toBe("*");
    expect(p.chains[0]?.parts[0]?.classes).toEqual(["btn"]);
  });

  it("parses tag + id + multiple classes", () => {
    const p = parseSelector("button#submit.primary.large");
    const part = p.chains[0]?.parts[0];
    expect(part?.tag).toBe("button");
    expect(part?.id).toBe("submit");
    expect(part?.classes).toEqual(["primary", "large"]);
  });

  it("parses an attribute selector with no value", () => {
    const p = parseSelector("input[disabled]");
    const part = p.chains[0]?.parts[0];
    expect(part?.attrs[0]?.name).toBe("disabled");
    expect(part?.attrs[0]?.op).toBe("exists");
  });

  it("parses every attribute operator", () => {
    const ops: Array<["=" | "~=" | "|=" | "^=" | "$=" | "*=", string]> = [
      ["=", "[a=x]"],
      ["~=", '[a~="x"]'],
      ["|=", '[a|="x"]'],
      ["^=", '[a^="x"]'],
      ["$=", '[a$="x"]'],
      ["*=", '[a*="x"]'],
    ];
    for (const [op, src] of ops) {
      const p = parseSelector(src);
      expect(p.chains[0]?.parts[0]?.attrs[0]?.op).toBe(op);
      expect(p.chains[0]?.parts[0]?.attrs[0]?.value).toBe("x");
    }
  });

  it("parses a descendant chain", () => {
    const p = parseSelector("section .btn");
    expect(p.chains[0]?.parts).toHaveLength(2);
    expect(p.chains[0]?.parts[0]?.tag).toBe("section");
    expect(p.chains[0]?.parts[1]?.classes).toEqual(["btn"]);
  });

  it("parses a comma-separated list with attributes", () => {
    const p = parseSelector('iframe[src*="cf"], a#x, .btn');
    expect(p.chains).toHaveLength(3);
    expect(p.chains[0]?.parts[0]?.tag).toBe("iframe");
    expect(p.chains[0]?.parts[0]?.attrs[0]?.value).toBe("cf");
    expect(p.chains[1]?.parts[0]?.id).toBe("x");
    expect(p.chains[2]?.parts[0]?.classes).toEqual(["btn"]);
  });

  it("preserves whitespace inside quoted attribute values", () => {
    const p = parseSelector('input[name="hello world"]');
    expect(p.chains[0]?.parts[0]?.attrs[0]?.value).toBe("hello world");
  });
});

describe("parseSelector — rejected input", () => {
  it("rejects empty string", () => {
    expect(() => parseSelector("")).toThrow(SelectorParseError);
  });

  it("rejects unterminated bracket", () => {
    expect(() => parseSelector("input[name=")).toThrow(SelectorParseError);
  });

  it("rejects bad tag chars", () => {
    // We only enforce on tag prefix when present — `.foo!` parses tag `*`
    // then class. But a leading numeric tag like `9foo` is rejected.
    expect(() => parseSelector("9foo")).toThrow(SelectorParseError);
  });
});

describe("matchSelector — basic matchers", () => {
  it("matches tag", () => {
    const node = el("div");
    expect(matchSelector(parseSelector("div"), node, [])).toBe(true);
    expect(matchSelector(parseSelector("span"), node, [])).toBe(false);
  });

  it("matches universal", () => {
    expect(matchSelector(parseSelector("*"), el("div"), [])).toBe(true);
    expect(matchSelector(parseSelector("*"), el("img"), [])).toBe(true);
  });

  it("matches id", () => {
    const node = el("div", { id: "main" });
    expect(matchSelector(parseSelector("#main"), node, [])).toBe(true);
    expect(matchSelector(parseSelector("#other"), node, [])).toBe(false);
  });

  it("matches class (single + multiple)", () => {
    const node = el("button", { class: "btn primary large" });
    expect(matchSelector(parseSelector(".btn"), node, [])).toBe(true);
    expect(matchSelector(parseSelector(".btn.primary"), node, [])).toBe(true);
    expect(matchSelector(parseSelector(".btn.primary.large"), node, [])).toBe(true);
    expect(matchSelector(parseSelector(".btn.missing"), node, [])).toBe(false);
  });

  it("matches every attribute operator", () => {
    const node = el("a", {
      href: "https://example.com/foo/bar",
      "data-tags": "alpha beta gamma",
      lang: "en-US",
    });
    expect(matchSelector(parseSelector("a[href]"), node, [])).toBe(true);
    expect(matchSelector(parseSelector('a[href="https://example.com/foo/bar"]'), node, [])).toBe(
      true,
    );
    expect(matchSelector(parseSelector('a[href^="https://"]'), node, [])).toBe(true);
    expect(matchSelector(parseSelector('a[href$="/bar"]'), node, [])).toBe(true);
    expect(matchSelector(parseSelector('a[href*="example"]'), node, [])).toBe(true);
    expect(matchSelector(parseSelector('a[data-tags~="beta"]'), node, [])).toBe(true);
    expect(matchSelector(parseSelector('a[data-tags~="zeta"]'), node, [])).toBe(false);
    expect(matchSelector(parseSelector('a[lang|="en"]'), node, [])).toBe(true);
    expect(matchSelector(parseSelector('a[lang|="fr"]'), node, [])).toBe(false);
  });

  it("matches descendant chains", () => {
    const section = el("section", { class: "panel" });
    const wrapper = el("div", { class: "wrap" });
    const button = el("button", { class: "btn" });
    expect(matchSelector(parseSelector("section .btn"), button, [section, wrapper])).toBe(true);
    expect(matchSelector(parseSelector("section button"), button, [section, wrapper])).toBe(true);
    // Reject when the leftmost compound is missing from the ancestor chain.
    expect(matchSelector(parseSelector("article button"), button, [section, wrapper])).toBe(false);
  });

  it("matches comma-separated branches", () => {
    const node = el("button", { class: "btn" });
    expect(matchSelector(parseSelector("a, button"), node, [])).toBe(true);
    expect(matchSelector(parseSelector("a, span"), node, [])).toBe(false);
  });
});

describe("readAttribute", () => {
  it("returns the value if present (case-insensitive name)", () => {
    const node = el("div", { id: "x", DataFoo: "yes" });
    expect(readAttribute(node, "id")).toBe("x");
    expect(readAttribute(node, "datafoo")).toBe("yes");
    expect(readAttribute(node, "missing")).toBeUndefined();
  });
});
