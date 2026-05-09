# Warm Session Replay

Capture cookies + localStorage from a real warmed-up session, persist to disk, re-hydrate on subsequent runs to defeat IP-class scoring on re-visit.

This example pairs with the [Warm-session replay](https://mochijs.com/docs/guides/recipe-warm-session-replay) cookbook page. Read that page for the full walkthrough; this folder is the runnable form.

## Run

```sh
cp .env.example .env  # set TARGET_ORIGIN; PROXY_URL optional
bun install

# Run 1 — capture the warm state.
bun run index.ts
# (Interactive login here. Idle 60s for tracker writes. State saved to ./state/.)

# Run 2 (and forever) — replay.
bun run index.ts --resume
```

## What it does

- **Capture mode (default).** Launches a session, runs the interactive login, idles 60 s for site-side trackers to debounce-write their state, then snapshots `Session.cookies` + `Page.localStorage` to `state/example-cookies.json` + `state/example-storage.json`.
- **Replay mode (`--resume`).** Loads cookies BEFORE any `goto` (Storage.setCookies works on the root browser target — no tab needed). Navigates to `TARGET_ORIGIN` first, THEN writes localStorage (DOMStorage requires a non-opaque origin). Then navigates to the protected route — already warm.
- Uses the same `pattern` regex on save and load — mismatched patterns leak cookies from outside the scope.

## Files

- `index.ts` — the script (mode flag via `Bun.argv.includes("--resume")`)
- `.env.example` — copy to `.env` and fill placeholders
- `package.json` — published-package deps; copy this folder anywhere and it works

## See also

- Cookbook recipe: https://mochijs.com/docs/guides/recipe-warm-session-replay
- Decision matrix: https://mochijs.com/docs/guides/pick-a-scenario
- Limits + honest cut: https://mochijs.com/docs/reference/limits
