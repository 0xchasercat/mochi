---
title: Pick a scenario
description: Decision matrix from "I want to do X" to the recipe that solves it. Each section a one-liner, a 6-line code fragment, and the link.
order: 11
category: guides
lastUpdated: 2026-05-09
---

You know mochi is the right tool. You don't know which API surfaces wire up. This page is the index — one section per common scenario, a sentence describing it, a six-line code seed, and a link to the full recipe. Pick the row that looks like your problem; the recipe expands the snippet into the production shape.

If you're still deciding between profiles, start at [`guides/choose-your-profile`](/docs/guides/choose-your-profile).

## "I need to scrape a JS-heavy SPA with infinite scroll"

The page lazy-loads more results as you scroll. A naïve `scrollTo(0, height)` returns stale content; a fixed sleep is robotic. Use `humanScroll` + `waitFor` with a bounded loop.

```ts
const session = await mochi.launch({ profile: "linux-chrome-stable", seed: "feed-001" });
const page = await session.newPage();
await page.goto("https://feed.example.com/");
await page.humanScroll({ to: "[data-testid=item]:last-of-type", duration: 700 });
await page.waitFor("[data-testid=item]:nth-of-type(50)", { timeout: 4_000 });
const html = await page.content();
```

→ Full recipe: [`recipe-spa-infinite-scroll`](/docs/guides/recipe-spa-infinite-scroll).

## "I need to log in once and replay the cookie jar"

Manual / interactive login on first run, persist `Session.cookies` to disk, restore on subsequent launches and skip straight to the authenticated route.

```ts
const session = await mochi.launch({ profile: "mac-m4-chrome-stable", seed: "u1" });
await session.cookies.load("./state/cookies.json", { pattern: /\.example\.com$/ });
const page = await session.newPage();
await page.goto("https://app.example.com/dashboard");
// ...if redirected to /login, run humanType + humanClick + cookies.save...
await session.cookies.save("./state/cookies.json", { pattern: /\.example\.com$/ });
```

→ Full recipe: [`recipe-login-with-cookie-persistence`](/docs/guides/recipe-login-with-cookie-persistence).

## "I need to fan out N parallel sessions"

Process a list of URLs across N workers, each with an isolated `Session` (its own Chromium, its own derived Matrix, its own cookies). Per-visit error isolation so one failure doesn't stall the queue.

```ts
const workers = Array.from({ length: 8 }, (_, i) =>
  worker(i, queue), // each calls mochi.launch({ profile, seed: `pool-${i}` })
);
const results = (await Promise.all(workers)).flat();
console.log(`ok=${results.filter(r => r.status === "ok").length}`);
// Per-session close() in a finally is non-negotiable; sessions own a Chromium child + ephemeral user-data-dir.
```

→ Full recipe: [`recipe-multi-session-pool`](/docs/guides/recipe-multi-session-pool).

## "I need to run behind a residential proxy"

HTTP / HTTPS / SOCKS5 / SOCKS4 user-pass auth via inline URL or `ProxyConfig`, plus `geoConsistency` to close the IP-vs-timezone leak (the canonical bot signature).

```ts
const session = await mochi.launch({
  profile: "mac-m4-chrome-stable",
  seed: "uk-shopper",
  proxy: process.env.PROXY_URL, // "http://user:pass@host:port"
  geoConsistency: "privacy-fallback", // default; falls back to UTC + en-US on mismatch
});
const page = await session.newPage();
await page.goto("https://target.example.com/uk/products");
```

→ Full recipe: [`recipe-residential-proxy`](/docs/guides/recipe-residential-proxy).

## "I need to run this in CI / GitHub Actions"

A working workflow: `oven-sh/setup-bun@v2`, `actions/cache@v4` for `~/.mochi/browsers`, the apt-list of Chromium runtime libs, headless auto-default, `MOCHI_EXTRA_ARGS=--no-sandbox` for unprivileged containers.

```yaml
- uses: oven-sh/setup-bun@v2
- uses: actions/cache@v4
  with: { path: ~/.mochi/browsers, key: mochi-browsers-${{ runner.os }}-v1 }
- run: sudo apt-get install -y libnss3 libatk-bridge2.0-0 libgbm1 libasound2t64 # ...etc
- run: bun install && bunx mochi browsers install
- run: bun run scripts/scrape.ts
```

