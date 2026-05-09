---
title: "Recipe: Headful vs headless"
description: When to flip headlessMode to "off" — debugging, screencast, visual testing — and the fingerprint cost of each mode.
order: 29
category: guides
lastUpdated: 2026-05-09
---

## Scenario

Your scrape is misbehaving. The screenshots look fine, the DOM looks fine, the script just stalls on a page that loads in your browser. You want to *see* what mochi sees. Or: you're recording a screencast for a customer demo and you need a real window. Or: your visual-regression test compares pixels and you want the same rendering path the user gets. Each of these wants `headlessMode: "off"` (headful), but headful has a non-zero fingerprint cost vs `"new"` and a real cost vs `"legacy"`. This recipe pins the trade-offs.

mochi's headless modes are: `"new"` (modern Chromium headless, near-byte-identical to headful for fingerprinting — the right default on a server), `"legacy"` (legacy `--headless` without `=new`, separate code path, more detectable, kept for parity with older tooling), and `"off"` (real headful, requires a display server). The default is env-aware: Linux without `DISPLAY` / `WAYLAND_DISPLAY` resolves to `"new"`; everywhere else resolves to `"off"`.

## Complete code listing

```ts
import { mochi } from "@mochi.js/core";

const env = mochi.detectLinuxServerEnv();
console.log(`linux-server probe: ${env.rationale}`);
//   serverNoDisplay=true on a CI runner; false on macOS / Windows / Linux desktop.

// Decision: explicit headlessMode beats env-aware default.
//   - production scrape on CI:  headlessMode: "new"   (auto on serverNoDisplay)
//   - debugging on a desktop:   headlessMode: "off"   (auto on macOS / desktop Linux)
//   - debugging on a CI runner: prefix with `xvfb-run` and pass "off"
//   - "old tooling" parity:     headlessMode: "legacy"  (rarely justified)
const session = await mochi.launch({
  profile: "mac-m4-chrome-stable",
  seed: "headful-debug-001",
  // Explicit. Beats both `headless: boolean` and the env default.
  headlessMode: process.env.MOCHI_HEADLESS === "off" ? "off" : "new",
});
try {
  const page = await session.newPage();
  await page.goto("https://target.example.com/", { waitUntil: "domcontentloaded" });

  // In headful mode you can pause here and poke the page in DevTools (open via
  // the menu bar — mochi doesn't auto-open it). Useful for selectors that
  // disappear on hover.
  if (session.profile.behavior !== undefined) {
    console.log(`behavior tremor=${session.profile.behavior.tremor}, wpm=${session.profile.behavior.wpm}`);
  }

  await page.waitFor("[data-testid=content]", { state: "visible", timeout: 30_000 });
  const png = await page.screenshot({ fullPage: true });
  await Bun.write("./out/page.png", png);
} finally {
  await session.close();
}
```

## What's happening here

