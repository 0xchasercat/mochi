---
title: Cookies & storage
description: Persist Session.cookies to disk, restore in a future run, and seed localStorage / sessionStorage.
order: 5
category: guides
lastUpdated: 2026-05-09
---

Warm-session reuse — across a CI run, across a restart, across a deploy — needs three things: cookies, localStorage, and sometimes sessionStorage. mochi exposes all three through CDP-backed accessors.

## Cookies — `Session.cookies.{save,load}`

```ts
import { mochi } from "@mochi.js/core";

const session = await mochi.launch({ profile: "linux-chrome-stable", seed: "abc" });
const page = await session.newPage();
await page.goto("https://example.com/login");
// ... interactive login, MFA, etc.

await session.cookies.save("./state/example-cookies.json");
await session.close();
```

Then in a future run:

```ts
const session = await mochi.launch({ profile: "linux-chrome-stable", seed: "abc" });
await session.cookies.load("./state/example-cookies.json");

const page = await session.newPage();
await page.goto("https://example.com/dashboard");  // already authenticated
```

The on-disk file is JSON with a version header (`{ version, savedAt, mochiVersion, pattern, count, cookies }`). The reader refuses unknown majors with a precise diagnostic so a stale jar can't silently load with the wrong shape. Round-trips are byte-exact.

### Filter by domain

The `pattern` regex is matched against each cookie's `domain` and applies on **both** save and load:

```ts
// Save only example.com cookies.
await session.cookies.save("./state/example.json", { pattern: /\.example\.com$/ });

// Or save everything, restore only one slice.
await session.cookies.save("./state/all.json");
await session.cookies.load("./state/all.json", { pattern: /\.example\.com$/ });
```

## Read / write without persistence

```ts
const all = await session.cookies.get();
const apiOnly = await session.cookies.get({ url: "https://api.example.com" });

await session.cookies.set([
  { name: "sid", value: "abc", domain: ".example.com", path: "/", expires: -1, size: 0,
    httpOnly: true, secure: true, session: true, sameSite: "Lax" },
]);
```

The `url` filter is a coarse hostname match — sufficient for "scope down to one site". Path / secure / sameSite handling is client-side; filter the result yourself if you need it.

## localStorage / sessionStorage

`Page.localStorage` and `Page.sessionStorage` are getters that return a namespaced accessor. Both default to the page's current main-frame origin.

```ts
const page = await session.newPage();
await page.goto("https://example.com");

// Read every key/value pair on the current origin.
const ls = await page.localStorage.get();

// Write some keys (Object.assign semantics — existing keys not in items are kept).
await page.localStorage.set({
  lastVisit: Date.now().toString(),
  bucket: "B",
  consentDismissed: "1",
});

// sessionStorage uses the same shape — per-tab, vanishes on tab close.
await page.sessionStorage.set({ flow: "checkout" });
```

To clear a key, set it to `""`. To replace the whole namespace, fetch with `get`, mutate, then call `set` with the union.

### Cross-origin warming

When the page is on `about:blank` (no origin yet), or when you need to seed a different origin's storage, pass `origin` explicitly:

```ts
await page.localStorage.set(
  { consent: "granted" },
  { origin: "https://example.com" },
);
```

The CDP backing (`DOMStorage.getDOMStorageItems` / `setDOMStorageItem`) requires a security origin — opaque origins (`about:blank`, `data:`) throw. Either navigate first, or pass `origin`.

## See also

- [`@mochi.js/core` API reference](/docs/api/core) for the full `CookieJar` and `DomStorage` interfaces.
- [Cloudflare Turnstile guide](/docs/guides/turnstile) — a common reason to warm a session before navigating.
