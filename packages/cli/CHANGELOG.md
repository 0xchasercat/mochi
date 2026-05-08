# @mochi.js/cli

## 0.1.4

### Patch Changes

- Updated dependencies [59d7b91]
- Updated dependencies [2855668]
- Updated dependencies [a7d8ca9]
- Updated dependencies [ddcc49e]
- Updated dependencies [ef00f63]
  - @mochi.js/core@0.2.1
  - @mochi.js/harness@0.1.4

## 0.1.3

### Patch Changes

- Updated dependencies [be1c69b]
- Updated dependencies [4f1b81e]
- Updated dependencies [1231131]
  - @mochi.js/core@0.2.0
  - @mochi.js/consistency@0.1.1
  - @mochi.js/harness@0.1.3

## 0.1.2

### Patch Changes

- Updated dependencies [707e42d]
  - @mochi.js/core@0.1.2
  - @mochi.js/harness@0.1.2

## 0.1.1

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

- Updated dependencies [7073097]
  - @mochi.js/core@0.1.1
  - @mochi.js/harness@0.1.1

## 0.1.0

### Minor Changes

- afeef48: Add `mochi browsers` subcommand surface and the programmatic `resolveChromiumBinary` helper that `@mochi.js/core` will consume in task 0011.

  - `mochi browsers install [--channel] [--version] [--platform] [--force] [--sha256]` downloads a Chromium-for-Testing build from Google's CfT registry, verifies SHA256, and atomically installs to `~/.mochi/browsers/<channel>-<version>-<platform>/`.
  - `mochi browsers list` prints installed binaries.
  - `mochi browsers path` prints the binary path of the resolved install (designed for `BIN="$(mochi browsers path)"`).
  - `mochi browsers uninstall <version>` removes an install.
  - Programmatic `resolveChromiumBinary({channel, version, platform, root})` exported for downstream consumers; honors `MOCHI_CHROMIUM_PATH` env override.
  - Pinned offline fallback (`131.0.6778.85`) when the CfT manifest is unreachable.
  - Note: CfT does not publish per-asset SHA256 hashes; we compute and record SHA256 at install time and accept user-supplied `--sha256` for out-of-band verification. See `docs/limits.md`.

- 5ea34c6: Add `mochi capture` subcommand and the `LaunchOptions.bypassInject` flag.

  - **`mochi capture --profile-id <id> [--out <dir>] [--browser <path>] [--seed <s>]`** drives a bare, un-spoofed Chromium against `tests/fixtures/probe-page.html`, captures every probe family (navigator, screen, canvas, webgl, webgpu, audio, media, speech, fonts, storage, timing, bot-detection), derives a `ProfileV1`, validates against `schemas/profile.schema.json`, and writes `profile.json` + `baseline.manifest.json` + `PROVENANCE.md` to the output directory.
  - **`LaunchOptions.bypassInject?: boolean`** (`@mochi.js/core`) — when `true`, the `Session` skips `buildPayload` and never sends `Page.addScriptToEvaluateOnNewDocument`. Worker / service-worker / audio-worklet targets also receive no inject. Intended for `mochi capture` and similar baseline-collection flows; **do not enable in production**. PLAN.md §12.1.
  - The new `tests/fixtures/probe-page.html` is a self-contained probe-page (no network, ≤ 5 s budget) shared with phase 0.5's harness runner.

### Patch Changes

- c38d7aa: Phase 0.5 — `@mochi.js/harness` MVP + `mochi harness` subcommand.

  - **`@mochi.js/harness`** ships the five public functions (`capture`, `normalize`, `diff`, `categorize`, `report`) and the `runHarnessAgainstProfile` orchestrator. Drives a Mochi-spoofed session through `tests/fixtures/probe-page.html`, normalizes per-session entropy on both the captured manifest and the committed baseline, structurally diffs the two, and categorizes each divergence as `guid-class` | `intentional` | `material`. PR gate: `counts.material === 0` (PLAN.md §13.6).
  - **`mochi harness <profile-id>`** + **`mochi harness all`** runs the harness from the CLI. Without `--out`, prints verdict + counts. With `--out <dir>`, writes `report.json` + `report.html` for each profile.
  - Per-profile **`expected-divergences.json`** ships at `packages/profiles/data/<id>/expected-divergences.json`. Glob paths are categorized as `intentional`. Every entry has a human-readable `comment` — phase-0.7-deferred surfaces (audio bytes, canvas hash, full WebGL extensions, full font lists, MediaDevices, SpeechSynthesis voices, etc.) are pre-populated for `mac-m4-chrome-stable`.
  - Root **`bun harness:smoke`** / **`bun harness:full`** / **`bun harness:diff <id>`** scripts replace the v0.0 echo placeholders.
  - `pr-fast.yml` gains a soft-fail `bun harness:smoke` step. Hard-fail flips on at the end of phase 0.7.

- 4f09750: Initial v0.0.1 claim release with placeholder exports. Surface lands incrementally per PLAN.md §14.
- Updated dependencies [3fefd93]
- Updated dependencies [e97c732]
- Updated dependencies [5ea34c6]
- Updated dependencies [29e1bb2]
- Updated dependencies [c38d7aa]
- Updated dependencies [f0c1a8a]
- Updated dependencies [4f09750]
- Updated dependencies [e7cc610]
- Updated dependencies [ff75595]
- Updated dependencies [74443f7]
  - @mochi.js/consistency@0.1.0
  - @mochi.js/core@0.1.0
  - @mochi.js/harness@0.1.0
