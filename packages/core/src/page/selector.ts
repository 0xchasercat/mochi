/**
 * Tiny host-side CSS selector engine for the closed-shadow piercing locator
 * (`Page.querySelectorPiercing`). Parses a CSS selector into a sequence of
 * **compound** parts joined by descendant combinators, then matches a
 * pre-walked `PierceDomNode` against that compound chain.
 *
 * Why we don't `DOM.querySelector` per shadow root: that CDP method does NOT
 * pierce closed shadows even when its parent `DOM.getDocument` was called
 * with `pierce: true`. Patchright's `_customFindElementsByParsed`
 * (`framesPatch.ts:868-1012`) parses the selector itself and walks the tree
 * manually for exactly this reason. We port the algorithm — *not* the surface
 * area: only the CSS-selector subset listed in `tasks/0253` lands here.
 *
 * **Supported subset (CSS Selectors level 4 — strict subset):**
 * - Tag selectors: `div`, `iframe`, `*`
 * - ID: `#main`
 * - Class: `.btn`, `.btn.primary`
 * - Attribute: `[src]`, `[name="x"]`, `[href*="foo"]`, `[role^="b"]`,
 *   `[data-x$="y"]`, `[data-x~="z"]`, `[data-x|="en"]`. Quotes optional for
 *   value-less words.
 * - Descendant combinator: `div .btn` (whitespace).
 * - Comma-separated selector lists: `a, button` — match if ANY branch matches.
 *
 * **NOT supported (intentionally — see Out of scope in 0253):**
 * - `>`, `+`, `~` combinators
 * - `:pseudo-classes` (`:hover`, `:nth-child`, `:has`, `:not`)
 * - `::pseudo-elements`
 * - XPath (deferred — STRETCH per task brief; document as TODO if it lands).
 * - Namespaces.
 *
 * Throws `SelectorParseError` on syntactically invalid input. The matcher
 * itself never throws — unsupported nodes just don't match.
 *
 * @see PLAN.md §8.2 (forbidden CDP — neither `DOM.getDocument` nor
 *   `DOM.resolveNode` is forbidden; both fine).
 */

import type { PierceDomNode } from "../cdp/types";

/** Thrown when the selector has a syntax error we can't recover from. */
export class SelectorParseError extends Error {
  readonly selector: string;
  constructor(selector: string, message: string) {
    super(`[mochi] invalid selector "${selector}": ${message}`);
    this.name = "SelectorParseError";
    this.selector = selector;
  }
}

/** A single attribute filter inside a compound part. */
export interface AttrFilter {
  name: string;
  /**
   * Matcher op:
   * - `"exists"`: attribute is present (value ignored)
   * - `"="`: exact value
   * - `"~="`: whitespace-separated word match
   * - `"|="`: exact OR `value-…` prefix
   * - `"^="`: prefix match
   * - `"$="`: suffix match
   * - `"*="`: substring match
   */
  op: "exists" | "=" | "~=" | "|=" | "^=" | "$=" | "*=";
  /** Match value (always present except for `op === "exists"`). */
  value?: string;
}

/** A compound (no whitespace) selector — one element's worth of constraints. */
export interface CompoundPart {
  /** Lower-case tag, or `"*"` for the universal selector. */
  tag: string;
  id?: string;
  classes: string[];
  attrs: AttrFilter[];
}

/**
 * A single descendant chain (one comma-separated branch). Matching iterates
 * the chain right-to-left: the rightmost part must match the candidate; each
 * earlier part must have a matching ancestor (DOM-ancestor-aware, including
 * across shadow boundaries — see `matchSelector` for the walk).
 */
export interface CompoundChain {
  parts: CompoundPart[];
}

/** A parsed selector list — `,`-separated chains. */
export interface ParsedSelector {
  chains: CompoundChain[];
}

// ---- parser ----------------------------------------------------------------

/**
 * Parse a CSS selector string into a {@link ParsedSelector}. Throws
 * {@link SelectorParseError} on bad input.
 *
 * The grammar we accept is a strict subset documented at the top of this
 * module. We deliberately do not use a regex-driven parser — those struggle
 * with quoted attribute values that contain `[`, `,`, or whitespace.
 */
export function parseSelector(input: string): ParsedSelector {
  if (typeof input !== "string") {
    throw new SelectorParseError(String(input), "selector must be a string");
  }
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    throw new SelectorParseError(input, "selector must not be empty");
  }
  const branches = splitTopLevel(trimmed, ",");
  const chains: CompoundChain[] = [];
  for (const branch of branches) {
    const parts = splitTopLevel(branch.trim(), " ").filter((p) => p.length > 0);
    if (parts.length === 0) {
      throw new SelectorParseError(input, "empty selector branch");
    }
    chains.push({ parts: parts.map((p) => parseCompound(p, input)) });
  }
  return { chains };
}

