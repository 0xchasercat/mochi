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

Turnstile auto-click ships in v0.1.2 (only the visible-checkbox variant). Image / audio / managed escalations fire `onEscalation` and bail — the framework deliberately does not click into image-challenge iframes. See [Limits](/docs/reference/limits) for the rationale.

## `Session`

Owns one Chromium child + the per-Session network FFI handle. Created by `mochi.launch`; closed via `session.close()` (idempotent).

- `session.profile` — the resolved Matrix, exposed as a structured object (`userAgent`, `locale`, `timezone`, …).
- `session.newPage(): Promise<Page>` — open a new tab.
- `session.fetch(url, init): Promise<Response>` — out-of-band HTTP via `@mochi.js/net` → Rust `wreq`. Mirrors `RequestInit` for the supported subset (no streaming or binary bodies in v0.1.x).
- `session.cookies(filter?): Promise<Cookie[]>` — read cookies from the root browser target. URL filtering is host-only at v0.1; client-side filter the result for path/secure/SameSite.
- `session.storage(): StorageSnapshot` — sync snapshot of per-Session storage state.
- `session.close(): Promise<void>` — flush, kill the Chromium child, drop the FFI handle.

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
- `page.humanMove(opts: HumanMoveOptions): Promise<void>` — trajectory only; no click.

### Inject control

- `page.addInitScript(source: string): Promise<string>` — install a script via `Page.addScriptToEvaluateOnNewDocument({ runImmediately: true })`. Returns an opaque handle.
- `page.removeInitScript(handle: string): Promise<void>` — remove a previously installed script from future navigations.

### Timing

- `page.waitFor(opts: WaitForOptions): Promise<void>` — selector, function, or `WaitState` (`"load" | "domcontentloaded" | "networkidle"`).

### Capture

- `page.screenshot(opts?: ScreenshotOptions): Promise<Uint8Array | string>` — CDP `Page.captureScreenshot`. Defaults to PNG bytes (`Uint8Array`) of the visible viewport. Pass `fullPage: true` for a full-document capture (round-trips through `Emulation.setDeviceMetricsOverride` and restores). Pass `encoding: "base64"` for the raw CDP string. Element-bounded capture (`{ element: handle }`) is a separate brief.

## Error classes

- `ChromiumNotFoundError` — Chromium-for-Testing not installed; run `bunx mochi browsers install`.
- `BrowserCrashedError` — the Chromium child died unexpectedly.
- `CdpRemoteError` — a CDP method returned an error response.
- `CdpTimeoutError` — a CDP request didn't resolve within the configured timeout.
- `ForbiddenCdpMethodError` — code attempted to send a CDP method on the I-1 / §8.2 forbidden list (`Runtime.enable`, etc.). Internal use; surfaces if you reach into `session._cdp` directly.
- `NotImplementedError` — a placeholder method that hasn't shipped yet (e.g. `session.fetch` until Phase 0.6).

## Utilities

- `parseProxyUrl(url: string): ParsedProxy` — normalize a proxy URL string into `{ server, username, password }`. Useful for tests and downstream tools.

## Versions

This page tracks `@mochi.js/core@0.1.2`.
