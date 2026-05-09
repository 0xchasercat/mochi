---
title: "@mochi.js/challenges"
description: "Convenience layer for bot-defense widgets — Turnstile auto-click. v0.2 visible-checkbox only."
order: 8
category: api
lastUpdated: 2026-05-09
---

`@mochi.js/challenges` ships convenience layers for common bot-defense challenge widgets. Phase 0.2 ships **Turnstile auto-click only** — the visible-checkbox variant. Image / audio / managed-failed Turnstile variants fire `onEscalation` and bail; the framework deliberately does not click into image-challenge iframes. hCaptcha and reCAPTCHA are deferred to v0.3+.

The standard surface is `LaunchOptions.challenges.turnstile.autoClick` on `mochi.launch` — when set, every page returned by `Session.newPage()` has `installTurnstileAutoClick(page, opts)` wired automatically. Reach for the function directly only when you're attaching to a page mochi didn't create, or when you want to install/uninstall the handler dynamically.

## Installation

```sh
bun add @mochi.js/challenges
```

(Already a transitive dep of `@mochi.js/core`; you probably already have it.)

## Public exports

### `function installTurnstileAutoClick(page, opts?): Disposable`

```ts
function installTurnstileAutoClick(
  page: PageLike,
  opts?: TurnstileOptions,
): Disposable;
```

Install a Turnstile auto-click handler on a `Page`. Returns a `Disposable` that, when called, stops further polling/clicking. Non-blocking: it returns immediately after starting the background poller. The handle is tracked on the Session (when launched via `mochi.launch({ challenges: { turnstile: { autoClick: true } } })`) and disposed on `Session.close()` automatically.

```ts
import { mochi } from "@mochi.js/core";
import { installTurnstileAutoClick } from "@mochi.js/challenges";

const session = await mochi.launch({ profile: "mac-m4-chrome-stable", seed: "x" });
const page = await session.newPage();

const handle = installTurnstileAutoClick(page, {
  timeout: 30_000,
  humanize: true,
  onSolved: (token) => console.log("turnstile solved:", token.slice(0, 12), "..."),
  onEscalation: (reason) => console.warn("turnstile escalated:", reason),
});

await page.goto("https://protected.example.com");
// ... do stuff ...
handle.dispose();
await session.close();
```

### `interface TurnstileOptions`

```ts
interface TurnstileOptions {
  timeout?: number;          // default 30_000ms (post-click wait for token)
  humanize?: boolean;        // default true (Bezier+Fitts click via Page.humanClick)
  onSolved?: (token: string) => void;
  onEscalation?: (reason: TurnstileEscalationReason) => void;
  pollIntervalMs?: number;   // default 500ms (DOM scan cadence)
}
```

- `timeout` — post-click wait for the response token. Fires `onEscalation("timeout")` if exceeded.
- `humanize` — `false` falls back to a fast non-humanized mid-element click for tests that want determinism.
- `onSolved` — fires once per widget per session when the response token appears. Receives the token string.
- `onEscalation` — fires on `"image-challenge"` (Turnstile escalated to image/audio), `"managed"` (Cloudflare flagged the session), or `"timeout"`.
- `pollIntervalMs` — smaller is more responsive but more CDP traffic.

### `type TurnstileEscalationReason`

```ts
type TurnstileEscalationReason = "image-challenge" | "managed" | "timeout";
```

| Reason | When | What to do |
| --- | --- | --- |
| `"image-challenge"` | iframe `src` matches the escalated `/challenge.html` URL family | Bail — mochi never blind-clicks image challenges. Try a different proxy / profile / seed |
| `"managed"` | iframe `src` matches `/managed.html` (failed-bot variant) | Bail — Cloudflare has flagged this session; retry with new state |
| `"timeout"` | Clicked the checkbox but the response token never appeared within `timeout` ms | Retry with a longer timeout, or treat as a soft-fail |

### `interface Disposable`