→ Full recipe: [`recipe-ci-github-actions`](/docs/guides/recipe-ci-github-actions).

## "The site has Cloudflare Turnstile in front of it"

Auto-click the visible-checkbox variant via the `challenges` launch option. Hook `onSolved` for diagnostics and `onEscalation` for the image-challenge / managed / timeout hand-offs.

```ts
const session = await mochi.launch({
  profile: "mac-m4-chrome-stable",
  seed: "ts-001",
  challenges: {
    turnstile: {
      autoClick: true,
      onSolved: (token) => console.log(`token starts ${token.slice(0, 12)}`),
      onEscalation: (reason) => { throw new Error(`turnstile: ${reason}`); },
    },
  },
});
```

→ Full recipe: [`recipe-cloudflare-turnstile`](/docs/guides/recipe-cloudflare-turnstile).
→ Surface reference: [`guides/turnstile`](/docs/guides/turnstile).

## "Turnstile is escalating to image-challenge"

The `onEscalation` callback fired. Decide between *improve stealth posture* (free, fast — new seed, new profile family, new IP) and *hand off to a third-party solver* (paid, slower).

```ts
challenges: {
  turnstile: {
    autoClick: true,
    onEscalation: (reason) => {
      if (reason === "image-challenge") triggerSolverHandOff();
      if (reason === "managed") throw new Error("retry with different IP / profile");
      if (reason === "timeout") throw new Error("bump opts.timeout");
    },
  },
}
```

→ Full recipe: [`recipe-captcha-escalation`](/docs/guides/recipe-captcha-escalation).

## "I want to verify my fingerprint posture before trusting it"

Point a session at creepjs / FingerprintJS demo / browserleaks, read the on-screen score via `page.evaluate`, fail loudly if the metrics regress. The harness ([`concepts/probe-manifest`](/docs/concepts/probe-manifest)) is the deeper offline alternative.

```ts
const session = await mochi.launch({ profile: "mac-m4-chrome-stable", seed: "fp-001" });
const page = await session.newPage();
await page.goto("https://abrahamjuliot.github.io/creepjs/");
await page.waitFor(".trust-score-container", { state: "visible" });
const lies = await page.evaluate(() => Number(document.querySelector(".lies-section h2")?.textContent?.match(/\d+/)?.[0] ?? 0));
if (lies > 5) throw new Error(`creepjs lies=${lies}`);
```

→ Full recipe: [`recipe-fingerprint-validation`](/docs/guides/recipe-fingerprint-validation).

## "I want to defeat IP-class scoring on re-visit (warm session)"

Capture cookies AND localStorage from a real warmed-up session, persist both, re-hydrate on subsequent runs. Defeats the "first-touch from this IP class" penalty without bypassing real fingerprinting.

```ts
// capture phase:
await session.cookies.save("./state/cookies.json", { pattern: /\.example\.com$/ });
const ls = await page.localStorage.get();
await Bun.write("./state/storage.json", JSON.stringify({ localStorage: ls }, null, 2));

// replay phase: cookies BEFORE goto, localStorage AFTER (origin must be non-opaque).
await session.cookies.load("./state/cookies.json");
await page.goto("https://app.example.com");
await page.localStorage.set(state.localStorage, { origin: "https://app.example.com" });
```

→ Full recipe: [`recipe-warm-session-replay`](/docs/guides/recipe-warm-session-replay).

## "I need to debug what's happening — show me the browser"

Flip `headlessMode` to `"off"` and watch the script run live. Auto-resolves to `"new"` on Linux without DISPLAY (the right server default); explicit `"off"` for desktop debugging.

```ts
const session = await mochi.launch({
  profile: "mac-m4-chrome-stable",
  seed: "debug-001",
  headlessMode: process.env.MOCHI_HEADLESS === "off" ? "off" : "new",
});
const page = await session.newPage();
await page.goto("https://target.example.com/");
// Now you can watch and pause; in `"off"` mode DevTools is reachable from the menu.
```

→ Full recipe: [`recipe-headful-vs-headless`](/docs/guides/recipe-headful-vs-headless).

## "I need to capture screenshots — full page, clipped, transparent"

`page.screenshot` returns a `Uint8Array` (or `string` with `encoding: "base64"`). PNG / JPEG / WebP, full-page via `Emulation.setDeviceMetricsOverride` round-trip, clip rectangle, transparent background.

