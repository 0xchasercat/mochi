# 0010: `mochi browsers install` — Chromium-for-Testing downloader

**Package:** `cli`
**Phase:** `0.1`
**Estimated size:** M
**Dependencies:** 0001, 0002 (already merged)

## Goal

Implement the `mochi browsers` subcommand surface per PLAN.md §5.8 — fetch a pinned Chromium-for-Testing build from Google's CfT registry, unpack it under `~/.mochi/browsers/<channel>-<version>/`, expose a programmatic `resolveChromiumBinary(opts)` for `@mochi.js/core` (task 0011) to consume.

After this lands, a developer can `bun add -d @mochi.js/cli && bunx mochi browsers install`, and `@mochi.js/core` (when 0011 lands) finds the binary automatically without anyone hardcoding paths.

## Success criteria

- [ ] `mochi browsers install [--channel <stable|beta>] [--version <X.Y.Z.W>] [--platform <plat>] [--force]` works:
  - Defaults: `channel=stable`, version auto-resolved from the CfT manifest, platform auto-detected from `process.platform + process.arch`.
  - Idempotent: re-running with same args is a no-op (logs `already installed at <path>`).
  - Downloads via Bun's native `fetch` (no node-fetch, no axios). Streams to disk via `Bun.file(...).writer()`.
  - Verifies SHA256 from the CfT manifest entry **before** unpacking. On hash mismatch: delete partial download, exit non-zero with a clear cause.
  - Unpacks the `.zip` atomically: extract to a sibling tmpdir, then `rename` into the canonical install path. No half-extracted state visible to readers.
  - `--force` re-downloads + re-verifies + reinstalls even if the canonical path exists.
- [ ] `mochi browsers list` prints a table of installed binaries: `channel | version | platform | path | size`. Empty-state message clean.
- [ ] `mochi browsers path [--channel <c>] [--version <v>]` prints the absolute path of the resolved binary on stdout (single line, no decoration). Designed for `BIN="$(mochi browsers path)"`. Resolution order: explicit `--version` > explicit `--channel` (latest installed in that channel) > most recently installed > error.
- [ ] `mochi browsers uninstall <version> [--yes]` removes the install dir. Confirms unless `--yes`.
- [ ] Programmatic API exported from `@mochi.js/cli`:
  ```ts
  export async function resolveChromiumBinary(opts?: {
    channel?: "stable" | "beta";
    version?: string;
    platform?: string;
    /** Override the install root. Default: ~/.mochi/browsers */
    root?: string;
  }): Promise<{ path: string; channel: string; version: string; platform: string }>;
  ```
  - Resolution order matches the CLI: env `MOCHI_CHROMIUM_PATH` override (if set, return as-is, version="env-override") > explicit version > most recent in channel > error with friendly message pointing at `mochi browsers install`.
