# Cloudflare Turnstile

Auto-click the visible-checkbox Turnstile variant; route image / managed / timeout escalations to a solver hand-off seam.

This example pairs with the [Cloudflare Turnstile](https://mochijs.com/docs/guides/recipe-cloudflare-turnstile) cookbook page. Read that page for the full walkthrough; this folder is the runnable form.

## Run

```sh
cp .env.example .env  # APP_PASSWORD, optional SOLVER_API_KEY
bun install
bun run index.ts
```

## What it does

- Launches a session with `challenges.turnstile.autoClick: true` — every page returned by `session.newPage()` gets `installTurnstileAutoClick` wired automatically.
- Hooks `onSolved(token)` for diagnostics (logs the first 12 chars of the response token).
- Hooks `onEscalation(reason)` and routes to a placeholder `solve2Captcha(reason)` — replace with a real solver call (2captcha, anti-captcha, capmonster).
- Drives the post-widget flow with `humanType` + `humanClick` and waits for the post-Turnstile DOM change (NOT `onSolved` — that fires before the form unlocks).

## Files

- `index.ts` — the script
- `.env.example` — copy to `.env` and fill placeholders
- `package.json` — published-package deps; copy this folder anywhere and it works

## See also

- Cookbook recipe: https://mochijs.com/docs/guides/recipe-cloudflare-turnstile
- Decision matrix: https://mochijs.com/docs/guides/pick-a-scenario
- Limits + honest cut: https://mochijs.com/docs/reference/limits
