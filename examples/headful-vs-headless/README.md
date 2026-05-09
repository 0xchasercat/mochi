# Headful vs Headless

Flag-based switch between `headlessMode: "new"` (default) and `"off"` (real headful) — same script, different rendering path.

This example pairs with the [Headful vs headless](https://mochijs.com/docs/guides/recipe-headful-vs-headless) cookbook page. Read that page for the full walkthrough; this folder is the runnable form.

## Run

```sh
bun install

# Default — env-aware (server: "new", desktop: "off").
bun run index.ts

# Real headful (visible window). Requires a display server or xvfb-run.
MOCHI_HEADLESS=off bun run index.ts
```

## What it does

- Reads `MOCHI_HEADLESS` from the env (one of `"new"` / `"legacy"` / `"off"` / unset).
- Calls `mochi.detectLinuxServerEnv()` to print the same probe `mochi.launch` runs internally so you can see why it chose what it chose.
- Launches a session with `headlessMode` pinned (or undefined to let mochi pick from env).
- Logs the resolved profile id + behavioral knobs (`tremor`, `wpm`) so the trade-off is concrete.
- Navigates to `https://example.com/`, waits for `h1`, and writes a full-page PNG to `out/page.png`.

Trade-offs:

- **`"new"`** — production default on servers. Full rendering, GPU compositor, near-byte-identical to headful for fingerprinting.
- **`"legacy"`** — old `--headless` (no `=new`). Detectable. Only for parity with old tooling; don't pick this.
- **`"off"`** — real headful. Requires `DISPLAY` / `WAYLAND_DISPLAY` (or `xvfb-run`). Slower spawn, more memory, but the most "real" rendering path. Use for debugging / screencast / visual-regression testing.

## Files

- `index.ts` — the script
- `.env.example` — copy to `.env` and fill placeholders
- `package.json` — published-package deps; copy this folder anywhere and it works

## See also

- Cookbook recipe: https://mochijs.com/docs/guides/recipe-headful-vs-headless
- Decision matrix: https://mochijs.com/docs/guides/pick-a-scenario
- Limits + honest cut: https://mochijs.com/docs/reference/limits
