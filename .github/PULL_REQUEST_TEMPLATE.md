<!--
  Read AGENTS.md and your task brief before opening this PR.
  Fill in every section. Don't delete sections; mark N/A if truly not applicable.
-->

## What

<!-- 1–3 sentences. What this PR does. -->

## Why

<!-- 1–3 sentences. Why now. Link to PLAN.md section or task brief. -->

## Package(s) touched

- [ ] @mochi.js/core
- [ ] @mochi.js/consistency
- [ ] @mochi.js/inject
- [ ] @mochi.js/net
- [ ] @mochi.js/net-rs
- [ ] @mochi.js/behavioral
- [ ] @mochi.js/profiles
- [ ] @mochi.js/harness
- [ ] @mochi.js/cli
- [ ] repo / docs / schemas

## Task brief

<!-- e.g. Closes #0042 (path: tasks/0042-cdp-pipe-transport.md) -->
Closes #

## Gates

- [ ] `bun typecheck` clean
- [ ] `bun lint` clean (biome)
- [ ] `bun test` per-affected-package: pass
- [ ] `bun test:contract --pkg=<pkg>`: pass
- [ ] `bun harness:smoke --affected`: Zero-Diff (or mark N/A if no inject/consistency/profiles change)
- [ ] `docs/limits.md` updated if any new JS-only-uncoverable surface discovered
- [ ] PROVENANCE.md updated if any profile re-captured
- [ ] Changeset added (`bun changeset`) for user-visible changes
- [ ] No new C++ work introduced (PLAN.md I-1)
- [ ] No proprietary integrations introduced (PLAN.md I-2)
- [ ] No `Runtime.enable` send-paths introduced (PLAN.md §8.2)

## Probe Manifest diff

<!-- If you touched @mochi.js/inject, @mochi.js/consistency, or @mochi.js/profiles,
     paste the output of `bun harness:diff <profile>` below.
     Otherwise mark N/A. -->

```
N/A
```

## Notes for review

<!-- Tradeoffs, follow-ups, gotchas, anything the reviewer should look at first. -->
