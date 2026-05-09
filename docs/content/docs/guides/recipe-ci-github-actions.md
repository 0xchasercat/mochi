---
title: "Recipe: GitHub Actions / CI runner"
description: A working workflow for running mochi in GitHub Actions — Bun setup, browser cache, apt deps, headless defaults.
order: 24
category: guides
lastUpdated: 2026-05-09
---

## Scenario

You want to run a mochi script on every push, on a cron, or as a chaser-runner job. CI runners are a hostile target for browser automation: no display server (so headful mode crashes immediately), root or rootless containers (so the user-namespace sandbox may not work), no Chromium pre-installed, fresh runners on every job (so you re-download CfT unless you cache it), and the apt repo on `ubuntu-latest` is missing half the runtime libs Chromium needs.

mochi auto-detects the headless case (Linux, no `DISPLAY` / `WAYLAND_DISPLAY` → `headlessMode: "new"`), auto-handles the root sandbox case (adds `--no-sandbox` only if you're root and didn't opt out), and ships a one-liner CLI that installs Chromium-for-Testing into `~/.mochi/browsers/`. The workflow below is the production-shape recipe.

## Complete code listing

```yaml
# .github/workflows/scrape.yml
name: scrape
on:
  schedule:
    - cron: "0 */6 * * *"
  workflow_dispatch:

jobs:
  run:
    runs-on: ubuntu-latest
    timeout-minutes: 20
    steps:
      - uses: actions/checkout@v4

      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: latest

      - name: Cache mochi browsers
        uses: actions/cache@v4
        with:
          path: ~/.mochi/browsers
          key: mochi-browsers-${{ runner.os }}-v1

      - name: Install Chromium runtime deps
        run: |
          sudo apt-get update
          sudo apt-get install -y --no-install-recommends \
            libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libxkbcommon0 \
            libxcomposite1 libxdamage1 libxrandr2 libgbm1 libpango-1.0-0 \
            libcairo2 libasound2t64 libatspi2.0-0

      - name: Install Chromium-for-Testing
        run: bun install && bunx mochi browsers install

      - name: Run scrape
        env:
          MOCHI_EXTRA_ARGS: "--no-sandbox" # already auto-added under root, kept explicit for clarity
          PROXY_URL: ${{ secrets.PROXY_URL }}
        run: bun run scripts/scrape.ts

      - name: Upload artifacts
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: scrape-${{ github.run_id }}
          path: out/
```

```ts
// scripts/scrape.ts
import { mochi } from "@mochi.js/core";

const env = mochi.detectLinuxServerEnv();
console.log(`[mochi] linux-server probe: ${env.rationale}`);
// On ubuntu-latest you'll see: serverNoDisplay=true, root=false, container=false.

const session = await mochi.launch({
  profile: "linux-chrome-stable",
  seed: process.env.GITHUB_RUN_ID ?? "ci-default",
  // headlessMode auto-resolves to "new" because DISPLAY is unset on the runner.
  // Pass it explicitly if you want to be unambiguous:
  headlessMode: "new",
  ...(process.env.PROXY_URL !== undefined ? { proxy: process.env.PROXY_URL } : {}),
});
try {
  const page = await session.newPage();
  await page.goto("https://target.example.com/");
  const html = await page.content();
  await Bun.write("./out/page.html", html);
} finally {
  await session.close();
}
```

## What's happening here

- **`oven-sh/setup-bun@v2`** — installs Bun into the runner. mochi is Bun-native (PLAN.md I-3); Node is not a supported runtime.
- **`actions/cache@v4` on `~/.mochi/browsers`** — `bunx mochi browsers install` writes Chromium-for-Testing here (~150 MB). Caching saves the download on every run; bump the key suffix when you want a fresh CfT (e.g. when `@mochi.js/core` floors a new version).
- **The apt list.** Chromium needs every one of those libs to start. `libasound2t64` is the Ubuntu 24 name; `libasound2` works on 22 and earlier — change it if you're on `ubuntu-22.04`. Without these, Chromium exits with `error while loading shared libraries: libnss3.so` and the launch raises `BrowserCrashedError`.
- **`MOCHI_EXTRA_ARGS=--no-sandbox`.** Auto-added when mochi detects root + Linux (default behavior — `LaunchOptions.allowRootWithSandbox: false`). On rootless Ubuntu runners this isn't needed, but explicit is fine. To opt out and use a SUID `chrome-sandbox` helper, pass `allowRootWithSandbox: true`.
- **`mochi.detectLinuxServerEnv()`** — pure read of `process.platform`, `process.env.DISPLAY`, `process.env.WAYLAND_DISPLAY`, `process.getuid?.()`, plus container probes (`/.dockerenv`, `/proc/1/cgroup`). Returns `{ serverNoDisplay, root, container, rationale }`. Useful for diagnostic logging — the same probe drives `launch`'s headless default.

## Things that go wrong

