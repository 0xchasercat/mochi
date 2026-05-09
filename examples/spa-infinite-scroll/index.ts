/**
 * Recipe: SPA with infinite scroll.
 *
 * Drives a JS-heavy feed past lazy-loaded items with `humanScroll` + `waitFor`,
 * bounded by an item-count target, a max-scroll-time budget, and a
 * stagnant-pass counter. Three independent stops, each catching a different
 * failure mode (target reached / time up / end of feed).
 *
 * @see https://mochijs.com/docs/guides/recipe-spa-infinite-scroll
 */

import { mochi } from "@mochi.js/core";

const TARGET_URL = process.env.TARGET_URL ?? "https://example.com/jobs?infinite";
const ITEM_SELECTOR = process.env.ITEM_SELECTOR ?? "[data-testid=job-card]";
const BUDGET_ITEMS = Number(process.env.BUDGET_ITEMS ?? "200");
const MAX_MS = Number(process.env.MAX_MS ?? "90000");

const session = await mochi.launch({
  profile: "mac-m4-chrome-stable",
  seed: "feed-scrape-001",
});

try {
  const page = await session.newPage();
  await page.goto(TARGET_URL, { waitUntil: "domcontentloaded" });

  // Wait for at least one card to render before we start counting.
  await page.waitFor(ITEM_SELECTOR, { state: "visible", timeout: 30_000 });

  const deadline = Date.now() + MAX_MS;
  let lastCount = 0;
  let stagnantPasses = 0;

  while (Date.now() < deadline) {
    // page.evaluate is ZERO-arg in mochi. Interpolate the selector into the
    // function source so it stays consistent with the env-driven
    // ITEM_SELECTOR rather than hard-coding the default.
    const selectorJson = JSON.stringify(ITEM_SELECTOR);
    const count = await page.evaluate(
      new Function(`return document.querySelectorAll(${selectorJson}).length`) as () => number,
    );

    if (count >= BUDGET_ITEMS) {
      console.log(`reached BUDGET_ITEMS=${BUDGET_ITEMS}; stopping at ${count}`);
      break;
    }
    if (count === lastCount) {
      if (++stagnantPasses >= 3) {
        console.log(`end of feed at ${count} items (3 stagnant passes)`);
        break;
      }
    } else {
      stagnantPasses = 0;
      lastCount = count;
    }

    if (count === 0) break;

    // humanScroll resolves the selector via DOM.querySelector +
    // getBoundingClientRect — full native CSS grammar, including
    // `:last-of-type`. Synthesizes a friction-modelled wheel cadence at 60 Hz.
    await page.humanScroll({ to: `${ITEM_SELECTOR}:last-of-type`, duration: 700 });

    // Wait for the next item to attach. If nothing appears in 4s the
    // stagnant-pass counter takes over.
    try {
      await page.waitFor(`${ITEM_SELECTOR}:nth-of-type(${count + 1})`, {
        state: "attached",
        timeout: 4_000,
      });
    } catch {
      // intentional — let stagnant-pass loop decide.
    }
  }

  // Some sites hide items behind closed shadow roots; querySelectorAllPiercing
  // sees through them where evaluate cannot.
  const piercedCount = (await page.querySelectorAllPiercing(ITEM_SELECTOR)).length;
  console.log(`final count: ${lastCount} (piercing: ${piercedCount})`);

  const html = await page.content();
  await Bun.write("./out/feed.html", html);
} finally {
  await session.close();
}
