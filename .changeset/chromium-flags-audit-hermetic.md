---
"@mochi.js/core": patch
---

Audit and trim `DEFAULT_CHROMIUM_FLAGS` against patchright's
`chromiumSwitchesPatch.ts:20-34` removal list (task 0256).

Drops these passive command-line bot-tells from the production default
flag set:

- `--disable-component-update` (patchright drops; PRB drops)
- `--disable-default-apps` (patchright drops)
- `--disable-background-networking` (patchright drops)
- `--disable-sync` (patchright drops)

Plus the noise-reduction `--disable-features=` extras
(`OptimizationHints,MediaRouter,InterestFeedContentSuggestions,
CalculateNativeWinOcclusion`) that previously rode along with the
load-bearing tokens.

Adds `LaunchOptions.hermetic?: boolean` (default `false`). When `true`,
re-applies the dropped flags on top of the production default — used by
`@mochi.js/harness`, `@mochi.js/cli` `mochi capture`, and the stealth
conformance fixture so baseline collection isn't perturbed by updater /
sync / default-apps / feed-prefetch network noise.

Production `mochi.launch()` callers get the cleaner flag set without any
opt-in: no command-line bot-tells, normal-looking updater + sync traffic.

`--disable-features=` token now split — production keeps `Translate,
AcceptCHFrame,IsolateOrigins,site-per-process` (load-bearing for inject
reach + UA-CH alignment + headed translate-prompt suppression); hermetic
appends the noise-reduction extras as a separate token (Chromium merges
multiple `--disable-features=` tokens into a union).

PLAN.md §8.6 amended with the new two-tier flag set + per-flag decision
lineage table. `docs/content/docs/reference/limits.md` documents the
hermetic-mode surface.

Verified: `--enable-unsafe-swiftshader` is not emitted anywhere
(patchright strips Playwright's leak; mochi never had it). Legacy
`--headless` (without `=new`) is not emitted anywhere — the `=new` form
is the only headless mode mochi ever spawns.

Source: patchright `chromiumSwitchesPatch.ts:20-34`,
puppeteer-real-browser `lib/cjs/index.js:57-58`.
