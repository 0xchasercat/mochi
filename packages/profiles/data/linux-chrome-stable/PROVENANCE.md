# PROVENANCE — linux-chrome-stable

Imported from the wrkx harvester corpus (`http://wrkx.app/api`) by `mochi profiles import`. PLAN.md §12.2 — every profile in `main` must carry verifiable provenance.

| field | value |
|---|---|
| profile id | `linux-chrome-stable` |
| upstream visitor id | `bcbb7cfaa7f381b92daacb6b7052c6b9` |
| upstream URL | `http://wrkx.app/api/visitors/bcbb7cfaa7f381b92daacb6b7052c6b9` |
| visitor egress ip (snapshot) | 64.140.162.130 |
| browser version | 147 |
| FingerprintJS suspectScore | 16 |
| captured at (UTC) | 2026-04-29T22:22:54.246Z |
| imported at (UTC) | 2026-05-08T20:50:37.035Z |
| importer | `mochi profiles import` (task 0260) |

## Multi-snapshot policy

When the visitor record contains multiple snapshots for a single category (re-visits over time), the importer keeps the most recent by `created_at`. This matches the spirit of capturing the device's *current* fingerprint rather than a stale earlier one.

## TLS preset

The harvester capture did not include a JA3/JA4 hash, so the wreqPreset is synthesised as `<browser>_<major>_<os>`. The wreq Rust crate's `resolve_preset()` matches by family (`chrome*` → Chrome) — exact-version fingerprint matching is a phase 0.7 deliverable. See `packages/net-rs/src/ffi/preset.rs`.

## Hand-corrections

None at import time. The harvester's `navigator` snapshot is captured by real Chrome (not headless), so the `--headless=new` artifacts that needed manual correction in `mac-m4-chrome-stable` (task 0070) are absent here.

