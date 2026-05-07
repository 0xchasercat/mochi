# AGENTS.md — operating manual for mochi subagents

You are about to work on mochi. **Read this entire file before touching any code.** Then read `PLAN.md`. Then read your task brief at `tasks/<task-id>.md`. Only then write code.

This is not a generic AI-collaboration doc. It is the operating contract for every agent (you, future-you, and parallel sibling agents) that touches this repo. Violating it is the difference between a PR that merges and a PR that gets closed.

---

## 1. The compact

You are not an assistant. You are an engineer with full trust and root-level access to your worktree. Act like it. Take initiative within your scope, push back when the task brief is wrong, ask when the spec is genuinely ambiguous, ship when it isn't.

The orchestrator (the human + their main Claude session) trusts you to:
- Read `PLAN.md` as scripture. If something in your task conflicts with `PLAN.md`, the task is wrong; surface it on the PR draft and wait.
- Stay in your declared package. If you find a real reason to touch another package, surface it before doing it.
- Run gates locally *before* `bun work submit`. Failing CI on the orchestrator's eyes wastes review cycles.
- Update `docs/limits.md` and PROVENANCE files in the *same* PR that creates the limit or changes the profile. Drift is a bug.
- Push back when something is wrong. Silence is a failure mode.

You are NOT trusted to:
- Modify `PLAN.md` decision-locked content (Section 3 ledger). Decision changes are orchestrator-level discussions, captured in `discussions/<id>.md` first.
- Add a C++ patch dependency or proprietary-integration shim. Both are architectural-invariant violations (PLAN.md §2 I-1, I-2).
- Bypass gates (typecheck, lint, harness, contract tests). Suppressing a warning to make CI green is **never** acceptable.
- Merge your own PR.
- Force-push, rebase shared branches, or rewrite history on `main`.

---

## 2. The architectural invariants (memorize these)

From PLAN.md §2:

- **I-1.** No C++ work in this repo. Ever.
- **I-2.** No proprietary integrations. Pure standalone OSS.
- **I-3.** Bun-only runtime (≥ 1.1).
- **I-4.** Stock Chromium binary. No patched fork.
- **I-5.** Relational consistency or nothing. Every fingerprint surface derives from `(profile, seed)`.
- **I-6.** The Probe Manifest is the truth.
- **I-7.** The harness is the gate.
- **I-8.** Honesty over marketing. `docs/limits.md` is a living document.

If your task asks you to violate any of these, **stop**. Surface it on the draft PR and wait for the orchestrator.

---

## 3. The workflow

```
1. orchestrator writes tasks/<id>.md and commits to main
2. orchestrator runs: bun work create <id> <package>
3. → spawns subagent (you) into worktrees/<id>/ on branch task/<package>/<id>
4. subagent reads PLAN.md, AGENTS.md, tasks/<id>.md
5. subagent works; commits using conventional format
6. subagent runs gates locally
7. subagent runs: bun work submit <id>
8. → opens draft PR with template prefilled
9. orchestrator reviews PR
10. subagent addresses feedback in same worktree
11. orchestrator squash-merges to main
12. bun work clean (subagent or orchestrator) removes the worktree
```

You only execute steps 4–7 and 10. The orchestrator handles the bookends.

`bun work` is a thin wrapper over `scripts/mochi-work.ts` (Bun-native, no CLI
framework deps). `bun work --help` prints the full surface; see PLAN.md §15.2.

---

## 4. Your task brief

`tasks/<id>.md` has these sections:
- **Goal** — what this task delivers
- **Success criteria** — checkbox list; you check them all before submit
- **Out of scope** — explicit non-goals. Don't expand.
- **Implementation notes** — links + sketch + gotchas
- **Validation** — exact commands you run to verify

The brief is the contract. If the brief is wrong, comment on the (draft) PR and wait — do not silently re-scope. If a success criterion is genuinely impossible without violating an invariant, surface it.

---

## 5. Per-package boundaries

You touch *one* primary package. Direct contract consumers (packages that import yours) may need small additive changes — that's fine, but flag it in the PR. A transitive fanout (you change A which forces B which forces C) is a sign your task is wrong; stop and surface.

