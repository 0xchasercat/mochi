# @mochi.js/cli

## 0.2.5

### Patch Changes

- 22b2a02: Wire real captured profile baselines into `mochi.launch` and bump the placeholder + CfT pin to Chrome 148.

  **The bug.** Every user shipping a string `profile:` got the hardcoded Chrome/131 placeholder UA against an installed Chromium-for-Testing v148. R-004's relational matrix dutifully emitted `Chrome/131.0.6778.110` (canonical for the bogus `minVersion: "131"` the placeholder hardcoded), but the binary serving TLS, fonts, and media-device IDs is real Chromium 148. Fingerprint validators that compare the spoofed UA against the actual binary's behavior caught the mismatch.

  **Three compounding causes, fixed in one pass.**

  - `@mochi.js/profiles.getProfile()` was a `throw new Error("not yet implemented")` stub. The six captured baselines on disk under `data/<id>/profile.json` (Chrome/146–147 UAs, Mac M4 / Mac Intel / Linux / Windows / mac-brave / mac-beta) were never read by the runtime. **Now**: `getProfile(id)` reads the captured `profile.json` via `Bun.file()`. New error classes `UnknownProfileIdError` (id outside `KNOWN_PROFILE_IDS`) and `ProfileBaselineMissingError` (id known but no baseline shipped yet) let callers distinguish the two failure modes. `hasProfile(id)` helper added.
  - `synthesizePlaceholderProfile()` in `@mochi.js/core/launch.ts` was hardcoded `minVersion: "131"`, `Chrome/131.0.0.0` UA. The launcher always called the placeholder for string ids, never `getProfile()`. **Now**: the launcher tries `getProfile(id)` first and only falls back to `synthesizePlaceholderProfile` on `ProfileBaselineMissingError` (catalog ids without captures yet) or on truly unknown ids (with a `console.warn` so typos stay visible — preserves the pre-0.8 contract that any string id produces a working session, important for synthetic test-fixture ids). The placeholder itself bumps `131 → 148`.
  - `@mochi.js/consistency`'s `BROWSER_TIP_FULL_VERSION` table topped out at `"147"` for chrome / edge / brave / arc. **Now**: adds `"148": "148.0.7778.97"` so R-004's tip-locked lookup resolves the new placeholder major to a real published patch.
  - `@mochi.js/cli` `PINNED_FALLBACK_VERSION` was `131.0.6778.85` (very stale). **Now**: `148.0.7778.97`, the live CfT stable pin verified in manifest tests. Capture-flow defaults that hardcoded Chrome/131 in `derive-profile.ts`, `capture/index.ts`, and `provenance.ts` JSDoc also bump to Chrome/148 so a fresh `mochi capture` produces a profile whose UA major matches the running binary.

  **Profile data fix — `linux-chrome-stable`.** The captured Linux baseline shipped with degraded GPU/display values that read as headless-server (SwiftShader) to Cloudflare Turnstile: `gpu.renderer: "Generic Renderer"`, `webglUnmaskedRenderer: "ANGLE (Generic)"`, 1280×800 display, 32 cores / 64GB, and a `sec-ch-ua` missing the branded "Google Chrome" entry (only `"Chromium";v="147"`). **Now**: realistic Intel Iris Xe values (`Intel Iris Xe Graphics` / `ANGLE (Intel Inc., Intel Iris Xe Graphics, OpenGL 4.1)`), 1920×1080, 8 cores / 16GB, and `sec-ch-ua: "Google Chrome";v="147", "Not.A/Brand";v="8", "Chromium";v="147"` — empirically validated as passing FingerprintJS Pro (bot=notDetected) and Cloudflare Turnstile in the wild.

  **Harness conformance — host-OS-matched profile + per-baseline asserts.** `CONFORMANCE_PROFILE` was hardcoded to `mac-m4-chrome-stable` for every host; this was silently masked pre-0.8 because the placeholder always returned a Linux profile regardless of id. Post-0.8 it loads the real Mac baseline on Linux CI, producing an OS mismatch that Cloudflare Turnstile catches. **Now**: `CONFORMANCE_PROFILE` resolves via `defaultProfileForHost()` (same decision table the launcher uses) — Linux CI gets `linux-chrome-stable`, Mac dev gets `mac-m4-chrome-stable`, etc. The audio + canvas fingerprint conformance test loads expected byte-exact hashes from the host-matched profile's `baseline.manifest.json` instead of hardcoding Mac M4's values, so it passes for any profile in the catalog with a captured baseline.

- Updated dependencies [22b2a02]
  - @mochi.js/core@0.8.1
  - @mochi.js/consistency@0.1.4
  - @mochi.js/harness@0.1.10

## 0.2.4

### Patch Changes

- Updated dependencies [52b5a45]
  - @mochi.js/core@0.8.0
  - @mochi.js/harness@0.1.9

## 0.2.3

### Patch Changes

- Updated dependencies [5705d38]
- Updated dependencies [d79b782]
- Updated dependencies [dd9a3c9]
  - @mochi.js/core@0.6.0
  - @mochi.js/consistency@0.1.3
  - @mochi.js/harness@0.1.8

## 0.2.2

### Patch Changes

- Updated dependencies [60dac27]
- Updated dependencies [a92cebf]
- Updated dependencies [5cb8160]
  - @mochi.js/core@0.4.0
  - @mochi.js/harness@0.1.7

## 0.2.1

### Patch Changes

- 6761997: Import 6+ real-device profiles from the wrkx harvester corpus and ship a
  new `mochi profiles import` CLI subcommand.

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
    `deriveProfile` pipeline.
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

- Updated dependencies [61ee52c]
- Updated dependencies [92b8a57]
  - @mochi.js/core@0.3.0
  - @mochi.js/consistency@0.1.2
  - @mochi.js/harness@0.1.6

## 0.2.0

### Minor Changes

- 7cb4997: First-run UX on Linux — close two opaque-crash surfaces.

  `mochi browsers install` now runs a `<binary> --version` smoke after extract on `linux64`. On `error while loading shared libraries: <name>.so` we parse the offending lib, print the verbatim apt install line for the canonical Chromium-for-Testing dep set (the same list both CI workflows install), and exit non-zero so the user knows the install isn't truly done. On success we print "Chromium binary verified — launches cleanly". The install command also prints a one-line warning if it detects `uid === 0` so the root-sandbox gotcha shows up before the launch crashes opaquely. The CLI does not auto-`sudo` — the user runs the apt line themselves.

  `@mochi.js/core` extends the v0.1.4 early-exit diagnostic in `proc.ts` with a second pattern matching the same missing-shared-libraries stderr — so any future `mochi.launch()` that hits this case (e.g. user installed mochi pre-v0.1.5 and ran the smoke before the apt-get) surfaces the same hint instead of the bare `BrowserCrashedError` / `EPIPE`.

  Both CI workflows + the new install path share a single `LINUX_RUNTIME_DEPS` constant in `packages/cli/src/lib/linux-deps.ts`; a contract test asserts the workflows install every dep in the constant so they cannot drift. Plus a "Linux runtime dependencies" Prerequisites block in `docs/quickstart.md` and `docs/content/docs/getting-started/install.md`.

### Patch Changes

- Updated dependencies [92eda96]
- Updated dependencies [7cb4997]
  - @mochi.js/core@0.2.2
  - @mochi.js/harness@0.1.5

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

- afeef48: Add `mochi browsers` subcommand surface and the programmatic `resolveChromiumBinary` helper that `@mochi.js/core` will consume.

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
