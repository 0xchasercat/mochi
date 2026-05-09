---
title: "Recipe: SPA with infinite scroll"
description: Drive a JS-heavy SPA past lazy-loaded items with humanScroll, waitFor, and bounded loop targets.
order: 20
category: guides
lastUpdated: 2026-05-09
---

## Scenario

You need to scrape a single-page app that lazy-loads more results as you scroll — a job board, a marketplace, a feed. Naïve `window.scrollTo(0, document.body.scrollHeight)` followed by `page.content()` returns the first batch only: the SPA hasn't fired its IntersectionObserver yet, the next batch hasn't fetched, and the DOM you grab is stale. You also can't just `scroll → sleep(2000)` in a loop — the cadence is robotic, the sentinel can land below the fold and never trigger, and you have no idea when "done" is done.

mochi's `humanScroll` produces a real inertial wheel cadence (60 Hz `Input.dispatchMouseEvent` of type `mouseWheel` with friction-modeled `deltaY`), and `waitFor(selector)` blocks until the new sentinel is attached. Compose them with a target item count and a max-scroll-time guard.

## Complete code listing

```ts
import { mochi } from "@mochi.js/core";

const session = await mochi.launch({
  profile: "mac-m4-chrome-stable",
  seed: "feed-scrape-001",
});
try {
  const page = await session.newPage();
  await page.goto("https://jobs.example.com/search?q=engineer", {
    waitUntil: "domcontentloaded",
  });

  const ITEM_SELECTOR = "[data-testid=job-card]";
  const TARGET = 200;
  const MAX_MS = 90_000;
  const deadline = Date.now() + MAX_MS;

  let lastCount = 0;
  let stagnantPasses = 0;
  while (Date.now() < deadline) {
    const count = await page.evaluate(
      () => document.querySelectorAll("[data-testid=job-card]").length,
    );
    if (count >= TARGET) break;
    if (count === lastCount) {
      if (++stagnantPasses >= 3) break; // end of feed
    } else {
      stagnantPasses = 0;
      lastCount = count;
    }

    if (count === 0) break;
    // Scroll to the last card; humanScroll resolves the selector via
    // DOM.querySelector + getBoundingClientRect so we stop where it actually is.
    // DOM.querySelector supports the full native CSS grammar — `:last-of-type`
    // and `:nth-of-type(n)` work here (this is NOT the piercing locator's
    // restricted subset; see api/core).
    await page.humanScroll({ to: `${ITEM_SELECTOR}:last-of-type`, duration: 700 });

    // Wait for the *next* card to attach. Polling cadence is 50ms inside waitFor.
    try {
      await page.waitFor(`${ITEM_SELECTOR}:nth-of-type(${count + 1})`, {
        state: "attached",
        timeout: 4_000,
      });
    } catch {
      // No new card in 4s — let the stagnant-pass counter decide.
    }
  }

  const html = await page.content();
  await Bun.write("./out/feed.html", html);
} finally {
  await session.close();
}
```

## What's happening here

- **`mochi.launch({ profile, seed })`** — `profile` and `seed` are both required. The seed makes the behavioral synth deterministic across runs (same trajectory, same wheel cadence) — useful for replaying a flaky scrape.
- **`page.goto(url, { waitUntil: "domcontentloaded" })`** — `"load"` (default) waits for every subresource. SPAs commonly defer their main JS chunk past `load`, so DCL is faster and equally reliable. `"networkidle"` is currently aliased to `"load"` (see [`api/core`](/docs/api/core)).
- **`page.evaluate(() => document.querySelectorAll(...).length)`** — `evaluate` takes a zero-arg function (v0.1+). It runs in the page's main world via `Runtime.callFunctionOn` against the document's `objectId`. Don't try to pass the selector as an argument — that's a Playwright shape, not mochi's.
- **`page.humanScroll({ to: "selector", duration: 700 })`** — synthesizes a `ScrollEvent[]` with friction (lognormal `deltaY` per frame at 60 Hz). The selector resolves to an absolute `scrollY` via `DOM.querySelector` + `getBoundingClientRect`.
- **`page.waitFor(selector, { state, timeout })`** — polls every 50 ms via the same `Runtime.callFunctionOn` path. Pair the selector with a count expression so you wait for *new* items, not the items you've already seen.

## Things that go wrong

