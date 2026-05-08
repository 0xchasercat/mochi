# 0253: closed-shadow-root piercing locator

**Package:** `core`
**Phase:** `0.2`
**Estimated size:** M
**Dependencies:** v0.1.2 shipped, audits 0200–0203 merged
**Source:** `docs/audits/patchright.md` HIGH finding
**Source-cited reference:** patchright `framesPatch.ts:868-1012` (`_customFindElementsByParsed`)

## Goal

Add `Page.querySelectorPiercing(selector)` — a locator that walks open AND closed shadow roots to find elements. Required because Cloudflare Turnstile's iframe is hosted behind a closed shadow root in many integrations (Cloudflare Challenge, Workers Static Assets, some CDN configs); task 0220's Turnstile auto-click silently fails on those because the existing `Page.querySelector` path doesn't pierce closed shadows.

## Success criteria

- [ ] New API `Page.querySelectorPiercing(selector: string): Promise<ElementHandle | null>` and `Page.querySelectorAllPiercing(selector: string): Promise<ElementHandle[]>`. Public on the `Page` interface in `packages/core/src/page.ts`.
- [ ] Implementation walks shadow roots via CDP:
  1. `DOM.getDocument({ depth: -1, pierce: true })` — yields the full DOM tree including shadow descendants.
  2. Recursive walk: when a node has `shadowRoots` (array), descend into each. Recognize `shadowRootType === "closed"` and STILL traverse — `pierce: true` lets us see closed roots in the protocol view.
  3. For matching nodes, `DOM.resolveNode({ backendNodeId })` to get an `objectId`, wrap in `ElementHandle`.
- [ ] **Critically**: the matching itself runs in JS, NOT via `DOM.querySelector` per shadow root. Reason: `DOM.querySelector` from the parent doesn't pierce closed shadows even with `pierce: true` set on `getDocument`. Patchright's implementation parses the selector and walks manually. Port that approach.
- [ ] Selector parsing: support standard CSS selectors (tag, class, id, attribute, descendant). XPath as a stretch goal — patchright supports it but it's a bigger surface; document XPath as TODO if not landing now.
- [ ] Cross-package contract test that drives the locator against a fixture page (HTML file in `tests/fixtures/`) with at least one closed-shadow-rooted custom element containing a target. Verify the piercing locator finds it; the existing `querySelector` does NOT.
- [ ] Online conformance test: the existing Turnstile online test (`packages/harness/src/conformance/stealth/__tests__/turnstile-auto-click.test.ts`) gains a variant that exercises a closed-shadow-rooted Turnstile. May require a self-hosted fixture; document if so.
- [ ] **Update task 0220's `installTurnstileAutoClick`** to use `querySelectorPiercing` for iframe detection. The MutationObserver-based detector also needs to pierce closed shadows when scanning for `iframe[src*="challenges.cloudflare.com"]`. Touch `packages/challenges/src/inject.ts` for the inject-side scanner — document the JS API for piercing in the inject script (the `Element.shadowRoot` accessor doesn't pierce closed shadows from JS; we need a CDP-driven scan from the host side and pass results back via the signed `console.debug` channel).
- [ ] Changeset: minor on `@mochi.js/core`, patch on `@mochi.js/challenges`.

## Out of scope

- XPath piercing — defer to a follow-up if needed. CSS selectors covers Turnstile use case.
- Performance optimization — patchright walks the entire shadow tree per call. Acceptable for v0.2; a cache layer is a v0.3+ concern.
- Mutation-observed pierce — the inject-side detector needs a different mechanism. Probably a periodic CDP-driven scan rather than a piercing MutationObserver. Document the design choice in the brief.

## Implementation notes

- See PLAN.md §8.2 (forbidden CDP methods — neither `DOM.getDocument` nor `DOM.resolveNode` is on the list; both are fine to use).
- Patchright source: `framesPatch.ts:868-1012`. Read it. Don't blind-port — understand the selector-walk approach first.
- `DOM.getDocument({ depth: -1, pierce: true })` returns the full tree including iframe contentDocument trees. Verify the response shape; the DOM.Node JSON has `shadowRoots`, `contentDocument`, `pseudoElements`, `templateContent` arrays for descendants.
- The inject-side scanner for Turnstile will need a different approach: from page JS, `Element.shadowRoot` returns `null` for closed shadows. The detector can't pierce client-side. So the strategy becomes: inject does a coarse periodic check, but actual iframe detection happens via host-side `querySelectorPiercing` triggered by a "page settled" signal (e.g. a `MutationObserver` detecting any DOM change → posts a debounced signal → host re-scans via CDP).

## Validation

```sh
bun run typecheck && bun run lint && bun run test && bun run test:contract
# Online conformance gated on MOCHI_E2E=1 + MOCHI_ONLINE=1.
```
