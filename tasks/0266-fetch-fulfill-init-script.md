# 0266: init-script delivery via `Fetch.fulfillRequest` body injection + CSP rewriter

**Package:** `core` (architectural pivot)
**Phase:** `0.2`
**Estimated size:** L
**Dependencies:** 0220 (Turnstile auto-click) — adds `addInitScript`/`removeInitScript` API on Page; this brief replaces its CDP delivery mechanism.
**Source:** `docs/audits/patchright.md` HIGH finding — `crNetworkManagerPatch.ts:166-453`

## Goal

Close the source-attribution leak that `Page.addScriptToEvaluateOnNewDocument` introduces: scripts injected via that CDP method carry an attribution hint (the script source URL or its absence in odd ways) that the "Vanilla CDP" detection probe checks for. Patchright sidesteps the leak entirely by intercepting the document response, rewriting CSP `script-src` headers (header AND `<meta http-equiv>` tags), and inlining the inject payload as a `<script class="${initScriptTag}" id="${randomHex}">` at end-of-head BEFORE the first non-comment `<script>`. The injected node self-removes from the DOM on first execution; patchright then walks post-`load` and `DOM.removeNode`s any leftover tags.

After this lands the inject pipeline is byte-indistinguishable from a same-origin developer's own `<script>` tag at the top of `<head>`. The "did this script come from `Page.addScriptToEvaluateOnNewDocument`?" detection vector is gone.

This is a **single architectural pivot** with significant blast radius:
- `Fetch.enable` becomes always-on per session (today it's gated on proxy-auth)
- The patterns array gains `[{ urlPattern: "*", resourceType: "Document" }]`
- `Fetch.requestPaused` event handler becomes load-bearing
- `addScriptToEvaluateOnNewDocument` is REPLACED, not supplemented — old call site removed

## Success criteria

- [ ] New `packages/core/src/cdp/init-injector.ts`:
  - `installInitInjector(router, sessionId, payload)` — registers `Fetch.requestPaused` listener; on a `Document` resource type, fetches the original response, parses + rewrites CSP, splices the payload as inline `<script>`, emits `Fetch.fulfillRequest` with the rewritten body. Non-Document requests get `Fetch.continueRequest`.
  - CSP rewriter handles header `Content-Security-Policy: ...` AND `<meta http-equiv="Content-Security-Policy" content="...">` in HTML body. Adds nonce to `script-src` if needed; falls back to `'unsafe-inline'` if the policy mode requires it.
  - Self-removing payload wrapper: the inline script's first action is `document.currentScript?.remove()`. Belt: a post-`load` `DOM.removeNode` walk via `DOM.querySelectorAll(".${initScriptTag}")` to clean any miss.
- [ ] `packages/core/src/session.ts` — replace the `Page.addScriptToEvaluateOnNewDocument` call site with `installInitInjector` install. Remove `Page.removeScriptToEvaluateOnNewDocument` (no longer needed). Update related tests.
- [ ] `Fetch.enable({ patterns: [{ urlPattern: "*", resourceType: "Document" }, { urlPattern: "*" }], handleAuthRequests: <auth ? true : false> })` — Document requests intercepted for body splice; non-Document `requestPaused` events forwarded immediately via `continueRequest`. Combined with proxy-auth's existing `handleAuthRequests` — extend the existing call, don't double-enable.
- [ ] PLAN.md §8.4 amendment: `addScriptToEvaluateOnNewDocument` is no longer the inject delivery mechanism. Document the new pattern, the trade-offs (Fetch.enable always-on cost ≈ one CDP RTT per Document request; non-Document requests are auto-forwarded with no extra cost), and the source-attribution-leak rationale.
- [ ] PLAN.md §8.2 — verify `Fetch.enable` is still NOT forbidden (it isn't; only `Runtime.enable` + `Page.createIsolatedWorld`). Add a note.
- [ ] Tests:
  - Unit test for the CSP rewriter: input policies (no-nonce, with-nonce, strict-dynamic, with-meta-tag) + assert the rewritten output preserves the original scope while admitting our payload.
  - Cross-package contract test: drive a `Session` via mocked CDP; capture `Fetch.fulfillRequest` params; assert the body contains the inject payload AND the original document body.
  - Live conformance test (gated `MOCHI_E2E=1`): navigate to a Bun.serve fixture that returns `<html><head><script>window.__before = true;</script></head>...`. After load, assert `window.__before === true` (page script ran), `window.__mochi_inject_marker === true` (our inject ran), `document.querySelector("script.mochi-init") === null` (self-removed).
- [ ] **Critical timing test**: assert the inject runs BEFORE the document's own first script. If we splice after, race window opens and detection-via-execution-order returns. Live conformance must verify `__mochi_inject_marker` lands first.
- [ ] All existing inject-related tests continue to pass (the contract test for `Page.addScriptToEvaluateOnNewDocument` either gets removed or rewritten to assert the new mechanism).
- [ ] Changeset: MINOR on `@mochi.js/core` (architectural change to inject delivery; document migration in changelog).

## Out of scope

- Replacing `addScriptToEvaluateOnNewDocument` for non-document resource types (workers, service workers) — those still use the existing `Runtime.callFunctionOn` worker path from 0254. Document-only is scope.
- `data:` / `about:blank` URL handling — Fetch domain doesn't intercept; keep the old inject path as a fallback for those (or document the gap).
- Performance benchmarking under heavy traffic — separate brief; profile if the CDP RTT cost matters in practice.

## Implementation notes

- See PLAN.md §8.2, §8.4. The mochi inject pipeline today: `Page.addScriptToEvaluateOnNewDocument({ runImmediately: true, worldName: "" })`. Replace.
- patchright source for the algorithm: `crNetworkManagerPatch.ts:166-453` (`RouteImpl._fixCSP`, `_injectIntoHead`, `fulfill`). Read it; understand the CSP-rewriting semantics before coding.
- Concrete CSP gotchas:
  - `script-src 'self'` + no nonce → must add `'unsafe-inline'` (least-bad option)
  - `script-src 'nonce-abc123'` → reuse the existing nonce on our injected `<script>`
  - `script-src 'strict-dynamic' 'nonce-abc123'` → same; strict-dynamic admits any script the original allowed dispatched
  - `<meta http-equiv="Content-Security-Policy" content="...">` in `<head>` overrides the header; rewrite both
  - Multiple CSPs (header + meta) → most-restrictive wins; rewrite all
- The injected `<script>` tag MUST NOT have `defer`, `async`, or `type="module"` — those defer execution past first parse and re-introduce the race window.
- Self-removal: `document.currentScript?.remove();` as the first line of the IIFE wrapper; belt-and-suspenders post-load walk via `Page.handleJavaScriptDialog` or `Runtime.callFunctionOn` to strip leftovers.
- `Fetch.continueRequest` for non-Document resources is critical — if our handler doesn't reply, the request hangs.

## Validation

```sh
bun run typecheck && bun run lint && bun run test && bun run test:contract
# Live: MOCHI_E2E=1 bun test packages/core/src/__tests__/init-injector.e2e.test.ts
```
