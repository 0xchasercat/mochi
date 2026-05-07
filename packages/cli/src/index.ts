/**
 * @mochi.js/cli — programmatic CLI surface (also exposed as the `mochi` binary).
 *
 * v0.0.1 claim release; subcommands land progressively (phase 0.4: capture; 0.5: harness;
 * 0.0+: work; 0.11: browsers install).
 *
 * @see PLAN.md §5.8
 */
export const VERSION = "0.0.1" as const;

export const SUBCOMMANDS = ["browsers", "capture", "harness", "work", "version"] as const;
export type Subcommand = (typeof SUBCOMMANDS)[number];

/**
 * Walk up from `start` until a directory containing `scripts/mochi-work.ts` is
 * found. Returns null if the worktree cannot be located.
 */
async function findRepoRoot(start: string): Promise<string | null> {
  let dir = start;
  for (let i = 0; i < 32; i++) {
    if (await Bun.file(`${dir}/scripts/mochi-work.ts`).exists()) return dir;
    const parent = dir.replace(/\/[^/]+$/, "");
    if (!parent || parent === dir) return null;
    dir = parent;
  }
  return null;
}

/**
 * Proxy `mochi work …` to `scripts/mochi-work.ts` via `Bun.spawn`. Lazy-imported
 * by `main` so the cli package's typecheck/test don't pull the script into
 * their compile graph.
 *
 * @internal
 */
export async function proxyToWork(workArgs: readonly string[]): Promise<number> {
  const repoRoot = await findRepoRoot(process.cwd());
  if (!repoRoot) {
    console.error(
      "error: could not locate the mochi repo root (no scripts/mochi-work.ts found above cwd)",
    );
    console.error("  → run `bun work` from inside the mochi monorepo");
    return 1;
  }
  const scriptPath = `${repoRoot}/scripts/mochi-work.ts`;
  const proc = Bun.spawn(["bun", scriptPath, ...workArgs], {
    cwd: process.cwd(),
    stdout: "inherit",
    stderr: "inherit",
    stdin: "inherit",
  });
  return proc.exited;
}

export async function main(argv: readonly string[]): Promise<number> {
  const arg = argv[0];
  if (arg === "version" || arg === "--version" || arg === "-v") {
    console.log(`mochi v${VERSION}`);
    return 0;
  }
  if (arg === "work") {
    return proxyToWork(argv.slice(1));
  }
  console.error(
    `mochi v${VERSION} (claim release)\n` +
      `subcommands not yet implemented; see https://github.com/0xchasercat/mochi`,
  );
  return 1;
}
