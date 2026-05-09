---
title: "@mochi.js/core"
description: Public surface — mochi.launch, Session, Page, error classes, and the proxy-URL parser.
order: 1
category: api
lastUpdated: 2026-05-09
---

The public entry point. `import { mochi } from "@mochi.js/core"` is enough for nearly all consumers.

## `mochi.launch(opts) : Promise<Session>`

Resolves a profile, derives a consistency Matrix from `(profile, seed)`, spawns Chromium-for-Testing via `--remote-debugging-pipe`, and returns a connected `Session`.

```ts
import { mochi, type LaunchOptions } from "@mochi.js/core";

const session = await mochi.launch({
  profile: "linux-chrome-stable",
  seed: "user-12345",
});
```

`LaunchOptions` (selected fields):

- `profile: ProfileId` — required. One of the IDs in `@mochi.js/profiles#KNOWN_PROFILE_IDS`.
- `seed: string` — required. Used to derive the Matrix; same `(profile, seed)` is byte-identical across runs.
- `proxy?: string | ProxyConfig` — inline URL with credentials, or explicit `{ server, username, password }`.
- `binary?: string` — bring-your-own Chromium binary path. Defaults to the resolved Chromium-for-Testing.
- `userDataDir?: string` — override the per-Session profile directory.
- `challenges?: ChallengeLaunchOptions` — see below.

### `ChallengeLaunchOptions`

```ts
challenges: {
  turnstile: {
    autoClick: true,
    onEscalation: (reason) => { /* "image-challenge" | "managed" | "timeout" */ },
  },
}
```

Turnstile auto-click ships in v0.1.2 (only the visible-checkbox variant). Image / audio / managed escalations fire `onEscalation` and bail — the framework deliberately does not click into image-challenge iframes. See the [Cloudflare Turnstile](/docs/guides/turnstile) guide and [Limits](/docs/reference/limits) for the rationale.

## `Session`

Owns one Chromium child + the per-Session network FFI handle. Created by `mochi.launch`; closed via `session.close()` (idempotent).

- `session.profile` — the resolved Matrix, exposed as a structured object (`userAgent`, `locale`, `timezone`, …).
- `session.newPage(): Promise<Page>` — open a new tab.
- `session.fetch(url, init): Promise<Response>` — out-of-band HTTP via `@mochi.js/net` → Rust `wreq`. Mirrors `RequestInit` for the supported subset (no streaming or binary bodies in v0.1.x).
- `session.cookies` — the cookie-jar namespace (see below).
- `session.storage(): StorageSnapshot` — sync snapshot of per-Session storage state.
- `session.close(): Promise<void>` — flush, kill the Chromium child, drop the FFI handle.

### `Session.cookies` — read / write / persist

The cookie jar is a namespaced object. All methods route through the root browser target's `Storage.getCookies` / `Storage.setCookies`, so the jar is session-wide (not page-scoped).

```ts
// Read every cookie the browser knows about.
const jar = await session.cookies.get();

// Read cookies a URL would see.
const apiJar = await session.cookies.get({ url: "https://api.example.com" });

// Write back.
await session.cookies.set(jar);

// Persist to disk. The file format is { version, savedAt, mochiVersion,
// pattern, count, cookies } — JSON, round-trips losslessly.
await session.cookies.save("./state/cookies.json");

// Restore in a future run.
await session.cookies.load("./state/cookies.json");

// Filter by domain on save AND on load.
await session.cookies.save("./state/cookies.json", {
  pattern: /\.example\.com$/,
});
```

The `pattern` regex is matched against each cookie's `domain` and applies on **both** sides — a saved-with-everything jar can be partially restored, and a saved-narrow jar can be loaded everywhere it matches. Invalid / version-mismatched files throw with a precise diagnostic.

## `Page`

Owns one tab + the per-page CDP target.

### Navigation

- `page.goto(url, opts?: GotoOptions): Promise<void>` — `waitUntil` accepts `"load" | "domcontentloaded" | "networkidle"`. `networkidle` is mapped to `load` until per-frame `Network.enable` lands.
- `page.content(): Promise<string>` — outerHTML of `document.documentElement`.
- `page.evaluate<T>(fn): Promise<T>` — `Runtime.callFunctionOn`-based; JSON-serializable returns only.

### Behavioral input

- `page.humanClick(selector, opts?: HumanClickOptions): Promise<void>` — Bezier+Fitts trajectory to the selector, then click.
- `page.humanType(selector, text, opts?: HumanTypeOptions): Promise<void>` — focus + lognormal digraph delays + adjacent-key mistakes.
- `page.humanScroll(opts: HumanScrollOptions): Promise<void>` — inertial scroll with friction.
- `page.humanMove(x, y, opts?: HumanMoveOptions): Promise<void>` — trajectory only; no click.

### Inject control

