/**
 * Unit tests for the inject-side detector.
 *
 * Bun has no `node:vm` and we don't spin up real Chromium for unit tests.
 * Instead we synthesize a minimal DOM-like sandbox (mirrors the pattern in
 * `packages/inject/src/__tests__/sandbox.ts`), run the IIFE under it, and
 * assert the Symbol-keyed reader installed on `document` reflects the
 * mutation we drive into the synthetic DOM.
 *
 * @see ../inject.ts
 */

import { describe, expect, it } from "bun:test";
import { buildTurnstileInjectScript, TURNSTILE_EVENT_NAMES, TURNSTILE_READER_KEY } from "../inject";

interface FakeRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface FakeElement {
  tagName: string;
  nodeType: number;
  attributes: Record<string, string>;
  children: FakeElement[];
  parent: FakeElement | null;
  value?: string;
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
  getBoundingClientRect(): FakeRect;
  querySelectorAll(selector: string): FakeElement[];
  appendChild(child: FakeElement): FakeElement;
}

interface FakeMutationRecord {
  type: "childList" | "attributes";
  target: FakeElement;
  addedNodes: FakeElement[];
  attributeName?: string;
}

type MutationCallback = (records: FakeMutationRecord[]) => void;

interface FakeMutationObserver {
  observe(target: FakeElement, opts: MutationObserverInit): void;
  disconnect(): void;
}

interface FakeDocument extends FakeElement {
  body: FakeElement;
  querySelectorAll(selector: string): FakeElement[];
}

interface SandboxState {
  document: FakeDocument;
  window: { document: FakeDocument };
  consoleEvents: Array<{ level: string; args: unknown[] }>;
  observers: Array<{ callback: MutationCallback; target: FakeElement }>;
  fireMutation(target: FakeElement, added: FakeElement[]): void;
  fireAttributeMutation(target: FakeElement): void;
}

/** Build a fresh sandbox + run the IIFE script against it. */
function runScript(script: string): SandboxState {
  const observers: SandboxState["observers"] = [];
  const consoleEvents: SandboxState["consoleEvents"] = [];

  function makeElement(tag: string): FakeElement {
    const attrs: Record<string, string> = {};
    const children: FakeElement[] = [];
    const el: FakeElement = {
      tagName: tag.toUpperCase(),
      nodeType: 1,
      attributes: attrs,
      children: children,
      parent: null,
      getAttribute(name: string) {
        return name in attrs ? (attrs[name] ?? null) : null;
      },
      setAttribute(name: string, value: string) {
        attrs[name] = value;
      },
      getBoundingClientRect() {
        return { left: 10, top: 20, width: 300, height: 65 };
      },
      querySelectorAll(selector: string): FakeElement[] {
        // Minimal selector support — we only need:
        //   "iframe"
        //   'input[name="cf-turnstile-response"], textarea[name="cf-turnstile-response"]'
        const out: FakeElement[] = [];
        const visit = (node: FakeElement): void => {
          for (const c of node.children) {
            const tag = c.tagName.toLowerCase();
            if (selector === "iframe" && tag === "iframe") out.push(c);
            else if (selector.indexOf("cf-turnstile-response") >= 0) {
              if (
                (tag === "input" || tag === "textarea") &&
                c.attributes.name === "cf-turnstile-response"
              ) {
                out.push(c);
              }
            }
            visit(c);
          }
        };
        visit(el);
        return out;
      },
      appendChild(child: FakeElement) {
        child.parent = el;
        children.push(child);
        return child;
      },
    };
    return el;
  }

  const docEl = makeElement("html") as unknown as FakeDocument;
  const body = makeElement("body");
  docEl.body = body;
  docEl.appendChild(body);
  // Document-style override: the iterator looks for sym descriptions.
  docEl.tagName = "#document";
  docEl.nodeType = 9;

  const FakeMO = function (this: unknown, cb: MutationCallback) {
    const observer: FakeMutationObserver = {
      observe(target: FakeElement) {
        observers.push({ callback: cb, target: target });
      },
      disconnect() {},
    };
    return observer;
  } as unknown as new (
    cb: MutationCallback,
  ) => FakeMutationObserver;

  const fakeConsole = {
    debug(...args: unknown[]) {
      consoleEvents.push({ level: "debug", args: args });
    },
  };

  const fakeWindow = { document: docEl };

  const fn = new Function(
    "window",
    "document",
    "console",
    "MutationObserver",
    "Symbol",
    "Object",
    "WeakMap",
    "Date",
    script,
  );
  fn(fakeWindow, docEl, fakeConsole, FakeMO, Symbol, Object, WeakMap, Date);

  return {
    document: docEl,
    window: fakeWindow,
    consoleEvents: consoleEvents,
    observers: observers,
    fireMutation(target: FakeElement, added: FakeElement[]) {
      for (const c of added) target.appendChild(c);
      for (const o of observers) {
        o.callback([
          {
            type: "childList",
            target: target,
            addedNodes: added,
          },
        ]);
      }
    },
    fireAttributeMutation(target: FakeElement) {
      for (const o of observers) {
        o.callback([
          {
            type: "attributes",
            target: target,
            addedNodes: [],
            attributeName: "src",
          },
        ]);
      }
    },
  };

  function _unused() {
    void makeElement;
  }
}

