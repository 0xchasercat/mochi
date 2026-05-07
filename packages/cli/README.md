# @mochi.js/cli

The `mochi` command-line for [mochi](https://github.com/0xchasercat/mochi).

```sh
bun add -d @mochi.js/cli
mochi --version
```

Subcommands (lands progressively):

| Command | Phase | What it does |
|---|---|---|
| `mochi browsers install` | 0.11 | Fetch pinned Chromium-for-Testing |
| `mochi capture` | 0.4 | Capture a baseline Probe Manifest from a real device |
| `mochi harness` | 0.5 | Run the validation harness manually |
| `mochi work` | 0.0+ | Worktree dev harness — `create`, `list`, `open`, `submit`, `clean` |
| `mochi version` | 0.0 | ✓ available now |

**Status:** v0.0.1 claim release. Only `version` is wired.

See [PLAN.md §5.8 and §15.2](https://github.com/0xchasercat/mochi/blob/main/PLAN.md).
