---
"@mochi.js/profiles": minor
"@mochi.js/cli": patch
---

Import 6+ real-device profiles from the wrkx harvester corpus and ship a
new `mochi profiles import` CLI subcommand (task 0260).

The v0.1.4 catalog shipped a single captured baseline (`mac-m4-chrome-stable`)
plus seven placeholder ids that resolved to a generic Linux fallback. This
release replaces the placeholder Linux entry with a real captured baseline
and adds four sibling Chrome/Brave baselines, all sourced from real users
filtered by FingerprintJS Pro `suspectScore <= 20`:

- `mac-chrome-stable` (Chrome 146 on macOS arm64, suspectScore 6)
- `mac-chrome-beta` (Chrome 147 on macOS arm64, suspectScore 6)
- `windows-chrome-stable` (Chrome 146 on Windows 11 x64, suspectScore 8)
- `linux-chrome-stable` (Chrome 147 on Linux x86_64, suspectScore 16) —
  REPLACES the previous placeholder fallback.
- `mac-brave-stable` (Brave 146 on macOS arm64, suspectScore 12) — only
  ships when the captured `navigator.userAgent` reads as plain Chrome AND
  `navigator.brave` is absent (mask-leak gate).

Each profile carries the canonical four-file shape under
`packages/profiles/data/<id>/`:

- `profile.json`            ProfileV1 derived from the captured navigator/
                            screen/webgl probes via the existing
                            `deriveProfile` (task 0040) pipeline.
- `baseline.manifest.json`  Per-category snapshot dict assembled from the
                            harvester's `/api/visitors/<id>` payload.
- `expected-divergences.json`  Glob list of intentional divergences (audio/
                            canvas v0.7-deferred + the real-user-Chrome ↔
                            Chromium-for-Testing structural deltas).
- `PROVENANCE.md`           Upstream URL, suspectScore, capture date,
                            wreqPreset rationale, hand-corrections.

New `mochi profiles import <visitor-id> --as <profile-id>` subcommand:
fetches the visitor record from `MOCHI_HARVESTER_API` (env, with a CLI
flag override), dedups multi-snapshot categories by `created_at`, runs
the existing `deriveProfile` translator, and writes the four files. Mobile
records (`userAgentData.mobile=true`) are rejected — Android/iOS support
needs schema + UA-template work tracked outside this task.

Per-profile harness round-trip (`bun run harness:smoke` against
Chromium 149 host): all five new profiles register `verdict: EQUIVALENT`
with `material === 0` after expected-divergences are applied. Cross-host
gaps (host fonts, host GPU, host media-devices) are documented as known
phase-0.7 deliverables in each profile's `expected-divergences.json`.
