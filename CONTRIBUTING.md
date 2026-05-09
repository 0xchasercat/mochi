# Contributing

Thanks for the interest. mochi is small enough that a serious contribution moves the project; it is also opinionated enough that a contribution off-axis costs more to merge than to land. Read this first.

## Before you write code

1. Read [`PLAN.md`](PLAN.md). It is the design contract — the 8 architectural invariants in §2 are non-negotiable (no C++, no proprietary integrations, Bun-only, stock Chromium, relational consistency, Probe Manifest is truth, harness is the gate, honesty over marketing).
2. Read the [Limits page](https://mochijs.com/docs/reference/limits). If your change addresses a documented limit, link the entry in the PR. If it changes the truth-value of an entry, update the same file in the same PR.
3. Skim the [Comparison page](https://mochijs.com/docs/reference/comparison). It documents what mochi explicitly does differently from peer tools and why; the patterns we deliberately *did not* adopt are part of the design.

If any of those reads contradicts what you want to build, open an issue first. Don't write a PR you'll have to unwind.

## Making a change

```sh
git clone https://github.com/0xchasercat/mochi.git
cd mochi
bun install              # installs deps + git hooks
bun run typecheck
bun run lint
bun run test
```

Develop on a branch, push, open a PR against `main`. The pre-push hook (`.githooks/pre-push`) runs typecheck, lint, unit tests, and contract tests on every push — so a green local push is also a clean CI starting point.

Larger changes that span packages or might violate an invariant are easier as an issue first. Concrete code with a coherent rationale lands fastest.

## Commit + PR conventions

- **Conventional commits**, enforced by `commitlint`. Valid scopes: `core`, `consistency`, `inject`, `net`, `net-rs`, `behavioral`, `profiles`, `harness`, `cli`, `challenges`, `repo`, `docs`, `schemas`.
  Examples: `feat(core): pipe-mode CDP transport`, `docs(repo): comparison table refresh`, `fix(net-rs): postinstall asset filename map`.
- **One topic per PR.** If you discover unrelated drift, file a second PR.
- **Draft PRs are the default.** Mark ready when CI is green.
- **The pre-push hook is the gate.** If it blocks, fix the failure rather than bypassing it; CI will reject the same thing anyway.
- **`@ts-ignore` / `// biome-ignore` are not acceptable shortcuts.** Use `@ts-expect-error` with a one-line rationale, or fix the underlying type.

## What CI gates

- `bun run typecheck` (project-wide TypeScript, strict mode).
- `bun run lint` (Biome — formatter + linter; warnings are not failures, errors are).
- `bun run test` (per-package + workspace unit tests).
- `bun run test:contract` (cross-package contract tests under `tests/contract/`).
- The harness Probe-Manifest diff against the committed baselines. Intentional divergences live in each profile's `expected-divergences.json` next to a written rationale.

The pre-push hook runs the first four locally before any push leaves your machine. CI re-runs them plus the conformance suites (`bun run conformance:stealth`, `bun run conformance:humanize`).

If a hook fails on commit, fix the underlying issue and create a new commit. Do not `--amend` past a failed pre-commit; that drops uncommitted work into the previous commit's tree.

## Documentation contributions

- Site content lives under `docs/content/docs/**`. Edit the markdown directly; the Astro site at `docs/site/` reads from those files.
- The README and per-package READMEs are repo-canonical. Cross-link to mochijs.com URLs from there, not to local paths.
- The [Limits page](https://mochijs.com/docs/reference/limits) (`docs/content/docs/reference/limits.md`) is the canonical honesty document. Edits there must be added in the same PR that creates or closes the limit.

## Code of conduct

Be direct, be technically precise, push back when something is wrong. Silence is a failure mode. No personal attacks, no marketing fluff in code comments.

## License

By contributing you agree that your contribution is licensed under the MIT License (see [`LICENSE`](LICENSE)).
