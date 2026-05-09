# @mochi.js/profiles

Captured-baseline data fixtures for [mochi](https://github.com/0xchasercat/mochi). Each profile is a real-device capture that the consistency engine consumes to lock fingerprint surfaces relationally.

Internal package consumed by `@mochi.js/core` and `@mochi.js/consistency`.

## Status — v0.2

Six real-device baselines ship today, imported from the wrkx harvester corpus and filtered by FingerprintJS Pro `suspectScore <= 20` (task 0260):

- `mac-m4-chrome-stable` — MacBook (Apple Silicon, M4) — Chrome stable
- `mac-chrome-stable` — macOS — Chrome stable
- `mac-chrome-beta` — macOS — Chrome beta
- `windows-chrome-stable` — Windows 11 — Chrome stable
- `linux-chrome-stable` — Linux x86_64 — Chrome stable
- `mac-brave-stable` — macOS — Brave stable

Each baseline carries `profile.json`, `baseline.manifest.json`, the precomputed `audio/*.bin` and `canvas/*.json` fingerprint blobs (consumed by R-047 / R-048 — task 0267), and `PROVENANCE.md`. Other catalog ids in `KNOWN_PROFILE_IDS` (`mac-m2-…`, `mac-intel-…`, `win11-edge-…`, `mac-m1-…`) still resolve to the generic placeholder until additional captures land.

See [PLAN.md §12](https://github.com/0xchasercat/mochi/blob/main/PLAN.md) for the capture protocol and provenance discipline.