/** Helper: read the inject reader off the document. Returns null if absent. */
function readSnapshot(state: SandboxState): unknown {
  const doc = state.document as unknown as Record<symbol, unknown>;
  const syms = Object.getOwnPropertySymbols(doc);
  for (const s of syms) {
    if (s.description === TURNSTILE_READER_KEY) {
      const fn = doc[s];
      if (typeof fn === "function") return (fn as () => unknown)();
    }
  }
  return null;
}

describe("buildTurnstileInjectScript — install", () => {
  it("registers a Symbol-keyed reader on document", () => {
    const state = runScript(buildTurnstileInjectScript());
    const snap = readSnapshot(state);
    expect(snap).not.toBeNull();
    expect((snap as { found: boolean }).found).toBe(false);
  });

  it("attaches a MutationObserver", () => {
    const state = runScript(buildTurnstileInjectScript());
    expect(state.observers.length).toBeGreaterThan(0);
  });

  it("is idempotent — second install is a no-op (no second symbol)", () => {
    const state = runScript(buildTurnstileInjectScript());
    // Run the script again against the SAME document.
    const fn = new Function(
      "window",
      "document",
      "console",
      "MutationObserver",
      "Symbol",
      "Object",
      "WeakMap",
      "Date",
      buildTurnstileInjectScript(),
    );
    fn(
      state.window,
      state.document,
      { debug: () => {} },
      (() => ({ observe: () => {}, disconnect: () => {} })) as unknown,
      Symbol,
      Object,
      WeakMap,
      Date,
    );
    const syms = Object.getOwnPropertySymbols(state.document);
    const matching = syms.filter((s) => s.description === TURNSTILE_READER_KEY);
    expect(matching.length).toBe(1);
  });
});

