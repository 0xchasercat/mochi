# Residential Proxy

Pipe a session through a residential / datacenter proxy with transparent HTTP / SOCKS5 auth, plus `geoConsistency` to close the IP-vs-timezone leak.

This example pairs with the [Residential proxy with geo reconciliation](https://mochijs.com/docs/guides/recipe-residential-proxy) cookbook page. Read that page for the full walkthrough; this folder is the runnable form.

## Run

```sh
cp .env.example .env  # set PROXY_URL with real credentials
bun install
bun run index.ts
```

## What it does

- Launches a `mac-m4-chrome-stable` session with `proxy: process.env.PROXY_URL` — credentials stripped from `--proxy-server` and replayed via CDP `Fetch.authRequired`.
- Sets `geoConsistency: "privacy-fallback"` (default) — on tz/locale mismatch with the proxy exit IP, the matrix overrides to UTC + en-US instead of leaking the canonical bot signature.
- Logs the resolved `session.profile.timezone` / `locale` after reconciliation so you can see what the page will actually see.
- Catches `GeoMismatchError` for users who switch to `geoConsistency: "strict"`.
- Makes an out-of-band `session.fetch` call on the same proxy with the same `wreqPreset` — JA4 stays coherent across the browser navigation and the side-channel API.

## Files

- `index.ts` — the script
- `.env.example` — copy to `.env` and fill placeholders
- `package.json` — published-package deps; copy this folder anywhere and it works

## See also

- Cookbook recipe: https://mochijs.com/docs/guides/recipe-residential-proxy
- Decision matrix: https://mochijs.com/docs/guides/pick-a-scenario
- Limits + honest cut: https://mochijs.com/docs/reference/limits
