# PROVENANCE — mac-brave-stable

Imported from the wrkx harvester corpus (`http://wrkx.app/api`) by `mochi profiles import`. PLAN.md §12.2 — every profile in `main` must carry verifiable provenance.

| field | value |
|---|---|
| profile id | `mac-brave-stable` |
| upstream visitor id | `d7cfcbec56ed7cbb166c33440ed9cc78` |
| upstream URL | `http://wrkx.app/api/visitors/d7cfcbec56ed7cbb166c33440ed9cc78` |
| visitor egress ip (snapshot) | 49.228.67.131 |
| browser version | 146 |
| FingerprintJS suspectScore | 12 |
| captured at (UTC) | 2026-05-08T20:06:53.637Z |
| imported at (UTC) | 2026-05-08T20:50:38.368Z |
| importer | `mochi profiles import` |

## Multi-snapshot policy

When the visitor record contains multiple snapshots for a single category (re-visits over time), the importer keeps the most recent by `created_at`. This matches the spirit of capturing the device's *current* fingerprint rather than a stale earlier one.

## TLS preset

Brave's TLS fingerprint diverges from Chrome's at the cipher-suite level. wreq's preset registry resolves `brave_*` → `UnknownFallbackChrome` (see `packages/net-rs/src/ffi/preset.rs:97`); the resulting client uses Chrome-family TLS. Closest exact match would require a per-Brave-build cipher list — phase 0.7 deliverable.

## Hand-corrections

None at import time. The harvester's `navigator` snapshot is captured by real Chrome (not headless), so the `--headless=new` artifacts that needed manual correction in `mac-m4-chrome-stable` are absent here.

