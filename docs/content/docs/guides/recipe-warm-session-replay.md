---
title: "Recipe: Warm-session replay"
description: Capture cookies + localStorage from a real session, persist to disk, re-hydrate to defeat IP-class scoring on re-visit.
order: 28
category: guides
lastUpdated: 2026-05-09
---

## Scenario

Risk engines lean on history. A "first-touch from this IP class" gets scored higher than a "returning visitor who's been here before, has localStorage cruft, has session-stable cookies". A bot script that opens a fresh session every run looks first-touch every run, which means a higher score every run, which means more challenges. The fix is to *be* a returning visitor: do an initial real-user session (manually, on a real device or a clean mochi run with a residential IP), capture both cookies AND localStorage, persist both to disk, and re-hydrate them on every subsequent run.

mochi exposes both halves: `Session.cookies.{save, load}` for the cookie jar, and `Page.localStorage.{get, set}` for the per-origin DOMStorage. Persist them in parallel; restore them in order (cookies before navigation, localStorage on a navigated tab).

## Complete code listing

```ts
import { mochi } from "@mochi.js/core";
import { existsSync } from "node:fs";

interface WarmState {
  localStorage: Record<string, string>;
  capturedAt: string;
}

const COOKIES = "./state/example-cookies.json";
const STORAGE = "./state/example-storage.json";
const TARGET_ORIGIN = "https://app.example.com";

async function captureWarmState(): Promise<void> {
  const session = await mochi.launch({
    profile: "mac-m4-chrome-stable",
    seed: "warm-capture-001",
  });
  try {
    const page = await session.newPage();
    await page.goto(`${TARGET_ORIGIN}/login`);
    // ...interactive login here (humanType, humanClick, MFA, etc)...
    await page.waitFor("[data-testid=dashboard]", { timeout: 60_000 });
    // Idle a few minutes — let the site write its tracking state.
    await new Promise((r) => setTimeout(r, 60_000));

    await session.cookies.save(COOKIES, { pattern: /\.example\.com$/ });
    const ls = await page.localStorage.get();
    const state: WarmState = { localStorage: ls, capturedAt: new Date().toISOString() };
    await Bun.write(STORAGE, JSON.stringify(state, null, 2));
  } finally {
    await session.close();
  }
}

async function rehydrateAndRun(): Promise<void> {
  const session = await mochi.launch({
    profile: "mac-m4-chrome-stable",
    seed: "warm-replay-001",
    proxy: process.env.PROXY_URL,
  });
  try {
    // Cookies BEFORE navigation — Storage.setCookies on the root browser target.
    if (existsSync(COOKIES)) {
      await session.cookies.load(COOKIES, { pattern: /\.example\.com$/ });
    }

    const page = await session.newPage();
    // Navigate to the *origin*, then write localStorage. DOMStorage requires a
    // real (non-opaque) origin — about:blank rejects.
    await page.goto(TARGET_ORIGIN);

    if (existsSync(STORAGE)) {
      const state = JSON.parse(await Bun.file(STORAGE).text()) as WarmState;
      await page.localStorage.set(state.localStorage, { origin: TARGET_ORIGIN });
    }

    // Now navigate to the protected route — already warm.
    await page.goto(`${TARGET_ORIGIN}/dashboard`);
    const greeting = await page.text("[data-testid=user-greeting]");
    console.log(greeting);
  } finally {
    await session.close();
  }
}

if (process.argv.includes("--capture")) {
  await captureWarmState();
} else {
  await rehydrateAndRun();
}
```

## What's happening here

- **Two-phase shape: capture once, replay forever.** The capture run (`--capture`) does the slow real-user dance: log in by hand if you must, idle long enough that the site writes its tracking state, then snapshot. The replay run loads the snapshot and skips the dance.
- **`session.cookies.save / load`** — JSON jar with `{ version: 1, savedAt, mochiVersion, pattern, count, cookies }` header. The reader rejects unknown majors with a precise diagnostic. `pattern` is a `RegExp` matched against `cookie.domain` — applies on save *and* load.
- **`page.localStorage.get(opts?)` / `set(items, opts?)`** — backed by CDP `DOMStorage.getDOMStorageItems` / `setDOMStorageItem`. `set` has `Object.assign` semantics (existing keys not in `items` are kept). Default origin is the page's main-frame origin; pass `{ origin }` to scope explicitly.
- **Cookies-before-nav, localStorage-after-nav.** `Storage.setCookies` runs on the root browser target — no tab needed. `DOMStorage.setDOMStorageItem` requires a non-opaque origin; `about:blank` and `data:` URLs reject. Navigate to the origin first, *then* write storage.
- **Idle on capture.** The 60 s wait isn't superstition — site-side trackers commonly debounce their writes (push-on-idle, push-on-unload). If you snapshot immediately after `dashboard` mounts, you miss the heuristic-engine bookkeeping. 60 s is the cheap floor; longer is better, page-visible better still.
- **Same profile + matching seed shape.** The replay session's matrix should be plausibly the same machine as the capture session. Different seed = different `display.{width, height}` jitter = a "same user but different monitor" story, which is fine. Different *profile* = different `userAgent`, different OS — the cookies still load but the user-agent says "I logged in on a Mac, now I'm on Windows" which is a real-world risk signal.

