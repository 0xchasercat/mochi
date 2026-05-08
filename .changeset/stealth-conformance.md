---
"@mochi.js/harness": minor
"@mochi.js/inject": minor
---

Phase 0.5.x — stealth conformance suite (port of CloakBrowser
`tests/test_stealth.py`).

- **`@mochi.js/harness`** gains a new `conformance/stealth/` subtree. Layer 1
  (`webdriver-detection.test.ts`) runs as the load-bearing PR-fast gate
  alongside `bun harness:smoke` — six offline assertions ported verbatim
  from CloakBrowser's `TestWebDriverDetection`:
  `navigator.webdriver===false`, no `HeadlessChrome` UA, `typeof window.chrome === "object"`,
  `navigator.plugins.length >= 5`, `navigator.languages.length >= 1`,
  no `cdc_*` / `__webdriver*` window keys. Layer 2
  (`bot-detection-sites.test.ts`) runs gated by `MOCHI_ONLINE=1` against
  bot.sannysoft, bot.incolumitas, browserscan, deviceandbrowserinfo, and
  demo.fingerprint.com/web-scraping. Three online tests carry typed
  expected-failure entries (incolumitas anti-debugger trap, sannysoft
  MQ_SCREEN, fingerprint.com IP-class blocking) — see `docs/limits.md`.
- **`@mochi.js/inject`** gains two CloakBrowser-surfaced defensive shim
  modules: `window-chrome.ts` (mirrors Chrome's `window.chrome` shape with
  `loadTimes`/`csi`/`app` only when the underlying browser doesn't already
  expose it; `runtime` is intentionally undefined for non-extension
  contexts) and `plugins.ts` (curated 5-plugin PluginArray + 2-mimetype
  MimeTypeArray, matching the `mac-m4-chrome-stable` baseline; only
  installed when the underlying browser reports an empty list). Both
  shims no-op on real Chrome.app where the surfaces are native, so the
  existing harness Zero-Diff gate is unchanged at runtime.
- New scripts: `bun conformance:stealth` (Layer 1, PR-fast) and
  `bun conformance:stealth:online` (Layer 2, network-gated). Wired into
  `.github/workflows/pr-fast.yml` (Layer 1 hard-fail) and
  `.github/workflows/release.yml` (both layers gate publish).
- Vendored upstream source: `tests/fixtures/cloakbrowser/test_stealth.py`
  (sha-pinned to `13b1b98b6840b68316e43fd46f43ffa7f50fd967`).
