---
title: Installation
description: Add mochi.js to a Bun project, install the pinned Chromium-for-Testing binary, and confirm the FFI bridge resolves.
order: 1
category: getting-started
lastUpdated: 2026-05-09
---

mochi.js is Bun-only — `bun >= 1.1`. Node and Deno are not targets (invariant **I-3**). If `bun --version` errors, install Bun first: <https://bun.sh>.

## Linux prerequisites

Skip this section on macOS / Windows — both ship the equivalents via the OS itself. On Linux, the order matters: **install Bun → install runtime deps (below) → `bun add` → `mochi browsers install`**. Skipping the deps step gives you two consecutive opaque crashes — first the sandbox refusal under root, then `BrowserCrashedError` from missing system libs.

### Linux gotcha — Chromium and root

Chromium refuses to start as root unless its user-namespace sandbox is disabled or replaced. If `mochi.launch()` dies with `EPIPE: broken pipe` immediately after spawn, you're hitting this. In order of preference:

1. **Run as a non-root user** — what every production setup should do anyway.
2. **`chmod 4755 chrome-sandbox`** on the SUID helper next to the CfT binary. Distro-dependent.
3. **Pass `args: ["--no-sandbox"]` to `mochi.launch()`** — fastest dev workaround, but `--no-sandbox` is a [fingerprint leak](/docs/reference/limits) (PLAN §8.6 omits it from defaults). Acceptable for testing, not for stealth-critical production. Set via env: `MOCHI_EXTRA_ARGS=--no-sandbox`.

`mochi browsers install` warns if it detects `uid === 0` so you see this gotcha at install time, not at first launch.

### Linux runtime dependencies

Chromium-for-Testing ships only the binary. On a fresh Ubuntu / Debian server the system libs Chromium links against are not preinstalled — `mochi.launch()` will die with `BrowserCrashedError` (Chromium aborts with `error while loading shared libraries: libnss3.so` or similar; the parent sees the CDP pipe close). v0.1.5+ runs a post-extract `--version` smoke that prints the exact apt line and exits non-zero on this case; you can also install up front:

```sh
sudo apt-get update -qq && sudo apt-get install -y --no-install-recommends \
  ca-certificates fonts-liberation libasound2t64 libatk-bridge2.0-0 \
  libatk1.0-0 libcairo2 libcups2 libdbus-1-3 libexpat1 libfontconfig1 \
  libgbm1 libglib2.0-0 libgtk-3-0 libnspr4 libnss3 libpango-1.0-0 \
  libpangocairo-1.0-0 libx11-6 libx11-xcb1 libxcb1 libxcomposite1 \
  libxcursor1 libxdamage1 libxext6 libxfixes3 libxi6 libxrandr2 \
  libxrender1 libxss1 libxtst6 xdg-utils
```

The CLI does NOT auto-`sudo` — sudo escalation belongs to you, not to the tool. The list above mirrors what mochi's CI installs on every PR (see `.github/workflows/pr-fast.yml`); a contract test diffs the two so they don't drift.

## Add the packages

```sh
bun add @mochi.js/core @mochi.js/cli
```

`@mochi.js/core` is the public entry point — `mochi.launch`, `Session`, `Page`. `@mochi.js/cli` exposes the `mochi` binary used to install Chromium and run the harness.

## Install Chromium-for-Testing

```sh
bunx mochi browsers install
```

This downloads the pinned [Chromium-for-Testing](https://googlechromelabs.github.io/chrome-for-testing/) build for your platform into `~/.mochi/browsers/`. Subsequent runs are cached. The pinned version is the only build the consistency engine has been validated against — installing your own Chrome works (`binary: <path>` on `mochi.launch`) but takes you off the certified surface.

The first install also unpacks the `@mochi.js/net-rs` cdylib (Rust crate wrapping [`wreq`](https://github.com/0x676e67/wreq)) for the JA4-coherent fetch path. Prebuilt binaries ship for `darwin-arm64`, `darwin-x64`, `linux-x64`, `linux-arm64`, and `win32-x64`. Anything else falls back to `cargo build --release` from `packages/net-rs/` — see [Limits](/docs/reference/limits) for the platform matrix.

## Confirm it works

```ts
// hello-mochi.ts
import { mochi } from "@mochi.js/core";

const session = await mochi.launch({
  profile: "linux-chrome-stable",
  seed: "user-12345",
});

const page = await session.newPage();
await page.goto("https://httpbin.org/headers");

console.log("UA:", session.profile.userAgent);
console.log("Locale:", session.profile.locale);

await session.close();
```

```sh
bun run hello-mochi.ts
```

You should see a Chrome-shaped UA string and a locale matching the profile. If the launch hangs or errors, jump to [Your first session](/docs/getting-started/first-session) for the full troubleshooting walkthrough.

## What you just installed

- A CDP transport over `--remote-debugging-pipe` FDs — no TCP port, no `Runtime.enable`.
- A 40-rule consistency engine that derives a coherent fingerprint matrix from `(profile, seed)`.
- A JIT-friendly inject payload installed via `Page.addScriptToEvaluateOnNewDocument({ runImmediately: true })` before any page script runs.
- A behavioral synth (Bezier+Fitts trajectories, lognormal digraph delays) wired into `Page.humanClick`/`humanType`/`humanScroll`.
- A Rust-backed `Session.fetch` that mirrors the spoofed Chrome's TLS/H2 fingerprint.

## Next

Continue to [Your first session](/docs/getting-started/first-session) for a full walkthrough — profile selection, navigation, behavioral input, and reading the Probe Manifest.