## Things that go wrong

- **Writing localStorage on `about:blank`.** `[mochi] page.localStorage.set: page origin is opaque (likely about:blank). Pass { origin } explicitly.` Either navigate first, or always pass `{ origin }`.
- **Loading the cookie jar AFTER `page.goto(target)`.** The browser sends the navigation request without your saved cookies, the site returns the un-authed response, and the cookies overwrite a state that's already wrong. Load cookies before any `goto` to a protected route.
- **Capturing too quickly.** Idle on capture is non-negotiable. Modern risk engines watch the *timing* of localStorage writes; a session that produces a full state in 1 s reads as scripted.
- **`page.localStorage()` (function-call form).** `localStorage` is a getter that returns a `DomStorage` namespace. Call `page.localStorage.get()` / `page.localStorage.set(items)`, not `page.localStorage()`.
- **Persisting a jar with a value that's already expired.** Cookies have an `expires` field (Unix epoch seconds). On load, mochi pushes them through `Storage.setCookies` verbatim; an expired cookie may be silently dropped by Chromium. Check `cookie.expires > Date.now() / 1000` before relying on warmth.
- **Mismatched `pattern` between save and load.** Saving `{ pattern: /\.example\.com$/ }` and loading without one leaks cookies from outside that domain. Save and load with the *same* pattern, or accept the leak.
- **Treating warm replay as a stealth bypass.** It's not. A replay defeats IP-class scoring (the "first-touch" penalty) but doesn't defeat real bot-detection — Cloudflare Turnstile still fires if the matrix-vs-IP combination doesn't match. Layer warmth on top of a clean fingerprint, not as a substitute. See [Limits → IP-class scoring](/docs/reference/limits).

## See also

- [`guides/recipe-login-with-cookie-persistence`](/docs/guides/recipe-login-with-cookie-persistence) — the cookies-only version of this recipe.
- [`guides/cookies-and-storage`](/docs/guides/cookies-and-storage) — full surface for `CookieJar` + `Page.localStorage`.
- [`guides/recipe-residential-proxy`](/docs/guides/recipe-residential-proxy) — the IP-class side of the equation.
- [`api/core`](/docs/api/core) — `CookieJar`, `DomStorage`, `DomStorageOptions`.
- [`reference/limits`](/docs/reference/limits) — IP-class scoring and what warm replay can and can't do.

<!-- llm-context:start
Page purpose: cookbook recipe — capture cookies + localStorage from a real
warmed-up session, persist both to disk, re-hydrate on subsequent runs to
defeat IP-class scoring on re-visit.

Key API symbols + signatures (verified against packages/core/src/session.ts +
packages/core/src/page.ts as of 2026-05-09):
  session.cookies: CookieJar (GETTER)
    cookies.save(path: string, opts?: { pattern?: RegExp }): Promise<void>
    cookies.load(path: string, opts?: { pattern?: RegExp }): Promise<void>
  page.localStorage: DomStorage (GETTER)
    localStorage.get(opts?: { origin?: string }): Promise<Record<string, string>>
    localStorage.set(items: Record<string, string>, opts?: { origin?: string }): Promise<void>
  page.sessionStorage: DomStorage (GETTER, same shape; per-tab)
  page.goto(url: string, opts?): Promise<void>
  Bun.file(path).text(): Promise<string>
  Bun.write(path, json): Promise<number>

Order of operations (load matters):
  1. mochi.launch({ profile, seed, proxy? })
  2. session.cookies.load(JAR)         // BEFORE any goto — Storage.setCookies, no tab needed
  3. session.newPage()
  4. page.goto(ORIGIN)                  // navigate to the target origin first
  5. page.localStorage.set(STATE, { origin: ORIGIN })   // origin must be non-opaque
  6. page.goto(`${ORIGIN}/protected-route`)

Common LLM hallucinations + corrections:
  - WRONG: `page.localStorage()` (function-call)         → CORRECT: getter, then `.get()` / `.set(items)`
  - WRONG: `session.localStorage`                        → CORRECT: localStorage is per-Page, not per-Session
  - WRONG: `localStorage.set` on about:blank             → CORRECT: navigate first, or pass `{ origin }` explicitly
  - WRONG: `cookies.save(path, "domain.com")`            → CORRECT: pass `{ pattern: /domain\.com$/ }` (RegExp)
  - WRONG: `session.storage()` for live read/write       → CORRECT: that returns a snapshot with empty placeholders; use page.localStorage / page.sessionStorage
  - WRONG: capturing immediately after dashboard mounts  → CORRECT: idle long enough for tracker debounces (60s+ is the cheap floor)

Cross-references on mochijs.com:
  - https://mochijs.com/docs/guides/recipe-login-with-cookie-persistence
  - https://mochijs.com/docs/guides/cookies-and-storage
  - https://mochijs.com/docs/guides/recipe-residential-proxy
  - https://mochijs.com/docs/api/core
  - https://mochijs.com/docs/reference/limits
  - https://mochijs.com/docs/concepts/inject-pipeline
llm-context:end -->
