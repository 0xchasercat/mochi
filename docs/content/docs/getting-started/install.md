---
title: Installation
description: Add mochi.js to a Bun project, install the pinned Chromium-for-Testing binary, and confirm the launch path works end-to-end.
order: 1
category: getting-started
lastUpdated: 2026-05-09
---

mochi.js is Bun-only — `bun >= 1.1`. Node and Deno are not targets ([invariant I-3](/docs/concepts/stealth-philosophy)). If `bun --version` errors, install Bun first: <https://bun.sh>.

## Linux server prerequisites

If you're deploying to a Linux server, container, or CI runner: read [Linux server deployment](/docs/getting-started/linux-server) first. It covers the `headlessMode: "new"` auto-detection, the apt deps you'll need on Ubuntu / Debian, the root + sandbox case, and the minimal Dockerfile. Skip that page on macOS / Windows — both ship the equivalents via the OS itself; nothing to install.

### Linux runtime dependencies

`Chromium-for-Testing` ships the binary only — not the system libs. On `debian:bookworm-slim` and similar minimal images you'll need:

```sh
sudo apt-get install -y --no-install-recommends \
  ca-certificates fonts-liberation libasound2t64 libatk-bridge2.0-0 \
  libatk1.0-0 libcairo2 libcups2 libdbus-1-3 libexpat1 libfontconfig1 \
  libgbm1 libglib2.0-0 libgtk-3-0 libnspr4 libnss3 libpango-1.0-0 \
  libpangocairo-1.0-0 libx11-6 libx11-xcb1 libxcb1 libxcomposite1 \
  libxcursor1 libxdamage1 libxext6 libxfixes3 libxi6 libxrandr2 \
  libxrender1 libxss1 libxtst6 xdg-utils
```

`mochi browsers install` runs a `--version` smoke after extraction; on a missing-lib host it prints the exact apt line and exits non-zero so the failure is loud and actionable.

### Linux gotcha — Chromium and root

Most server containers run as root by default. Chromium's user-namespace sandbox refuses to initialize under uid 0 without help; mochi auto-adds `--no-sandbox` in that case so the launch doesn't crash on first run. The cost is small but real: `--no-sandbox` is a fingerprintable command-line surface (PLAN.md §8.6). Three ways to avoid the auto-fallback in production:

- **Run the container as a non-root user** — `USER node` (or any uid > 0) in the Dockerfile.
- **Provision the SUID `chrome-sandbox` helper** — distro-dependent setup; survives the sandbox check without `--no-sandbox`.
- **Grant `--cap-add=SYS_ADMIN`** — broad capability; only do this when you trust the workload.

