# CI / GitHub Actions

A working GitHub Actions workflow for running mochi — Bun setup, browser cache, apt deps, headless defaults — plus a one-liner test script the workflow runs.

This example pairs with the [GitHub Actions / CI runner](https://mochijs.com/docs/guides/recipe-ci-github-actions) cookbook page. Read that page for the full walkthrough; this folder is the runnable form.

## Run

The example's payload is the workflow file at `.github/workflows/example.yml`. To exercise the workflow:

```sh
# Locally, to verify the script works before pushing the workflow.
cp .env.example .env
bun install
bun run index.ts
```

To run in CI, copy this folder into a repo of yours, push, and trigger the workflow via `workflow_dispatch` or the cron schedule.

## What it does

- The workflow sets up Bun via `oven-sh/setup-bun@v2`, caches `~/.mochi/browsers` via `actions/cache@v4`, installs Chromium runtime deps via apt, and runs `bunx mochi browsers install`.
- The workflow targets `runs-on: ubuntu-latest` for portability — self-hosted runner pools use the same shape with a different runner label.
- `index.ts` calls `mochi.detectLinuxServerEnv()` (the introspection seam for "why am I auto-headless?"), launches with `headlessMode: "new"`, and dumps the page HTML to `out/page.html`. The workflow uploads `out/` as an artifact.

## Files

- `index.ts` — the runnable script
- `.github/workflows/example.yml` — the workflow file (the actual example)
- `.env.example` — copy to `.env` and fill placeholders
- `package.json` — published-package deps; copy this folder anywhere and it works

## See also

- Cookbook recipe: https://mochijs.com/docs/guides/recipe-ci-github-actions
- Decision matrix: https://mochijs.com/docs/guides/pick-a-scenario
- Limits + honest cut: https://mochijs.com/docs/reference/limits
