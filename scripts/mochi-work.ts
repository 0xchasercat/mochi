#!/usr/bin/env bun
/**
 * mochi-work — the worktree dev harness CLI.
 *
 * Subcommands (see PLAN.md §15.2):
 *   create <task-id> <package>   create a worktree + branch from origin/main for a task brief
 *   list                         list active worktrees with branch + last-commit summary
 *   open <task-id>               print the absolute path of the worktree (use with `cd "$(...)"`)
 *   submit <task-id> [--draft]   run gates, push, and open a PR
 *   clean [--merged-only|--all]  remove worktrees whose branches have merged into origin/main
 *
 * Bun-only. No external CLI-framework deps. No child_process, no node:fs.
 * @see tasks/0002-mochi-work-cli.md, PLAN.md §15.
 */

// -------------------------------------------------------------------------------------
// Tiny logging helpers. log.info → stdout; warn/error/fatal → stderr.
// -------------------------------------------------------------------------------------

const isTty = Boolean(process.stdout.isTTY);
const c = {
  bold: (s: string) => (isTty ? `\x1b[1m${s}\x1b[0m` : s),
  dim: (s: string) => (isTty ? `\x1b[2m${s}\x1b[0m` : s),
  red: (s: string) => (isTty ? `\x1b[31m${s}\x1b[0m` : s),
  green: (s: string) => (isTty ? `\x1b[32m${s}\x1b[0m` : s),
  yellow: (s: string) => (isTty ? `\x1b[33m${s}\x1b[0m` : s),
  cyan: (s: string) => (isTty ? `\x1b[36m${s}\x1b[0m` : s),
};

const log = {
  info: (msg: string): void => {
    console.log(msg);
  },
  warn: (msg: string): void => {
    console.error(`${c.yellow("warn:")} ${msg}`);
  },
  error: (msg: string): void => {
    console.error(`${c.red("error:")} ${msg}`);
  },
};

/**
 * Print a one-line cause + a one-line "do this" hint, then exit non-zero.
 * Top-level function (not a method on `log`) so TypeScript narrows control flow
 * after the call site (a `never`-returning method on an object literal does not
 * narrow under strict mode).
 */
function fatal(cause: string, hint?: string): never {
  console.error(`${c.red("error:")} ${cause}`);
  if (hint) console.error(`  ${c.dim("→")} ${hint}`);
  process.exit(1);
}

// -------------------------------------------------------------------------------------
// Process helpers — thin wrappers over Bun.spawn. No child_process, no node:fs.
// -------------------------------------------------------------------------------------

interface RunResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

interface RunOpts {
  readonly cwd?: string;
  readonly env?: Record<string, string | undefined>;
  /** When true, inherit parent stdio so child output streams live. Defaults to false. */
  readonly inherit?: boolean;
}

/** Run a command and capture stdout/stderr. Never throws on non-zero. */
async function run(cmd: readonly string[], opts: RunOpts = {}): Promise<RunResult> {
  const proc = Bun.spawn(cmd as string[], {
    cwd: opts.cwd,
    env: opts.env ? { ...process.env, ...opts.env } : process.env,
    stdout: opts.inherit ? "inherit" : "pipe",
    stderr: opts.inherit ? "inherit" : "pipe",
    stdin: "ignore",
  });

  const [stdout, stderr] = opts.inherit
    ? ["", ""]
    : await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  const code = await proc.exited;
  return { code, stdout, stderr };
}

/** Run a command and return trimmed stdout. Throws if exit != 0. */
async function runOut(cmd: readonly string[], opts: RunOpts = {}): Promise<string> {
  const result = await run(cmd, opts);
  if (result.code !== 0) {
    throw new Error(
      `command failed (${result.code}): ${cmd.join(" ")}\n${result.stderr.trim() || result.stdout.trim()}`,
    );
  }
  return result.stdout.trim();
}

// -------------------------------------------------------------------------------------
// Repo introspection.
// -------------------------------------------------------------------------------------

export interface RepoCtx {
  readonly root: string;
}

