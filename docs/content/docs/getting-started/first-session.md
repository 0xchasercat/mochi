---
title: Your first session
description: Walk through mochi.launch, Page.goto, and a humanClick — end to end, with the values you should see.
order: 2
category: getting-started
lastUpdated: 2026-05-09
---

Following [Installation](/docs/getting-started/install), you have `@mochi.js/core` installed and Chromium-for-Testing on disk. This page walks the API surface you'll use day-to-day.

## Launch a Session

`mochi.launch(opts)` resolves a profile, derives a consistency Matrix from `(profile, seed)`, spawns a Chromium child, and returns a `Session`.

```ts
import { mochi } from "@mochi.js/core";

const session = await mochi.launch({
  profile: "linux-chrome-stable",
  seed: "user-12345",
  // Optional — proxy URL with inline credentials supported.
  proxy: "http://us-east.example.proxy:443",
});
```

A few things worth knowing:

- `profile` selects the device class. `seed` selects the per-user variation. Same `(profile, seed)` produces a byte-identical Matrix every run.
- `mochi.launch` does **not** throw on a missing profile — `linux-chrome-stable` is the only profile guaranteed to ship in v0.1.x with a real Matrix. Other IDs in `KNOWN_PROFILE_IDS` resolve to a Linux placeholder until their baselines land.
- The launched Chromium uses a clean per-Session `userDataDir`. Cookies, localStorage, and cache do not leak between sessions.

## Navigate

```ts
const page = await session.newPage();
await page.goto("https://httpbin.org/headers", { waitUntil: "load" });

const html = await page.content();
console.log(html.slice(0, 200));

await session.close();
```

`page.goto` is `--remote-debugging-pipe`-driven. There is no TCP port; nothing for a network probe to scan. `waitUntil` accepts `"load" | "domcontentloaded" | "networkidle"` — `networkidle` is currently mapped to `load` until per-frame `Network.enable` lands (see [Limits](/docs/reference/limits)).

## Read the spoofed surface

`session.profile` exposes the resolved Matrix shape:

```ts
console.log("UA:", session.profile.userAgent);
console.log("Locale:", session.profile.locale);
console.log("Timezone:", session.profile.timezone);
```

For probe-level inspection, point the session at the bundled probe page:

```ts
await page.goto("file:///" + import.meta.dir + "/tests/fixtures/probe-page.html");
const probeJson = await page.evaluate(() => JSON.stringify(window.__probe));
```

Compare against `packages/profiles/data/<profile-id>/baseline.manifest.json` — the harness does this automatically (see [Probe Manifest](/docs/concepts/probe-manifest)).

## Synthesize a click

```ts
await page.goto("https://example.com");
await page.humanClick("a[href]");
```

`humanClick` synthesizes a Bezier trajectory with overshoot+correction (Fitts MT), dispatches `Input.dispatchMouseEvent` calls along the path, then issues the click. The trajectory is parameterized by the profile's `behavior` block (`hand`, `tremor`, `wpm`, `scrollStyle`).

Same shape: `page.humanType(selector, text)` (lognormal digraph delays + adjacent-key mistakes) and `page.humanScroll({ to, ... })` (inertial scroll with friction).

## Out-of-band fetch

`session.fetch(url, init)` routes through Bun:FFI to the Rust `wreq`-backed cdylib. The TLS/H2 fingerprint matches the spoofed Chrome — the bytes a server sees on a manual `fetch` are indistinguishable from what Chromium itself would send.

```ts
const res = await session.fetch("https://api.example.com/v1/me", {
  method: "GET",
  headers: { Authorization: "Bearer ..." },
});
console.log(res.status, await res.text());
```

## Close cleanly

```ts
await session.close();
```

`close()` flushes the CDP queue, kills the Chromium child, drops the per-Session `NetCtx`, and frees the user-data-dir. It is idempotent — calling it twice is safe.

## Next

Continue to [Quickstart](/docs/getting-started/quickstart) for a longer end-to-end recipe, or jump to [The Consistency Engine](/docs/concepts/consistency-engine) for the conceptual model behind the Matrix.
