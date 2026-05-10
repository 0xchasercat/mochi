---
"@mochi.js/core": patch
---

Fix `synthesizePlaceholderProfile` hardcoding Linux for every profile id. Pre-fix, the 5 catalog ids without captured baselines (`mac-m2-chrome-stable`, `mac-m1-chrome-stable`, `mac-intel-chrome-stable`, `win11-chrome-stable`, `win11-edge-stable`) all silently produced a Linux UA + Linux `os.name` regardless of what the id implied. macOS and Windows users passing those ids saw a Linux fingerprint against their actual Chromium-for-Testing binary — the canonical R-004 mismatch.

The placeholder synthesizer now pattern-matches the id and emits OS-coherent skeletons:

- `mac-*` / `macos-*` → macOS placeholder (Apple Silicon arm64 default, M3 GPU, `Macintosh; Intel Mac OS X` UA, Helvetica fonts, America/Los_Angeles tz).
- `win11-*` / `windows-*` / `win10-*` → Windows placeholder (D3D11 ANGLE, `Windows NT 10.0; Win64; x64` UA, Segoe UI fonts).
- `linux-*` and unknown prefixes → Linux placeholder (preserves long-standing default).

Captured baselines (the 6 real-device profiles in `@mochi.js/profiles`) are unaffected — `getProfile()` returns those directly without hitting the synthesizer.

The `inferPlaceholderOsFromId` helper is exported as `@internal` for unit-test coverage. Reported by user observation; reproducible via `await mochi.launch({ profile: "mac-m1-chrome-stable", seed: "x" })` on any host (pre-fix produced Linux UA).
