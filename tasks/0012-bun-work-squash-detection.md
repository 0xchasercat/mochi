# 0012: `bun work clean` squash-merge detection

**Package:** `repo` (touches `scripts/mochi-work.ts` only)
**Phase:** `0.1.x` (polish)
**Estimated size:** S
**Dependencies:** 0002 (merged)

## Goal

Fix `bun work clean` so it detects squash-merged branches as merged. Today it uses `git branch --merged origin/main` which only reports branch reachability — and our canonical merge style (PLAN.md §15.7) is squash-merge, which produces a new commit on `main` without preserving the branch tip's reachability. As a result, `bun work clean` (default mode, no `--all`) incorrectly reports "nothing to clean (no merged worktrees)" after every successful task merge.

After this task lands, `bun work clean` works as designed for the squash-merge workflow: branches whose content is already on `main` are detected and removed by default.

## Success criteria

- [ ] `bun work clean` (no flags) removes worktrees whose branches are content-identical to `main` (i.e., squash-merged) AND whose tips are reachable in `main` (the existing case). Both detection paths land here.
- [ ] Detection algorithm: a branch is "effectively merged into `main`" if either of the following is true:
  1. The branch tip is reachable from `origin/main` (existing — `git merge-base --is-ancestor <branch> origin/main`)
  2. `git cherry origin/main <branch>` reports zero output (every commit on the branch has an equivalent on `main` by patch-id; canonical "is this work present on main" check used by git itself)
- [ ] The new check uses `git cherry`, not a content-diff approximation. `git cherry` is git's authoritative answer to "is this branch's work already on the target". It handles squash-merges, rebases, and cherry-picks uniformly.
- [ ] If `git cherry` returns lines starting with `+` (commits not yet present on main), the branch is NOT merged. Lines starting with `-` mean equivalent commit found — those count as merged.
- [ ] `--merged-only` flag (current default behavior name) keeps the same semantics — it's effectively the same as the no-flag default now. Optional: rename to `--no-all` and deprecate `--merged-only` (low priority — leave alias for backward compat).
- [ ] `--all` flag unchanged — still removes every worktree regardless of merge status.
- [ ] Edge cases handled:
  - Branch that's NEW (zero commits ahead, zero behind) — treat as merged (nothing to merge).
  - Branch that's purely BEHIND `main` (no unique commits) — treat as merged.
  - Branch with truly unmerged work — left alone, like today.
  - `origin/main` not fetched recently — `git fetch origin main --quiet` runs once at the top of `clean`. Skip silently if offline (warn, treat as merge-status-unknown, do not remove).
- [ ] Unit tests in `tests/contract/mochi-work.contract.test.ts`: a new section that exercises the squash-merge detection. Spin up a throwaway repo, create a branch with a commit, squash-merge into main (`git merge --squash` + `git commit`), then call the detection helper and assert the branch is reported as merged.
- [ ] All existing `bun work` smoke + contract tests still pass.
- [ ] AGENTS.md / PLAN.md changes: none expected. The behavior matches what's already documented; we're fixing an incorrect implementation.

## Out of scope

- Changing the `bun work submit` flow — just `clean`.
- Adding a `--squash-merged-only` discriminator flag — not needed; the detection is uniform.
- A `--dry-run` flag for `clean`. The existing confirmation flow (`--yes` to skip prompt) is sufficient.
- A retroactive scan that flags worktrees whose corresponding task `tasks/<id>-*.md` no longer exists. Out of scope for this task.

## Implementation notes

- Locate the existing `isBranchMerged(branch, repo)` function in `scripts/mochi-work.ts` (line ~752 on current main). That's the function to update.
- The new logic:
  ```ts
  async function isBranchMerged(branch: string, repo: RepoCtx): Promise<boolean> {
    // Refresh remote ref so we compare against latest origin/main
    await run(["git", "fetch", "origin", "main", "--quiet"], { cwd: repo.root, allowFail: true });

    // Path 1: ancestor check (fast-forward / rebase merges)
    const ancestor = await run(
      ["git", "merge-base", "--is-ancestor", branch, "origin/main"],
      { cwd: repo.root, allowFail: true },
    );
    if (ancestor.exitCode === 0) return true;

    // Path 2: patch-id equivalence (squash merges)
    // `git cherry origin/main <branch>` lists branch commits not yet on origin/main.
    // Lines starting with `+` are unmerged; `-` are equivalent. Empty output = fully merged.
    const cherry = await runOut(["git", "cherry", "origin/main", branch], { cwd: repo.root });
    return cherry.split("\n").every((line) => !line.startsWith("+"));
  }
  ```
- The `git fetch origin main --quiet` should be best-effort (timeout maybe 5s); offline use shouldn't block the cleanup. If fetch fails, skip and use whatever `origin/main` is locally.
- `git cherry` outputs one line per commit prefixed with `+` (not on target) or `-` (equivalent on target). Empty output = no commits to compare = trivially merged. The `every(line => !line.startsWith("+"))` predicate handles all three cases (empty, all-equivalent, has-unmerged) correctly.
- Do not change the existing branch deletion flow — once a branch is detected as merged, the existing `git worktree remove` + `git branch -D` call sequence is correct.

## Validation

```sh
bun typecheck
bun lint
bun test
bun test:contract --pkg=repo

# Manual smoke (after merging this fix to main):
# Create a fake task, merge it, then `bun work clean` and assert it gets removed.
```

When everything's green: `bun work submit 0012 --draft`.

## Touch list (rough)

- `scripts/mochi-work.ts` (modify `isBranchMerged`, ~10-20 line change)
- `tests/contract/mochi-work.contract.test.ts` (extend with squash-merge detection tests)