/**
 * Split a selector string at top-level occurrences of `sep` — i.e. ignoring
 * separators inside `[...]` brackets or quoted attribute values.
 */
function splitTopLevel(input: string, sep: string): string[] {
  const out: string[] = [];
  let buf = "";
  let depth = 0;
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i] as string;
    if (quote !== null) {
      buf += ch;
      if (ch === "\\" && i + 1 < input.length) {
        const next = input[i + 1] as string;
        buf += next;
        i++;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      buf += ch;
      continue;
    }
    if (ch === "[") {
      depth++;
      buf += ch;
      continue;
    }
    if (ch === "]") {
      depth = Math.max(0, depth - 1);
      buf += ch;
      continue;
    }
    if (depth === 0 && ch === sep) {
      out.push(buf);
      buf = "";
      continue;
    }
    if (depth === 0 && sep === " " && /\s/.test(ch)) {
      out.push(buf);
      buf = "";
      continue;
    }
    buf += ch;
  }
  out.push(buf);
  return out;
}

/** Parse one compound (tag + ids + classes + attrs, no whitespace). */
function parseCompound(input: string, original: string): CompoundPart {
  const part: CompoundPart = { tag: "*", classes: [], attrs: [] };
  let i = 0;
  // Optional tag prefix (or `*`).
  let tagBuf = "";
  while (i < input.length) {
    const ch = input[i] as string;
    if (ch === "#" || ch === "." || ch === "[") break;
    tagBuf += ch;
    i++;
  }
  if (tagBuf.length > 0) {
    if (!/^[*a-zA-Z][a-zA-Z0-9-]*$/.test(tagBuf)) {
      throw new SelectorParseError(original, `bad tag "${tagBuf}"`);
    }
    part.tag = tagBuf.toLowerCase();
  }
  while (i < input.length) {
    const ch = input[i] as string;
    if (ch === "#") {
      i++;
      const id = readIdent(input, i, original);
      part.id = id.value;
      i = id.next;
      continue;
    }
    if (ch === ".") {
      i++;
      const cls = readIdent(input, i, original);
      part.classes.push(cls.value);
      i = cls.next;
      continue;
    }
    if (ch === "[") {
      i++;
      const attr = readAttr(input, i, original);
      part.attrs.push(attr.filter);
      i = attr.next;
      continue;
    }
    throw new SelectorParseError(original, `unexpected "${ch}" in compound "${input}"`);
  }
  return part;
}

/** Read an identifier starting at `i`. Returns the parsed value + next idx. */
function readIdent(input: string, i: number, original: string): { value: string; next: number } {
  const start = i;
  while (i < input.length) {
    const ch = input[i] as string;
    if (!/[a-zA-Z0-9_-]/.test(ch)) break;
    i++;
  }
  const value = input.slice(start, i);
  if (value.length === 0) {
    throw new SelectorParseError(original, `expected identifier at position ${start}`);
  }
  return { value, next: i };
}

/** Read the contents of `[...]` starting just past the `[`. */
function readAttr(
  input: string,
  i: number,
  original: string,
): { filter: AttrFilter; next: number } {
  // Read attribute name (case-insensitive HTML; lower-case for storage).
  const nameStart = i;
  while (i < input.length) {
    const ch = input[i] as string;
    if (!/[a-zA-Z0-9_:-]/.test(ch)) break;
    i++;
  }
  const name = input.slice(nameStart, i).toLowerCase();
  if (name.length === 0) {
    throw new SelectorParseError(original, `expected attribute name at position ${nameStart}`);
  }
  while (i < input.length && /\s/.test(input[i] as string)) i++;
  if (i >= input.length) {
    throw new SelectorParseError(original, `unterminated [...] in selector`);
  }
  if ((input[i] as string) === "]") {
    return { filter: { name, op: "exists" }, next: i + 1 };
  }
  // Operator.
  const opChars = ["~=", "|=", "^=", "$=", "*=", "="] as const;
  let op: AttrFilter["op"] | null = null;
  for (const cand of opChars) {
    if (input.startsWith(cand, i)) {
      op = cand;
      i += cand.length;
      break;
    }
  }
  if (op === null) {
    throw new SelectorParseError(original, `expected operator at position ${i}`);
  }
  while (i < input.length && /\s/.test(input[i] as string)) i++;
  // Value: quoted or bare ident.
  let value: string;
  const ch0 = input[i] as string | undefined;
  if (ch0 === '"' || ch0 === "'") {
    const quote = ch0;
    i++;
    let buf = "";
    while (i < input.length) {
      const ch = input[i] as string;
      if (ch === "\\" && i + 1 < input.length) {
        buf += input[i + 1];
        i += 2;
        continue;
      }
      if (ch === quote) {
        i++;
        break;
      }
      buf += ch;
      i++;
    }
    value = buf;
  } else {
    const start = i;
    while (i < input.length) {
      const ch = input[i] as string;
      if (ch === "]" || /\s/.test(ch)) break;
      i++;
    }
    value = input.slice(start, i);
  }
  while (i < input.length && /\s/.test(input[i] as string)) i++;
  if ((input[i] as string | undefined) !== "]") {
    throw new SelectorParseError(original, `expected ']' at position ${i}`);
  }
  return { filter: { name, op, value }, next: i + 1 };
}

