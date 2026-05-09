# Fingerprint Validation

Point a mochi session at creepjs, read the trust score / lies count programmatically, and gate CI on a clean posture.

This example pairs with the [Validate the fingerprint posture](https://mochijs.com/docs/guides/recipe-fingerprint-validation) cookbook page. Read that page for the full walkthrough; this folder is the runnable form.

## Run

```sh
cp .env.example .env  # set MAX_LIES threshold
bun install
bun run index.ts
```

## What it does

- Launches a `mac-m4-chrome-stable` session with a deterministic seed (so the score is reproducible across runs).
- Navigates to `https://abrahamjuliot.github.io/creepjs/` and waits for `.trust-score-container` to render, then sleeps 10 s for the per-probe results to populate.
- Calls `page.evaluate(() => ...)` (ZERO-arg in mochi) to scrape the trust score, fingerprint hash, lies count, and bot section into a JSON-serializable record.
- Saves `out/creepjs.png` (`page.screenshot({ fullPage: true })`) as a CI artifact for debugging regressions.
- Exits with code 1 if `lies > MAX_LIES` — the CI gate.

## Files

- `index.ts` — the script
- `.env.example` — copy to `.env` and fill placeholders
- `package.json` — published-package deps; copy this folder anywhere and it works

## See also

- Cookbook recipe: https://mochijs.com/docs/guides/recipe-fingerprint-validation
- Decision matrix: https://mochijs.com/docs/guides/pick-a-scenario
- Limits + honest cut: https://mochijs.com/docs/reference/limits