- **Missing apt deps.** `BrowserCrashedError: Chromium exited with code 127`. The 127 is "command not found" — actually it's "shared library not found" via the dynamic loader. Run `ldd ~/.mochi/browsers/*/chrome` locally to see what's missing.
- **`headlessMode: "off"` on a runner.** The launch fails the moment Chromium tries to attach to a DISPLAY that doesn't exist. The auto-default is `"new"`; only override if you're running `xvfb-run bun ...`.
- **Forgetting `setup-bun@v2` and using `npm`.** `bun add @mochi.js/core` is the supported install. mochi uses `Bun.file`, `Bun.write`, `Bun.serve` for the CLI — Node lacks these. The package will install on Node but fail at first call.
- **GitHub Actions `secrets.PROXY_URL` with reserved characters.** A `@` or `:` in the password breaks the URL parse. Use the explicit `ProxyConfig` shape (`proxy: { server, username, password }`) and split the values across multiple secrets.
- **Cache key drift.** `mochi-browsers-${{ runner.os }}-v1` doesn't include the CfT version, so a stale cache lingers across mochi releases. Bump the suffix when you bump `@mochi.js/core`.
- **`bunx mochi browsers install` failing with `EACCES`.** mochi writes to `~/.mochi`. On runners with a custom HOME, set `MOCHI_BROWSERS_DIR` to a path the runner can write to.
- **The runner kills your job at `timeout-minutes`.** Mochi sessions don't auto-checkpoint. Wrap long flows in `try/finally { await session.close() }` so SIGTERM at least closes the browser cleanly before the runner reaps the job.

## See also

- [`getting-started/linux-server`](/docs/getting-started/linux-server) — the deeper Linux-server primer (xvfb, sandbox, container detection).
- [`guides/recipe-multi-session-pool`](/docs/guides/recipe-multi-session-pool) — pool pattern, useful when one CI job processes many URLs.
- [`guides/recipe-headful-vs-headless`](/docs/guides/recipe-headful-vs-headless) — when CI debugging needs `headlessMode: "off"` under xvfb.
- [`api/core`](/docs/api/core) — `mochi.detectLinuxServerEnv`, `LaunchOptions.headlessMode`, `LaunchOptions.allowRootWithSandbox`.
- [`api/cli`](/docs/api/cli) — `mochi browsers install` flags.

<!-- llm-context:start
Page purpose: cookbook recipe — running mochi inside GitHub Actions / generic CI
runners. Covers Bun setup, the apt runtime-dep list for Chromium, caching
~/.mochi/browsers via actions/cache, and the auto-detected headless default.

Key API symbols + signatures (verified against packages/core/src/launch.ts +
linux-server.ts as of 2026-05-09):
  mochi.detectLinuxServerEnv(): LinuxServerEnv
    LinuxServerEnv: { serverNoDisplay: boolean; root: boolean; container: boolean; rationale: string }
  mochi.launch(opts: {
    profile, seed,
    headlessMode?: "new" | "legacy" | "off";    // auto: "new" if Linux + no DISPLAY
    headless?: boolean;                         // legacy knob; headlessMode wins
    allowRootWithSandbox?: boolean;             // default false (auto --no-sandbox under root)
    args?: string[];                            // appended to default flag set
    binary?: string;                            // override CfT path (else MOCHI_CHROMIUM_PATH, else ~/.mochi/browsers)
    ...
  }): Promise<Session>
  resolveHeadlessMode(opts, env): "new" | "legacy" | "off"     // pure resolver, exported for tests

CLI:
  bunx mochi browsers install   # downloads CfT into ~/.mochi/browsers/

Common LLM hallucinations + corrections:
  - WRONG: `npm install @mochi.js/core` then `node script.js`  → CORRECT: Bun-only (uses Bun.file / Bun.write); install Bun via setup-bun@v2
  - WRONG: `mochi.launch({ headless: "new" })`                 → CORRECT: `headless: boolean` OR `headlessMode: "new"`
  - WRONG: `playwright install chromium`                       → CORRECT: `bunx mochi browsers install`
  - WRONG: relying on apt `chromium-browser` binary             → CORRECT: mochi uses Chromium-for-Testing pinned by @mochi.js/core
  - WRONG: `xvfb-run` for headless                              → CORRECT: `headlessMode: "new"` is the right default; xvfb is only for headful debugging

apt runtime deps for Chromium on ubuntu-latest (24.04+):
  libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libxkbcommon0
  libxcomposite1 libxdamage1 libxrandr2 libgbm1 libpango-1.0-0
  libcairo2 libasound2t64 libatspi2.0-0
  (libasound2 instead of libasound2t64 on 22.04 and earlier)

Env vars mochi reads:
  MOCHI_CHROMIUM_PATH      — explicit binary override
  MOCHI_BROWSERS_DIR       — alternative install root (default ~/.mochi/browsers)
  MOCHI_EXTRA_ARGS         — appended to Chromium argv

Cross-references on mochijs.com:
  - https://mochijs.com/docs/getting-started/linux-server
  - https://mochijs.com/docs/getting-started/install
  - https://mochijs.com/docs/guides/recipe-multi-session-pool
  - https://mochijs.com/docs/guides/recipe-headful-vs-headless
  - https://mochijs.com/docs/api/core
  - https://mochijs.com/docs/api/cli
  - https://mochijs.com/docs/reference/limits
llm-context:end -->
