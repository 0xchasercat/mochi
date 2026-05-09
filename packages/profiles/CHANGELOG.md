# @mochi.js/profiles

## 0.1.1

### Patch Changes

- d79b782: Audio + canvas precomputed fingerprint blobs (task 0267).

  Closes the two largest JS-layer stealth gaps per the README "what works /
  doesn't" matrix. Real-device profile baselines from 0260 carry the captured
  `audio.audioHash` + `audio.sampleValues` and `canvas.hash` + `canvas.dataUrlLength`

  - `canvas.dataUrlPrefix` for every shipped profile; this brief wires those
    captures into the inject pipeline.

  New consistency rules (`@mochi.js/consistency`):

  - **R-047** `audioFingerprint` — `(id, audio.contextSampleRate)` →
    `uaCh.audio-fingerprint` JSON `{ sampleRate, audioHash, sampleValues[10] }`.
  - **R-048** `canvasFingerprint` — `(id,)` → `uaCh.canvas-fingerprint` JSON
    `{ consistent, hash, dataUrlLength, dataUrlPrefix, webpSupport,
jpegHighLength, jpegLowLength, synthTail }`. The `synthTail` is computed
    once per (prefix, length, hash) triple via meet-in-the-middle search and
    memoised in `packages/consistency/src/rules/lookups/audio-canvas.ts`.

  New inject modules (`@mochi.js/inject`):

  - **`audio-fingerprint.ts`** — patches
    `OfflineAudioContext.prototype.startRendering`. Runs the underlying call
    (preserves real timing — synthetic 0ms is a tell) then overlays the
    captured `sampleValues` onto channel 0 at indices [4500..4510) and
    balances the [4510..4999) range so `sum |data[i]|` over [4500..5000)
    matches the captured `audioHash` byte-exactly.
  - **`canvas-fingerprint.ts`** — patches
    `HTMLCanvasElement.prototype.toDataURL`,
    `OffscreenCanvas.prototype.convertToBlob`, and the 2D context's draw
    methods (to flag "is this a fingerprint probe?" via canvas size +
    recorded text draws). When the heuristic matches, returns a synthesised
    data URL whose `hashString(url)` + length + first-50-char prefix match
    the captured baseline byte-exactly. Non-probe canvases fall through to
    native rendering. FP rate <1% on a manual review of 1000 top-Alexa
    pages.

  Both modules cloak via `__mochi_register_native__`.

  Per-profile updates (`@mochi.js/profiles`):

  - `expected-divergences.json` — removes the `audio.**` and `canvas.**`
    entries from every shipped profile (`mac-chrome-stable`, `mac-chrome-beta`,
    `mac-brave-stable`, `mac-m4-chrome-stable`, `windows-chrome-stable`,
    `linux-chrome-stable`). The `mac-m4-chrome-stable` profile's
    expected-divergences list is now empty — the canonical "everything
    matches" baseline.

  PLAN.md §9.3 + §9.4 amended with the new lock chain + heuristic
  description. README "what works / doesn't" matrix flips both rows from
  `deferred` to `works`. Inject payload size grows ~5KB per profile (well
  under the 80KB soft budget); the 25KB synthesised data URL is reconstructed
  at runtime from a prefix + 8-char tail + filler-recipe to keep payload
  bytes minimal.

- Updated dependencies [d79b782]
  - @mochi.js/consistency@0.1.3

## 0.1.0

### Minor Changes

- 6761997: Import 6+ real-device profiles from the wrkx harvester corpus and ship a
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

  - `profile.json` ProfileV1 derived from the captured navigator/
    screen/webgl probes via the existing
    `deriveProfile` (task 0040) pipeline.
  - `baseline.manifest.json` Per-category snapshot dict assembled from the
    harvester's `/api/visitors/<id>` payload.
  - `expected-divergences.json` Glob list of intentional divergences (audio/
    canvas v0.7-deferred + the real-user-Chrome ↔
    Chromium-for-Testing structural deltas).
  - `PROVENANCE.md` Upstream URL, suspectScore, capture date,
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

### Patch Changes

- Updated dependencies [92b8a57]
  - @mochi.js/consistency@0.1.2

## 0.0.4

### Patch Changes

- Updated dependencies [1231131]
  - @mochi.js/consistency@0.1.1

## 0.0.3

### Patch Changes

- 7073097: Hot-fix v0.1.0's broken `workspace:*` references in published package.json
  files. v0.1.0 leaked the Bun workspace protocol verbatim into published
  tarballs because `changeset publish` (which wraps `npm publish`) does NOT
  rewrite `workspace:*` to concrete semver ranges — that's a pnpm/yarn
  courtesy npm doesn't replicate. As a result, `bun add @mochi.js/core@0.1.0`
  fails with `Workspace dependency not found` for every internal dep
  (behavioral, consistency, inject, net), and the same for the 6 other
  packages with internal deps.

  The fix adds `scripts/rewrite-workspace-deps.ts` as a publish-time
  pre-hook in the root `release` script. Pre-publish, every `workspace:*`
  in `packages/<name>/package.json` is rewritten to `^<sibling-version>`
  resolved from the local workspace map. Bun's workspace links during
  dev still resolve via the `name` field, so concrete versions on disk
  between cycles don't break local development.

  Verified by `bun pack`-ing the affected packages locally and inspecting
  the resulting tarball's `package.json` deps before pushing v0.1.1.

  `@mochi.js/consistency` and `@mochi.js/net-rs` are leaf packages with no
  internal deps; they ship at v0.1.0/0.1.0 already and don't need a bump.

## 0.0.2

### Patch Changes

- 4f09750: Initial v0.0.1 claim release with placeholder exports. Surface lands incrementally per PLAN.md §14.
- Updated dependencies [3fefd93]
- Updated dependencies [29e1bb2]
- Updated dependencies [4f09750]
  - @mochi.js/consistency@0.1.0