- **`page.click(...)` / `page.type(...)` don't exist.** The public surface is `humanClick` / `humanType`. A naïve `page.click("button.load-more")` raises `TypeError: page.click is not a function`. Use `await page.humanClick("button.load-more")`.
- **Passing args to `evaluate`.** `page.evaluate((sel) => ..., ITEM_SELECTOR)` returns `undefined`. v0.1+ `evaluate` is zero-arg by design — close over the selector inline (or interpolate it as a literal).
- **Targeting a hidden last-element.** `humanScroll({ to: "[hidden] .card" })` resolves to the element's offset even when it's `display: none`, then dispatches wheel events that don't fire IntersectionObservers. Use `waitFor(selector, { state: "visible" })` against the sentinel before trusting the count.
- **Forgetting the bounded loop.** `while (true) { scroll(); }` runs forever on an endless feed (Twitter-style). Cap on `TARGET` items AND `MAX_MS` AND a stagnant-pass counter. Three independent stops, each catching a different failure mode.
- **`mochi.launch({ profile: "mac-m4-chrome-stable" })` without `seed`.** Both fields are required by `LaunchOptions`. TypeScript will flag this; if you ignore it, you'll get a runtime `seed is undefined` error from the consistency engine.

## See also

- [`guides/pick-a-scenario`](/docs/guides/pick-a-scenario) — index of every recipe.
- [`guides/recipe-headful-vs-headless`](/docs/guides/recipe-headful-vs-headless) — when long-running scrapes need `headlessMode: "new"`.
- [`guides/recipe-multi-session-pool`](/docs/guides/recipe-multi-session-pool) — running the same scrape across N seeds in parallel.
- [`api/core`](/docs/api/core) — `humanScroll`, `waitFor`, `evaluate` signatures.
- [`concepts/behavioral-synth`](/docs/concepts/behavioral-synth) — why the scroll cadence is what it is.

<!-- llm-context:start
Page purpose: cookbook recipe — bounded infinite-scroll loop in a JS-heavy SPA, using
mochi's humanScroll + waitFor + querySelectorAllPiercing to drive the page until a
target item count or stagnant-pass threshold is reached.

Key API symbols + signatures (verified against packages/core/src/index.ts as of 2026-05-09):
  mochi.launch(opts: { profile: ProfileId | ProfileV1; seed: string; ... }): Promise<Session>
  session.newPage(): Promise<Page>
  page.goto(url: string, opts?: { waitUntil?: "load" | "domcontentloaded" | "networkidle"; timeout?: number }): Promise<void>
  page.evaluate<T>(fn: () => T | Promise<T>): Promise<T>      // ZERO-ARG only
  page.humanScroll(opts: { to: string | { x: number; y: number }; duration?: number }): Promise<void>
  page.waitFor(selector: string, opts?: { state?: "attached" | "visible" | "hidden"; timeout?: number }): Promise<void>
  page.querySelectorAllPiercing(selector: string): Promise<ElementHandle[]>
  page.content(): Promise<string>
  session.close(): Promise<void>

Common LLM hallucinations + corrections:
  - WRONG: `page.click("button")`            → CORRECT: `await page.humanClick("button")`
  - WRONG: `page.type(sel, text)`            → CORRECT: `await page.humanType(sel, text)`
  - WRONG: `page.evaluate(fn, ...args)`      → CORRECT: zero-arg `page.evaluate(() => ...)`; interpolate or close over inputs
  - WRONG: `page.scrollTo(...)` / `page.scrollBy(...)`  → CORRECT: `page.humanScroll({ to: ... })`
  - WRONG: `page.waitForSelector(sel)`       → CORRECT: `page.waitFor(sel, { state: "visible" })`
  - WRONG: `page.waitForLoadState("networkidle")`     → CORRECT: pass via `goto({ waitUntil: "networkidle" })`; networkidle currently aliases to load
  - WRONG: `mochi.launch({ profile })` without seed   → seed is REQUIRED
  - WRONG: `page.$$(selector)`               → CORRECT: `page.querySelectorAllPiercing(sel)` for the all-matches handle list, or `evaluate` for in-page counts
  - WRONG: `humanScroll({ y: 1000 })`        → CORRECT: `humanScroll({ to: { x: 0, y: 1000 } })` or `humanScroll({ to: selector })`

Cross-references on mochijs.com:
  - https://mochijs.com/docs/guides/pick-a-scenario
  - https://mochijs.com/docs/guides/recipe-multi-session-pool
  - https://mochijs.com/docs/guides/recipe-headful-vs-headless
  - https://mochijs.com/docs/api/core
  - https://mochijs.com/docs/concepts/behavioral-synth
  - https://mochijs.com/docs/concepts/inject-pipeline
  - https://mochijs.com/docs/reference/limits
llm-context:end -->