```ts
interface Disposable {
  dispose(): void;
  readonly disposed: boolean;
}
```

Returned by `installTurnstileAutoClick`. `dispose()` stops the poll loop and removes the inject script. Idempotent — calling twice is a no-op. `Session.cookies.dispose` it on `close()`.

> **Re-exported as `ChallengeHandle` in `@mochi.js/core`'s `Session` internals** — same shape, named for the Session-internal use site. The public name here is `Disposable`.

### `function buildTurnstileInjectScript(): string`

The IIFE source for the inject-side detector. The script installs a MutationObserver filtered to iframe inserts with Turnstile-shaped `src`, populates a Symbol-keyed reader on `document` (key string in `TURNSTILE_READER_KEY`), and emits tagged `console.debug` events using the names in `TURNSTILE_EVENT_NAMES`. Source-deterministic: same string every call (no per-call entropy).

```ts
import { buildTurnstileInjectScript } from "@mochi.js/challenges";

const src = buildTurnstileInjectScript();
const id = await page.addInitScript(src);
// later:
await page.removeInitScript(id);
```

You only need this when you're driving the inject install yourself (e.g. for a custom orchestrator that's not `installTurnstileAutoClick`).

### `const TURNSTILE_READER_KEY: "__mochi_ts_q__"`

The well-known reader key. The mochi-side poller looks up `document[Symbol.for(TURNSTILE_READER_KEY)]` on every tick to drain detected widget state. Lives in source so both sides agree without a separate sync mechanism.

### `const TURNSTILE_EVENT_NAMES`

```ts
const TURNSTILE_EVENT_NAMES = {
  detected: "turnstile-detected",
  resolved: "turnstile-resolved",
  escalated: "turnstile-escalated",
} as const;
```

The console-debug magic tags used in the detection event payload. The mochi-side console listener (when wired in a follow-up task) filters to events whose first argument's `__mochi_event` field equals one of these values.

### `const VERSION: string`

The npm package version (`"0.1.0"`).

## Architecture invariants honored

- **I-1 no-patches.** Pure JS layer + existing CDP + behavioral synth.
- **I-3 Bun-only.** No Node-specific imports, no FS / network access.
- **I-5 relational consistency.** Clicks reuse `Page.humanClick`, which reads the session's resolved `MatrixV1.behavior` profile — no new entropy source.
- **PLAN.md §8.2.** Never sends `Runtime.enable`. Detection is poll-based via the existing `Page.evaluate` plumbing (which uses `Runtime.callFunctionOn`, not `Runtime.evaluate`).

## Detection model

1. The inject script's `MutationObserver` populates a Symbol-keyed reader on the document.
2. The mochi-side poller calls that reader at `pollIntervalMs` cadence and reacts on state change.
3. **Closed-shadow fallback.** When the inject reader hasn't installed (e.g. user constructed a `Page` directly) or when the widget lives behind a closed shadow root, the poller falls back to `Page.querySelectorAllPiercing("iframe[src*='challenges.cloudflare.com']")` — the host-side locator that walks `DOM.getDocument({ depth: -1, pierce: true })` and traverses both open and closed shadow descendants.
4. On detection, the poller dispatches via `Page.humanClick(selector)` (light-DOM/open-shadow path) or `Page.humanClickHandle(handle)` (closed-shadow path).

## Common patterns

### Auto-click on every new page (preferred)

```ts
const session = await mochi.launch({
  profile: "mac-m4-chrome-stable",
  seed: "x",
  challenges: {
    turnstile: {
      autoClick: true,
      onSolved: (t) => sessionStorage.set({ cfTurnstile: t }),
      onEscalation: (r) => { throw new Error(`Turnstile escalated: ${r}`); },
    },
  },
});
```

### Manual install for a single page

```ts
const handle = installTurnstileAutoClick(page, {
  timeout: 60_000,
  humanize: true,
});
try {
  await page.goto("https://target.example.com");
  // wait for the widget to resolve...
} finally {
  handle.dispose();
}
```