- **`mochi.detectLinuxServerEnv()`** — pure read of `process.platform`, `process.env.DISPLAY`, `process.env.WAYLAND_DISPLAY`, `process.getuid?.()`, plus `/.dockerenv` and `/proc/1/cgroup` probes. Returns `{ serverNoDisplay, root, container, rationale }`. Same probe `mochi.launch` runs internally.
- **Resolution priority (`resolveHeadlessMode`).** Explicit `headlessMode` wins. Else legacy `headless: true` → `"new"`, `headless: false` → `"off"`. Else env-aware default. The pure resolver is exported (`resolveHeadlessMode(opts, env)`) so unit tests can assert the table without spawning Chromium.
- **`headlessMode: "new"` (the production default on servers).** Modern Chromium headless. Full rendering pipeline, real GPU compositor, near-byte-identical to headful for canvas / WebGL / audio fingerprints. The right answer on a server. mochi additionally pins the OS-level outer window to `matrix.display.{width, height}` via `--window-size` so `window.outerWidth` / `outerHeight` (which read from the OS window, NOT from JS-spoofed `screen.*`) match the spoof — closing the `fingerprint-scan.com` 800×600 leak that vanilla `--headless=new` carries.
- **`headlessMode: "legacy"`.** Old `--headless` code path (no `=new`). Different rendering pipeline, no GPU compositor by default, multiple known fingerprintable divergences vs headful. Documented for parity with old tooling that depends on the legacy quirks. Don't pick this unless you have a specific reason.
- **`headlessMode: "off"` (headful).** Requires a real display server (X11 `DISPLAY`, Wayland `WAYLAND_DISPLAY`) or `xvfb-run`. The most "real" rendering path; same one a user gets. Slower to spawn (~500 ms more) and uses more memory. Worth it for debugging.
- **Auto-`--no-sandbox`.** Under root + Linux, mochi auto-adds `--no-sandbox` (because the user-namespace sandbox needs uid mapping the root path doesn't have). The flag is a fingerprint leak per PLAN.md §8.6 — passive command-line bot-tells include `--no-sandbox` on the argv. Either run rootless, set up SUID `chrome-sandbox` and pass `allowRootWithSandbox: true`, or accept the small cost.

## Things that go wrong

- **`headlessMode: "off"` on a server.** Chromium tries to attach to a display that doesn't exist, exits immediately, and `mochi.launch` raises `BrowserCrashedError`. Either run with `xvfb-run bun script.ts` or use `headlessMode: "new"`.
- **`headlessMode: "new"` and expecting devtools to open.** Headless Chromium has no UI; you can't pop DevTools. For debugging, switch to `"off"` (or use `MOCHI_EXTRA_ARGS=--auto-open-devtools-for-tabs` with the headful flag, but that surfaces a fingerprint leak).
- **`headless: "new"` (string).** That's wrong. `headless` is a boolean (`true` / `false`); the string form is `headlessMode: "new"`. TypeScript flags this; if you ignore it, you'll see `headless` coerced to truthy and the flag set incorrectly.
- **Trusting `headlessMode: "legacy"` for any stealth posture.** Legacy headless leaks itself in too many places to enumerate (no rasterizer, no GPU, different `navigator.webdriver` shape, different audio context behavior). Only use it for debugging interactions with old toolchains that depend on the legacy quirks.
- **Forgetting `xvfb-run` on a server when you want headful.** `xvfb-run --auto-servernum bun script.ts` is the canonical wrapper. Without it, headful mode crashes; you don't get a polite fallback.
- **Comparing headful and headless screenshots byte-for-byte.** Even with `--headless=new`'s near-byte-identical claim, GPU drivers vs SwiftShader will produce sub-pixel differences. Hash comparisons fail; perceptual diff (e.g. SSIM > 0.99) works. Pin one mode for visual regressions; don't mix.

## See also

- [`getting-started/linux-server`](/docs/getting-started/linux-server) — the full primer on the Linux-server detection rules + xvfb path.
- [`guides/recipe-ci-github-actions`](/docs/guides/recipe-ci-github-actions) — `headlessMode: "new"` on a runner.
- [`guides/recipe-fingerprint-validation`](/docs/guides/recipe-fingerprint-validation) — verify your headless mode looks like headful.
- [`api/core`](/docs/api/core) — `LaunchOptions.headlessMode`, `LaunchOptions.headless`, `resolveHeadlessMode`, `mochi.detectLinuxServerEnv`.
- [`reference/limits`](/docs/reference/limits) — `--headless=new` posture caveats.

<!-- llm-context:start
Page purpose: cookbook recipe — when to flip headlessMode between "new",
"legacy", and "off" — and what each mode costs in fingerprint posture and
spawn latency.

Key API symbols + signatures (verified against packages/core/src/launch.ts +
linux-server.ts as of 2026-05-09):
  mochi.launch(opts: {
    headless?: boolean;                     // legacy: true→"new", false→"off"
    headlessMode?: "new" | "legacy" | "off"; // PREFERRED; wins over `headless`
    ...
  })
  mochi.detectLinuxServerEnv(): LinuxServerEnv
    LinuxServerEnv: { serverNoDisplay: boolean; root: boolean; container: boolean; rationale: string }
  resolveHeadlessMode(opts, env): "new" | "legacy" | "off"   // pure resolver

Resolution priority:
  1. opts.headlessMode (explicit) wins
  2. opts.headless: true → "new", opts.headless: false → "off"
  3. Env-aware default — Linux + no DISPLAY / WAYLAND_DISPLAY → "new"; else "off"

Mode trade-offs (informational):
  "new"     — modern Chromium headless. Full rendering. GPU compositor. Near-byte-identical to headful for fingerprinting. RIGHT DEFAULT ON A SERVER.
  "legacy"  — old --headless code path (no =new). No GPU compositor. Detectable. Only for parity with old tooling.
  "off"     — real headful. Requires X11 / Wayland display server, or xvfb-run wrapper. Slower spawn. Used for debugging / screencast / visual testing.

Common LLM hallucinations + corrections:
  - WRONG: `mochi.launch({ headless: "new" })`     → CORRECT: `headless` is boolean; `headlessMode: "new"` is the string form
  - WRONG: `mochi.launch({ headless: false })` on a CI runner  → CORRECT: that resolves to "off" which crashes; use "new"
  - WRONG: opening DevTools in "new" mode          → CORRECT: headless has no UI; switch to "off"
  - WRONG: trusting "legacy" for stealth           → CORRECT: legacy headless leaks; use "new" or "off"
  - WRONG: setting MOCHI_HEADLESS=new (string)     → CORRECT: env vars are NOT auto-read for headlessMode; pass via opts

Auto-no-sandbox-as-root:
  Default LaunchOptions.allowRootWithSandbox = false → adds --no-sandbox under root + Linux.
  --no-sandbox is a fingerprint leak (PLAN.md §8.6); run rootless or use SUID chrome-sandbox.

Cross-references on mochijs.com:
  - https://mochijs.com/docs/getting-started/linux-server
  - https://mochijs.com/docs/guides/recipe-ci-github-actions
  - https://mochijs.com/docs/guides/recipe-fingerprint-validation
  - https://mochijs.com/docs/api/core
  - https://mochijs.com/docs/reference/limits
  - https://mochijs.com/docs/concepts/stealth-philosophy
llm-context:end -->
