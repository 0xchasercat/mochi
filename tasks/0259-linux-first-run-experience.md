# 0259: first-run experience on Linux — sandbox + runtime-deps gotchas

**Package:** `cli` + docs + minor `core`
**Phase:** `0.2`
**Estimated size:** S
**Dependencies:** v0.1.3 / v0.1.4 (the early-exit diagnostic landed in v0.1.4)
**Source:** Two real first-time-user reports during v0.1.2 testing — (a) `EPIPE` from `mochi.launch()` when running as root without `--no-sandbox`; (b) `BrowserCrashedError` from a non-root user on a fresh Linux server with Chromium runtime deps missing.

## Goal

Make `bun add @mochi.js/core @mochi.js/cli && bunx mochi browsers install && bun run hello.ts` work on a fresh Linux server without surprise gotchas, OR fail loudly with an actionable error pointing at the exact apt install line. Today the first-time-user experience on a clean Ubuntu / Debian box is two consecutive opaque crashes (sandbox refusal, missing libs), each surfacing as `EPIPE` / `BrowserCrashedError`.

## Success criteria

- [ ] `mochi browsers install` post-extract: spawn `chrome --version` and capture stdout/stderr. If exit code is non-zero AND stderr contains `error while loading shared libraries:`, parse the missing `.so` name(s) and emit a clear error message naming the apt install command. Don't silently install — print the exact `sudo apt-get install ...` line and exit non-zero so the user knows the install isn't truly done.
- [ ] When stderr matches "no such file or directory" / "missing executable bit" / similar, surface those distinctly (different remediation path — possibly a partial unzip).
- [ ] **Don't auto-install the deps** — that requires sudo, which the CLI shouldn't assume. Print + exit-non-zero is the right shape.
- [ ] If `--version` succeeds, print "Chromium binary verified — launches cleanly" so the install completes with positive confirmation.
- [ ] Update the early-exit diagnostic in `packages/core/src/proc.ts` (already shipped in v0.1.4) so the missing-lib stderr tail also matches the "running as root" pattern's hint shape — currently the root hint exists but missing-lib hint doesn't. Add a second pattern.
- [ ] Update `docs/quickstart.md` Prerequisites: add a "Linux runtime dependencies" block alongside the existing "Linux gotcha — Chromium and root" block. Includes the verbatim apt install line. Order: install Bun → install runtime deps (Linux only) → `bun add` → `mochi browsers install`.
- [ ] Update `docs/content/docs/getting-started/install.md` (the docs site canonical install page) with the same Linux block.
- [ ] Cross-link the install error message ↔ the docs section so users can paste a search-friendly snippet.

## Out of scope

- Auto-installing system deps via sudo apt-get — sudo escalation belongs to the user, not the CLI.
- Detecting glibc version mismatches — Chromium-for-Testing pins glibc requirements; if the host is older, the user needs a different CfT build. Document but don't auto-handle.
- Windows / macOS first-run friction — both ship the runtime deps via the OS itself; not in scope.
- Container detection — running inside Docker/podman has its own quirks; separate brief.

## Implementation notes

- See `packages/cli/src/commands/browsers/install.ts` (or wherever the install command lives — verify) for where to add the post-extract `--version` smoke.
- `Bun.spawnSync({ cmd: [path, "--version"] })` is the right shape — synchronous is fine here; we want the install to block on the verification.
- Parse stderr with a small regex set, not heuristics:
  - `error while loading shared libraries: ([^:]+):` → missing lib
  - Match against the canonical Chromium-for-Testing dep list (Playwright's list is the de facto standard) and emit the apt install line for the matched libs only — or always print the full list for safety.
- The existing CI workflows (`.github/workflows/pr-fast.yml` + `release.yml`) have the canonical apt install line. Don't fork it; export it from `packages/cli/src/lib/linux-deps.ts` (or similar) and have both CI and the install command read from the same constant.
- For root detection on Linux, `os.userInfo().uid === 0` is the canonical check. Surface a one-line warning at install time if running as root, even before the binary smoke. Don't error out (some users genuinely need to run as root) — just inform.

## Validation

```sh
bun run typecheck && bun run lint && bun run test && bun run test:contract
# Manual: spin up a fresh ubuntu-24.04 Docker container without runtime deps,
# run `bunx mochi browsers install`, verify the apt install line is printed
# AND the install command exits non-zero. Then install deps, re-run, verify
# the green "binary verified" message.
```

## Submission

```sh
bun work create 0259 cli
cd worktrees/0259
# implement
bun work submit 0259 --draft
```
