---
title: The inject pipeline
description: How the JIT-friendly stealth payload reaches every page before any other script runs.
order: 3
category: concepts
lastUpdated: 2026-05-09
---

The Mochi inject payload is a single IIFE bundle of TurboFan-friendly Proxy traps and property definitions, derived from the resolved Matrix. It must run **before any page script**, in the page's main world (no isolated worlds — those are detectable; PLAN.md §8.4).

`@mochi.js/core` delivers it through a **two-mechanism strategy** wired up once at session construction. The two mechanisms cover disjoint navigation paths and an idempotency marker keeps them from doubling up.

## Mechanism A — `Fetch.fulfillRequest` body splice

The load-bearing path for HTTP / HTTPS document navigations.

The session installs a `Fetch.enable` handler that listens for `Fetch.requestPaused` on Document responses. When a Document arrives, the handler:

1. Rewrites any `Content-Security-Policy` headers that would block an inline `<script>`.
2. Splices the wrapped payload as an inline `<script>` at end-of-`<head>`, before the first non-comment `<script>` from the page.
3. Returns the rewritten body via `Fetch.fulfillRequest`.

Because the script is inline and lives in the document's HTML byte stream, it has the same source attribution as a page-author script. `Page.addScriptToEvaluateOnNewDocument` carries a "third-party install" provenance that anti-bot scripts can side-channel detect; the body-splice path closes that leak.

## Mechanism B — `Page.addScriptToEvaluateOnNewDocument` fallback

The fallback for non-HTTP navigations (`about:blank`, `data:` URLs, `file://`, custom schemes, and anything `Fetch.requestPaused` doesn't see).

```ts
Page.addScriptToEvaluateOnNewDocument({
  source: wrappedPayload,
  runImmediately: true,   // run against the current document too
  worldName: "",          // empty = main world; non-empty = isolated, detectable
});
```

`worldName: ""` is critical — any non-empty string creates an isolated world, which is detectable from the main world. `runImmediately: true` ensures the script also runs against the current document if one already exists, not just on the next navigation.

## Idempotency — `__mochi_inject_marker`

Both mechanisms register the same wrapped payload. On a Document navigation, both can fire — the body splice from Fetch *and* `addScriptToEvaluateOnNewDocument` running on the same target.

The wrapper checks `globalThis.__mochi_inject_marker` before doing any work and sets the marker on first run. The second invocation is a no-op. This keeps the payload exactly-once even when both mechanisms fire on the same page.

## Surfaces consumed

The payload covers all 40 rules in the consistency DAG, including:

- **R-001..R-030.** Navigator, screen, simple GPU strings, fonts/baseline-only, locale, timezone, hardware basics — plain `Object.defineProperty` and Proxy traps.
- **R-036.** Per-permission `navigator.permissions.query()` matrix (orthogonal to `page.grantAllPermissions()` which acts at the browser level — see [`@mochi.js/core`](/docs/api/core)).
- **R-047.** Audio (`OfflineAudioContext`) byte-accurate fingerprint. Per-(profile, sample-rate) capture distributes the audio residual across the 489 samples in `[4510..4999)` (using `Math.fround` to model f32 readback) so the page-side digest is byte-exact on every host architecture.
- **R-048.** Canvas (`toDataURL`) byte-accurate fingerprint. Per-profile data URL synthesis intercepts probe-sized canvases (`300×150`) with the captured baseline; non-probe sizes fall through to native rendering.

## User init scripts

`Page.addInitScript(source)` is the *user-facing* entry point on `Page`. It composes on top of the session-level inject — your script runs after the Mochi payload, in the same main world, on every new document. Mochi's payload installs first (via Mechanism A or B) and your `addInitScript` source is a separate `addScriptToEvaluateOnNewDocument` registration on the per-page session.

## Architectural notes

- **No `Runtime.enable`.** The payload is a passive byte stream installed by `Fetch.fulfillRequest` — Chromium runs it as a regular page script. The fallback uses `addScriptToEvaluateOnNewDocument`, which also doesn't require `Runtime.enable`.
- **No `Page.createIsolatedWorld`.** Both mechanisms target the page's main world.
- **CSP is rewritten only on Document responses.** Subresources (XHR, fetch, images) are unaffected.

See PLAN.md §5.3 / §8.4 and `tasks/0266-fetch-fulfill-init-script.md` for the implementation detail.