// ---- matcher ---------------------------------------------------------------

/**
 * Test whether a single (already-walked) node matches the rightmost compound
 * part of any branch in `parsed`, with ancestor-walking for descendant
 * combinators. `ancestors` is the chain of parent element nodes from the
 * document root down to (but not including) `node`, INCLUDING ancestors that
 * cross shadow boundaries (the piercing walker keeps a flat chain).
 */
export function matchSelector(
  parsed: ParsedSelector,
  node: PierceDomNode,
  ancestors: PierceDomNode[],
): boolean {
  for (const chain of parsed.chains) {
    if (matchChain(chain, node, ancestors)) return true;
  }
  return false;
}

function matchChain(
  chain: CompoundChain,
  node: PierceDomNode,
  ancestors: PierceDomNode[],
): boolean {
  const parts = chain.parts;
  if (parts.length === 0) return false;
  const last = parts[parts.length - 1] as CompoundPart;
  if (!matchCompound(last, node)) return false;
  // Walk leftwards through compound parts, each must be matched by some
  // ancestor (in any order — `parts[k]` ancestor must be deeper than
  // `parts[k-1]` ancestor; we enforce by iterating right-to-left and
  // consuming ancestors from the bottom up).
  let idx = ancestors.length - 1;
  for (let p = parts.length - 2; p >= 0; p--) {
    const part = parts[p] as CompoundPart;
    let found = false;
    while (idx >= 0) {
      const a = ancestors[idx] as PierceDomNode;
      idx--;
      if (matchCompound(part, a)) {
        found = true;
        break;
      }
    }
    if (!found) return false;
  }
  return true;
}

/** Test a single compound part against a single element node. */
export function matchCompound(part: CompoundPart, node: PierceDomNode): boolean {
  // Element nodes only.
  if (node.nodeType !== 1) return false;
  const local = (node.localName ?? node.nodeName.toLowerCase()).toLowerCase();
  if (part.tag !== "*" && part.tag !== local) return false;
  if (part.id !== undefined) {
    const id = readAttribute(node, "id");
    if (id !== part.id) return false;
  }
  if (part.classes.length > 0) {
    const cls = readAttribute(node, "class") ?? "";
    const tokens = cls.split(/\s+/).filter((t) => t.length > 0);
    for (const c of part.classes) {
      if (!tokens.includes(c)) return false;
    }
  }
  for (const f of part.attrs) {
    if (!matchAttr(f, node)) return false;
  }
  return true;
}

function matchAttr(f: AttrFilter, node: PierceDomNode): boolean {
  const val = readAttribute(node, f.name);
  if (f.op === "exists") return val !== undefined;
  if (val === undefined) return false;
  const target = f.value ?? "";
  switch (f.op) {
    case "=":
      return val === target;
    case "~=": {
      // Whitespace-separated word match.
      const tokens = val.split(/\s+/).filter((t) => t.length > 0);
      return tokens.includes(target);
    }
    case "|=":
      return val === target || val.startsWith(`${target}-`);
    case "^=":
      return target.length > 0 && val.startsWith(target);
    case "$=":
      return target.length > 0 && val.endsWith(target);
    case "*=":
      return target.length > 0 && val.indexOf(target) >= 0;
  }
}

/**
 * Read an attribute value from a `PierceDomNode`. CDP serialises attributes
 * as a flat `[name, value, name, value, ...]` array (lower-cased names per
 * the protocol). Returns `undefined` if absent.
 */
export function readAttribute(node: PierceDomNode, name: string): string | undefined {
  const attrs = node.attributes;
  if (attrs === undefined) return undefined;
  const lower = name.toLowerCase();
  for (let i = 0; i + 1 < attrs.length; i += 2) {
    if ((attrs[i] as string).toLowerCase() === lower) return attrs[i + 1] as string;
  }
  return undefined;
}
