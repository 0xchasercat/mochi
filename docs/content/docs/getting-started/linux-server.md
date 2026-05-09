---
title: Linux server deployment
description: Run mochi.launch on a fresh Ubuntu / Debian server. mochi auto-detects no-DISPLAY, defaults to --headless=new, and the headlessMode option lets you override.
order: 4
category: getting-started
lastUpdated: 2026-05-09
---

The common deployment path for mochi is a Linux server — Ubuntu / Debian box, no display, often inside a container. mochi auto-detects this and switches Chromium to `--headless=new` so `mochi.launch()` Just Works on the first try.

## What mochi auto-detects

At launch time mochi snapshots three orthogonal signals from the host:

| Signal | What it means | What mochi does |
|---|---|---|
| `process.platform === "linux"` AND no `DISPLAY` AND no `WAYLAND_DISPLAY` | Server-no-display | Default `headlessMode` to `"new"` (full-rendering modern headless). Logs a one-line warning naming the inferred mode. |
| `process.getuid?.() === 0` (Linux) | Running as root | Auto-add `--no-sandbox` (with a warning naming the [fingerprint cost](/docs/getting-started/install#linux-gotcha--chromium-and-root)). Pre-existing behavior; orthogonal to headless dispatch. |
| `/.dockerenv` exists OR `/proc/1/cgroup` mentions `docker | containerd | kubepods` | Containerised | Surfaced in the debug rationale only. A container with `DISPLAY` set is still a "with display" environment. |

You can introspect what mochi inferred without launching:

```ts
import { mochi } from "@mochi.js/core";

const env = mochi.detectLinuxServerEnv();
// { serverNoDisplay: true, root: false, container: true,
//   rationale: "platform=linux display=(unset) waylandDisplay=(unset) ..." }
```

`detectLinuxServerEnv()` is a pure read of `process.platform`, `process.env.DISPLAY`, `process.env.WAYLAND_DISPLAY`, `process.getuid?.()`, and the container probe paths. No side effects, safe to call before any launch.

## The `headlessMode` option

`LaunchOptions.headlessMode` takes one of three values:

```ts
type HeadlessMode = "new" | "legacy" | "off";
```

| Value | Chromium flag emitted | When to use |
|---|---|---|
| `"new"` | `--headless=new` | The right default on a server. Full rendering, near-byte-identical to headful for fingerprinting (the legacy `--headless` is a separate, more-detectable code path). |
| `"legacy"` | `--headless` (no `=new`) | Parity with older tooling that depends on the legacy code path. Documented but not recommended — the modern path is what production should use. |
| `"off"` | (no headless flag) | Run headful. Requires a real display server (X11 `DISPLAY`, Wayland `WAYLAND_DISPLAY`) or [xvfb](#when-you-actually-need-xvfb). |

Resolution order — explicit wins, env-aware default at the bottom:

1. **Explicit `headlessMode`** — caller knows what they want, mochi honors it.
2. **Legacy `headless: true | false`** — `true` → `"new"`, `false` → `"off"`. Retained for v0.1 callers.
3. **Env default** — Linux without `DISPLAY` / `WAYLAND_DISPLAY` → `"new"`; everywhere else → `"off"`.

Examples:

```ts
// Server box with no display: defaults to --headless=new automatically.
await mochi.launch({ profile: "linux-chrome-stable", seed: "abc" });

// Force headful on a server (you'd better have xvfb running).
await mochi.launch({ profile: "linux-chrome-stable", seed: "abc", headlessMode: "off" });

// Force the legacy headless code path for parity testing.
await mochi.launch({ profile: "linux-chrome-stable", seed: "abc", headlessMode: "legacy" });

// Dev workstation with DISPLAY set: defaults to headful. Force headless explicitly:
await mochi.launch({ profile: "linux-chrome-stable", seed: "abc", headlessMode: "new" });
```

### Stealth note

`--headless=new` exposes a `HeadlessChrome` substring in the bare Chromium UA. mochi rewrites the UA via CDP `Network.setUserAgentOverride` (and the matching `Sec-CH-UA*` headers via `userAgentMetadata` per task 0261) so the bytes the network sees match the matrix's browser channel — **the `HeadlessChrome` token never leaves the process**. The stealth conformance gate (`webdriver-detection.test.ts`) runs against `--headless=new` and asserts `navigator.userAgent` does not contain `"HeadlessChrome"`. That gate stays green.

## When you actually need xvfb

`xvfb` (X Virtual FrameBuffer) is **not required for fingerprint stealth** under mochi — `--headless=new` produces near-identical rendering to headful, and the inject pipeline closes the JS-layer gaps. You only want xvfb when:

- You're testing window-manager interactions (chrome window state, multi-monitor geometry, OS-level focus events).
- You hit a very specific legacy-headless quirk that the new headless code path doesn't reproduce — rare, usually older Chromium ext / DRM-licensed-content bugs.
- You're running screencast-related workflows that need a full display server upstream of Chromium.

If you're in one of those buckets, the setup is:

```sh
sudo apt-get install -y xvfb
Xvfb :99 -screen 0 1920x1080x24 &
DISPLAY=:99 bun run app.ts
```

With `DISPLAY=:99` set, mochi will see a display, default `headlessMode` to `"off"`, and Chromium will spawn headful against the virtual framebuffer.

## Containers (Docker / Kubernetes)

mochi runs cleanly in containers. The two failure modes you'll hit are the same as on a bare server, just expressed through container syscall plumbing:

1. **Sandbox refusal under root.** Most container images run as root by default. mochi's auto-`--no-sandbox` fallback fires here — you'll see one warning line on launch (the fingerprint cost is documented at [Installation § Linux gotcha](/docs/getting-started/install#linux-gotcha--chromium-and-root)). Three ways out, in order of preference:

   - Run the container as a non-root user (`USER node` or similar in your Dockerfile).
   - Add the SUID `chrome-sandbox` helper (distro-dependent setup).
   - Or grant the container `--cap-add=SYS_ADMIN` so the user-namespace sandbox can initialize without escalating privileges. **Trade-off:** `SYS_ADMIN` is a broad capability — only do this when you trust the workload.

2. **Missing system libs.** `Chromium-for-Testing` ships only the binary; on a `FROM debian:bookworm-slim` base you'll need the runtime deps. The full apt line lives at [Installation § Linux runtime dependencies](/docs/getting-started/install#linux-runtime-dependencies). `mochi browsers install` runs a post-extract `--version` smoke that prints the exact line and exits non-zero on this case.

A minimal Dockerfile that works:

```dockerfile
FROM oven/bun:1.1
RUN apt-get update -qq && apt-get install -y --no-install-recommends \
      ca-certificates fonts-liberation libasound2t64 libatk-bridge2.0-0 \
      libatk1.0-0 libcairo2 libcups2 libdbus-1-3 libexpat1 libfontconfig1 \
      libgbm1 libglib2.0-0 libgtk-3-0 libnspr4 libnss3 libpango-1.0-0 \
      libpangocairo-1.0-0 libx11-6 libx11-xcb1 libxcb1 libxcomposite1 \
      libxcursor1 libxdamage1 libxext6 libxfixes3 libxi6 libxrandr2 \
      libxrender1 libxss1 libxtst6 xdg-utils \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY . .
RUN bun install && bunx mochi browsers install
CMD ["bun", "run", "app.ts"]
```

## Troubleshooting

**"Linux server detected (no DISPLAY / WAYLAND_DISPLAY) — defaulting to --headless=new"** — this is the env-aware default doing its job. Pass `headlessMode: "off"` if you have a display server you want to attach to.

**`EPIPE: broken pipe` immediately after `mochi.launch()`** — usually the root + no-sandbox case. See [Installation § Linux gotcha](/docs/getting-started/install#linux-gotcha--chromium-and-root). The early-exit diagnostic in `proc.ts` heuristic-classifies this and surfaces a remediation hint when it can.

**Chromium starts but pages render blank under `--headless=new`** — confirm you're on Chromium 118+. The pinned `mochi browsers install` build is well past that floor; if you've overridden with `binary: <path>`, check the version.

**`navigator.userAgent` shows `HeadlessChrome`** — should not happen with mochi (the inject layer rewrites the UA). If you see it, either `bypassInject: true` is set or the inject failed; check the conformance suite (`bun run conformance:stealth`).

## Next

- [Installation](/docs/getting-started/install) — the apt deps and the root + sandbox fallback.
- [Your first session](/docs/getting-started/first-session) — full API walkthrough.
- [`docs/limits.md`](/docs/reference/limits) — every known limit and workaround.