Pass `allowRootWithSandbox: true` to `mochi.launch` to opt out of the auto-fallback (the launch will then crash on a misconfigured SUID setup, which is the right failure mode when you're enforcing a specific posture).

## Add the packages

```sh
bun add @mochi.js/core @mochi.js/cli
```

`@mochi.js/core` is the public entry point — `mochi.launch`, `Session`, `Page`. `@mochi.js/cli` exposes the `mochi` binary used to install Chromium and run the harness.

If `bun add` fails with `Workspace dependency not found`, you're on `v0.1.0` (which leaked `workspace:*` into published `package.json` files). Upgrade:

```sh
bun add @mochi.js/core@latest @mochi.js/cli@latest
```

## Install Chromium-for-Testing

```sh
bunx mochi browsers install
```

This downloads the pinned [Chromium-for-Testing](https://googlechromelabs.github.io/chrome-for-testing/) build for your platform into `~/.mochi/browsers/`. Subsequent runs are cached. The pinned version is the only build the consistency engine has been validated against — installing your own Chrome works (`binary: <path>` on `mochi.launch`) but takes you off the certified surface.

There is no native code to compile, no FFI bridge to install, no Rust toolchain to provision. `Session.fetch` rides Chromium's own network stack via CDP — install the browser, you have JA4-coherent fetch.

## Confirm it works

`profile` is optional in `mochi.launch()` — when omitted, mochi consults `process.platform` / `process.arch` and auto-picks the host-OS-matching real-device profile (Linux x64 → `linux-chrome-stable`, Mac arm64 → `mac-m4-chrome-stable`, Mac x64 → `mac-chrome-stable`, Windows x64 → `windows-chrome-stable`). On unsupported hosts (Linux arm64 today, FreeBSD, Alpine musl, Windows arm64) launch throws with a precise diagnostic and a pointer to [Choose your profile](/docs/guides/choose-your-profile). Most setups don't need to type `profile: "linux-chrome-stable"` explicitly — passing the id still wins when you want it. The architectural rationale lives in [Stealth philosophy → Default to the host OS](/docs/concepts/stealth-philosophy#default-to-the-host-os-not-windows). Use `mochi.defaultProfileForHost()` to introspect the pick before launching.

```ts
// hello-mochi.ts
import { mochi } from "@mochi.js/core";

const session = await mochi.launch({
  profile: "linux-chrome-stable",
  seed: "user-12345",
});
try {
  const page = await session.newPage();
  await page.goto("https://httpbin.org/headers");
  console.log("UA:", session.profile.userAgent);
  console.log("Locale:", session.profile.locale);
} finally {
  await session.close();
}
```

```sh
bun run hello-mochi.ts
```

You should see a Chrome-shaped UA string and a locale matching the profile. If the launch hangs or errors, jump to [Quickstart § Troubleshooting](/docs/getting-started/quickstart#troubleshooting) for the common failure modes.

## What you just installed

- A CDP transport over `--remote-debugging-pipe` FDs — no TCP port, no `Runtime.enable`. See [The inject pipeline](/docs/concepts/inject-pipeline).
- A 48-rule [consistency engine](/docs/concepts/consistency-engine) that derives a coherent fingerprint matrix from `(profile, seed)`.
- A JIT-friendly [inject payload](/docs/concepts/inject-pipeline) delivered via `Fetch.fulfillRequest` body splice on Document responses (with `addScriptToEvaluateOnNewDocument({ runImmediately: true, worldName: "" })` fallback for `about:blank` and other non-HTTP nav targets) before any page script runs.
- A [behavioral synth](/docs/concepts/behavioral-synth) (Bezier+Fitts trajectories, lognormal digraph delays) wired into `Page.humanClick` / `humanType` / `humanScroll`.
- A Chromium-native `session.fetch` that routes through the browser's own network stack via CDP — JA4 / JA3 / H2 are real Chrome by definition.

## BYO Chromium

`mochi.launch({ binary: "/path/to/chrome" })` overrides the resolved Chromium-for-Testing binary. Useful for:

- Running against a vendored CfT cached outside `~/.cache/mochi/`.
- Testing against a specific Chromium build (e.g., a custom-compiled Chromium on a CI runner).
- Running against a stable Chrome installation rather than CfT (note: takes you off the harness-certified surface; the consistency engine is validated against the pinned CfT build).

The launch path checks the binary version against `ProfileV1.browser.minVersion` / `maxVersion` and emits a warning if outside the validated range. See [Profiles](/docs/concepts/profiles).

## Next

- [Quickstart](/docs/getting-started/quickstart) — five-minute end-to-end recipe.
- [Your first session](/docs/getting-started/first-session) — drill into the session lifecycle.
- [Linux server deployment](/docs/getting-started/linux-server) — apt deps, root sandbox, Docker.
- [Is mochi for me?](/docs/getting-started/is-mochi-for-me) — choosing between mochi and a peer.

<!-- llm-context:start
This page covers npm install of @mochi.js/core + @mochi.js/cli and the `mochi browsers install` step.

Key install commands (verified):
- bun add @mochi.js/core @mochi.js/cli
- bunx mochi browsers install

Default install paths:
- Chromium-for-Testing: ~/.mochi/browsers/<version>/chrome-<platform>/

LaunchOptions.binary: string  (override the auto-resolved CfT binary)

Common LLM hallucinations to avoid:
- "npm install @mochi.js/core" — works at the bun-aliased level but mochi engines field rejects non-Bun installs. Use bun add.
- "mochi browsers install --version=<n>" — flag does not exist; CfT version is pinned per @mochi.js/cli release.
- "Use puppeteer's bundled Chromium" — the CfT binary is the only one validated by the harness. Override via binary: <path> if you must.
- "Add @mochi.js/profiles to install profiles separately" — profiles are bundled inside @mochi.js/profiles which is a transitive dep of @mochi.js/core. Don't install separately.
- "Run mochi as root" — works with auto-no-sandbox fallback but logs a fingerprint-leak warning. See linux-server.md.
- "bunx mochi pm trust @mochi.js/net-rs" — that package is gone; there is no Rust cdylib to install or trust post-0.7.

Cross-references:
- /docs/getting-started/quickstart
- /docs/getting-started/first-session
- /docs/getting-started/linux-server
- /docs/getting-started/is-mochi-for-me
- /docs/concepts/inject-pipeline
- /docs/concepts/consistency-engine
- /docs/concepts/behavioral-synth
- /docs/concepts/profiles
- /docs/reference/limits
llm-context:end -->
