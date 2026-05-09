# @mochi.js/challenges

Convenience layer for common bot-defense challenge widgets in [mochi](https://github.com/0xchasercat/mochi).

**v0.2 scope:** Cloudflare Turnstile **visible-checkbox auto-click only**.

Out of scope (deferred):
- hCaptcha — same shape, separate task (v0.3)
- reCAPTCHA v2 / v3 — different mechanism (audio / visual challenges)
- 3rd-party solver API integrations (2captcha / anti-captcha) — v0.3+ via `onEscalation`

## What this is — and isn't

This is **not** a captcha solver. The visible Turnstile checkbox is a behavioral test: Cloudflare watches the cursor trajectory, the dwell, and a few hundred other signals around the click. The hard part is the **behavioral** profile, which mochi already does (`@mochi.js/behavioral`'s Bezier+Fitts synth, the inject pipeline's matrix consistency, the wreq TLS fingerprint). The actual click is the easy part — this package exists so you don't have to write `page.humanClick('iframe[src*="challenges.cloudflare.com"]')` yourself in every flow.

For escalated variants (image / audio / managed-failed), this package fires `onEscalation(reason)` and bails. It will **not** click randomly into a challenge iframe.

## Install

This package ships with `@mochi.js/core` v0.2+. You don't add it to your project directly.

## Usage

### Recommended: launch option

```ts
import { mochi } from "@mochi.js/core";

const session = await mochi.launch({
  profile: "...",
  seed: "...",
  challenges: {
    turnstile: {
      autoClick: true,
      timeout: 30_000,
      onSolved: (token) => console.log("turnstile passed:", token.slice(0, 8) + "…"),
      onEscalation: (reason) => console.warn("turnstile escalation:", reason),
    },
  },
});

// Every page from this session auto-clicks Turnstile.
const page = await session.newPage();
await page.goto("https://example.com");
```

### Manual: `installTurnstileAutoClick`

```ts
import { installTurnstileAutoClick } from "@mochi.js/challenges";

const session = await mochi.launch({ profile: "...", seed: "..." });
const page = await session.newPage();
const dispose = installTurnstileAutoClick(page, {
  timeout: 30_000,
  onSolved: () => console.log("turnstile passed"),
  onEscalation: (reason) => console.warn("escalation:", reason),
});

await page.goto("https://example.com");
// ... do stuff ...
dispose();
```

## How it works

1. **Detection.** A small inject script is mounted on the page's main world via `Page.addScriptToEvaluateOnNewDocument({ runImmediately: true, worldName: "" })` (PLAN.md §8.4). The script installs a `MutationObserver` filtered to iframe inserts only — it does **not** fire on every DOM mutation.
2. **Channel.** When a Turnstile iframe is detected, the inject emits a tagged `console.debug({__mochi_event:"turnstile-detected", …})` event and exposes a Symbol-keyed snapshot reader on `document` (the only externally observable surface; non-enumerable + non-configurable so page script can't tamper).
3. **Click.** The mochi-side poller drains the snapshot, finds the iframe via `DOM.getBoxModel`, and dispatches a click via `page.humanClick(...)` — the same Bezier+Fitts synth the rest of the framework uses. We never reinvent the synth.
4. **Token.** After the click, the inject reader watches the parent page's hidden `cf-turnstile-response` field. When a token appears, `onSolved(token)` fires.
5. **Escalation.** If the iframe `src` matches `/challenge.html` (image/audio) or `/managed.html` (failed-bot variant), or the token doesn't appear within `opts.timeout`, `onEscalation(reason)` fires and we bail on that widget.

## Invariants

- **Uses existing behavioral synth** — Bezier path + Fitts's-Law dwell from `@mochi.js/behavioral`. No new fingerprint surface.
- **No new globals** — the inject script's only observable property is a Symbol-keyed function on `document`. The Symbol is non-enumerable, writable:false, configurable:false.
- **No new postMessage handlers, no new event listeners on `window`.**
- **Iframe-only MutationObserver filter** — perf invariant; the observer rejects mutations cheaply before doing any work.
- **PLAN.md §8.2** — never sends `Runtime.enable`. Detection is poll-based via `Runtime.callFunctionOn` against the document objectId.
- **PLAN.md §8.4** — main world (`worldName: ""`) for the inject script. Any non-empty world name is detectable.

## When to bring a 3rd-party solver

Roughly: the visible-checkbox flow covers the common case. If your target consistently escalates to image / audio challenges, that's a signal that mochi's stealth posture isn't passing the bot heuristics — fix the upstream signal first, then reach for a solver.

The `onEscalation` callback receives `"image-challenge" | "managed" | "timeout"` and lets you fire your solver of choice. v0.3 will ship a first-party solver hook surface.

## Reference

- [PLAN.md §8.4](https://github.com/0xchasercat/mochi/blob/main/PLAN.md) — main-world inject pattern
- [PLAN.md §11](https://github.com/0xchasercat/mochi/blob/main/PLAN.md) — behavioral synth (Bezier + Fitts)
- <https://mochijs.com/docs/reference/limits> — what's deferred to v0.3

## Documentation

- Package reference: <https://mochijs.com/docs/api/challenges>
- Concept deep-dive: <https://mochijs.com/docs/concepts/inject-pipeline>
- Cookbook: <https://mochijs.com/docs/guides/pick-a-scenario>
