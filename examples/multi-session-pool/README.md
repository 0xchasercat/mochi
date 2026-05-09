# Multi-Session Pool

Fan out N parallel mochi sessions with deterministic seeds (`pool-${i}-${RUN_ID}`), each draining a shared URL queue with per-session error isolation.

This example pairs with the [Multi-session pool](https://mochijs.com/docs/guides/recipe-multi-session-pool) cookbook page. Read that page for the full walkthrough; this folder is the runnable form.

> **Memory caveat.** Each session is one Chromium child, ~150–300 MB resident. A pool of 8 is ~1.5–2.5 GB. On a 4 GB CI runner cap at 4–6 to avoid OOM.

## Run

```sh
cp .env.example .env  # set POOL_SIZE / RUN_ID
bun install
bun run index.ts
```

## What it does

- Builds a fixed pool of `POOL_SIZE` async workers, each draining a shared URL queue via `queue.shift()`.
- For every URL, launches a fresh `Session` (fresh Chromium child, fresh user-data-dir, fresh derived Matrix) — true isolation between visits.
- Wraps each visit in `try/catch/finally` so errors return as `JobResult` records and the session always closes.
- Wraps the worker fan-out in `Promise.allSettled` so one worker crash doesn't void the rest.
- Writes `out/results.json` with per-URL status, byte counts, and error strings.

## Files

- `index.ts` — the script
- `.env.example` — copy to `.env` and fill placeholders
- `package.json` — published-package deps; copy this folder anywhere and it works

## See also

- Cookbook recipe: https://mochijs.com/docs/guides/recipe-multi-session-pool
- Decision matrix: https://mochijs.com/docs/guides/pick-a-scenario
- Limits + honest cut: https://mochijs.com/docs/reference/limits