describe("buildTurnstileInjectScript — detection", () => {
  function makeIframe(_state: SandboxState, src: string): FakeElement {
    const fr = {
      tagName: "IFRAME",
      nodeType: 1,
      attributes: { src: src },
      children: [],
      parent: null,
      value: undefined,
      getAttribute(name: string) {
        return name in this.attributes ? this.attributes[name] : null;
      },
      setAttribute(name: string, value: string) {
        this.attributes[name] = value;
      },
      getBoundingClientRect() {
        return { left: 10, top: 20, width: 300, height: 65 };
      },
      querySelectorAll() {
        return [];
      },
      appendChild(c: FakeElement) {
        this.children.push(c);
        return c;
      },
    } as FakeElement;
    return fr;
  }

  it("detects Turnstile iframe added via mutation", () => {
    const state = runScript(buildTurnstileInjectScript());
    const fr = makeIframe(state, "https://challenges.cloudflare.com/turnstile/v0/test?token=abc");
    state.fireMutation(state.document.body, [fr]);
    const snap = readSnapshot(state) as { found: boolean; frames: unknown[] };
    expect(snap.found).toBe(true);
    expect(snap.frames.length).toBe(1);
  });

  it("ignores non-Turnstile iframes", () => {
    const state = runScript(buildTurnstileInjectScript());
    const fr = makeIframe(state, "https://example.com/embed");
    state.fireMutation(state.document.body, [fr]);
    const snap = readSnapshot(state) as { found: boolean; frames: unknown[] };
    expect(snap.found).toBe(false);
    expect(snap.frames.length).toBe(0);
  });

  it("emits a console.debug event with the magic tag on detection", () => {
    const state = runScript(buildTurnstileInjectScript());
    const fr = makeIframe(state, "https://challenges.cloudflare.com/turnstile/v0/widget?k=foo");
    state.fireMutation(state.document.body, [fr]);
    const ev = state.consoleEvents.find(
      (e) =>
        e.level === "debug" &&
        e.args.length > 0 &&
        typeof e.args[0] === "object" &&
        e.args[0] !== null &&
        (e.args[0] as { __mochi_event?: string }).__mochi_event === TURNSTILE_EVENT_NAMES.detected,
    );
    expect(ev).toBeDefined();
  });

  it("flags escalation when src matches /challenge.html", () => {
    const state = runScript(buildTurnstileInjectScript());
    const fr = makeIframe(
      state,
      "https://challenges.cloudflare.com/turnstile/v0/challenge.html?id=zz",
    );
    state.fireMutation(state.document.body, [fr]);
    const snap = readSnapshot(state) as { found: boolean; frames: Array<{ escalated: boolean }> };
    expect(snap.found).toBe(true);
    expect(snap.frames[0]?.escalated).toBe(true);
    const ev = state.consoleEvents.find(
      (e) =>
        e.args.length > 0 &&
        typeof e.args[0] === "object" &&
        e.args[0] !== null &&
        (e.args[0] as { __mochi_event?: string }).__mochi_event === TURNSTILE_EVENT_NAMES.escalated,
    );
    expect(ev).toBeDefined();
  });

  it("reads the cf-turnstile-response token from the input field", () => {
    const state = runScript(buildTurnstileInjectScript());
    const fr = makeIframe(state, "https://challenges.cloudflare.com/turnstile/v0/widget");
    state.fireMutation(state.document.body, [fr]);
    // Add the hidden response input.
    const input = {
      tagName: "INPUT",
      nodeType: 1,
      attributes: { name: "cf-turnstile-response" },
      children: [],
      parent: null,
      value: "TOKEN-XYZ",
      getAttribute(name: string) {
        return this.attributes[name] ?? null;
      },
      setAttribute(name: string, v: string) {
        this.attributes[name] = v;
      },
      getBoundingClientRect() {
        return { left: 0, top: 0, width: 0, height: 0 };
      },
      querySelectorAll() {
        return [];
      },
      appendChild(c: FakeElement) {
        return c;
      },
    } as FakeElement;
    state.document.body.appendChild(input);
    const snap = readSnapshot(state) as { token: string | null };
    expect(snap.token).toBe("TOKEN-XYZ");
  });

  it("filters non-element nodes during mutation processing", () => {
    const state = runScript(buildTurnstileInjectScript());
    // Fire a mutation whose addedNodes include a text node (nodeType 3).
    const textNode = { nodeType: 3, tagName: "" } as unknown as FakeElement;
    state.observers[0]?.callback([
      {
        type: "childList",
        target: state.document.body,
        addedNodes: [textNode],
      },
    ]);
    const snap = readSnapshot(state) as { found: boolean };
    expect(snap.found).toBe(false);
  });
});