async function repoCtx(cwd?: string): Promise<RepoCtx> {
  try {
    const root = await runOut(["git", "rev-parse", "--show-toplevel"], { cwd });
    return { root };
  } catch {
    return fatal("not inside a git repository", "run `bun work` from the mochi repo root");
  }
}

async function gitFetchOriginMain(repo: RepoCtx): Promise<void> {
  // Best-effort: don't fatal if offline; just warn.
  const result = await run(["git", "fetch", "origin", "main"], { cwd: repo.root });
  if (result.code !== 0) {
    log.warn("git fetch origin main failed; using local refs (continue with caution)");
  }
}

// -------------------------------------------------------------------------------------
// Brief validation.
// -------------------------------------------------------------------------------------

const REQUIRED_SECTIONS = [
  "## Goal",
  "## Success criteria",
  "## Out of scope",
  "## Implementation notes",
  "## Validation",
] as const;

interface BriefValidation {
  readonly ok: boolean;
  readonly missing: readonly string[];
  readonly empty: readonly string[];
}

export function validateBriefMarkdown(text: string): BriefValidation {
  const missing: string[] = [];
  const empty: string[] = [];

  // Map heading → starting line index (one-based, optional)
  const lines = text.split(/\r?\n/);
  const headingIdx = new Map<string, number>();
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (line.startsWith("## ")) {
      // Normalize trailing whitespace; preserve heading exactly otherwise.
      const heading = line.replace(/\s+$/, "");
      if (!headingIdx.has(heading)) headingIdx.set(heading, i);
    }
  }

  for (const required of REQUIRED_SECTIONS) {
    const at = headingIdx.get(required);
    if (at === undefined) {
      missing.push(required);
      continue;
    }
    // Determine the next H2 (## …) after this heading; everything between is the body.
    let nextH2 = lines.length;
    for (let i = at + 1; i < lines.length; i++) {
      const line = lines[i] ?? "";
      if (line.startsWith("## ")) {
        nextH2 = i;
        break;
      }
    }
    const body = lines.slice(at + 1, nextH2).join("\n");
    // Empty if only whitespace, or only HTML comments.
    const stripped = body
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/\s+/g, "")
      .trim();
    if (stripped.length === 0) empty.push(required);
  }

  return { ok: missing.length === 0 && empty.length === 0, missing, empty };
}

// -------------------------------------------------------------------------------------
// Affected packages & path helpers.
// -------------------------------------------------------------------------------------

const SPOOF_PACKAGES = new Set(["inject", "consistency", "profiles"] as const);
const KNOWN_PACKAGE_NAMES = [
  "core",
  "consistency",
  "inject",
  "net",
  "net-rs",
  "behavioral",
  "profiles",
  "harness",
  "cli",
] as const;
type KnownPackage = (typeof KNOWN_PACKAGE_NAMES)[number];

/** Map a path like `packages/inject/src/foo.ts` to its package name (`inject`). */
export function packageNameFromPath(p: string): KnownPackage | null {
  const m = /^packages\/([^/]+)\//.exec(p);
  if (!m) return null;
  const name = m[1];
  if (name === undefined) return null;
  return (KNOWN_PACKAGE_NAMES as readonly string[]).includes(name) ? (name as KnownPackage) : null;
}

export function affectedPackages(changedFiles: readonly string[]): readonly KnownPackage[] {
  const out = new Set<KnownPackage>();
  for (const f of changedFiles) {
    const pkg = packageNameFromPath(f);
    if (pkg) out.add(pkg);
  }
  return [...out];
}

export function touchesSpoofSurface(changedFiles: readonly string[]): boolean {
  for (const pkg of affectedPackages(changedFiles)) {
    if ((SPOOF_PACKAGES as Set<string>).has(pkg)) return true;
  }
  return false;
}

// -------------------------------------------------------------------------------------
// Argument parser. Hand-rolled; no commander/yargs/citty.
// -------------------------------------------------------------------------------------

