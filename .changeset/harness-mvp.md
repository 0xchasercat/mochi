---
"@mochi.js/harness": minor
"@mochi.js/cli": patch
---

Phase 0.5 — `@mochi.js/harness` MVP + `mochi harness` subcommand.

- **`@mochi.js/harness`** ships the five public functions (`capture`, `normalize`, `diff`, `categorize`, `report`) and the `runHarnessAgainstProfile` orchestrator. Drives a Mochi-spoofed session through `tests/fixtures/probe-page.html`, normalizes per-session entropy on both the captured manifest and the committed baseline, structurally diffs the two, and categorizes each divergence as `guid-class` | `intentional` | `material`. PR gate: `counts.material === 0` (PLAN.md §13.6).
- **`mochi harness <profile-id>`** + **`mochi harness all`** runs the harness from the CLI. Without `--out`, prints verdict + counts. With `--out <dir>`, writes `report.json` + `report.html` for each profile.
- Per-profile **`expected-divergences.json`** ships at `packages/profiles/data/<id>/expected-divergences.json`. Glob paths are categorized as `intentional`. Every entry has a human-readable `comment` — phase-0.7-deferred surfaces (audio bytes, canvas hash, full WebGL extensions, full font lists, MediaDevices, SpeechSynthesis voices, etc.) are pre-populated for `mac-m4-chrome-stable`.
- Root **`bun harness:smoke`** / **`bun harness:full`** / **`bun harness:diff <id>`** scripts replace the v0.0 echo placeholders.
- `pr-fast.yml` gains a soft-fail `bun harness:smoke` step. Hard-fail flips on at the end of phase 0.7.