### Tighter polling for a flaky page

```ts
installTurnstileAutoClick(page, { pollIntervalMs: 200 });
```

## v0.2 scope

| What works | What doesn't |
| --- | --- |
| Visible-checkbox Turnstile (light DOM, open shadow, closed shadow) | Image / audio Turnstile (escalated; `onEscalation("image-challenge")` fires) |
| Behavioral-synth click via Bezier+Fitts | hCaptcha (deferred to v0.3) |
| Auto-install on every `Session.newPage` | reCAPTCHA v2 / v3 (deferred — different mechanism) |
| Closed-shadow piercing via `Page.querySelectorAllPiercing` | 3rd-party solver API integrations (deferred to v0.3+ via `onEscalation`) |

See [Reference → Limits](/docs/reference/limits) and [Guides → Cloudflare Turnstile](/docs/guides/turnstile) for the rationale and the failure-mode triage matrix.

## See also

- [Guides → Cloudflare Turnstile](/docs/guides/turnstile)
- [API → @mochi.js/core](/docs/api/core) — `LaunchOptions.challenges`, `Page.querySelectorPiercing`, `Page.humanClickHandle`
- [API → @mochi.js/behavioral](/docs/api/behavioral)
- [Reference → Limits](/docs/reference/limits)

<!-- llm-context:start
Package: @mochi.js/challenges
Public surface (verbatim from packages/challenges/src/index.ts as of 2026-05-09):

  VERSION                                          (const "0.1.0")
  installTurnstileAutoClick(page, opts?): Disposable
  Disposable { dispose(): void; readonly disposed: boolean }
  TurnstileEscalationReason = "image-challenge" | "managed" | "timeout"
  TurnstileOptions { timeout?, humanize?, onSolved?, onEscalation?, pollIntervalMs? }
  buildTurnstileInjectScript(): string
  TURNSTILE_EVENT_NAMES { detected, resolved, escalated }
  TURNSTILE_READER_KEY = "__mochi_ts_q__"

That is the full surface.

PageLike (structural type used by installTurnstileAutoClick — not exported from barrel
but the real Page from @mochi.js/core satisfies it):
  humanClick(selector, opts?): Promise<void>
  evaluate<T>(fn): Promise<T>
  addInitScript?(source): Promise<string>
  removeInitScript?(identifier): Promise<void>
  querySelectorPiercing?(selector): Promise<PiercingHandleLike | null>
  querySelectorAllPiercing?(selector): Promise<PiercingHandleLike[]>
  humanClickHandle?(handle, opts?): Promise<void>

Common LLM hallucinations (DO NOT USE):
- `installTurnstile(page)` / `solveTurnstile(page)` — the function is `installTurnstileAutoClick`
- `installHCaptchaAutoClick` / `installRecaptchaAutoClick` — DO NOT EXIST. v0.2 ships Turnstile only
- `TurnstileOptions.solver: "audio" | "image"` — there is no solver option; image/audio fire `onEscalation` and bail
- `onEscalation` reasons including `"hcaptcha"` / `"recaptcha"` — only "image-challenge" | "managed" | "timeout"
- `Disposable.cancel()` / `.unsubscribe()` — method is `dispose()`
- `Disposable[Symbol.dispose]` / using-statement support — not implemented; call `.dispose()` explicitly
- `installTurnstileAutoClick(page).then(handle => ...)` — RETURNS Disposable SYNCHRONOUSLY, not a Promise
- `LaunchOptions.challenges.hcaptcha.autoSolve` — does not exist
- `LaunchOptions.challenges.turnstile.solver: "2captcha" | "anticaptcha"` — no built-in solver; user wires their own via onEscalation

Cross-references:
- /docs/guides/turnstile
- /docs/api/core
- /docs/api/behavioral
- /docs/reference/limits
llm-context:end -->
