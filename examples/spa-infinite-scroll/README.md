# SPA Infinite Scroll

Drive a JS-heavy single-page app past lazy-loaded items with `humanScroll` + `waitFor`, bounded by an item-count target and a max-scroll-time budget.

This example pairs with the [SPA with infinite scroll](https://mochijs.com/docs/guides/recipe-spa-infinite-scroll) cookbook page. Read that page for the full walkthrough; this folder is the runnable form.

## Run

```sh
cp .env.example .env  # adjust TARGET_URL / ITEM_SELECTOR / budgets
bun install
bun run index.ts
```

## What it does

- Launches a session with the `mac-m4-chrome-stable` profile and a deterministic seed (so the trajectory + scroll cadence replay across runs).
- Navigates to `TARGET_URL` and waits for at least one item card to become visible.
- Loops: counts items via `page.evaluate`, scrolls to the last item, then waits for the next item to attach.
- Stops on three independent conditions: target reached, max scroll time exceeded, or three stagnant passes (end of feed).
- Snapshots `out/feed.html` and prints both the live count and a closed-shadow-root pierced count.

## Files

- `index.ts` — the script
- `.env.example` — copy to `.env` and fill placeholders
- `package.json` — published-package deps; copy this folder anywhere and it works

## See also

- Cookbook recipe: https://mochijs.com/docs/guides/recipe-spa-infinite-scroll
- Decision matrix: https://mochijs.com/docs/guides/pick-a-scenario
- Limits + honest cut: https://mochijs.com/docs/reference/limits
