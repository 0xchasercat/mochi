/**
 * Cross-package contract tests for the `mochi-work` CLI.
 *
 * These tests stand up a throwaway git repository in a temp dir, vendor a
 * minimal subset of the mochi monorepo layout into it (root package.json with
 * the gate scripts, the actual scripts/mochi-work.ts script, a `tasks/` dir,
 * and a `.github/PULL_REQUEST_TEMPLATE.md`), and exercise each subcommand via
 * `bun scripts/mochi-work.ts <subcommand>` to verify behavior end-to-end.
 *
 * @see tasks/0002-mochi-work-cli.md "Touch list"
 * @see PLAN.md §15.2
 */

import { afterEach, beforeEach, describe, expect, it, setDefaultTimeout } from "bun:test";

// `mochi-work` integration tests do real `git init` / worktree / spawn work in
// beforeEach, which can run >5s on slow CI runners — Bun's default `it()` and
// hook timeout. Bump the per-test ceiling for this entire file so a slow runner
// doesn't trip a misleading "a beforeEach/afterEach hook timed out" failure on
// what is in fact a healthy (just slow) git fixture rebuild. 30s is well clear
// of any realistic local + CI budget; a genuine hang still trips quickly.
setDefaultTimeout(30_000);

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  affectedPackages,
  isBranchMerged,
  packageNameFromPath,
  parseArgs,
  touchesSpoofSurface,
  validateBriefMarkdown,
} from "../../scripts/mochi-work";

// -------------------------------------------------------------------------------------
// Pure-function unit tests (no spawn).
// -------------------------------------------------------------------------------------

describe("mochi-work / pure helpers", () => {
  describe("validateBriefMarkdown", () => {
    it("accepts a brief with all required sections having content", () => {
      const brief = `# 0042: foo

## Goal

Make foo work.

## Success criteria

- [ ] thing

## Out of scope

- not bar

## Implementation notes

Walk it back.

## Validation

\`\`\`sh
bun test
\`\`\`
`;
      const result = validateBriefMarkdown(brief);
      expect(result.ok).toBe(true);
      expect(result.missing).toEqual([]);
      expect(result.empty).toEqual([]);
    });

    it("rejects a brief missing the Goal section", () => {
      const brief = `# 0042: foo

## Success criteria
- [ ] x

## Out of scope
- y

## Implementation notes
z

## Validation
w
`;
      const result = validateBriefMarkdown(brief);
      expect(result.ok).toBe(false);
      expect(result.missing).toContain("## Goal");
    });

    it("rejects a brief whose Goal section is empty (only HTML comment)", () => {
      const brief = `# 0042: foo

## Goal

<!-- TODO: fill in -->

## Success criteria
- [ ] x

## Out of scope
- y

## Implementation notes
z

## Validation
w
`;
      const result = validateBriefMarkdown(brief);
      expect(result.ok).toBe(false);
      expect(result.empty).toContain("## Goal");
    });

    it("rejects a brief missing multiple sections", () => {
      const brief = `# 0042: foo

## Goal

words

## Validation

words
`;
      const result = validateBriefMarkdown(brief);
      expect(result.ok).toBe(false);
      expect(result.missing).toContain("## Success criteria");
      expect(result.missing).toContain("## Out of scope");
      expect(result.missing).toContain("## Implementation notes");
    });
  });

  describe("packageNameFromPath", () => {
    it("maps packages/<pkg>/* paths to the package name", () => {
      expect(packageNameFromPath("packages/inject/src/foo.ts")).toBe("inject");
      expect(packageNameFromPath("packages/core/src/bar.ts")).toBe("core");
      expect(packageNameFromPath("packages/net-rs/Cargo.toml")).toBe("net-rs");
    });

    it("returns null for paths outside packages/", () => {
      expect(packageNameFromPath("scripts/foo.ts")).toBeNull();
      expect(packageNameFromPath("docs/architecture.md")).toBeNull();
    });

    it("returns null for unknown package directories", () => {
      expect(packageNameFromPath("packages/notreal/src/foo.ts")).toBeNull();
    });
  });

  describe("affectedPackages / touchesSpoofSurface", () => {
    it("dedups across multiple files in the same package", () => {
      const files = [
        "packages/core/src/a.ts",
        "packages/core/src/b.ts",
        "packages/inject/src/c.ts",
      ];
      expect([...affectedPackages(files)].sort()).toEqual(["core", "inject"]);
    });

    it("touchesSpoofSurface fires on inject/consistency/profiles", () => {
      expect(touchesSpoofSurface(["packages/inject/src/a.ts"])).toBe(true);
      expect(touchesSpoofSurface(["packages/consistency/src/a.ts"])).toBe(true);
      expect(touchesSpoofSurface(["packages/profiles/data/foo.json"])).toBe(true);
      expect(touchesSpoofSurface(["packages/core/src/a.ts"])).toBe(false);
      expect(touchesSpoofSurface(["docs/limits.md"])).toBe(false);
    });
  });

  describe("parseArgs", () => {
    it("separates positional args from flags", () => {
      const r = parseArgs(["create", "0042", "core"]);
      expect(r.positional).toEqual(["create", "0042", "core"]);
      expect(r.flags).toEqual({});
    });

    it("handles --flag (boolean) and --flag=value forms", () => {
      const r = parseArgs(["submit", "--draft", "--pkg=core"]);
      expect(r.positional).toEqual(["submit"]);
      expect(r.flags.draft).toBe(true);
      expect(r.flags.pkg).toBe("core");
    });

    it("handles --flag value form", () => {
      const r = parseArgs(["clean", "--mode", "merged-only"]);
      expect(r.flags.mode).toBe("merged-only");
    });
  });
});

