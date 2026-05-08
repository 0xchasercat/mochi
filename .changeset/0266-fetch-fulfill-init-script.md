---
"@mochi.js/core": minor
---

init-script delivery via `Fetch.fulfillRequest` body splice + CSP rewriter
(architectural pivot — task 0266).

Replaces `Page.addScriptToEvaluateOnNewDocument` as the inject delivery
mechanism with a `Fetch.requestPaused` → `Fetch.fulfillRequest` body splice
that inlines the payload as a same-origin `<script class="__mochi_init_script__">`
at end-of-`<head>`, BEFORE the document's first non-comment `<script>`.
Closes the source-attribution leak the previous channel carried (the
"Vanilla CDP" detection probe). After this lands the inject is
byte-indistinguishable from a developer's own `<script>` tag.

Behavioural changes
-------------------
- **`Fetch.enable` becomes always-on per session** (gated only on
  `bypassInject`). Patterns:
  `[{ urlPattern: "*", resourceType: "Document" }, { urlPattern: "*" }]`.
  Document responses get the body splice; non-Document requests get an
  immediate `Fetch.continueRequest` (zero-cost pass-through).
- Proxy auth (`SessionInit.proxyAuth`) now shares the SAME `Fetch.enable`
  call (single owner — no double-enable). The auth-only path still skips
  the protocol surface when both `bypassInject:true` AND no proxy creds are
  set.
- The inject `<script>` tag carries no `defer`/`async`/`type="module"` —
  parser-blocking is required to keep the timing guarantee.
- The payload is wrapped in a self-removing IIFE
  (`document.currentScript?.remove()` first; post-`load` DOM walk as belt).

CSP rewriter
------------
Handles `Content-Security-Policy` AND `Content-Security-Policy-Report-Only`
response headers AND `<meta http-equiv="Content-Security-Policy">` tags.
Reuses existing `'nonce-…'` tokens; admits `'strict-dynamic'`; falls back
to `'unsafe-inline'` for nonce-less restrictive policies. Multiple CSPs
(header + meta) are each rewritten independently so most-restrictive-wins
still admits us.

PLAN.md amendments
------------------
- §8.4 — full rewrite documenting the new mechanism and trade-offs.
- §8.2 — note that `Fetch.enable` is allowed (only `Runtime.enable` and
  `Page.createIsolatedWorld` are forbidden); cost characterisation added.

Migration
---------
The public `Page.addInitScript()` / `Page.removeInitScript()` API is
unchanged — convenience-layer scripts (e.g. Turnstile detector) still
flow through `Page.addScriptToEvaluateOnNewDocument`. Only the
session-level matrix payload moved to the new channel.