- [ ] CfT manifest fetching: use `https://googlechromelabs.github.io/chrome-for-testing/known-good-versions-with-downloads.json` (or whatever the current CfT canonical URL is — verify via `curl` first; document the URL choice in a code comment with date). Cache the manifest JSON for 1h in `~/.mochi/browsers/.manifest-cache.json` to avoid re-fetching during a session.
- [ ] **Hardcoded fallback default version** in source: pin a known-good Chromium version (suggest `131.0.6778.85` or whatever's stable on this date — verify it exists in the CfT manifest before pinning). Used when (a) network is down and (b) no `--version` provided. Logged as `(using pinned default; manifest fetch failed: <cause>)`.
- [ ] Platform mapping table covers: `darwin-arm64` → `mac-arm64`, `darwin-x64` → `mac-x64`, `linux-x64` → `linux64`, `linux-arm64` → `linux64` (CfT doesn't ship Linux ARM yet — error clearly), `win32-x64` → `win64`. Document the map in a code comment.
- [ ] Binary path within the unpacked tree (per platform — the `chrome` binary is nested):
  - `mac-*`: `<root>/chrome-mac-*/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`
  - `linux64`: `<root>/chrome-linux64/chrome`
  - `win64`: `<root>\chrome-win64\chrome.exe`
- [ ] Unit tests for: CfT manifest parsing, platform mapping, version resolution logic, path computation, friendly error formatting. Mocked I/O — tests don't actually download.
- [ ] Integration test (gated on `MOCHI_E2E=1` env var so it doesn't run by default in CI): downloads into a temp dir (`MOCHI_BROWSERS_ROOT=/tmp/mochi-test-<uuid>` env override), runs install, runs list, runs path, asserts the binary is executable. Skipped without the env var so default `bun test` runs in <2s.
- [ ] All gates green: typecheck, lint, test, test:contract.
- [ ] No new runtime deps beyond what's already in `@mochi.js/cli`. Devdeps OK if essential (e.g., a small zip lib if shelling out to `unzip` is too brittle).

## Out of scope

- Auto-update / channel-following (manual via `--version` is fine for v1).
- Headless-shell variants — desktop Chromium only.
- Mobile Chromium / Android.
- Profile / user-data-dir management — that's per-session in 0011 (`mkdtemp`'d, deleted on close).
- A standalone npm package for the downloader — lives in `@mochi.js/cli` for v1.
- Mirror-server fallback — only the canonical Google CfT registry. Document the limitation.
- Wiring into `@mochi.js/core` — that's task 0011's responsibility; 0010 just provides the resolver function and CLI surface.

## Implementation notes

- The whole feature lives under `packages/cli/src/browsers/`:
  - `index.ts` — exports `resolveChromiumBinary` and helpers
  - `manifest.ts` — CfT manifest fetcher + parser, cache layer
  - `install.ts` — download + verify + extract pipeline
  - `paths.ts` — platform/version path helpers
  - `subcommand.ts` — `mochi browsers <action>` dispatch (install/list/path/uninstall)
  - `__tests__/*.test.ts` — units
- `packages/cli/src/index.ts` `main()` adds case `"browsers"` → calls `subcommand.ts` dispatcher. The existing `version` case stays.
- For `unzip`: prefer shelling out to system `unzip` via `Bun.spawn(["unzip", "-q", "-d", dest, src])`. macOS, Linux, and Windows-with-Git-Bash all ship it. If `unzip` isn't on PATH, error clearly. Document the dep in a code comment. Do **not** add a JS zip library to runtime deps.
- For SHA256: `Bun.CryptoHasher` (`new Bun.CryptoHasher("sha256")`).
- For atomic rename: download to `<root>/.tmp-<rand>/`, extract, then `Bun.file(...)` is fine but you'll need `await Bun.$\`rename ...\`` or `node:fs/promises.rename` (Node-style is acceptable for this single FS op since Bun re-exports it; no shell-out for a portability-critical op).
- Hashing the entire zip archive is fine; CfT publishes per-asset hashes.
- For network errors: distinguish ENOTFOUND/ECONNREFUSED ("offline?") from 404 ("version doesn't exist?"). Surface the right hint in `fatal()`.
- Manifest schema validation: parse defensively. CfT can change shape over time; if a required field is missing, fail with `manifest format unexpected — open an issue` not a stack trace.
- Use the conventional commits scope `cli` for all commits in this task.

## Validation

```sh
bun typecheck
bun lint
bun test
bun test:contract --pkg=cli

# manual smoke (if you have network)
mkdir -p /tmp/mochi-test
MOCHI_BROWSERS_ROOT=/tmp/mochi-test bun packages/cli/src/bin.ts browsers install
MOCHI_BROWSERS_ROOT=/tmp/mochi-test bun packages/cli/src/bin.ts browsers list
MOCHI_BROWSERS_ROOT=/tmp/mochi-test bun packages/cli/src/bin.ts browsers path
"$(MOCHI_BROWSERS_ROOT=/tmp/mochi-test bun packages/cli/src/bin.ts browsers path)" --version
rm -rf /tmp/mochi-test

# E2E test (slow; only if you want to confirm)
MOCHI_E2E=1 bun test packages/cli/src/browsers/__tests__/install.e2e.test.ts
```

When everything's green: `bun work submit 0010 --draft`.

## Touch list (rough)

- `packages/cli/src/browsers/{index,manifest,install,paths,subcommand}.ts` (new)
- `packages/cli/src/browsers/__tests__/*.test.ts` (new)
- `packages/cli/src/index.ts` (route `browsers` case)
- `packages/cli/src/__tests__/smoke.test.ts` (extend with `browsers --help` smoke)
- `packages/cli/package.json` (no new runtime deps expected; verify)
- `tasks/0010-mochi-browsers-install.md` (this file — already committed)
