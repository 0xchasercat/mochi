---
title: Installation
description: Add mochi.js to a Bun project, install the pinned Chromium-for-Testing binary, and confirm the FFI bridge resolves.
order: 1
category: getting-started
lastUpdated: 2026-05-09
---

mochi.js is Bun-only — `bun >= 1.1`. Node and Deno are not targets (invariant **I-3**). If `bun --version` errors, install Bun first: <https://bun.sh>.

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
