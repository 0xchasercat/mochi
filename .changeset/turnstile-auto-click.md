---
"@mochi.js/challenges": minor
"@mochi.js/core": patch
---

Turnstile auto-click convenience layer per task 0220.

New package `@mochi.js/challenges` exposing `installTurnstileAutoClick(page, opts)` plus
the `LaunchOptions.challenges.turnstile.autoClick` ergonomic surface on `mochi.launch`.
The detector mounts a `MutationObserver` (iframe-only filter) in the page's main world
via `Page.addScriptToEvaluateOnNewDocument({ runImmediately: true, worldName: "" })`
per PLAN.md §8.4. Clicks reuse the existing Bezier+Fitts behavioral synth from
`@mochi.js/behavioral` — no new fingerprint surface, no new globals, no Runtime.enable.

Scope: visible-checkbox auto-click only. Image/audio/managed escalations fire
`onEscalation(reason)` and bail (image-challenge solving is deferred to v0.3 via the
solver-hook surface that lands then). See `docs/limits.md` for the limit entry.

`@mochi.js/core` adds `Page.addInitScript` / `Page.removeInitScript` so the challenges
module can install its main-world inject without owning the router.
