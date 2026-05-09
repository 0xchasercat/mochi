---
title: Connect to an existing Chrome
description: Drive a Chromium mochi did NOT spawn — BrowserBase, dockerised Chrome, your own patched build, re-attach.
order: 1
category: guides
lastUpdated: 2026-05-09
---

`mochi.connect()` attaches to a Chromium that's already running and exposing a CDP browser endpoint over a WebSocket. Use it when:

- You're driving a remote browser fleet (BrowserBase, Browserless, your own gateway).
- Chromium runs in a Docker container you manage and you want mochi to drive it from outside the container.
- You've patched Chrome locally and want mochi to drive your build instead of the bundled Chromium-for-Testing.
- You launched a Chromium (with `--remote-debugging-port`) earlier in the same process and want to re-attach.

`session.close()` disconnects the WebSocket but leaves the browser running, matching `puppeteer.connect`'s convention. The browser keeps running.

## Direct WebSocket endpoint

If you already have the canonical `ws://…/devtools/browser/<id>` URL, pass it via `wsEndpoint`. This is the BrowserBase / Browserless shape:

```ts
import { mochi } from "@mochi.js/core";

const session = await mochi.connect({
  wsEndpoint: "wss://gateway.browserbase.com/devtools/browser/abc123",
  profile: "linux-chrome-stable",
  seed: "user-12345",
  // Auth tokens / mTLS for proxied gateways go on the upgrade headers:
  headers: { Authorization: "Bearer …" },
});

const page = await session.newPage();
await page.goto("https://example.com");

await session.close();   // disconnects the WS — browser keeps running
```

## HTTP discovery via `browserURL`

Pass `browserURL` (HTTP base) and mochi GETs `${browserURL}/json/version` to discover the WebSocket URL — same dance Puppeteer / Playwright run.

```ts
// Standard `chrome --remote-debugging-port=9222` setup, e.g. inside a docker container.
const session = await mochi.connect({
  browserURL: "http://localhost:9222",
  profile: "windows-chrome-stable",
  seed: "scrape-job-7",
});
```

## No-spoof mode

Pass `profile: null` to drive the remote browser through mochi's API (`humanClick`, `humanType`, `session.fetch`, the cookie jar, screenshots) **without layering any fingerprint override on top**. Mochi will not send `Network.setUserAgentOverride`, `Emulation.setTimezoneOverride`, the inject payload, or any other matrix-derived CDP call.

This is the right shape when:

- The remote browser already spoofs (BrowserBase profiles, your own patched build).
- You only want mochi for the API ergonomics, not the stealth layer.
- You're measuring a baseline against the bare browser.

```ts
const session = await mochi.connect({
  wsEndpoint: "ws://localhost:9222/devtools/browser/abc",
  profile: null,         // no spoof — drive the bare browser
});

// session.profile === null
// humanClick falls back to DEFAULT_BEHAVIOR from @mochi.js/behavioral.
const page = await session.newPage();
await page.goto("https://example.com");
await page.humanClick("button#submit");
await session.close();
```

## Power user: connect + spoof on top

You can pass an explicit profile + seed to `connect` to layer mochi's spoof onto a remote browser:

```ts
const session = await mochi.connect({
  wsEndpoint: "wss://gateway.browserbase.com/devtools/browser/abc",
  profile: "linux-chrome-stable",
  seed: "user-12345",
});
```

Mochi will derive a `MatrixV1` from `(profile, seed)`, install the inject pipeline (init-script body splice), send `Network.setUserAgentOverride` / `Emulation.setTimezoneOverride`, etc. — exactly like `mochi.launch`. This is the right shape when the remote browser doesn't spoof on its own and you want mochi's full stealth posture on top.

This composes both ways. If the remote browser does its own spoofing (BrowserBase profiles, etc.), passing a mochi profile here will produce a session whose UA / TZ / locale match `(profile, seed)` while every CDP-invisible signal (TLS JA4, OS-level network stack, native paint pipeline) reflects the remote browser. Test the combination against your fingerprint targets — there's no universal "best" mix.

## Validation

`mochi.connect` rejects with a clear message when:

- Neither `wsEndpoint` nor `browserURL` is supplied.
- `profile` is `undefined` (auto-pick keys off the *local* `process.platform`, which is meaningless for a remote browser whose host OS we don't know — pass an explicit profile or `null`).
- `profile` is set to a non-`null` value but `seed` is missing.
- `browserURL` is set but `${browserURL}/json/version` doesn't return a JSON body with `webSocketDebuggerUrl`.

Connection failures (DNS, ECONNREFUSED, TLS, 4xx upgrade rejection, timeout) surface as a `ConnectionLostError`, with the endpoint URL embedded in the message for diagnostics.

## What `connect` does NOT do

`ConnectOptions` deliberately omits launch-only fields:

- No `binary` — the browser is already running.
- No `headless` / `headlessMode` — set on the remote browser at its launch.
- No `proxy` — same; configure on the remote browser.
- No `args` / `extraArgs`, no `hermetic`, no `allowRootWithSandbox`, no `bypassInject` — all launcher-only knobs.

If you need any of these, control them at the remote browser's launch (or use `mochi.launch` instead).

## See also

- [`mochi.launch`](/docs/api/core#interface-launchoptions) — the spawn-and-attach sibling.
- [Stealth philosophy](/docs/concepts/stealth-philosophy) — when to spoof, when to skip.
- [`@mochi.js/behavioral` → `DEFAULT_BEHAVIOR`](/docs/api/behavioral) — the fallback used under `profile: null`.
