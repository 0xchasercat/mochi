# Contributing

Thanks for the interest. mochi is small enough that a serious contribution moves the project; it is also opinionated enough that a contribution off-axis costs more to merge than to land. Read this first.

## Before you write code

1. Read [`PLAN.md`](PLAN.md). It is the design contract — the 8 architectural invariants in §2 are non-negotiable (no C++, no proprietary integrations, Bun-only, stock Chromium, relational consistency, Probe Manifest is truth, harness is the gate, honesty over marketing).
2. Read [`AGENTS.md`](AGENTS.md). It is the operating manual — it describes the `bun work` workflow, how worktrees and tasks map to PRs, the gates you run locally, and the conventional-commit + commitlint rules.
3. Read [`docs/limits.md`](docs/limits.md). If your change addresses a documented limit, link the entry in the PR. If it changes the truth-value of an entry, update the same file in the same PR.

If any of those three reads contradicts what you want to build: open an issue first. Don't write a PR you'll have to unwind.

## Making a change

The full workflow lives in [`AGENTS.md`](AGENTS.md) §3. Short version:

```sh
bun work create <task-id> <package>   # spawns a worktree under worktrees/<id>/
cd worktrees/<task-id>
# … do the work …
bun run typecheck && bun run lint && bun test
bun work submit <task-id> --draft     # opens a draft PR with the brief prefilled
```

Tasks live in [`tasks/<id>-<slug>.md`](tasks/). If you're contributing without a pre-written task brief, open one as a PR first and let the orchestrator weigh it before you write code.

## Commit + PR conventions

- Conventional commits, enforced by `commitlint`. Valid scopes: `core`, `consistency`, `inject`, `net`, `net-rs`, `behavioral`, `profiles`, `harness`, `cli`, `repo`, `docs`, `schemas`. Examples: `feat(core): pipe-mode CDP transport`, `docs(repo): comparison table refresh`, `fix(net-rs): postinstall asset filename map`.
- One task per PR. If you discover unrelated drift, file a separate task.
- Draft PRs are the default. Mark ready when the harness Zero-Diff gate is green.
- Don't merge your own PR. The orchestrator squash-merges.

## What gets gated

- `bun run typecheck` (project-wide TypeScript).
- `bun run lint` (Biome).
- `bun test` (per-package + workspace).
- The harness Probe-Manifest diff against the committed baseline. Intentional divergences live in `expected-divergences.json` next to a written rationale.

If a hook fails on commit, fix the underlying issue and create a new commit. Do not `--amend` past a failed pre-commit; that drops uncommitted work into the previous commit's tree. (See [`AGENTS.md`](AGENTS.md) on this.)

## Code of conduct

Be direct, be technically precise, push back when something is wrong. Silence is a failure mode. No personal attacks, no marketing fluff in code comments.

## License

By contributing you agree that your contribution is licensed under the MIT License (see [`LICENSE`](LICENSE)).
