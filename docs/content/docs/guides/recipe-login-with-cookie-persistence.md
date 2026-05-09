---
title: "Recipe: Login flow with cookie persistence"
description: humanType the credentials, persist Session.cookies to disk, restore the jar in a future run.
order: 21
category: guides
lastUpdated: 2026-05-09
---

## Scenario

You need to log into a site once — clicking through real form fields with real keystroke timings — and then, every subsequent run, skip the login flow entirely by replaying the cookie jar. Naïve scripts re-login on every invocation; that's a per-run rate-limit hit, a per-run risk-engine score bump, and a 2FA prompt every Tuesday. The clean shape is: log in once, save the jar, load the jar on the next launch, navigate straight to the authenticated route.

mochi's `Session.cookies` namespace exposes `get` / `set` / `save` / `load`. The on-disk format is JSON with a version header (`{ version: 1, savedAt, mochiVersion, pattern, count, cookies }`) and a regex `pattern` filter that applies on both save and load. The jar is session-wide, not page-scoped — it routes through `Storage.getCookies` / `Storage.setCookies` on the root browser target.

## Complete code listing

```ts
import { mochi } from "@mochi.js/core";
import { existsSync } from "node:fs";

const JAR = "./state/example-cookies.json";

const session = await mochi.launch({
  profile: "mac-m4-chrome-stable",
  seed: "warm-account-001",
});
try {
  if (existsSync(JAR)) {
    await session.cookies.load(JAR, { pattern: /\.example\.com$/ });
  }

  const page = await session.newPage();
  await page.goto("https://app.example.com/dashboard");

  // If the cookie jar was valid we land on the dashboard; if not we get
  // bounced to /login and run the interactive flow.
  if (page.url.includes("/login")) {
    await page.humanType("input[name=email]", "me@example.com");
    await page.humanType("input[name=password]", process.env.APP_PASSWORD ?? "");
    await page.humanClick("button[type=submit]");
    await page.waitFor("[data-testid=dashboard]", { state: "visible", timeout: 30_000 });

    // Persist the freshly-issued session cookies for next time.
    await session.cookies.save(JAR, { pattern: /\.example\.com$/ });
  }

  // Authenticated work happens here.
  const greeting = await page.text("[data-testid=user-greeting]");
  console.log(greeting);
} finally {
  await session.close();
}
```

## What's happening here

