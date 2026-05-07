# @mochi.js/core

> The primary entry point for **mochi** — a zero-footprint, Bun-native browser automation framework.

```sh
bun add @mochi.js/core
```

```ts
import { mochi } from "@mochi.js/core";

const session = await mochi.launch({
  profile: "mac-m2-chrome-stable",
  seed: "user-12345",
});

const page = await session.newPage();
await page.goto("https://example.com");
await page.humanClick("#submit");
await session.close();
```

## Status

**v0.0.1 — claim release.** The surface above is the contract; the implementation lands incrementally per the project roadmap. Calling `mochi.launch()` at v0.0.1 throws `NotImplementedError` with a pointer to the repo.

The full surface lands in phases 0.1 → 1.0. Watch the repo for v0.1 (CDP transport) and v1.0 (the production release).

## What this package gives you

- `mochi.launch(opts)` — spawn a Chromium-for-Testing instance with a relationally-locked fingerprint matrix derived from `(profile, seed)`.
- `Session` and `Page` — the runtime objects you drive.
- `page.humanClick / humanType / humanScroll` — biomechanically-shaped input synthesis.
- `session.fetch` — out-of-band requests with profile-matching JA3/JA4 via the Rust+wreq backend.

All of this is the single import. No mixing Patchright + a fingerprint injector + a Turnstile clicker. mochi solves it once.

## Why @mochi.js/core?

- **Bun-only.** No Node fallback. Engines: `bun >= 1.1`.
- **Stock Chromium.** No patched fork. Works against [Chromium-for-Testing](https://googlechromelabs.github.io/chrome-for-testing/), pinned and downloadable via `mochi browsers install`.
- **Relational locking.** Every fingerprint surface (canvas, WebGL, audio, fonts, timing) derives from a single `(profile, seed)` pair. No Frankenstein fingerprints.
- **Zero-jitter spoofing.** TurboFan-friendly proxies installed via `Page.addScriptToEvaluateOnNewDocument(runImmediately:true)` before any page script. No async round-trips when a WAF probes.

## License

MIT.

## See also

- [Repo](https://github.com/0xchasercat/mochi)
- [PLAN.md](https://github.com/0xchasercat/mochi/blob/main/PLAN.md) — the full design contract
- [Limits](https://github.com/0xchasercat/mochi/blob/main/docs/limits.md) — what the JS-only ceiling honestly does and doesn't cover
