---
title: "@mochi.js/cli — the `mochi` binary"
description: "Subcommands: browsers, capture, harness, profiles, work, version. Plus the programmatic re-exports."
order: 9
category: api
lastUpdated: 2026-05-09
---

`@mochi.js/cli` ships the `mochi` binary plus a thin programmatic surface (the `mochi browsers …` helpers re-exported for `@mochi.js/core`'s binary resolution). The binary is the single entry point for installing Chromium-for-Testing, capturing a baseline `ProfileV1` from a real device, running the harness, and proxying to the in-tree `mochi work` worktree harness. Every subcommand is `bunx mochi <sub>` (or `bun run mochi <sub>` from inside the monorepo).

## Installation

```sh
bun add -g @mochi.js/cli
# Then:
mochi --help
```

Inside the monorepo, `bun work` (an alias for `bun scripts/mochi-work.ts`) and `bunx mochi` resolve to the local checkout — no install needed.

## Subcommands

```text
mochi browsers     manage Chromium-for-Testing installs
mochi capture      capture a baseline ProfileV1 from a real device
mochi harness      run the validation harness against a profile
mochi profiles     manage the local profile catalog (import from harvester)
mochi work         worktree dev harness (proxies to scripts/mochi-work.ts)
mochi version      print the CLI version
```

The full list is exported as a const-tuple:

```ts
const SUBCOMMANDS = ["browsers", "capture", "harness", "profiles", "work", "version"] as const;
type Subcommand = (typeof SUBCOMMANDS)[number];
```

### `mochi browsers`

```text
mochi browsers install   [--channel <stable|beta>] [--version <X.Y.Z.W>]
                         [--platform <plat>] [--force] [--sha256 <hex>]
                         [--root <path>] [--offline] [--no-cache]
mochi browsers list      [--root <path>]
mochi browsers path      [--channel <c>] [--version <v>] [--platform <p>] [--root <path>]
mochi browsers uninstall <version> [--channel <c>] [--platform <p>] [--root <path>] [--yes]
```

Manages CfT installs under `~/.mochi/browsers/` (or `$MOCHI_BROWSERS_ROOT`). `mochi browsers install` downloads, SHA-256-verifies (when `--sha256` is supplied), unzips, and stamps a `.mochi-meta.json` so future `mochi browsers list` and `resolveChromiumBinary` calls can find it. The CfT registry doesn't publish per-asset hashes, so the install records the SHA-256 it computed itself for drift detection.

`unzip` must be on PATH (macOS, Linux, Git-Bash all ship it). Default platform is auto-detected (`mac-arm64`, `mac-x64`, `linux64`, `win64`).

```sh
mochi browsers install                         # latest stable, current platform
mochi browsers install --channel beta
mochi browsers install --version 148.0.7778.97 --sha256 e3b0c44...
mochi browsers list
mochi browsers path                             # → /Users/.../mochi/browsers/.../chrome
mochi browsers uninstall 147.0.7390.66 --yes
```

`MOCHI_CHROMIUM_PATH` overrides every other resolution rule when set.

### `mochi capture`

```text
mochi capture --profile-id <id> [--browser <path>] [--out <dir>] [--seed <s>]
              [--no-headless] [--interactive]
              [--capturer <name>] [--machine <model>]
              [--browser-version <v>] [--mochi-version <v>] [--notes <text>]
```

Drives a bare, un-spoofed Chromium (`bypassInject: true`) against `tests/fixtures/probe-page.html`, derives a `ProfileV1` from the captured probes, validates against `schemas/profile.schema.json`, and writes:

```
<out>/<profile-id>/
├── profile.json
├── baseline.manifest.json
└── PROVENANCE.md
```

Default `<out>` is `packages/profiles/data/`. Default seed is `capture-<id>`.

> **Safety.** The captured `ProfileV1` inherits the device's REAL fingerprint values. Don't run `mochi capture` on a machine you wouldn't use to publish a profile (PLAN.md §12.2 — provenance discipline).

```sh
mochi capture --profile-id my-laptop-chrome \
  --capturer "your-name" --machine "MacBook Pro M4" \
  --browser-version "147.0.7390.0"
```

`MOCHI_CHROMIUM_PATH` is honored for the binary resolution path.

### `mochi harness`

```text
mochi harness <profile-id> [--include-online] [--out <dir>]
                           [--browser <path>] [--seed <s>] [--no-headless]
mochi harness all          [--include-online] [--out <dir>]
                           [--browser <path>] [--no-headless]
```

Runs `runHarnessAgainstProfile(profileId, opts)` from `@mochi.js/harness` against one profile (or every profile under `packages/profiles/data/`). Without `--out`, prints the verdict + counts + `structuralMatchPct`. With `--out <dir>`, writes `<dir>/<profile-id>/{report.json,report.html}` next to the verdict line.

PR gate: `counts.material === 0`.

```sh
mochi harness linux-chrome-stable
# verdict EQUIVALENT  guid=12 intentional=3 material=0  match=98.7%

mochi harness all --out ./tmp/reports
```

Exit codes:

| Code | Meaning |
| --- | --- |
| `0` | `EQUIVALENT` (`counts.material === 0`) |
| `1` | `DIVERGED` (`counts.material > 0`) |
| `2` | Usage error |

`--include-online` is plumbed for v0.5.x but currently throws ("not yet wired" — PLAN.md §13.5).

### `mochi profiles`

```text
mochi profiles import <visitor-id> --as <profile-id> [--out <dir>] [--api <root>] [--dry-run]
```

Pulls a consolidated visitor record from a harvester API (`MOCHI_HARVESTER_API` env or `--api`), normalizes per-category snapshot shape, derives a `ProfileV1`, and emits the canonical 4-file profile dir:

```
packages/profiles/data/<profile-id>/
├── profile.json
├── baseline.manifest.json
├── expected-divergences.json
└── PROVENANCE.md
```

When the visitor record contains multiple snapshots per category (re-visits over time), the importer keeps the most recent by `created_at`.

**Brave UA-mask gate.** When `--as` ends with `brave-stable` (or contains `brave`), the importer checks that the captured navigator surface looks like plain Chrome (UA reports Chrome, `navigator.brave` absent). If the mask leaks, the import is refused — a Brave-fingerprint stamped as Chrome would mis-spoof.

```sh
mochi profiles import 6c47b1f8-... --as mac-chrome-stable
mochi profiles import 6c47b1f8-... --as mac-brave-stable --dry-run
```

Exit codes:

| Code | Meaning |
| --- | --- |
| `0` | Profile written |
| `1` | Import rejected (Brave mask leak / mobile snapshot / fetch failure / etc.) |
| `2` | Usage error |

### `mochi work`

```text
mochi work create <task-id> <package>     create worktree + branch from origin/main
mochi work list                            list active worktrees
mochi work open <task-id>                  print the absolute path of a worktree
mochi work submit <task-id> [--draft]      run gates, push, and open a PR
mochi work clean [--merged-only|--all]     remove worktrees (default: merged-only)
```

Proxies to `scripts/mochi-work.ts` from the in-tree monorepo (resolved by walking up from `process.cwd()` until `scripts/mochi-work.ts` is found). Outside the monorepo, exits 1 with a hint to run `bun work` from inside it. Internal monorepo tooling — not part of the public CLI contract.

```sh
mochi work create 0270 docs/site
# → opens worktree at .worktrees/0270-… on branch task/0270
mochi work submit 0270 --draft
mochi work clean --merged-only
```

### `mochi version`

```sh
mochi version
mochi --version
mochi -v
```

Prints `mochi v<VERSION>` (the CLI package version, currently `"0.0.1"` — claim release).

## Programmatic surface

The `@mochi.js/cli` package re-exports the browsers helpers so `@mochi.js/core` can resolve the Chromium binary at launch.

### `function resolveChromiumBinary(opts?: ResolveChromiumOpts): Promise<ResolvedChromium>`

Resolution order (the same one `mochi.launch({ binary })` uses internally):

1. `$MOCHI_CHROMIUM_PATH` → returned as-is, `version: "env-override"`.
2. Explicit `version` (and optional `channel`) → exact match in installed set.
3. Explicit `channel` (no version) → most recently installed in that channel.
4. No args → most recently installed install (any channel).
5. None of the above → throw `ChromiumNotFoundError` pointing at `mochi browsers install`.

```ts
import { resolveChromiumBinary } from "@mochi.js/cli";

const r = await resolveChromiumBinary({ channel: "stable" });
console.log(r.path, r.version, r.platform);
```

### `interface ResolveChromiumOpts`

```ts
interface ResolveChromiumOpts {
  readonly channel?: Channel;       // "stable" | "beta"
  readonly version?: string;
  readonly platform?: string;
  readonly root?: string;           // default ~/.mochi/browsers (or $MOCHI_BROWSERS_ROOT)
}
```

### `interface ResolvedChromium`

```ts
interface ResolvedChromium {
  readonly path: string;
  readonly channel: string;
  readonly version: string;
  readonly platform: string;
}
```

### `function listInstalled(root?: string): Promise<InstalledBrowser[]>`

Walk `<root>/*`, read each `.mochi-meta.json`, return one entry per directory. Sorted most-recently-installed first. Foreign installs / partial extractions are silently skipped.

### `interface InstalledBrowser`

```ts
interface InstalledBrowser {
  readonly installDir: string;
  readonly binaryPath: string;
  readonly meta: InstallMeta;
}
```

### `function install(opts): Promise<InstallResult>`

The download/verify/extract/finalize pipeline. Used internally by `mochi browsers install`. Most consumers should shell out to the binary instead.

### `function defaultInstallRoot(): string`

`~/.mochi/browsers` (or `$MOCHI_BROWSERS_ROOT`).

### `function detectPlatform(): CftPlatform | null`

Map the runtime's platform/arch to a CfT-compatible identifier (`mac-arm64`, `mac-x64`, `linux64`, `win64`). Returns `null` on unsupported platforms.

### `class ChromiumNotFoundError extends Error`

Thrown by `resolveChromiumBinary` when no install matches. The message points at `mochi browsers install`.

### Other re-exports

```ts
type CftPlatform;
type Channel;
type InstallMeta;
type InstallResult;
const PINNED_FALLBACK_VERSION: string;
```

### `const VERSION: string`

The CLI package version (`"0.0.1"`).

### `function main(argv: readonly string[]): Promise<number>`

The dispatch entry point. `bin.ts` calls `main(Bun.argv.slice(2))`. Returns the process exit code.

## Environment variables

| Var | Used by | Effect |
| --- | --- | --- |
| `MOCHI_CHROMIUM_PATH` | `core`, `harness`, `capture` | Bypass binary resolution; use this path directly |
| `MOCHI_BROWSERS_ROOT` | `browsers` | Override install root (default `~/.mochi/browsers`) |
| `MOCHI_HARVESTER_API` | `profiles` | Harvester base URL (required for `mochi profiles import`) |
| `MOCHI_E2E` | `harness` | `=1` enables E2E gates (otherwise tests skip) |
| `MOCHI_ONLINE` | `harness` | `=1` enables network-gated probes (requires `MOCHI_E2E=1`) |
| `MOCHI_PROXY` | `harness` | Proxy URL for `launchStealthSession` |
| `MOCHI_PROBE_PAGE` | `harness`, `capture` | Absolute path to a `probe-page.html` fixture; overrides the repo-root walk |

## Common patterns

### First-run setup on a fresh machine

```sh
bunx mochi browsers install
bunx mochi browsers list
bun -e 'import("@mochi.js/core").then(({ mochi }) => mochi.launch({ profile: "linux-chrome-stable", seed: "x" }).then(s => s.close()))'
```

### Capture and validate a profile in CI

```sh
mochi capture --profile-id ci-linux --capturer ci-bot
mochi harness ci-linux
```

### Resolve a binary programmatically (instead of shelling out)

```ts
import { resolveChromiumBinary } from "@mochi.js/cli";
import { mochi } from "@mochi.js/core";

const { path } = await resolveChromiumBinary();
const session = await mochi.launch({ profile: "linux-chrome-stable", seed: "x", binary: path });
```

## See also

- [Getting started → Install](/docs/getting-started/install)
- [Getting started → Linux server](/docs/getting-started/linux-server)
- [Guides → Capture a profile](/docs/guides/capture-a-profile)
- [Guides → Conformance suite](/docs/guides/conformance-suite)
- [API → @mochi.js/core](/docs/api/core)
- [API → @mochi.js/harness](/docs/api/harness)
- [API → @mochi.js/profiles](/docs/api/profiles)

<!-- llm-context:start
Package: @mochi.js/cli (binary: `mochi`)
Public surface (verbatim from packages/cli/src/index.ts as of 2026-05-09):

  VERSION                                          (const "0.0.1")
  SUBCOMMANDS                                      (const tuple: ["browsers", "capture", "harness", "profiles", "work", "version"])
  Subcommand                                       (type)
  main(argv: readonly string[]): Promise<number>
  proxyToWork(workArgs: readonly string[]): Promise<number>   (@internal but exported)

Re-exports (from packages/cli/src/browsers/index.ts):
  CftPlatform                                      (type)
  Channel                                          (type)
  ChromiumNotFoundError                            (class)
  defaultInstallRoot(): string
  detectPlatform(): CftPlatform | null
  InstalledBrowser                                 (interface)
  InstallMeta                                      (type)
  InstallResult                                    (type)
  install(opts): Promise<InstallResult>            (the download/verify/extract pipeline)
  listInstalled(root?: string): Promise<InstalledBrowser[]>
  PINNED_FALLBACK_VERSION                          (const)
  ResolveChromiumOpts                              (interface)
  ResolvedChromium                                 (interface)
  resolveChromiumBinary(opts?): Promise<ResolvedChromium>

Subcommand binaries (verbatim help text from packages/cli/src/<sub>/subcommand.ts):

  mochi browsers install/list/path/uninstall ...
  mochi capture --profile-id <id> ...
  mochi harness <profile-id|all> ...
  mochi profiles import <visitor-id> --as <profile-id> ...
  mochi work create/list/open/submit/clean ...     (proxies to scripts/mochi-work.ts)
  mochi version  (also `--version`, `-v`)

Common LLM hallucinations (DO NOT USE):
- `mochi run <profile>` / `mochi launch <profile>` — there is NO `run` or `launch` subcommand. Use the SDK (`mochi.launch` from @mochi.js/core)
- `mochi profile create <id>` — the verb is `mochi capture` (locally-captured) or `mochi profiles import` (harvester-imported)
- `mochi profile list` — listing is via `mochi browsers list` (browser binaries) or filesystem (`ls packages/profiles/data/`)
- `mochi install` (without `browsers` token) — must say `mochi browsers install`
- `mochi update <package>` — there is no update subcommand
- `mochi proxy <url>` / `mochi config` — no such subcommands
- `mochi harness --headless=true` — the flag is `--no-headless` (boolean inverter; default IS headless)
- `mochi harness <profile> --output <dir>` — flag is `--out`, not `--output`
- `mochi browsers uninstall <channel>` — first positional is the VERSION, not the channel
- `mochi work submit --pr` — flag is `--draft` (or omit for non-draft)
- `mochi work create --branch <name>` — branch name is derived from `<task-id>`, not user-supplied
- `npx mochi …` — works under bun's compat shim but the canonical invocation is `bunx mochi …`
- `mochi capture --profile <id>` — the flag is `--profile-id` (not `--profile`)
- `mochi harness --profile <id>` — `<profile-id>` is a POSITIONAL arg, not a flag
- `resolveChromiumBinary` returning `{path, sha256}` — return shape is `{ path, channel, version, platform }`
- `listInstalled` returning a `Map<string, InstalledBrowser>` — returns an array

Cross-references:
- /docs/getting-started/install
- /docs/getting-started/linux-server
- /docs/guides/capture-a-profile
- /docs/guides/conformance-suite
- /docs/api/core
- /docs/api/harness
- /docs/api/profiles
llm-context:end -->