interface ParsedArgs {
  readonly positional: readonly string[];
  readonly flags: Readonly<Record<string, string | boolean>>;
}

export function parseArgs(argv: readonly string[]): ParsedArgs {
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] ?? "";
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      if (eq >= 0) {
        const k = a.slice(2, eq);
        flags[k] = a.slice(eq + 1);
      } else {
        const k = a.slice(2);
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith("--")) {
          flags[k] = next;
          i++;
        } else {
          flags[k] = true;
        }
      }
    } else {
      positional.push(a);
    }
  }
  return { positional, flags };
}

// -------------------------------------------------------------------------------------
// Subcommand: create
// -------------------------------------------------------------------------------------

const USAGE = `mochi-work — worktree dev harness for mochi

Usage:
  bun work create <task-id> <package>     create worktree + branch from origin/main
  bun work list                            list active worktrees
  bun work open <task-id>                  print the absolute path of a worktree
  bun work submit <task-id> [--draft]      run gates, push, and open a PR
  bun work clean [--merged-only|--all]     remove worktrees (default: merged-only)
  bun work --help                          this banner

See PLAN.md §15.2 and AGENTS.md §3 for the full workflow.
`;

async function cmdCreate(args: ParsedArgs, repo: RepoCtx): Promise<number> {
  const taskId = args.positional[0];
  const pkgArg = args.positional[1];
  if (!taskId || !pkgArg) {
    fatal("create requires <task-id> and <package>", "example: bun work create 0042 core");
  }

  // Validate package name.
  if (!(KNOWN_PACKAGE_NAMES as readonly string[]).includes(pkgArg) && pkgArg !== "repo") {
    fatal(
      `unknown package "${pkgArg}"`,
      `expected one of: ${[...KNOWN_PACKAGE_NAMES, "repo"].join(", ")}`,
    );
  }

  // Locate the task brief.
  const briefPath = `${repo.root}/tasks/${taskId}-*.md`;
  // Find the actual file (glob via Bun.Glob).
  const glob = new Bun.Glob(`tasks/${taskId}-*.md`);
  const matches: string[] = [];
  for await (const m of glob.scan({ cwd: repo.root })) matches.push(m);
  if (matches.length === 0) {
    fatal(
      `no task brief found at ${briefPath}`,
      `create tasks/${taskId}-<short-name>.md first (see tasks/_template.md)`,
    );
  }
  if (matches.length > 1) {
    fatal(
      `multiple briefs match tasks/${taskId}-*.md: ${matches.join(", ")}`,
      "task IDs must be unique",
    );
  }
  const briefRel = matches[0] ?? "";
  const briefAbs = `${repo.root}/${briefRel}`;
  const briefText = await Bun.file(briefAbs).text();
  const validation = validateBriefMarkdown(briefText);
  if (!validation.ok) {
    const missing = validation.missing.map((s) => `missing required section: ${s}`).join("\n  ");
    const empty = validation.empty.map((s) => `empty required section: ${s}`).join("\n  ");
    const detail = [missing, empty].filter(Boolean).join("\n  ");
    fatal(
      `task brief is malformed (${briefRel})\n  ${detail}`,
      "edit the brief so every required section has content; see tasks/_template.md",
    );
  }

  // Branch + worktree path.
  const branch = `task/${pkgArg}/${taskId}`;
  const worktreeAbs = `${repo.root}/worktrees/${taskId}`;

  // Refuse if worktree already exists.
  if (await Bun.file(`${worktreeAbs}/package.json`).exists()) {
    fatal(
      `worktree already exists at worktrees/${taskId}`,
      `clean it first with \`bun work clean --all\` or remove manually`,
    );
  }

  // Refuse if branch already exists locally.
  const branchExists = await run(
    ["git", "show-ref", "--verify", "--quiet", `refs/heads/${branch}`],
    { cwd: repo.root },
  );
  if (branchExists.code === 0) {
    fatal(`branch ${branch} already exists locally`, `delete it first or pick a different task id`);
  }

  await gitFetchOriginMain(repo);

  log.info(c.cyan(`→ creating worktree worktrees/${taskId} on branch ${branch}`));
  const wt = await run(["git", "worktree", "add", worktreeAbs, "-b", branch, "origin/main"], {
    cwd: repo.root,
  });
  if (wt.code !== 0) {
    fatal(
      `git worktree add failed: ${wt.stderr.trim()}`,
      "is origin/main fetched? try `git fetch origin main` and retry",
    );
  }

  log.info(c.cyan("→ running bun install in the new worktree"));
  const install = await run(["bun", "install"], { cwd: worktreeAbs, inherit: true });
  if (install.code !== 0) {
    log.warn("bun install failed inside the new worktree (worktree was still created)");
  }

  // Print next-steps banner.
  log.info("");
  log.info(c.bold(`Worktree ready at ${worktreeAbs}`));
  log.info(`  branch:  ${branch}`);
  log.info(`  brief:   ${briefRel}`);
  log.info("");
  log.info("Next steps:");
  log.info(`  cd "$(bun work open ${taskId})"`);
  log.info("  # subagent reads PLAN.md, AGENTS.md, the brief, then writes code");
  log.info(`  bun work submit ${taskId} --draft`);
  return 0;
}

