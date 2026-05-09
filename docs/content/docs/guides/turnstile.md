---
title: Cloudflare Turnstile
description: Opt-in auto-click for the visible-checkbox variant via @mochi.js/challenges.
order: 6
category: guides
lastUpdated: 2026-05-09
---

`@mochi.js/challenges` is a convenience layer that auto-clicks the visible-checkbox variant of Cloudflare Turnstile. It is **opt-in** — pass `challenges: { turnstile: { autoClick: true } }` to `mochi.launch()` and every page returned by `session.newPage()` gets the handler installed.

The click goes through the existing behavioral synth (Bezier path + Fitts dwell from `@mochi.js/behavioral`). No new entropy source — same `(profile, seed)` deterministic shape as `humanClick`.

## Minimal example

```ts
import { mochi } from "@mochi.js/core";

const session = await mochi.launch({
  profile: "mac-m4-chrome-stable",
  seed: "warm-session-001",
  challenges: {
    turnstile: {
      autoClick: true,
    },
  },
});

const page = await session.newPage();
await page.goto("https://protected.example/login");
// The auto-clicker runs in the background. Just await your normal flow.
```

## Hook the lifecycle

```ts
challenges: {
  turnstile: {
    autoClick: true,
    onSolved: (token) => {
      console.log("Turnstile token:", token);
    },
    onEscalation: (reason) => {
      // "image-challenge" | "managed" | "timeout"
      console.warn("Turnstile escalated:", reason);
    },
  },
}
```

`onSolved` fires once per widget per session. `onEscalation` fires when:

- `"image-challenge"` — the iframe `src` matched the escalated-challenge URL pattern.
- `"managed"` — the iframe `src` matched the managed (failed-bot) URL pattern.
- `"timeout"` — the click went through but the response token never appeared within `timeout` ms (default 30000).

## What it does NOT do

- It does **not** click into image / audio challenge iframes. The auto-clicker is deliberately scoped to the visible-checkbox variant; clicking blindly into image challenges would be detectable and pointless.
- It does **not** solve the managed (failed-bot) variant — by definition, that screen is what Cloudflare shows when the heuristics already classified the visitor as a bot. No amount of clicking helps.
- For both, you fire your own resolver from `onEscalation` (third-party solver, manual fallback, retry from a fresh seed, etc.). v0.3 will ship a first-party solver hook surface.

## Tuning options

```ts
challenges: {
  turnstile: {
    autoClick: true,
    timeout: 45_000,        // wait this long for the response token (default 30000)
    pollIntervalMs: 250,    // DOM scan cadence (default 500ms; smaller = more responsive)
    humanize: true,         // use behavioral synth (default true; false = hard mid-element click)
  },
}
```

`humanize: false` is for tests where determinism beats realism. Production should always leave it `true`.

## Closed-shadow widgets

Some Cloudflare integrations (Workers Static Assets, certain CDN configs, Challenge pages) host the Turnstile iframe behind a **closed** shadow root. The auto-clicker uses `Page.querySelectorPiercing` to find these — a CSS-selector traversal across closed shadows — and routes the click through `Page.humanClickHandle`. No special configuration required; it just works on those flows.

## Limits

See [Limits → Turnstile auto-click](/docs/reference/limits) for the full architectural-honesty entry.