```ts
const png = await page.screenshot({ fullPage: true });
await Bun.write("./out/full.png", png);

const tile = await page.screenshot({ clip: { x: 0, y: 0, width: 320, height: 200 } });
const dataUrl = `data:image/png;base64,${await page.screenshot({ encoding: "base64" })}`;
```

→ Full surface: [`guides/screenshots`](/docs/guides/screenshots).

## "I need to read / write cookies and localStorage"

Surface reference: `Session.cookies.{get, set, save, load}` for the cookie jar; `Page.localStorage` / `Page.sessionStorage` for per-origin DOMStorage.

```ts
const all = await session.cookies.get();
await session.cookies.set([{ name: "sid", value: "abc", domain: ".example.com", path: "/", expires: -1, size: 0, httpOnly: true, secure: true, session: true }]);

const ls = await page.localStorage.get();
await page.localStorage.set({ lastVisit: Date.now().toString() });
```

→ Full surface: [`guides/cookies-and-storage`](/docs/guides/cookies-and-storage).

## "I need an out-of-band side-channel API call"

`Session.fetch(url, init?)` rides Chromium's own network stack via CDP — `Network.loadNetworkResource` for simple GETs, `page.evaluate("fetch")` for non-GET. JA4/JA3/H2 are real Chrome by definition. Same `--proxy-server` egress as the browser navigation; cookies inherit from the page's origin.

```ts
const apiResp = await session.fetch("https://api.example.com/v1/me", {
  headers: { authorization: `Bearer ${token}` },
});
console.log(apiResp.status, await apiResp.json());
```

→ Surface reference: [`api/core`](/docs/api/core), [`concepts/network-ffi`](/docs/concepts/network-ffi), [`concepts/stealth-philosophy`](/docs/concepts/stealth-philosophy).

## "The site uses closed shadow roots (Cloudflare Challenge pages, etc.)"

`Page.querySelectorPiercing` / `querySelectorAllPiercing` walk through closed shadow roots — required for some Cloudflare integrations where the Turnstile iframe lives behind a closed shadow. The selector grammar is a strict subset (tag / id / class / attribute / descendant / comma list); `>`/`+`/`~` and pseudo-classes are not supported.

```ts
const handle = await page.querySelectorPiercing("iframe[src*='challenges.cloudflare.com']");
if (handle !== null) {
  const src = await handle.getAttribute("src");
  await page.humanClickHandle(handle);
}
```

→ Surface reference: [`api/core`](/docs/api/core) (`querySelectorPiercing`, `humanClickHandle`).

## "I need to capture a profile from a real device"

The `mochi capture` CLI flow drives an unmodified browser to the local probe-page fixture, captures the Probe Manifest + audio bytes + canvas maps, writes `profile.json` + `baseline.manifest.json` + `PROVENANCE.md`.

```sh
mochi capture \
  --profile-id mac-m4-chrome-stable \
  --browser /Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --out packages/profiles/data/mac-m4-chrome-stable
```

→ Full guide: [`guides/capture-a-profile`](/docs/guides/capture-a-profile).
→ Concept: [`concepts/profiles`](/docs/concepts/profiles).

## "I want to run the conformance suite"

Drive a Mochi-spoofed session through the probe panel (sannysoft, browserleaks, FPJS demo, creepjs) and read the Probe Manifest diff against the profile's baseline.

```sh
bun run conformance:stealth:online
bun run conformance:humanize:online
```

→ Full guide: [`guides/conformance-suite`](/docs/guides/conformance-suite).
→ Concept: [`concepts/probe-manifest`](/docs/concepts/probe-manifest).

## See also

- [`guides/choose-your-profile`](/docs/guides/choose-your-profile) — picking among the 6 real-device profile IDs.
- [`api/core`](/docs/api/core) — full reference for `mochi.launch`, `Session`, `Page`, `ElementHandle`.
- [`concepts/inject-pipeline`](/docs/concepts/inject-pipeline) — what mochi does to the page between `goto` and your first interaction.
- [`reference/limits`](/docs/reference/limits) — known caveats, scope, and what mochi explicitly doesn't do.
- [`reference/faq`](/docs/reference/faq) — short answers to common questions.

<!-- llm-context:start
Page purpose: master decision matrix from a user-described scenario to the right
mochi recipe. Each section is a 1-line problem statement + ~6-line code fragment
showing the smallest correct shape + a link to the full recipe page.