// -------------------------------------------------------------------------------------
// Subcommand: list
// -------------------------------------------------------------------------------------

interface WorktreeInfo {
  readonly path: string;
  readonly branch: string;
  readonly head: string;
}

async function listGitWorktrees(repo: RepoCtx): Promise<readonly WorktreeInfo[]> {
  const out = await runOut(["git", "worktree", "list", "--porcelain"], { cwd: repo.root });
  const blocks = out.split(/\r?\n\r?\n/);
  const result: WorktreeInfo[] = [];
  for (const block of blocks) {
    let path = "";
    let head = "";
    let branch = "";
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith("worktree ")) path = line.slice("worktree ".length);
      else if (line.startsWith("HEAD ")) head = line.slice("HEAD ".length);
      else if (line.startsWith("branch ")) {
        branch = line.slice("branch ".length).replace(/^refs\/heads\//, "");
      } else if (line === "detached") {
        branch = "(detached)";
      }
    }
    if (path) result.push({ path, branch, head });
  }
  return result;
}

interface ListRow {
  readonly id: string;
  readonly pkg: string;
  readonly branch: string;
  readonly subject: string;
  readonly aheadBehind: string;
}

async function cmdList(_args: ParsedArgs, repo: RepoCtx): Promise<number> {
  const trees = await listGitWorktrees(repo);
  // Filter to those under <root>/worktrees/.
  const rootSlash = `${repo.root}/`;
  const ours = trees.filter((t) => t.path.startsWith(`${rootSlash}worktrees/`));
  if (ours.length === 0) {
    log.info("no active worktrees under worktrees/");
    log.info(c.dim("  (create one with `bun work create <task-id> <package>`)"));
    return 0;
  }

  const rows: ListRow[] = [];
  for (const tree of ours) {
    const id = tree.path.split("/").pop() ?? "?";
    const branchMatch = /^task\/([^/]+)\//.exec(tree.branch);
    const pkg = branchMatch?.[1] ?? "?";

    // Last commit subject.
    let subject = "(no commits)";
    try {
      subject = await runOut(["git", "log", "-1", "--pretty=%s"], { cwd: tree.path });
    } catch {
      // ignore
    }

    // Ahead/behind vs origin/main.
    let aheadBehind = "?";
    try {
      const counts = await runOut(
        ["git", "rev-list", "--left-right", "--count", `origin/main...${tree.branch}`],
        { cwd: tree.path },
      );
      const parts = counts.split(/\s+/);
      const behind = parts[0] ?? "0";
      const ahead = parts[1] ?? "0";
      aheadBehind = `+${ahead}/-${behind}`;
    } catch {
      // ignore
    }

    rows.push({ id, pkg, branch: tree.branch, subject, aheadBehind });
  }

  // Pretty table.
  const headers: ListRow = {
    id: "ID",
    pkg: "PKG",
    branch: "BRANCH",
    subject: "LAST COMMIT",
    aheadBehind: "+/-",
  };
  const all = [headers, ...rows];
  const widths = {
    id: Math.max(...all.map((r) => r.id.length)),
    pkg: Math.max(...all.map((r) => r.pkg.length)),
    branch: Math.max(...all.map((r) => r.branch.length)),
    aheadBehind: Math.max(...all.map((r) => r.aheadBehind.length)),
  };
  const fmt = (r: ListRow): string =>
    [
      r.id.padEnd(widths.id),
      r.pkg.padEnd(widths.pkg),
      r.branch.padEnd(widths.branch),
      r.aheadBehind.padEnd(widths.aheadBehind),
      r.subject,
    ].join("  ");
  log.info(c.bold(fmt(headers)));
  for (const row of rows) log.info(fmt(row));
  return 0;
}