- **`session.cookies.load(path, { pattern })`** — reads the JSON jar, validates the `version: 1` header, and replays every matching cookie via `Storage.setCookies`. Failing files throw with a precise diagnostic (path-relative). The `pattern` regex is matched against each cookie's `domain`; cookies that don't match are skipped (so a saved-with-everything jar can be restored partially).
- **`page.url.includes("/login")`** — `Page.url` is a getter (no parentheses), updated from the most recent `Page.frameNavigated` event. After `goto`, it reflects whatever the server redirected to.
- **`page.humanType(selector, text)`** — focuses the field via `DOM.focus({ nodeId })` then dispatches per-key `Input.dispatchKeyEvent` of type `keyDown` / `keyUp` with lognormal digraph delays. The default mistake rate is 2%; pass `{ mistakeRate: 0 }` for password fields if your site doesn't tolerate transient typos.
- **`page.humanClick("button[type=submit]")`** — Bezier+Fitts trajectory, `mousePressed`, `mouseReleased`. The pre-move settle is on by default (50–300 ms uniform jitter — humans don't snap instantly).
- **`session.cookies.save(path, { pattern })`** — writes a `CookieJarFile` JSON record to `path` via `Bun.write`. The format version is `COOKIE_JAR_FORMAT_VERSION` (currently `1`); the file ends with a trailing newline so it diffs cleanly when committed alongside fixtures.

## Things that go wrong

- **`page.fill(selector, value)` / `page.type(selector, value)` don't exist.** That's Playwright. Use `humanType`. A `TypeError: page.fill is not a function` here is the giveaway.
- **`session.cookies(filter)` (function-call form).** `cookies` is a getter that returns the `CookieJar`. Call `session.cookies.get(filter)`, not `session.cookies(filter)`.
- **Loading a jar from a different `version`.** `cookies.load` throws `[mochi] cookies.load: <path> version <n> is not supported (expected 1)`. Bump your tooling or re-save from scratch.
- **`pattern` is a `RegExp`, not a string.** `{ pattern: ".example.com" }` matches every cookie because the runtime coerces string → regex inputs in unexpected ways. Pass an actual `/\.example\.com$/` literal.
- **Setting cookies before the browser has any tabs open.** `Storage.setCookies` does work pre-tab, but if the cookie's `domain` doesn't have a path-scoped origin yet some sites' service workers re-clear them on first load. Open your tab first, then `cookies.load` if you hit this.
- **Persisting a jar with `httpOnly: false` and committing it.** The on-disk shape includes raw cookie values. Treat the jar like a credential — gitignore it, vault it, or scope `pattern` to non-sensitive cookies only.

## See also

- [`guides/cookies-and-storage`](/docs/guides/cookies-and-storage) — full surface for `CookieJar` + `Page.localStorage` / `sessionStorage`.
- [`guides/recipe-warm-session-replay`](/docs/guides/recipe-warm-session-replay) — taking this further with localStorage hydration to defeat IP-class scoring.
- [`guides/recipe-multi-session-pool`](/docs/guides/recipe-multi-session-pool) — fan out N parallel logins, one jar per seed.
- [`api/core`](/docs/api/core) — `CookieJar`, `CookieJarFile`, `CookieJarOptions`, `COOKIE_JAR_FORMAT_VERSION`.
- [`concepts/inject-pipeline`](/docs/concepts/inject-pipeline) — what happens between `goto` and the cookie write.

<!-- llm-context:start
Page purpose: cookbook recipe — interactive login (humanType + humanClick), persist
Session.cookies to disk, restore on a future launch via Session.cookies.load with a
domain-scoped regex pattern. Skips the re-login flow when the jar is valid.

Key API symbols + signatures (verified against packages/core/src/session.ts as of 2026-05-09):
  mochi.launch(opts: { profile: ProfileId | ProfileV1; seed: string; ... }): Promise<Session>
  session.cookies: CookieJar (GETTER, not a method)
    cookies.get(filter?: { url?: string }): Promise<Cookie[]>
    cookies.set(cookies: Cookie[]): Promise<void>
    cookies.save(path: string, opts?: { pattern?: RegExp }): Promise<void>
    cookies.load(path: string, opts?: { pattern?: RegExp }): Promise<void>
  CookieJarFile: { version: 1; savedAt: string; mochiVersion: string; pattern: string; count: number; cookies: Cookie[] }
  COOKIE_JAR_FORMAT_VERSION: 1
  page.humanType(selector: string, text: string, opts?: { wpm?: number; mistakeRate?: number }): Promise<void>
  page.humanClick(selector: string, opts?: { button?: ...; duration?: number; preMoveSettle?: boolean }): Promise<void>
  page.waitFor(selector: string, opts?: { state?: "attached" | "visible" | "hidden"; timeout?: number }): Promise<void>
  page.url: string (GETTER)
  page.text(selector: string): Promise<string | null>

Common LLM hallucinations + corrections:
  - WRONG: `page.fill(sel, value)`            → CORRECT: `page.humanType(sel, value)`
  - WRONG: `session.cookies(filter)`          → CORRECT: `session.cookies.get(filter)` (cookies is a getter)
  - WRONG: `session.context.cookies()`        → CORRECT: `session.cookies.get()` (no BrowserContext concept)
  - WRONG: `cookies.save(path, "**.example.com")`  → CORRECT: `cookies.save(path, { pattern: /\.example\.com$/ })` (RegExp)
  - WRONG: `page.url()`                       → CORRECT: `page.url` (getter, no parens)
  - WRONG: `page.waitForNavigation()`         → CORRECT: `page.waitFor(selector, { state: "visible" })` against a post-nav element
  - WRONG: `mochi.launch({ profile })` no seed → seed is REQUIRED
  - WRONG: `humanClick({ selector })`         → CORRECT: `humanClick(selector, opts?)` — selector is positional

Cross-references on mochijs.com:
  - https://mochijs.com/docs/guides/cookies-and-storage
  - https://mochijs.com/docs/guides/recipe-warm-session-replay
  - https://mochijs.com/docs/guides/recipe-multi-session-pool
  - https://mochijs.com/docs/api/core
  - https://mochijs.com/docs/concepts/inject-pipeline
  - https://mochijs.com/docs/concepts/behavioral-synth
  - https://mochijs.com/docs/reference/limits
llm-context:end -->
