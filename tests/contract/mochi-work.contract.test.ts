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

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  affectedPackages,
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
  const proc = Bun.spawn(cmd as string[], {
    cwd,
    env: { ...process.env, ...env },
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