// -------------------------------------------------------------------------------------
// Subcommand: open
// -------------------------------------------------------------------------------------

async function cmdOpen(args: ParsedArgs, repo: RepoCtx): Promise<number> {
  const [taskId] = args.positional;
  if (!taskId) {
    fatal("open requires <task-id>", "example: bun work open 0042");
  }
  const target = `${repo.root}/worktrees/${taskId}`;
  if (!(await Bun.file(`${target}/package.json`).exists())) {
    fatal(
      `no worktree at worktrees/${taskId}`,
      `create one with \`bun work create ${taskId} <package>\``,
    );
  }
  // Print the path; the caller does `cd "$(bun work open <id>)"`.
  log.info(target);
  return 0;
}

// -------------------------------------------------------------------------------------
// Subcommand: submit
// -------------------------------------------------------------------------------------

interface SubmitContext {
  readonly worktree: string;
  readonly branch: string;
  readonly taskId: string;
  readonly pkg: string;
}

async function resolveSubmitContext(args: ParsedArgs, repo: RepoCtx): Promise<SubmitContext> {
  // Determine if cwd is a worktree under <root>/worktrees/<id>.
  const cwd = process.cwd();
  let taskId: string;
  let worktree: string;
  const taskIdArg = args.positional[0];
  if (taskIdArg) {
    taskId = taskIdArg;
    worktree = `${repo.root}/worktrees/${taskId}`;
    if (!(await Bun.file(`${worktree}/package.json`).exists())) {
      fatal(
        `no worktree at worktrees/${taskId}`,
        `create one with \`bun work create ${taskId} <package>\``,
      );
    }
  } else {
    const cwdMatch = /^.*\/worktrees\/([^/]+)$/.exec(cwd);
    const cwdId = cwdMatch?.[1];
    if (!cwdId) {
      fatal(
        "submit must be run from inside a worktree, or with <task-id> argument",
        "example: bun work submit 0042 --draft",
      );
    }
    taskId = cwdId;
    worktree = cwd;
  }

  // Read branch.
  const branch = await runOut(["git", "rev-parse", "--abbrev-ref", "HEAD"], { cwd: worktree });
  const branchMatch = /^task\/([^/]+)\/(.+)$/.exec(branch);
  const pkg = branchMatch?.[1];
  if (!pkg) {
    fatal(
      `branch ${branch} doesn't match task/<package>/<task-id>`,
      "submit only operates on branches created by `bun work create`",
    );
  }
  return { worktree, branch, taskId, pkg };
}

async function ensureCleanTree(worktree: string): Promise<void> {
  const status = await runOut(["git", "status", "--porcelain"], { cwd: worktree });
  if (status.length > 0) {
    fatal(
      "worktree has uncommitted changes",
      "commit or stash them before running `bun work submit`",
    );
  }
}

async function changedFilesVsOrigin(worktree: string): Promise<readonly string[]> {
  const out = await runOut(["git", "diff", "--name-only", "origin/main...HEAD"], {
    cwd: worktree,
  });
  return out.split(/\r?\n/).filter(Boolean);
}

