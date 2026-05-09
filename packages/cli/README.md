# @mochi.js/cli

The `mochi` command-line for [mochi](https://github.com/0xchasercat/mochi).

```sh
bun add -d @mochi.js/cli
mochi --version
```

## Subcommands

| Command | What it does |
|---|---|
| `mochi browsers install` | Fetch + verify the pinned Chromium-for-Testing build into `~/.cache/mochi/chromium/`. |
| `mochi browsers list` | List installed CfT builds. |
| `mochi browsers uninstall <version>` | Remove a cached build. |
| `mochi capture` | Capture a baseline Probe Manifest from a real device (used by the harness gate). |
| `mochi harness` | Run the validation harness manually (smoke / conformance / Zero-Diff diff against baselines). |
| `mochi profiles` | List + inspect the shipped profile catalog. |
| `mochi work` | Worktree dev harness — `create`, `list`, `open`, `submit`, `clean`. |
| `mochi version` | Print the CLI + core versions. |

**Status:** shipping in v0.2 (`@mochi.js/cli` 0.2.x). All subcommands above are wired.

See [PLAN.md §5.8 and §15.2](https://github.com/0xchasercat/mochi/blob/main/PLAN.md) for design intent and the [quickstart](https://github.com/0xchasercat/mochi/blob/main/docs/quickstart.md) for the 5-minute first-run flow.