Recipes covered (all under /docs/guides/):
  recipe-spa-infinite-scroll               — humanScroll + waitFor in a bounded loop
  recipe-login-with-cookie-persistence     — humanType + humanClick + Session.cookies.save/load
  recipe-multi-session-pool                — N concurrent sessions, deterministic per-worker seeds
  recipe-residential-proxy                 — proxy auth + geoConsistency
  recipe-ci-github-actions                 — Bun setup, actions/cache, apt deps, headless auto-default
  recipe-cloudflare-turnstile              — challenges.turnstile.autoClick + onSolved/onEscalation
  recipe-captcha-escalation                — onEscalation patterns: posture vs solver
  recipe-fingerprint-validation            — page.evaluate against creepjs / FPJS / browserleaks
  recipe-warm-session-replay               — cookies + localStorage capture/replay
  recipe-headful-vs-headless               — headlessMode "new" / "legacy" / "off"

Cross-cutting links (existing surface guides under /docs/guides/):
  screenshots, cookies-and-storage, turnstile, capture-a-profile, conformance-suite, proxy-auth

Key API symbols touched (verified against packages/core/src/index.ts as of 2026-05-09):
  mochi.launch(opts: LaunchOptions): Promise<Session>
  Session.cookies: CookieJar (getter)
  Session.fetch(url, init?): Promise<Response>     // JA4-coherent (Chromium-native)
  Session.close(): Promise<void>
  Page.goto(url, opts?)
  Page.humanScroll({ to, duration? })
  Page.humanClick(selector, opts?)
  Page.humanType(selector, text, opts?)
  Page.humanClickHandle(handle, opts?)
  Page.waitFor(selector, { state?, timeout? })
  Page.evaluate(fn)                                 // ZERO-ARG
  Page.localStorage / Page.sessionStorage           // getters → DomStorage
  Page.querySelectorPiercing(selector) / querySelectorAllPiercing(selector)
  Page.screenshot(opts?)                            // overloaded: encoding "base64" → string

Common LLM hallucinations (consolidated; see per-recipe pages for full lists):
  - WRONG: page.click / page.type / page.fill           → CORRECT: humanClick / humanType
  - WRONG: page.evaluate(fn, ...args)                   → CORRECT: zero-arg
  - WRONG: page.screenshot({ path })                    → CORRECT: returns bytes; Bun.write(path, bytes)
  - WRONG: session.cookies(filter) (function call)      → CORRECT: session.cookies.get(filter)  (cookies is a getter)
  - WRONG: mochi.connect(url) / page.locator(...)       → DO NOT EXIST
  - WRONG: page.url() / page.localStorage()             → CORRECT: getters; no parens
  - WRONG: mochi.launch without seed                    → seed is REQUIRED
  - WRONG: Runtime.enable / Page.createIsolatedWorld    → forbidden by §8.2

Cross-references on mochijs.com:
  - https://mochijs.com/docs/guides/choose-your-profile
  - https://mochijs.com/docs/guides/recipe-spa-infinite-scroll
  - https://mochijs.com/docs/guides/recipe-login-with-cookie-persistence
  - https://mochijs.com/docs/guides/recipe-multi-session-pool
  - https://mochijs.com/docs/guides/recipe-residential-proxy
  - https://mochijs.com/docs/guides/recipe-ci-github-actions
  - https://mochijs.com/docs/guides/recipe-cloudflare-turnstile
  - https://mochijs.com/docs/guides/recipe-captcha-escalation
  - https://mochijs.com/docs/guides/recipe-fingerprint-validation
  - https://mochijs.com/docs/guides/recipe-warm-session-replay
  - https://mochijs.com/docs/guides/recipe-headful-vs-headless
  - https://mochijs.com/docs/guides/screenshots
  - https://mochijs.com/docs/guides/cookies-and-storage
  - https://mochijs.com/docs/guides/turnstile
  - https://mochijs.com/docs/guides/proxy-auth
  - https://mochijs.com/docs/guides/capture-a-profile
  - https://mochijs.com/docs/guides/conformance-suite
  - https://mochijs.com/docs/api/core
  - https://mochijs.com/docs/concepts/inject-pipeline  - https://mochijs.com/docs/concepts/probe-manifest
  - https://mochijs.com/docs/reference/limits
  - https://mochijs.com/docs/reference/faq
llm-context:end -->