interface Gate {
  readonly name: string;
  readonly cmd: readonly string[];
  readonly hint: string;
}

async function runGate(gate: Gate, cwd: string): Promise<void> {
  log.info(c.cyan(`→ ${gate.name}`));
  const result = await run(gate.cmd, { cwd, inherit: true });
  if (result.code !== 0) {
    fatal(`gate failed: ${gate.name}`, gate.hint);
  }
}

async function ghAvailable(): Promise<boolean> {
  const which = await run(["bash", "-lc", "command -v gh"]);
  return which.code === 0;
}

async function ghAuthed(): Promise<boolean> {
  const status = await run(["gh", "auth", "status"]);
  return status.code === 0;
}

function buildPrBody(
  templateText: string,
  affected: readonly KnownPackage[],
  taskId: string,
  spoofTouched: boolean,
): string {
  // Tick the appropriate package checkboxes.
  const knownLines = new Map<KnownPackage, string>([
    ["core", "@mochi.js/core"],
    ["consistency", "@mochi.js/consistency"],
    ["inject", "@mochi.js/inject"],
    ["net", "@mochi.js/net"],
    ["net-rs", "@mochi.js/net-rs"],
    ["behavioral", "@mochi.js/behavioral"],
    ["profiles", "@mochi.js/profiles"],
    ["harness", "@mochi.js/harness"],
    ["cli", "@mochi.js/cli"],
  ]);

  let body = templateText;
  for (const [pkg, label] of knownLines) {
    if (affected.includes(pkg)) {
      body = body.replace(`- [ ] ${label}`, `- [x] ${label}`);
    }
  }

  // Pre-fill the task brief reference.
  body = body.replace("Closes #\n", `Closes #${taskId}\n`);

  // Replace the Probe Manifest diff block when irrelevant. The template ships with `N/A`
  // already in the fenced block; only inject a more explicit note when the diff matters.
  if (spoofTouched) {
    body = body.replace(
      "```\nN/A\n```",
      "```\nTODO: paste the output of `bun harness:diff <profile>` here\n```",
    );
  }

  return body;
}