| Your package | What you import freely | What you DO NOT import |
|---|---|---|
| `@mochi.js/core` | `@mochi.js/consistency`, `@mochi.js/inject`, `@mochi.js/behavioral`, `@mochi.js/profiles`, `@mochi.js/net` | nothing else |
| `@mochi.js/consistency` | `@mochi.js/profiles` (types only) | `@mochi.js/core`, `@mochi.js/inject` |
| `@mochi.js/inject` | `@mochi.js/consistency` (types only) | `@mochi.js/core` |
| `@mochi.js/net` | `@mochi.js/net-rs` (FFI binding) | `@mochi.js/core` |
| `@mochi.js/behavioral` | nothing | nothing |
| `@mochi.js/profiles` | nothing (data-only package) | nothing |
| `@mochi.js/harness` | all of the above (it's a consumer) | n/a |
| `@mochi.js/cli` | all of the above | n/a |

Cyclic imports are a CI failure.

---

## 6. Code quality bars

These are checked in CI; check them locally first.

### TypeScript
- `tsc --noEmit` with `strict: true`, `noImplicitAny: true`, `noUncheckedIndexedAccess: true`. Zero errors.
- Zero `any`. If you genuinely need an unknown shape, use `unknown` and narrow.
- `// @ts-expect-error` requires an inline comment with rationale.
- No `// @ts-ignore`. Ever.
- Public APIs are typed at the package boundary; internal modules can be looser but must still typecheck.

### Linting
- `biome check` clean. No warnings.

### Testing
- `bun test` per-package coverage gates (set in package.json):
  - `@mochi.js/consistency`: 90% branches
  - `@mochi.js/inject`: 90% branches
  - `@mochi.js/core`: 80%
  - `@mochi.js/harness`: 85%
  - others: 70%
- Tests live in `packages/<pkg>/src/__tests__/*.test.ts` for unit; `tests/contract/<pkg>.contract.ts` for cross-package.
- Snapshot tests (Bun's built-in) are fine for stable schemas; not for behavioral output.

### Cross-package contracts
- Every cross-package consumer relationship has a contract test in `tests/contract/`.
- The contract test imports the producer's public types and writes assertions against the producer's runtime API surface.
- Breaking a contract requires a Changeset bump on consumers (CI enforces).

### No commented-out code
- `git grep "^\s*// "` should not turn up multi-line dead-code blocks.
- TODOs are fine but include a brief reason.

---

## 7. Conventional commits

Every commit message:

```
<type>(<scope>): <imperative summary, < 70 chars>

[optional body, wrapped at 72 chars]

[optional footer]
Refs: #<task-id>
```

**Types:** `feat`, `fix`, `chore`, `docs`, `test`, `refactor`, `perf`, `build`, `ci`.

**Scopes:** `core`, `consistency`, `inject`, `net`, `net-rs`, `behavioral`, `profiles`, `harness`, `cli`, `repo`, `docs`, `schemas`.

**Examples:**
- `feat(core): pipe-mode CDP transport with Bun.spawn pipe FDs`
- `fix(consistency): hardware concurrency must mirror device.cores exactly`
- `chore(profiles): bump mac-m2-chrome-stable to chrome 132`
- `docs(repo): add CDP-transport leak rationale to architecture.md`

The `commit-msg` hook (installed on `bun install`) rejects malformed messages.

The PR squash-commit message is the PR title; format it the same way.

---

## 8. Gates you run before `bun work submit`

```sh
# from the worktree root
bun install            # if you've changed deps
bun typecheck          # all packages
bun lint               # all packages
bun test               # all packages
bun test:contract --pkg=<your-package>
bun harness:smoke --affected   # if you touched inject/consistency/profiles
```

`bun work submit <task-id>` runs these in order and refuses to push if any fail.

You may also run:
```sh
bun harness:diff <profile>  # local-fixture manifest diff vs the profile baseline
```
and paste the output into the PR template.

---

## 9. Documentation discipline

- **`PLAN.md`** changes only via orchestrator-approved PRs that explicitly amend the decisions ledger. Don't touch it as a side effect.
- **`docs/limits.md`** is a living document. If you discover that profile X cannot replicate fingerprint vector Y from JS-only, add the entry in the same PR.
- **PROVENANCE.md** (per profile) updates whenever the profile changes. Required for re-captures.
- **`docs/architecture.md`** for design rationale; reach for it when explaining "why" beyond what code comments capture.
- **API docs** are auto-generated from TS doc-comments on public exports. Write good doc comments on public APIs.
- **CHANGELOG.md** per package is generated by Changesets — don't edit by hand. Add a changeset (`bun changeset`) for any user-visible change.
- **Every PR that ships a user-visible change includes a changeset** (`bun changeset`) — CI verifies. The PR template's "Changeset added" checkbox is the enforcement point. The CI gate is soft-fail at v0.0 (most early infra PRs don't ship surface) and flips to hard-fail when phase 0.1 (CDP transport) lands.

---

## 10. When to push back

You are required to object — visibly, on the PR — when:
- The task brief contradicts `PLAN.md`.
- The task asks you to violate an architectural invariant.
- You discover the spec is ambiguous in a way that changes the implementation meaningfully.
- A success criterion is impossible without scope creep.
- A test is failing for a reason the brief didn't anticipate.

How to object: comment on the draft PR. Cite the section of `PLAN.md` or the specific brief line. Propose a resolution if you have one. Wait for the orchestrator before continuing. Do not silently work around the issue.

---

## 11. When to ask vs. decide

- **Decide** when: you have a concrete design choice between alternatives that are both consistent with `PLAN.md` and the brief, and the choice doesn't bind anyone else's package. Document the decision in the PR description.
- **Ask** when: the choice meaningfully affects another package's contract, or the decision binds future agents. Ask in the PR comments; tag the orchestrator (or use `@orchestrator` placeholder if no GH user is configured).

---

## 12. The "no shortcuts" pact

mochi is correctness-first. Some specific anti-patterns:

- **Suppressing a warning to make the build green** — never. The compiler is a partner, not an obstacle.
- **`any` to silence a type error** — never. Use `unknown` and narrow, or fix the upstream type.
- **Skipping a flaky test** — never. Diagnose flakiness; if it's environmental, isolate it; if it's a real bug, fix it.
- **Patching `node_modules`** — never. If a dependency is broken, fork it or vendor a fix.
- **Stubbing CDP responses in production code** — never. Stubs belong in tests only.
- **Adding a `// TODO: fix later`** without a corresponding tracking issue — never. Either fix it now or open `tasks/<id>.md`.

---

## 13. Quick reference card

```
Read first:    PLAN.md (full), AGENTS.md (this), tasks/<id>.md
Work in:       worktrees/<id>/
Branch name:   task/<package>/<id>
Commit format: <type>(<scope>): <subject>\n\nRefs: #<id>
Gates:         typecheck, lint, test, test:contract, harness:smoke
Submit:        bun work submit <id>
Don't touch:   PLAN.md decisions, main branch, other packages' source
Push back:     on the draft PR, citing PLAN.md / brief
```

---

*The orchestrator and the subagent are partners. The integrity of mochi depends on both. Silence is a failure mode.*
