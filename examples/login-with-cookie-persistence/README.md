# Login With Cookie Persistence

Log in once with `humanType` + `humanClick`, persist `Session.cookies` to disk, restore the jar on every subsequent run to skip the interactive flow.

This example pairs with the [Login flow with cookie persistence](https://mochijs.com/docs/guides/recipe-login-with-cookie-persistence) cookbook page. Read that page for the full walkthrough; this folder is the runnable form.

## Run

```sh
cp .env.example .env  # fill APP_PASSWORD
bun install
bun run index.ts      # first run — interactive login + jar save
bun run index.ts      # second run — jar replay, no login
```

## What it does

- Loads `state/example-cookies.json` if present (RegExp-scoped to `.example.com`); on failure, falls through to the interactive flow.
- Navigates to `${APP_ORIGIN}/dashboard`. If the server bounces to `/login`, runs the interactive form fill: `humanType` email + password, `humanClick` submit, `waitFor [data-logged-in]`.
- On a fresh login, persists the resulting cookie jar back to disk for next time.
- Reads `[data-testid=user-greeting]` and dumps the authenticated dashboard HTML to `out/dashboard.html`.

## Files

- `index.ts` — the script
- `.env.example` — copy to `.env` and fill placeholders
- `package.json` — published-package deps; copy this folder anywhere and it works

## See also

- Cookbook recipe: https://mochijs.com/docs/guides/recipe-login-with-cookie-persistence
- Decision matrix: https://mochijs.com/docs/guides/pick-a-scenario
- Limits + honest cut: https://mochijs.com/docs/reference/limits