async function cmdSubmit(args: ParsedArgs, repo: RepoCtx): Promise<number> {
  const ctx = await resolveSubmitContext(args, repo);
  const draft = args.flags.draft === true;

  await ensureCleanTree(ctx.worktree);

  // Compute affected packages from diff.
  let changed: readonly string[] = [];
  try {
    changed = await changedFilesVsOrigin(ctx.worktree);
  } catch (err) {
    log.warn(`could not compute changed files vs origin/main: ${(err as Error).message}`);
  }
  const affected = affectedPackages(changed);
  const spoofTouched = touchesSpoofSurface(changed);

  // Gate sequence.
  const gates: Gate[] = [
    {
      name: "bun typecheck",
      cmd: ["bun", "run", "typecheck"],
      hint: "fix the TS errors above; zero `any`, zero `// @ts-ignore` (AGENTS.md §6)",
    },
    {
      name: "bun lint",
      cmd: ["bun", "run", "lint"],
      hint: "run `bun run lint:fix` to auto-fix what biome can; resolve the rest",
    },
    {
      name: "bun test",
      cmd: ["bun", "run", "test"],
      hint: "fix the failing test(s) — do not skip flaky tests (AGENTS.md §12)",
    },
    {
      name: `bun test:contract --pkg=${ctx.pkg}`,
      cmd: ["bun", "run", "test:contract", "--", `--pkg=${ctx.pkg}`],
      hint: "see tests/contract/ for the cross-package contracts",
    },
  ];
  if (spoofTouched) {
    gates.push({
      name: "bun harness:smoke --affected",
      cmd: ["bun", "run", "harness:smoke", "--", "--affected"],
      hint: "Zero-Diff is the bar; see PLAN.md §13.6",
    });
  }

  for (const gate of gates) {
    // eslint-disable-next-line no-await-in-loop
    await runGate(gate, ctx.worktree);
  }

  // Push the branch.
  log.info(c.cyan("→ pushing branch to origin"));
  const push = await run(["git", "push", "-u", "origin", ctx.branch], {
    cwd: ctx.worktree,
    inherit: true,
  });
  if (push.code !== 0) {
    fatal("git push failed (see output above)", "fix the push error then re-run submit");
  }

  // gh pr create.
  if (!(await ghAvailable())) {
    log.warn("`gh` not installed — branch pushed, but PR was not opened");
    log.info("install gh: https://cli.github.com/  then run `gh pr create --draft`");
    return 0;
  }
  if (!(await ghAuthed())) {
    log.warn("`gh` is not authenticated — branch pushed, but PR was not opened");
    log.info("run `gh auth login` then re-run `bun work submit` to open the PR");
    return 0;
  }

  const titleSubject = await runOut(["git", "log", "-1", "--pretty=%s"], { cwd: ctx.worktree });

  // Read the PR template; if it's missing, fall back to a minimal body.
  const templatePath = `${repo.root}/.github/PULL_REQUEST_TEMPLATE.md`;
  let body = `Closes #${ctx.taskId}\n`;
  if (await Bun.file(templatePath).exists()) {
    const tmpl = await Bun.file(templatePath).text();
    body = buildPrBody(tmpl, affected, ctx.taskId, spoofTouched);
  }

  // Write a temp body file for gh.
  const bodyFile = `${ctx.worktree}/.git/MOCHI_PR_BODY.md`;
  await Bun.write(bodyFile, body);

  const ghArgs = ["gh", "pr", "create", "--title", titleSubject, "--body-file", bodyFile];
  if (draft) ghArgs.push("--draft");
  log.info(c.cyan(`→ ${ghArgs.join(" ")}`));
  const pr = await run(ghArgs, { cwd: ctx.worktree, inherit: true });
  if (pr.code !== 0) {
    fatal(
      "gh pr create failed (see output above)",
      "you can open the PR manually with `gh pr create` from the worktree",
    );
  }
  return 0;
}

// -------------------------------------------------------------------------------------
// Subcommand: clean
// -------------------------------------------------------------------------------------

/**
 * Decide whether a branch's work is already present on `origin/main`.
 *
 * Two paths, either is sufficient:
 *
 *   1. **Ancestor reachability** — `git merge-base --is-ancestor <branch> origin/main`
 *      returns 0 when `<branch>`'s tip is reachable from `origin/main`. Catches
 *      fast-forward merges, classic merge commits, and rebase-then-fast-forward.
 *
 *   2. **Patch-id equivalence** — `git cherry origin/main <branch>` enumerates
 *      every commit on `<branch>` that is *not yet* equivalent (by patch-id) to
 *      a commit on `origin/main`. Lines beginning with `+` are unmerged; lines
 *      beginning with `-` are equivalent (already on main). When zero `+` lines
 *      remain, the branch's work is fully on main — this is git's authoritative
 *      "is this branch's work already present" check, and crucially handles the
 *      **squash-merge** workflow we use (PLAN.md §15.7), since the squash
 *      commit on main has the same patch-id as the (single) branch commit.
 *
 *      Edge cases handled by the predicate `every(line => !line.startsWith("+"))`:
 *        - empty stdout (no unique commits → trivially merged) → all() is true
 *        - all `-` lines (every commit has an equivalent on main) → no `+`, true
 *        - any `+` line (genuinely unmerged work) → false
 *
 * `git cherry` itself never errors on a valid branch + ref pair, so we return
 * `false` (treat as unmerged) on a non-zero exit out of caution.
 */
export async function isBranchMerged(branch: string, repo: RepoCtx): Promise<boolean> {
  // Path 1: ancestor reachability (fast-forward / classic merge / rebase merges).
  const ancestor = await run(["git", "merge-base", "--is-ancestor", branch, "origin/main"], {
    cwd: repo.root,
  });
  if (ancestor.code === 0) return true;

  // Path 2: patch-id equivalence (squash-merges; also catches cherry-picks).
  const cherry = await run(["git", "cherry", "origin/main", branch], { cwd: repo.root });
  if (cherry.code !== 0) return false;
  return cherry.stdout.split(/\r?\n/).every((line) => !line.startsWith("+"));
}

