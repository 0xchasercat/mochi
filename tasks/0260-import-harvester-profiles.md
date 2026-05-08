# 0260: import 6-7 real-device profiles from harvester

**Package:** `profiles` + `cli` (importer subcommand) + `harness` (validation)
**Phase:** `0.2`
**Estimated size:** L
**Dependencies:** v0.1.4+ shipped, harvester DB access

## Goal

Replace mochi's single shipped profile (`mac-m4-chrome-stable`) and the Linux placeholder fallback with a curated catalog of 6-7 real-device profiles harvested from `wrkx.app`'s fingerprint corpus, filtered by FingerprintJS `suspectScore <= 20`. Profiles cover macOS Chrome (×2-3), Windows Chrome, Linux Chrome, Android Chrome Mobile (×2). Each ships with `profile.json` + `baseline.manifest.json` + `expected-divergences.json` + `PROVENANCE.md` per the existing `mac-m4-chrome-stable` shape.

After this lands: `mochi.launch({ profile: "windows-chrome-stable", seed: ... })` resolves to a real Windows 11 baseline; the harness diffs against actual captured-from-real-user data; consumers stop hitting the Linux placeholder fallback for non-Linux profile ids.

## Curated source

Visitor IDs from harvester DB (suspect ≤ 20):

```
7ef25424cddb541c5c91bfdb25d73818   Android 10  Chrome Mobile 149  suspect=3
OtCiCTddayiF0se5kzF0               macOS 10.15.7  Chrome 146     suspect=6
a5DvTh20kSDEse8RKYg2               macOS 10.15.7  Chrome 147     suspect=6
d73055c972457a8531a0324077d78282   Android 10  Chrome Mobile 147  suspect=8
460a5cc5f4a4a6d8af32f28945530f03   Windows 11   Chrome 146       suspect=8
d7cfcbec56ed7cbb166c33440ed9cc78   macOS 10.15.7  Brave 146      suspect=9   (verify masks as Chrome)
bcbb7cfaa7f381b92daacb6b7052c6b9   Linux x86_64  Chrome 147      suspect=16
```

Consolidated record fetch: `GET http://wrkx.app/api/visitors/<id>` → JSON with `snapshots[]` (categories: `navigator`, `screen`, `audio`, `webgl`, `webgpu`, `canvas`, `media`, `storage`, `fonts`, `speech`, `timing`, `tls_fingerprint`, `server_headers`, `bot`, `fingerprintjs`, `session_bundle`).

Brave (`d7cfcbec...`): only include if the captured `navigator.userAgent` reports as `Chrome` AND `navigator.brave` is absent in the snapshot. If Brave's mask leaks, drop or document as Brave-specific.

## Success criteria

### Importer

- [ ] New `mochi profiles import <visitor-id> --as <profile-id>` subcommand. Pulls the API JSON, normalizes per-category snapshot shape, emits a `packages/profiles/data/<profile-id>/` directory with the canonical four files.
- [ ] When the visitor has multiple snapshots per category (re-visits), pick the **latest** by `created_at`. Document this choice in PROVENANCE.md.
- [ ] Per-category mapping (verify exact paths against `schemas/probe-manifest.schema.json`):
  - `navigator` → flat into `baseline.manifest.json`'s navigator block
  - `screen` → screen + display rules + window-size derivation
  - `audio`, `webgl`, `webgpu`, `canvas`, `media`, `storage`, `fonts`, `speech`, `timing` → corresponding manifest blocks
  - `tls_fingerprint` → JA3/JA4 hint for `wreqPreset` selection
- [ ] `profile.json` derived from `navigator.userAgent` parsing + `screen.*` + `tls_fingerprint`. Top-level fields: `id`, `version`, `engine`, `browser{name, channel, minVersion, maxVersion}`, `os{name, version, arch}`, `locale`, `timezone`, `display{width, height}`, `deviceMemory`, `hardwareConcurrency`, `wreqPreset`.
- [ ] `expected-divergences.json` — start from `mac-m4-chrome-stable`'s entries, trim per-platform.
- [ ] `PROVENANCE.md` — when captured, what device/browser, suspectScore, normalization steps, upstream URL.

### Profile naming

Canonical IDs: `windows-chrome-stable`, `mac-chrome-stable`, `mac-chrome-beta`, `linux-chrome-stable` (replaces placeholder), `android-chrome-stable`, `android-chrome-prev`, optional `mac-brave-stable`.

### Validation

- [ ] Each imported profile must `bun run harness:smoke` clean against itself — Probe Manifest captured from `mochi.launch({ profile: <id>, ... })` should diff to zero with the expected-divergences applied. Load-bearing check.
- [ ] Add per-profile contract test asserting key R-rule values match the matrix.
- [ ] Update `KNOWN_PROFILE_IDS` to include the new IDs.
- [ ] README + docs/quickstart "Profile catalog" section.

### Other

- [ ] DON'T commit harvester DB credentials. Importer reads from env: `MOCHI_HARVESTER_API` (URL prefix).
- [ ] DON'T wire importer into CI — one-time-per-batch human-driven action.
- [ ] Changeset: minor on `@mochi.js/profiles`, patch on `@mochi.js/cli`.

## Out of scope

- Full TLS preset coverage — `wreqPreset` selection from JA3/JA4 may not have exact matches; document gaps.
- Behavioral baseline (`session_bundle`) import — separate brief.
- Continuous re-import pipeline — v0.3+.
- `server_headers` import — network-layer captures we don't currently spoof at HTTP layer.

## Implementation notes

- See `packages/profiles/data/mac-m4-chrome-stable/` for canonical shape.
- See `schemas/probe-manifest.schema.json` + `harness/normalize.ts` for manifest format.
- Brave UA-mask check: `navigator.userAgent` plain Chrome AND `navigator.brave` absent. If `navigator.brave` non-null, drop.
- TLS preset mapping: pick nearest `wreq` preset by version + cipher list; document fallbacks.
- `linux-chrome-stable` import REPLACES placeholder fallback in `packages/core/src/launch.ts:resolveProfile`.

## Validation

```sh
bun run typecheck && bun run lint && bun run test && bun run test:contract
for p in windows-chrome-stable mac-chrome-stable mac-chrome-beta linux-chrome-stable android-chrome-stable android-chrome-prev; do
  MOCHI_E2E=1 MOCHI_PROFILE_OVERRIDE="$p" bun run harness:smoke
done
```

## Submission

```sh
bun work create 0260 profiles
cd worktrees/0260
# implement importer, run for each ID, verify, commit, PR
bun work submit 0260 --draft
```
