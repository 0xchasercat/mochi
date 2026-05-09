/**
 * Closed-shadow piercing locator.
 *
 * Walks a tree returned by `DOM.getDocument({ depth: -1, pierce: true })` and
 * yields `backendNodeId`s for every element that matches a parsed CSS
 * selector — including elements inside **closed** shadow roots, which
 * `DOM.querySelector(..., pierce: true)` does NOT traverse from the parent
 * document. Patchright solves the same problem in `_customFindElementsByParsed`
 * (`framesPatch.ts:868-1012`); this is mochi's port — we kept the recursive-walk
 * shape but simplified the selector subset (CSS only — no XPath; see task
 * 0253 brief for the rationale).
 *
 * The walker recurses through:
 *  - `node.children[]` (regular DOM descendants)
 *  - `node.shadowRoots[]` (BOTH `shadowRootType:"open"` and `"closed"` — the
 *    pierce flag yields both; the matcher just doesn't care which kind it is)
 *  - `node.contentDocument` (iframes — same-origin only; OOPIF subframes
 *    surface as separate targets and are out of scope here)
 *  - `node.templateContent` (template fragment, rare but cheap to walk)
 *
 * It deliberately does NOT recurse into:
 *  - `pseudoElements` — `::before` / `::after` aren't real DOM nodes for
 *    selector matching purposes; CDP yields them but they'd produce
 *    spurious matches on `*` selectors.
 *
 * The walker keeps a *flat* ancestor chain across shadow boundaries so the
 * descendant-combinator matcher can reason about "div .btn" correctly even
 * when the `.btn` is inside a closed shadow rooted at `<div>`. This mirrors
 * how DOM's regular ancestor walk behaves under `composedPath` semantics —
 * patchright does the same.
 *
 * Performance: O(N) in DOM size per call. Acceptable for v0.2 (per task
 * brief — a per-page cache layer is a v0.3+ concern).
 *
 * @see PLAN.md §8.2 — `DOM.getDocument` / `DOM.resolveNode` are not forbidden
 */

import type { PierceDomNode } from "../cdp/types";
import { matchSelector, type ParsedSelector } from "./selector";

export interface PierceMatch {
  /** The CDP `backendNodeId` of the matched element — stable across DOM mutations. */
  backendNodeId: number;
  /** The CDP node id (per-DOMSession-instance; less stable than backend). */
  nodeId: number;
  /** The matched node itself (for diagnostics + tests). */
  node: PierceDomNode;
}

/**
 * Walk `root` and return every matching element. Ordering is depth-first,
 * pre-order (parents before children) — matches the natural `querySelectorAll`
 * traversal order users expect.
 *
 * If `limit` is set, the walk short-circuits as soon as that many matches
 * accumulate. `Page.querySelectorPiercing` passes `1` for a single-element
 * lookup; `querySelectorAllPiercing` leaves it undefined.
 */
export function findPiercingMatches(
  root: PierceDomNode,
  selector: ParsedSelector,
  limit?: number,
): PierceMatch[] {
  const out: PierceMatch[] = [];
  walk(root, selector, [], out, limit);
  return out;
}

function walk(
  node: PierceDomNode,
  selector: ParsedSelector,
  ancestors: PierceDomNode[],
  out: PierceMatch[],
  limit: number | undefined,
): boolean {
  if (limit !== undefined && out.length >= limit) return true;

  // Match element nodes only — but document / fragment nodes still need to
  // recurse into children.
  if (node.nodeType === 1 && matchSelector(selector, node, ancestors)) {
    out.push({ backendNodeId: node.backendNodeId, nodeId: node.nodeId, node });
    if (limit !== undefined && out.length >= limit) return true;
  }

  // Push self into ancestor stack ONLY if it's an element (text / shadow-root
  // / document nodes aren't ancestors for `div .btn`-style descendant matches).
  const isElement = node.nodeType === 1;
  if (isElement) ancestors.push(node);

  // Children (regular DOM descendants).
  const children = node.children;
  if (children !== undefined) {
    for (const child of children) {
      if (walk(child, selector, ancestors, out, limit)) {
        if (isElement) ancestors.pop();
        return true;
      }
    }
  }

  // Shadow roots — both open AND closed. This is the whole point.
  const shadowRoots = node.shadowRoots;
  if (shadowRoots !== undefined) {
    for (const root of shadowRoots) {
      if (walk(root, selector, ancestors, out, limit)) {
        if (isElement) ancestors.pop();
        return true;
      }
    }
  }

  // iframe contentDocument (same-origin only — OOPIFs surface as separate
  // CDP targets and aren't reachable here).
  const contentDocument = node.contentDocument;
  if (contentDocument !== undefined) {
    if (walk(contentDocument, selector, ancestors, out, limit)) {
      if (isElement) ancestors.pop();
      return true;
    }
  }

  // <template>.content — rare in real-world Cloudflare integrations but
  // matches what patchright walks.
  const templateContent = node.templateContent;
  if (templateContent !== undefined) {
    if (walk(templateContent, selector, ancestors, out, limit)) {
      if (isElement) ancestors.pop();
      return true;
    }
  }

  if (isElement) ancestors.pop();
  return false;
}