// -------------------------------------------------------------------------------------
// Integration tests: stand up a throwaway repo and exercise the CLI via Bun.spawn.
// -------------------------------------------------------------------------------------

interface RunResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

async function runIn(
  cwd: string,
  cmd: readonly string[],
  env: Record<string, string> = {},
): Promise<RunResult> {
  // CRITICAL: scrub all GIT_* env vars before spawning. If the parent
  // process (e.g., `bun work submit`, a pre-push hook, or a containing
  // worktree) has GIT_DIR / GIT_WORK_TREE / GIT_INDEX_FILE set, child
  // `git` invocations will silently target the PARENT repo even though
  // we explicitly pass `cwd: <fixture>`. That's how this fixture
  // famously poisoned origin/main with a `chore: advance main` test
  // artifact and rewrote the parent repo's `.git/config` to bare=true
  // + Test User identity. Stripping every GIT_* key prevents any
  // similar leak in the future.
  const cleanEnv: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (k.startsWith("GIT_")) continue;
    if (v !== undefined) cleanEnv[k] = v;
  }
  const proc = Bun.spawn(cmd as string[], {
    cwd,
    env: { ...cleanEnv, ...env },
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const code = await proc.exited;
  return { code, stdout, stderr };
}

const ROOT = (() => {
  // tests/contract/foo.test.ts → ../../
  const here = new URL(".", import.meta.url).pathname;
  return here.replace(/\/tests\/contract\/?$/, "");
})();

const SCRIPT_PATH = join(ROOT, "scripts", "mochi-work.ts");

const VALID_BRIEF = `# 0042: integration sample

## Goal

Stand up a sample brief for the contract test suite.

## Success criteria

- [ ] looks good

## Out of scope

- world peace

## Implementation notes

Use the test fixture.

## Validation

\`\`\`sh
bun test
\`\`\`
`;

const INVALID_BRIEF = `# 0099: malformed

## Validation

bun test
`;

const PR_TEMPLATE = `## What

x

## Package(s) touched

- [ ] @mochi.js/core
- [ ] @mochi.js/cli

## Task brief

Closes #

## Probe Manifest diff

\`\`\`
N/A
\`\`\`
`;

interface Fixture {
  readonly dir: string;
  readonly cleanup: () => Promise<void>;
}

/**
 * Build a throwaway git repo that mimics the mochi monorepo's relevant slice:
 *   - root package.json with the gate scripts (typecheck/lint/test/test:contract/harness:smoke)
 *   - scripts/mochi-work.ts symlinked from the actual script under test
 *   - tasks/, worktrees/, .github/PULL_REQUEST_TEMPLATE.md
 *   - an "origin" remote set to a sibling bare repo so `git fetch origin main` works
 *   - one initial commit on `main`
 */
async function makeFixture(opts: { gateScripts: Record<string, string> }): Promise<Fixture> {
  const dir = await mkdtemp(join(tmpdir(), "mochi-work-test-"));
  const upstream = join(dir, "upstream.git");
  const repo = join(dir, "repo");

  // Bare upstream.
  await runIn(dir, ["git", "init", "--bare", "--initial-branch=main", upstream]);

  // Working clone.
  await runIn(dir, ["mkdir", "-p", repo]);
  await runIn(repo, ["git", "init", "--initial-branch=main"]);
  await runIn(repo, ["git", "remote", "add", "origin", upstream]);
  await runIn(repo, ["git", "config", "user.email", "test@example.com"]);
  await runIn(repo, ["git", "config", "user.name", "Test User"]);
  await runIn(repo, ["git", "config", "commit.gpgsign", "false"]);

  // Workspace skeleton.
  const pkg = {
    name: "fixture-workspace",
    version: "0.0.0",
    private: true,
    type: "module",
    workspaces: ["packages/*"],
    scripts: {
      ...opts.gateScripts,
      work: `bun ${SCRIPT_PATH}`,
    },
  };
  await Bun.write(join(repo, "package.json"), `${JSON.stringify(pkg, null, 2)}\n`);
  await Bun.write(join(repo, ".gitignore"), "worktrees/\nnode_modules/\n");
  await Bun.write(join(repo, "tasks", ".keep"), "");
  await Bun.write(join(repo, "worktrees", ".keep"), "");
  await Bun.write(join(repo, ".github", "PULL_REQUEST_TEMPLATE.md"), PR_TEMPLATE);
  // Symlink scripts/mochi-work.ts to the real one in the repo under test (no copy:
  // this guarantees we test the actual script, not a stale copy).
  await runIn(repo, ["mkdir", "-p", "scripts"]);
  await runIn(repo, ["ln", "-s", SCRIPT_PATH, join(repo, "scripts", "mochi-work.ts")]);

  await runIn(repo, ["git", "add", "."]);
  await runIn(repo, ["git", "commit", "-m", "chore: initial"]);
  await runIn(repo, ["git", "push", "-u", "origin", "main"]);

  return {
    dir: repo,
    cleanup: async () => {
      await rm(dir, { recursive: true, force: true });
    },
  };
}

async function writeBrief(repoDir: string, name: string, content: string): Promise<void> {
  await Bun.write(join(repoDir, "tasks", name), content);
}

// -------------------------------------------------------------------------------------
// Direct tests of `isBranchMerged` against synthesized git scenarios.
//
// We construct a working repo with an `origin/main` ref and a feature branch,
// then drive each detection path independently. No CLI involvement here — we
// call the exported function with a `RepoCtx` pointed at the temp repo root.
// -------------------------------------------------------------------------------------

interface MergedFixture {
  readonly dir: string;
  readonly cleanup: () => Promise<void>;
}

async function makeMergedFixture(): Promise<MergedFixture> {
  const dir = await mkdtemp(join(tmpdir(), "mochi-work-merged-"));
  const upstream = join(dir, "upstream.git");
  const repo = join(dir, "repo");

  await runIn(dir, ["git", "init", "--bare", "--initial-branch=main", upstream]);
  await runIn(dir, ["mkdir", "-p", repo]);
  await runIn(repo, ["git", "init", "--initial-branch=main"]);
  await runIn(repo, ["git", "remote", "add", "origin", upstream]);
  await runIn(repo, ["git", "config", "user.email", "test@example.com"]);
  await runIn(repo, ["git", "config", "user.name", "Test User"]);
  await runIn(repo, ["git", "config", "commit.gpgsign", "false"]);

  // Seed an initial commit on main so we have an `origin/main` to compare against.
  await Bun.write(join(repo, "README.md"), "seed\n");
  await runIn(repo, ["git", "add", "."]);
  await runIn(repo, ["git", "commit", "-m", "chore: seed"]);
  await runIn(repo, ["git", "push", "-u", "origin", "main"]);

  return {
    dir: repo,
    cleanup: async () => {
      await rm(dir, { recursive: true, force: true });
    },
  };
}

describe("isBranchMerged (squash detection)", () => {
  let mf: MergedFixture | undefined;

  beforeEach(async () => {
    mf = await makeMergedFixture();
  });

  afterEach(async () => {
    if (mf) {
      await mf.cleanup();
      mf = undefined;
    }
  });

  it("returns true for an ancestor branch (fast-forward case)", async () => {
    if (!mf) throw new Error("fixture not initialized");
    // Create a branch that is strictly an ancestor of origin/main: branch off
    // first commit, advance main beyond it, push main. The branch tip is
    // reachable from origin/main.
    await runIn(mf.dir, ["git", "checkout", "-b", "feature/ancestor"]);
    await runIn(mf.dir, ["git", "checkout", "main"]);
    await Bun.write(join(mf.dir, "advance.txt"), "advance\n");
    await runIn(mf.dir, ["git", "add", "."]);
    await runIn(mf.dir, ["git", "commit", "-m", "chore: advance main"]);
    await runIn(mf.dir, ["git", "push", "origin", "main"]);

    const merged = await isBranchMerged("feature/ancestor", { root: mf.dir });
    expect(merged).toBe(true);
  });

  it("returns true for a squash-merged branch", async () => {
    if (!mf) throw new Error("fixture not initialized");
    // Branch with a unique commit, squash-merged into main and pushed. The
    // branch tip is NOT an ancestor of origin/main, but the patch-id is
    // equivalent — the canonical squash workflow.
    await runIn(mf.dir, ["git", "checkout", "-b", "feature/squashed"]);
    await Bun.write(join(mf.dir, "feature.txt"), "feature body\n");
    await runIn(mf.dir, ["git", "add", "."]);
    await runIn(mf.dir, ["git", "commit", "-m", "feat: add feature"]);

    await runIn(mf.dir, ["git", "checkout", "main"]);
    await runIn(mf.dir, ["git", "merge", "--squash", "feature/squashed"]);
    await runIn(mf.dir, ["git", "commit", "-m", "feat: add feature (squashed)"]);
    await runIn(mf.dir, ["git", "push", "origin", "main"]);

    // Sanity: ancestor check would say "no", which is exactly why path 1 fails
    // and we need path 2.
    const ancestor = await runIn(mf.dir, [
      "git",
      "merge-base",
      "--is-ancestor",
      "feature/squashed",
      "origin/main",
    ]);
    expect(ancestor.code).not.toBe(0);

    const merged = await isBranchMerged("feature/squashed", { root: mf.dir });
    expect(merged).toBe(true);
  });

  it("returns false for a branch with genuinely unmerged work", async () => {
    if (!mf) throw new Error("fixture not initialized");
    await runIn(mf.dir, ["git", "checkout", "-b", "feature/unmerged"]);
    await Bun.write(join(mf.dir, "wip.txt"), "WIP\n");
    await runIn(mf.dir, ["git", "add", "."]);
    await runIn(mf.dir, ["git", "commit", "-m", "wip: not merged"]);

    const merged = await isBranchMerged("feature/unmerged", { root: mf.dir });
    expect(merged).toBe(false);
  });

  it("returns false for a brand-new branch whose tip exactly equals origin/main", async () => {
    if (!mf) throw new Error("fixture not initialized");
    // Fresh branch off main, no extra commits. Tip == origin/main. This is the
    // canonical "in-flight worktree, agent hasn't committed yet" case. `bun work
    // clean` (default mode) MUST treat this as in-flight and skip removal,
    // otherwise it reaps active work mid-task. Use `--all` to force-remove.
    // Refs: orchestrator hot-fix that supersedes the original 0012 brief's
    //   "empty branch → merged" rule.
    await runIn(mf.dir, ["git", "checkout", "-b", "feature/empty"]);

    const merged = await isBranchMerged("feature/empty", { root: mf.dir });
    expect(merged).toBe(false);
  });

  it("returns true for a branch whose only commits are cherry-picked onto main", async () => {
    // Same code path as squash, different workflow: a single commit was
    // cherry-picked from the branch onto main. `git cherry` reports the
    // branch commit as `-` (equivalent), so detection returns true.
    // The intermediate commit on main is intentional — without it, git's
    // cherry-pick of a single commit straight off the same parent produces
    // an identical SHA, and the branch tip ends up == main tip (caught by
    // the in-flight short-circuit, not the cherry path).
    if (!mf) throw new Error("fixture not initialized");
    await runIn(mf.dir, ["git", "checkout", "-b", "feature/cherrypicked"]);
    await Bun.write(join(mf.dir, "cherry.txt"), "pickme\n");
    await runIn(mf.dir, ["git", "add", "."]);
    await runIn(mf.dir, ["git", "commit", "-m", "feat: pickme"]);
    const sha = (await runIn(mf.dir, ["git", "rev-parse", "HEAD"])).stdout.trim();

    await runIn(mf.dir, ["git", "checkout", "main"]);
    // Intermediate commit ensures the cherry-pick onto main produces a
    // distinct SHA from the branch tip.
    await Bun.write(join(mf.dir, "intermediate.txt"), "intermediate\n");
    await runIn(mf.dir, ["git", "add", "."]);
    await runIn(mf.dir, ["git", "commit", "-m", "chore: intermediate"]);
    await runIn(mf.dir, ["git", "cherry-pick", sha]);
    await runIn(mf.dir, ["git", "push", "origin", "main"]);

    const merged = await isBranchMerged("feature/cherrypicked", { root: mf.dir });
    expect(merged).toBe(true);
  });
});

describe("mochi-work / cli integration", () => {
  let fixture: Fixture | undefined;

  beforeEach(async () => {
    fixture = await makeFixture({
      gateScripts: {
        typecheck: "exit 0",
        lint: "exit 0",
        test: "exit 0",
        "test:contract": "exit 0",
        "harness:smoke": "exit 0",
      },
    });
  });

  afterEach(async () => {
    if (fixture) {
      await fixture.cleanup();
      fixture = undefined;
    }
  });

  it("--help prints a usage banner including subcommands", async () => {
    if (!fixture) throw new Error("fixture not initialized");
    const r = await runIn(fixture.dir, ["bun", SCRIPT_PATH, "--help"]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("create");
    expect(r.stdout).toContain("list");
    expect(r.stdout).toContain("submit");
    expect(r.stdout).toContain("clean");
  });

  it("list produces structured output even with zero worktrees", async () => {
    if (!fixture) throw new Error("fixture not initialized");
    const r = await runIn(fixture.dir, ["bun", SCRIPT_PATH, "list"]);
    expect(r.code).toBe(0);
    // Either "no active worktrees" message, or a header row — both are structured.
    expect(r.stdout).toMatch(/no active worktrees|ID\s+PKG\s+BRANCH/);
  });

  it("create rejects a malformed brief with a clear error", async () => {
    if (!fixture) throw new Error("fixture not initialized");
    await writeBrief(fixture.dir, "0099-bad.md", INVALID_BRIEF);
    const r = await runIn(fixture.dir, ["bun", SCRIPT_PATH, "create", "0099", "core"]);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toMatch(/missing required section/);
    expect(r.stderr).toContain("## Goal");
  });

  it("create rejects when the brief does not exist at all", async () => {
    if (!fixture) throw new Error("fixture not initialized");
    const r = await runIn(fixture.dir, ["bun", SCRIPT_PATH, "create", "0888", "core"]);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toMatch(/no task brief found/);
  });

  it("create succeeds for a valid brief, list shows the new worktree", async () => {
    if (!fixture) throw new Error("fixture not initialized");
    await writeBrief(fixture.dir, "0042-foo.md", VALID_BRIEF);
    const r = await runIn(fixture.dir, ["bun", SCRIPT_PATH, "create", "0042", "core"]);
    // bun install fails inside a fixture (no real workspace deps to resolve);
    // the worktree should still be created and a warning should fire.
    expect(r.stdout).toContain("Worktree ready");

    const list = await runIn(fixture.dir, ["bun", SCRIPT_PATH, "list"]);
    expect(list.code).toBe(0);
    expect(list.stdout).toContain("0042");
    expect(list.stdout).toContain("task/core/0042");
  });

  it("open prints the absolute path of an existing worktree", async () => {
    if (!fixture) throw new Error("fixture not initialized");
    await writeBrief(fixture.dir, "0042-foo.md", VALID_BRIEF);
    await runIn(fixture.dir, ["bun", SCRIPT_PATH, "create", "0042", "core"]);
    const r = await runIn(fixture.dir, ["bun", SCRIPT_PATH, "open", "0042"]);
    expect(r.code).toBe(0);
    expect(r.stdout.trim()).toContain("/worktrees/0042");
    // Path is absolute.
    expect(r.stdout.trim().startsWith("/")).toBe(true);
  });

  it("open errors clearly when the worktree does not exist", async () => {
    if (!fixture) throw new Error("fixture not initialized");
    const r = await runIn(fixture.dir, ["bun", SCRIPT_PATH, "open", "9999"]);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toMatch(/no worktree at worktrees\/9999/);
  });

  it("clean (default merged-only) skips unmerged branches", async () => {
    if (!fixture) throw new Error("fixture not initialized");
    await writeBrief(fixture.dir, "0042-foo.md", VALID_BRIEF);
    await runIn(fixture.dir, ["bun", SCRIPT_PATH, "create", "0042", "core"]);

    // Make a commit on the worktree branch so it diverges from origin/main.
    const wt = join(fixture.dir, "worktrees", "0042");
    await Bun.write(join(wt, "scratch.txt"), "diverge");
    await runIn(wt, ["git", "add", "."]);
    await runIn(wt, ["git", "commit", "-m", "feat(core): diverge"]);

    // clean --yes: should be a no-op since the branch is unmerged.
    const r = await runIn(fixture.dir, ["bun", SCRIPT_PATH, "clean", "--yes"]);
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/nothing to clean/);

    // The worktree must still exist.
    const list = await runIn(fixture.dir, ["bun", SCRIPT_PATH, "list"]);
    expect(list.stdout).toContain("0042");
  });

  it("clean (default merged-only) removes a squash-merged worktree", async () => {
    // Regression test for tasks/0012-bun-work-squash-detection.md.
    // Branch tip is NOT reachable from origin/main (squash creates a fresh
    // commit), but the patch-id of the branch's single commit equals the
    // squash commit's patch-id, so `git cherry` reports zero `+` lines.
    if (!fixture) throw new Error("fixture not initialized");
    await writeBrief(fixture.dir, "0042-foo.md", VALID_BRIEF);
    await runIn(fixture.dir, ["bun", SCRIPT_PATH, "create", "0042", "core"]);

    // Add a commit on the task branch.
    const wt = join(fixture.dir, "worktrees", "0042");
    await Bun.write(join(wt, "feature.txt"), "hello squash\n");
    await runIn(wt, ["git", "add", "."]);
    await runIn(wt, ["git", "commit", "-m", "feat(core): add feature"]);

    // Squash-merge the task branch into main on the working clone, then push.
    await runIn(fixture.dir, ["git", "merge", "--squash", "task/core/0042"]);
    await runIn(fixture.dir, ["git", "commit", "-m", "feat(core): add feature\n\nRefs: #0042"]);
    await runIn(fixture.dir, ["git", "push", "origin", "main"]);

    // The branch tip must NOT be an ancestor of origin/main (squash semantics).
    const ancestor = await runIn(fixture.dir, [
      "git",
      "merge-base",
      "--is-ancestor",
      "task/core/0042",
      "origin/main",
    ]);
    expect(ancestor.code).not.toBe(0);

    // But `git cherry origin/main task/core/0042` must report no `+` lines
    // (the branch's work is patch-id-equivalent to the squash commit).
    const cherry = await runIn(fixture.dir, ["git", "cherry", "origin/main", "task/core/0042"]);
    expect(cherry.code).toBe(0);
    const plusLines = cherry.stdout.split(/\r?\n/).filter((l) => l.startsWith("+"));
    expect(plusLines).toEqual([]);

    // Now `bun work clean --yes` must remove the worktree by detecting the
    // squash via the `git cherry` path.
    const r = await runIn(fixture.dir, ["bun", SCRIPT_PATH, "clean", "--yes"]);
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/will remove 1 worktree/);
    expect(r.stdout).not.toMatch(/nothing to clean/);

    // The worktree must be gone.
    const list = await runIn(fixture.dir, ["bun", SCRIPT_PATH, "list"]);
    expect(list.stdout).not.toContain("0042");
  });

  it("submit bails on a forced gate failure with a clear hint", async () => {
    // Replace fixture with one whose `test` script always fails.
    if (fixture) await fixture.cleanup();
    fixture = await makeFixture({
      gateScripts: {
        typecheck: "exit 0",
        lint: "exit 0",
        test: "exit 1",
        "test:contract": "exit 0",
        "harness:smoke": "exit 0",
      },
    });
    await writeBrief(fixture.dir, "0042-foo.md", VALID_BRIEF);
    await runIn(fixture.dir, ["bun", SCRIPT_PATH, "create", "0042", "core"]);

    // Make a small commit so origin/main...HEAD has a diff (otherwise affected = []).
    const wt = join(fixture.dir, "worktrees", "0042");
    await Bun.write(join(wt, "scratch.txt"), "x");
    await runIn(wt, ["git", "add", "."]);
    await runIn(wt, ["git", "commit", "-m", "feat(core): scratch"]);

    const r = await runIn(wt, ["bun", SCRIPT_PATH, "submit"]);
    expect(r.code).not.toBe(0);
    // Should fail at the test gate (typecheck + lint pass first, then test fails).
    expect(r.stderr).toMatch(/gate failed: bun test/);
  });
});
