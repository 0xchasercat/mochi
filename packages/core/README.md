# @mochi.js/core

> The primary entry point for **mochi** — a zero-footprint, Bun-native browser automation framework.

```sh
bun add @mochi.js/core
```

```ts
import { mochi } from "@mochi.js/core";

const session = await mochi.launch({
  profile: "linux-chrome-stable",
  seed: "user-12345",
});

const page = await session.newPage();
await page.goto("https://example.com");
await page.humanClick("a");
await session.close();
```

## Status

`v0.4.x` (v0.2 wave-4 surfaces). `mochi.launch()` is fully wired: pipe-mode CDP transport, relational `(profile, seed)` Matrix, JIT-friendly inject delivered via `Fetch.fulfillRequest` body splice (with `Page.addScriptToEvaluateOnNewDocument({ runImmediately: true, worldName: "" })` as the `about:blank` / `data:` fallback), behavioral synth, and JA4-coherent `session.fetch` via Rust+wreq.

The full [v0.1.4 → v0.2] surface lands as additive minor bumps. See [`CHANGELOG.md`](https://github.com/0xchasercat/mochi/blob/main/CHANGELOG.md).

## What this package gives you

- `mochi.launch(opts)` — spawn a Chromium-for-Testing instance with a relationally-locked fingerprint matrix derived from `(profile, seed)`. Options include `proxy`, `headless`, `binary`, `timeout`, `geoConsistency` (IP/TZ/locale exit reconciliation per task 0262), and `challenges` (Turnstile auto-click, task 0220).
- `Session` and `Page` — the runtime objects you drive.
- `page.humanClick / humanType / humanScroll` — biomechanically-shaped input synthesis (Bezier + Fitts + Gaussian jitter).
- `session.fetch` — out-of-band requests with profile-matching JA3/JA4/H2 via the Rust+wreq backend.
- `page.screenshot(opts?)` — PNG / JPEG / WebP via CDP `Page.captureScreenshot`. Options: `format`, `quality`, `fullPage`, `clip`, `omitBackground`, `encoding`. Element-bounded capture (`{ element: handle }`) is deferred — see [`docs/limits.md`](https://github.com/0xchasercat/mochi/blob/main/docs/limits.md).
- `session.cookies.{save,load}(path, { pattern? })` — JSON cookie jar with version header + regex domain filter. Round-trips losslessly via `Storage.getCookies` / `Storage.setCookies` (task 0257).
- `page.localStorage.{get,set}` and `page.sessionStorage.{get,set}` — direct `DOMStorage` CDP access, frame-scoped (defaults to current main-frame origin; pass `{ origin }` for cross-origin).
- `page.grantAllPermissions(opts?)` — wraps `Browser.grantPermissions` with the full `ALL_BROWSER_PERMISSIONS` descriptor list (task 0257).

All of this is the single import. No mixing Patchright + a fingerprint injector + a Turnstile clicker. mochi solves it once.

## Why @mochi.js/core?

- **Bun-only.** No Node fallback. Engines: `bun >= 1.1`.
- **Stock Chromium.** No patched fork. Works against [Chromium-for-Testing](https://googlechromelabs.github.io/chrome-for-testing/), pinned and downloadable via `mochi browsers install`.
- **Relational locking.** Every fingerprint surface (canvas, WebGL, audio, fonts, timing) derives from a single `(profile, seed)` pair. No Frankenstein fingerprints. Audio + canvas digests are byte-exact via precomputed per-(profile, sample-rate) blobs (R-047 / R-048, task 0267).
- **Zero-jitter spoofing.** TurboFan-friendly proxies installed before any page script. Init-script delivery via `Fetch.fulfillRequest` body splice closes the source-attribution leak that bare `addScriptToEvaluateOnNewDocument` would otherwise carry (task 0266).

## License

MIT.

## See also

- [Repo](https://github.com/0xchasercat/mochi)
- [PLAN.md](https://github.com/0xchasercat/mochi/blob/main/PLAN.md) — the full design contract
- [Quickstart](https://github.com/0xchasercat/mochi/blob/main/docs/quickstart.md) — 5-minute walkthrough
- [Limits](https://github.com/0xchasercat/mochi/blob/main/docs/limits.md) — what the JS-only ceiling honestly does and doesn't cover
