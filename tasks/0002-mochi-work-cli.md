# 0002: `mochi-work` CLI — the worktree dev harness

**Package:** `repo` (touches `scripts/`, root `package.json`, `AGENTS.md`, `@mochi.js/cli`)
**Phase:** `0.0`
**Estimated size:** M
**Dependencies:** 0001 (already merged)

## Goal

Build `scripts/mochi-work.ts` — the worktree dev harness CLI per PLAN.md §15.2. After this lands, every future task is dispatched via `bun work create <id> <package>`, eliminating hand-rolled `git worktree add` ceremony and enforcing the gates-then-PR contract uniformly.

This is the linchpin of the parallelized agent workflow. Treat it as production code: type-strict, well-tested, friendly errors.

## Success criteria

- [ ] `scripts/mochi-work.ts` is a Bun-native, shebanged TypeScript file. No external CLI-framework deps.
- [ ] Subcommands implemented:
  - `bun work create <task-id> <package>` — validates `tasks/<task-id>.md` exists and has the required sections (`Goal`, `Success criteria`, `Out of scope`, `Implementation notes`, `Validation`); creates `worktrees/<task-id>/` on branch `task/<package>/<task-id>` from `origin/main`; runs `bun install` in the new worktree; prints a next-steps banner.
  - `bun work list` — prints a table of active worktrees: id, package, branch, last-commit subject, behind/ahead vs `origin/main`.
  - `bun work open <task-id>` — prints the absolute path of `worktrees/<task-id>/` (callers `cd "$(bun work open 0042)"`).
  - `bun work submit <task-id> [--draft]` — from inside the worktree (or with the id provided): runs `bun typecheck`, `bun lint`, `bun test`, `bun test:contract --pkg=<package>`, and `bun harness:smoke --affected` (if the changed paths intersect `packages/{inject,consistency,profiles}`). Bails on first failure with a clean error pointing at what to fix. On all-green, pushes the branch and runs `gh pr create --title <last-commit-subject> --body-file .github/PULL_REQUEST_TEMPLATE.md` (with `--draft` if flag passed).
  - `bun work clean [--merged-only]` — removes worktrees whose branches have already been merged into `origin/main` (default) or all worktrees (with `--all`). Confirms before destructive action unless `--yes`.
- [ ] Wired in root `package.json` scripts: `"work": "bun scripts/mochi-work.ts"` so `bun work <subcommand>` works from repo root.
- [ ] `@mochi.js/cli`'s `main()` proxies `mochi work <args>` to the same script (lazy-imports so the CLI's own typecheck stays fast). The cli package's smoke test now also asserts that `main(["work", "list"])` returns `0` after spawning successfully.
- [ ] `tests/contract/mochi-work.contract.test.ts` — integration tests that exercise each subcommand against a temporary git repo (use Bun's `Bun.spawn` + a tmpdir fixture). Required coverage: `create` validates briefs correctly (rejects missing sections), `list` outputs structured data, `submit` runs gates and bails appropriately on a forced failure, `clean` skips unmerged branches.
- [ ] `AGENTS.md` §3 / §8 updated: every reference to "mochi-work" or "git worktree add" replaced with the canonical `bun work` invocations. PLAN.md §15.2 already specifies the surface; no PLAN.md changes needed unless something contradicts.
- [ ] Smoke run: `bun work --help` prints a usable usage banner. `bun work list` runs cleanly even with zero worktrees.
- [ ] Error UX: when `gh` isn't authenticated, when the worktree is dirty at submit, when the brief is malformed — every failure path prints a one-line cause + a one-line "do this" suggestion. No raw stack traces in normal flows.
- [ ] All package gates green (typecheck, lint, test, test:contract).

## Out of scope

- The `mochi browsers install`, `mochi capture`, `mochi harness` subcommands — those land in their respective phases (0.4, 0.5, 0.11). The `mochi work` proxy is the only `cli` change here.
- A long-running daemon / agent dispatcher (PLAN.md §15.2 third option, deferred).
- Authentication management — `bun work submit` shells out to `gh` and `git`; if those aren't configured, surface the error and stop. Don't wrap or replace gh's auth flow.
- Cross-machine coordination, locking, or concurrency control. One developer runs `bun work` at a time on a given checkout.
- A dependency on `@mochi.js/harness` for the `harness:smoke` step. At v0.0 the script just runs `bun run harness:smoke --affected` (which is a placeholder echo today). When `@mochi.js/harness` lands in phase 0.5, the placeholder is replaced — `mochi-work` doesn't change.

## Implementation notes

- Use Bun's native APIs: `Bun.spawn`, `Bun.argv`, `Bun.file`, `Bun.write`. No `child_process`, no `commander`/`yargs`/`citty` — hand-roll the arg parser. The whole file should be < 500 lines.
- For `gh pr create`, prefill the PR template by reading `.github/PULL_REQUEST_TEMPLATE.md` and substituting the package list checkbox (auto-tick based on `git diff --name-only origin/main...HEAD`). Pre-fill the "Probe Manifest diff" code block as `N/A` unless the diff touches `packages/{inject,consistency,profiles}`.
- For `git` calls: shell out to `git`, never use a JS git library. Each command is a single `Bun.spawn` invocation with `cwd` set to the worktree.
- Brief validation (`create`): parse the markdown, verify the required H2 sections exist (`## Goal`, `## Success criteria`, `## Out of scope`, `## Implementation notes`, `## Validation`). Reject with a clear message if any are missing or empty.
- Worktree path: always absolute, derived from `git rev-parse --show-toplevel`. Never hardcode `/Users/marcxavier/mochi`.
- The "affected packages" computation for `submit` uses `git diff --name-only origin/main...HEAD` and maps `packages/<pkg>/**` paths back to package names. Reuse this helper if it's useful elsewhere later.
- Logging: a tiny `log.info`, `log.warn`, `log.error`, `log.fatal` helper at the top of the file. Use `console.error` for `warn`/`error`/`fatal` and `console.log` for `info`. The cli package's biome override already permits `console` use.
- Don't add a logger framework. Don't add a colors library — Bun supports ANSI directly via template literals if the output is a TTY.

## Validation

From the worktree root:

```sh
bun typecheck
bun lint
bun test
bun test:contract --pkg=repo

# manual smoke
bun work --help
bun work list
echo "# 0099: smoke task" > tasks/0099-smoke.md  # malformed; should fail validation
bun work create 0099 repo  # expect: rejection with "missing required section: ## Goal"
rm tasks/0099-smoke.md

# the @mochi.js/cli proxy
cd packages/cli && bun src/bin.ts work list
```

`bun work submit 0002 --draft` is the *self-test* — once everything passes locally, this command itself opens the PR for this task.

## Touch list (rough)

- `scripts/mochi-work.ts` (new, primary)
- `package.json` (root): add `"work"` script
- `tests/contract/mochi-work.contract.test.ts` (new)
- `packages/cli/src/index.ts`: replace placeholder `main()` with arg-routing that proxies `work` to `scripts/mochi-work.ts`
- `packages/cli/src/__tests__/smoke.test.ts`: extend with proxy assertion
- `AGENTS.md`: §3, §8 invocation references
- `tasks/_template.md`: tweak the validation block to suggest `bun work submit <id>` (currently says nothing about it)
- `.gitignore`: confirm `worktrees/` is already ignored (it is; just verify)