async function confirm(question: string): Promise<boolean> {
  if (!process.stdin.isTTY) return false;
  process.stdout.write(`${question} [y/N] `);
  // Read a single line from stdin.
  const decoder = new TextDecoder();
  const reader = (Bun.stdin.stream() as ReadableStream<Uint8Array>).getReader();
  let input = "";
  try {
    while (true) {
      // eslint-disable-next-line no-await-in-loop
      const { value, done } = await reader.read();
      if (done) break;
      input += decoder.decode(value);
      if (input.includes("\n")) break;
    }
  } finally {
    reader.releaseLock();
  }
  return /^\s*y(es)?\s*$/i.test(input);
}

async function cmdClean(args: ParsedArgs, repo: RepoCtx): Promise<number> {
  const all = args.flags.all === true;
  const yes = args.flags.yes === true;
  const mergedOnly = !all || args.flags["merged-only"] === true;

  await gitFetchOriginMain(repo);

  const trees = await listGitWorktrees(repo);
  const rootSlash = `${repo.root}/`;
  const ours = trees.filter((t) => t.path.startsWith(`${rootSlash}worktrees/`));
  if (ours.length === 0) {
    log.info("no worktrees to clean");
    return 0;
  }

  const candidates: WorktreeInfo[] = [];
  for (const tree of ours) {
    if (mergedOnly && !all) {
      // eslint-disable-next-line no-await-in-loop
      const merged = await isBranchMerged(tree.branch, repo);
      if (!merged) continue;
    }
    candidates.push(tree);
  }

  if (candidates.length === 0) {
    log.info("nothing to clean (no merged worktrees)");
    log.info(c.dim("  (use --all to remove unmerged worktrees too)"));
    return 0;
  }

  log.info(c.bold(`will remove ${candidates.length} worktree(s):`));
  for (const tree of candidates) log.info(`  ${tree.path}  (${tree.branch})`);

  if (!yes) {
    const ok = await confirm("proceed?");
    if (!ok) {
      log.info("aborted");
      return 0;
    }
  }

  for (const tree of candidates) {
    log.info(c.cyan(`→ git worktree remove ${tree.path}`));
    // eslint-disable-next-line no-await-in-loop
    const result = await run(["git", "worktree", "remove", "--force", tree.path], {
      cwd: repo.root,
    });
    if (result.code !== 0) {
      log.warn(`failed to remove ${tree.path}: ${result.stderr.trim()}`);
      continue;
    }
    // Best-effort branch delete (only meaningful for merged branches).
    // eslint-disable-next-line no-await-in-loop
    await run(["git", "branch", "-D", tree.branch], { cwd: repo.root });
  }
  return 0;
}

// -------------------------------------------------------------------------------------
// Entry point.
// -------------------------------------------------------------------------------------

export async function runCli(argv: readonly string[]): Promise<number> {
  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h" || argv[0] === "help") {
    log.info(USAGE);
    return 0;
  }

  const sub = argv[0];
  const rest = argv.slice(1);
  const args = parseArgs(rest);

  switch (sub) {
    case "create": {
      const repo = await repoCtx();
      return cmdCreate(args, repo);
    }
    case "list": {
      const repo = await repoCtx();
      return cmdList(args, repo);
    }
    case "open": {
      const repo = await repoCtx();
      return cmdOpen(args, repo);
    }
    case "submit": {
      const repo = await repoCtx();
      return cmdSubmit(args, repo);
    }
    case "clean": {
      const repo = await repoCtx();
      return cmdClean(args, repo);
    }
    default: {
      log.error(`unknown subcommand: ${sub}`);
      log.info(USAGE);
      return 1;
    }
  }
}

// Execute when run directly (not when imported by tests).
if (import.meta.main) {
  const code = await runCli(Bun.argv.slice(2));
  process.exit(code);
}