- `page.addInitScript(source: string): Promise<string>` — install a script via `Page.addScriptToEvaluateOnNewDocument({ runImmediately: true, worldName: "" })`. Returns an opaque handle.
- `page.removeInitScript(handle: string): Promise<void>` — remove a previously installed script from future navigations.

The session-level Mochi inject payload is not delivered through this method — see [The inject pipeline](/docs/concepts/inject-pipeline) for the dual-mechanism design (`Fetch.fulfillRequest` body splice + `addScriptToEvaluateOnNewDocument` fallback). `addInitScript` composes on top.

### Timing

- `page.waitFor(selector: string, opts?: WaitForOptions): Promise<void>` — waits for `attached` (default), `visible`, or `hidden`.

### DOM storage

`Page.localStorage` and `Page.sessionStorage` are getters that return a namespaced accessor backed by CDP `DOMStorage.getDOMStorageItems` / `setDOMStorageItem`. Both default to the page's current main-frame origin; pass `{ origin }` to scope explicitly.

```ts
const ls = await page.localStorage.get();
await page.localStorage.set({ lastVisit: Date.now().toString(), bucket: "B" });

// Cross-origin warming requires an explicit origin.
await page.localStorage.set(
  { consent: "granted" },
  { origin: "https://example.com" },
);

const ss = await page.sessionStorage.get();
```

Both `set` calls have `Object.assign` semantics — keys not mentioned are left alone. To clear a key, set it to `""`. `get` returns a `Record<string, string>` (CDP's `[[k, v], ...]` shape collapsed for ergonomics). Throws when the page is on `about:blank` and no `origin` was passed (opaque origins can't be scoped).

### Permissions

- `page.grantAllPermissions(opts?: { origin?: string }): Promise<void>` — wraps `Browser.grantPermissions` with the full `ALL_BROWSER_PERMISSIONS` descriptor list (geolocation, clipboardReadWrite, notifications, midi, sensors, …). Defaults to the page's current main-frame origin; pass `origin` to grant explicitly. Throws on opaque origins (`about:blank`, `data:`).

This grants permissions at the *browser* level so the page never sees a prompt. The page-side `navigator.permissions.query()` matrix is still controlled by the inject (R-036) — the two surfaces are orthogonal: this method decides what the browser *enforces*; the inject decides what the page *sees*.

### Capture

- `page.screenshot(opts?: ScreenshotOptions): Promise<Uint8Array | string>` — CDP `Page.captureScreenshot`. Defaults to a PNG-encoded `Uint8Array` of the visible viewport. Discriminated overloads narrow the return type by `encoding`.

```ts
interface ScreenshotOptions {
  format?: "png" | "jpeg" | "webp";   // default "png"
  quality?: number;                    // 0..100; jpeg/webp only
  fullPage?: boolean;                  // synthesized via setDeviceMetricsOverride
  clip?: { x: number; y: number; width: number; height: number; scale?: number };
  omitBackground?: boolean;            // PNG only; transparent background
  encoding?: "binary" | "base64";      // default "binary" → Uint8Array
}
```

`fullPage: true` round-trips through `Page.getLayoutMetrics` + `Emulation.setDeviceMetricsOverride`, captures, then clears the override (in a `finally`, so a capture failure can't leave the viewport in a frozen oversized state). `clip` and `fullPage` are mutually exclusive — `clip` wins per CDP semantics. Element-bounded capture (`{ element: handle }`) is a separate brief and not yet shipped.

### Closed-shadow piercing

- `page.querySelectorPiercing(selector): Promise<ElementHandle | null>` — find an element across the entire DOM tree, including descendants of closed shadow roots. Required for the Turnstile auto-click on Cloudflare Challenge pages where the widget iframe lives behind a closed shadow root. Supports tag / id / class / attribute / descendant / comma-list selectors. No combinators (`>`, `+`, `~`), no pseudo-classes, no XPath at v0.2.
- `page.querySelectorAllPiercing(selector): Promise<ElementHandle[]>` — same, but returns every match in DFS pre-order.
- `page.humanClickHandle(handle: ElementHandle, opts?): Promise<void>` — `humanClick` against a handle resolved through the piercing locator.

## Error classes

- `ChromiumNotFoundError` — Chromium-for-Testing not installed; run `bunx mochi browsers install`.
- `BrowserCrashedError` — the Chromium child died unexpectedly.
- `CdpRemoteError` — a CDP method returned an error response.
- `CdpTimeoutError` — a CDP request didn't resolve within the configured timeout.
- `ForbiddenCdpMethodError` — code attempted to send a CDP method on the I-1 / §8.2 forbidden list (`Runtime.enable`, etc.). Internal use; surfaces if you reach into `session._cdp` directly.
- `NotImplementedError` — a placeholder method that hasn't shipped yet.

## Utilities

- `parseProxyUrl(url: string): ParsedProxy` — normalize a proxy URL string into `{ server, username, password }`. Useful for tests and downstream tools.

## Versions

This page tracks `@mochi.js/core@0.1.4` (v0.2 wave-4).
