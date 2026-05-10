---
"@mochi.js/cli": patch
"@mochi.js/core": patch
---

Roll back `PINNED_FALLBACK_VERSION` from `148.0.7778.97` → `147.0.7727.138` to match the captured-baseline majority. Closes the canonical R-004 mismatch ("Different browser version" -5% on browserscan.net / generic-bot detectors): the captured profiles in `@mochi.js/profiles` are still on Chrome 146/147, so pinning 148 shipped a UA-vs-binary divergence on every install.

After this rollback:
- The three most-used profiles (`linux-chrome-stable`, `mac-m4-chrome-stable`, `mac-chrome-beta`) match the binary byte-exactly.
- The placeholder synthesizer (`synthesizePlaceholderProfile` in `@mochi.js/core`) bumps in lockstep — its UA / `wreqPreset` / `browser.{min,max}Version` are now Chrome 147.
- The three older 146 captures (`mac-chrome-stable`, `windows-chrome-stable`, `mac-brave-stable`) still mismatch by 1 minor — tracked for the next recapture pass; users hitting these can pass an inline ProfileV1 with a 147 UA as a workaround.

Existing users who already downloaded Chromium 148 should refresh:

```sh
bunx mochi browsers install --force
```

(or pass `--version 147.0.7727.138` explicitly — the new default is the same build).
