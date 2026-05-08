---
"@mochi.js/core": minor
"@mochi.js/challenges": patch
---

Closed-shadow-root piercing locator on `Page` (task 0253).

`@mochi.js/core` adds `Page.querySelectorPiercing(selector)` /
`Page.querySelectorAllPiercing(selector)` plus a public `ElementHandle`. The
locator walks `DOM.getDocument({ depth: -1, pierce: true })` and matches a
parsed CSS selector in JS, which is the only way to find elements inside
**closed** shadow roots — `DOM.querySelector(..., pierce: true)` itself does
not pierce closed shadows. Required for task 0220's Turnstile auto-clicker
on Cloudflare CDN integrations where the iframe lives behind a closed shadow
root. Algorithm sourced from patchright `framesPatch.ts:868-1012`
(`_customFindElementsByParsed`); selector subset is intentionally narrower
(tag / id / class / attribute / descendant combinator / comma lists). XPath
deferred per task brief — TODO if a future surface needs it.

`Page.humanClickHandle(handle, opts)` is the click-via-handle counterpart;
required when no CSS path can name the element from the parent document.

`@mochi.js/challenges` updates `installTurnstileAutoClick` so each poll tick
also performs a host-side piercing scan via the new locator. Inject-side
detection (light DOM + open shadows) and host-side piercing detection
(closed shadows) merge into a single per-widget state machine; clicks route
through `humanClick(selector)` for selector-reachable widgets and
`humanClickHandle(handle)` for closed-shadow widgets. Documented in
`packages/challenges/src/inject.ts` why the inject MutationObserver alone
cannot pierce closed shadows.

Neither `DOM.getDocument` nor `DOM.resolveNode` is on the §8.2 forbidden
list, and no `Runtime.enable` / `Page.createIsolatedWorld` are used.
