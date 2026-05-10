/**
 * @mochi.js/cli — programmatic CLI surface (also exposed as the `mochi` binary).
 *
 * v0.0.1 claim release; subcommands land progressively (phase 0.4: capture; 0.5: harness;
 * 0.0+: work; 0.1: browsers install).
 *
 * @see PLAN.md §5.8
 */
export const VERSION = "0.2.8" as const;

/**
 * Programmatic re-exports for downstream consumers (notably `@mochi.js/core`,
 * (). Keep this list narrow — the CLI is a tool, not a library.
 */
export {
  type CftPlatform,
  type Channel,
  ChromiumNotFoundError,
  defaultInstallRoot,
  detectPlatform,
  type InstalledBrowser,
  type InstallMeta,
  type InstallResult,
  install,
  install as installChromium,
  listInstalled,
  PINNED_FALLBACK_VERSION,
  type ResolveChromiumOpts,
  type ResolvedChromium,
  resolveChromiumBinary,
} from "./browsers/index";

export const SUBCOMMANDS = [
  "browsers",
  "capture",
  "harness",
  "profiles",
  "work",
  "version",
] as const;
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

/** The help text printed by `mochi`, `mochi --help`, and `mochi -h`. */
const HELP_TEXT = `mochi v${VERSION} — stealth browser automation, Bun-native

USAGE:
  bunx mochi <subcommand> [args...]

SUBCOMMANDS:
  browsers    Manage Chromium-for-Testing installs
                install [--channel <stable|beta>] [--version <X.Y.Z.W>] [--sha256 <hex>]
                list                                  List installed builds
                path [--channel <c>] [--version <v>]  Print absolute path to a binary
                uninstall <version> [--yes]           Remove a cached build

  capture     Capture a Probe Manifest baseline from a real device
                Outputs profile.json + baseline.manifest.json + PROVENANCE.md.

  harness     Run the Probe Manifest harness (Zero-Diff gate)
                all [--include-online]                Diff every shipped profile
                <profile-id>                          Diff a single profile

  profiles    Inspect / import / list shipped profiles
                list                                  Show every shipped id
                show <profile-id>                     Print one profile.json

  work        Proxy to scripts/mochi-work.ts (in-tree task orchestrator)

  version     Print the package version (also: --version, -v)

DOCS: https://mochijs.com/docs/api/cli
REPO: https://github.com/0xchasercat/mochi
`;

export async function main(argv: readonly string[]): Promise<number> {
  const arg = argv[0];
  if (arg === "version" || arg === "--version" || arg === "-v") {
    console.log(`mochi v${VERSION}`);
    return 0;
  }
  if (arg === undefined || arg === "help" || arg === "--help" || arg === "-h") {
    // Stdout for help (so `| less` works); zero exit so `mochi --help`
    // doesn't trip CI that pipes `mochi`'s output.
    console.log(HELP_TEXT);
    return 0;
  }
  if (arg === "work") {
    return proxyToWork(argv.slice(1));
  }
  if (arg === "browsers") {
    const { runBrowsers } = await import("./browsers/subcommand");
    return runBrowsers(argv.slice(1));
  }
  if (arg === "capture") {
    const { runCaptureCommand } = await import("./capture/subcommand");
    return runCaptureCommand(argv.slice(1));
  }
  if (arg === "harness") {
    const { runHarnessCommand } = await import("./harness/subcommand");
    return runHarnessCommand(argv.slice(1));
  }
  if (arg === "profiles") {
    const { runProfilesCommand } = await import("./profiles/subcommand");
    return runProfilesCommand(argv.slice(1));
  }
  console.error(`mochi v${VERSION}: unknown subcommand "${String(arg)}"\n`);
  console.error(HELP_TEXT);
  return 1;
}
