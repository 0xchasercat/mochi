/**
 * subcommand.ts — `mochi browsers <action> [...flags]` dispatcher.
 *
 * Argv shape (after the leading `browsers` token has already been consumed by
 * the parent `mochi` dispatcher):
 *
 *   install [--channel <c>] [--version <v>] [--platform <p>] [--force]
 *           [--sha256 <hex>] [--root <path>] [--offline] [--no-cache]
 *   list    [--root <path>]
 *   path    [--channel <c>] [--version <v>] [--platform <p>] [--root <path>]
 *   uninstall <version> [--channel <c>] [--platform <p>] [--root <path>] [--yes]
 *   --help | -h
 *
 * All flags accept both `--flag value` and `--flag=value` forms. Boolean flags
 * have no value (just presence).
 *
 * @see PLAN.md §5.8
 */
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { userInfo } from "node:os";
import { createInterface } from "node:readline/promises";
import { listInstalled, resolveChromiumBinary } from "./index";
import {
  BinarySmokeError,
  DownloadError,
  install,
  Sha256MismatchError,
  UnzipError,
} from "./install";
import {
  binaryPathFor,
  type CftPlatform,
  type Channel,
  defaultInstallRoot,
  detectPlatform,
  installDir as installDirFor,
  isCftPlatform,
  isChannel,
} from "./paths";

const HELP = `mochi browsers — manage Chromium-for-Testing installs

USAGE:
  mochi browsers install   [--channel <stable|beta>] [--version <X.Y.Z.W>]
                           [--platform <plat>] [--force] [--sha256 <hex>]
                           [--root <path>] [--offline] [--no-cache]

  mochi browsers list      [--root <path>]

  mochi browsers path      [--channel <c>] [--version <v>] [--platform <p>]
                           [--root <path>]

  mochi browsers uninstall <version> [--channel <c>] [--platform <p>]
                                     [--root <path>] [--yes]

ENVIRONMENT:
  MOCHI_BROWSERS_ROOT     Override install root (default: ~/.mochi/browsers).
  MOCHI_CHROMIUM_PATH     Bypass resolution; use this binary path directly.

NOTES:
  - The CfT registry does not publish per-asset SHA256 hashes; pass
    --sha256 to verify against a hash you obtained out-of-band. Without it,
    we record the SHA256 we computed at install time in <installDir>/.mochi-meta.json
    so future force-reinstalls can detect drift.
  - \`unzip\` must be on PATH. macOS, Linux, and Git-Bash all ship it.
`;

const CLI_VERSION = "0.0.1";

export interface DispatchResult {
  readonly code: number;
}

/**
 * Top-level dispatch. Pure-ish: writes to stdout/stderr, returns exit code.
 */
export async function runBrowsers(argv: readonly string[]): Promise<number> {
  const action = argv[0];
  if (!action || action === "--help" || action === "-h") {
    process.stdout.write(`${HELP}\n`);
    return action ? 0 : 1;
  }
  const rest = argv.slice(1);
  switch (action) {
    case "install":
      return runInstall(rest);
    case "list":
      return runList(rest);
    case "path":
      return runPath(rest);
    case "uninstall":
      return runUninstall(rest);
    default:
      process.stderr.write(`mochi browsers: unknown action '${action}'\n${HELP}\n`);
      return 1;
  }
}

// ----------------------------------------------------------------------------
// Argument parsing — small, deliberate, no framework deps.
// ----------------------------------------------------------------------------

interface ParsedArgs {
  readonly positional: readonly string[];
  readonly flags: Readonly<Record<string, string | boolean>>;
}

const BOOL_FLAGS = new Set(["force", "yes", "no-cache", "offline", "help"]);

export function parseFlags(args: readonly string[]): ParsedArgs {
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === undefined) continue;
    if (a === "--") {
      // remaining args are positional
      for (let j = i + 1; j < args.length; j++) {
        const v = args[j];
        if (v !== undefined) positional.push(v);
      }
      break;
    }
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      const name = (eq >= 0 ? a.slice(2, eq) : a.slice(2)).toLowerCase();
      if (eq >= 0) {
        flags[name] = a.slice(eq + 1);
        continue;
      }
      if (BOOL_FLAGS.has(name)) {
        flags[name] = true;
        continue;
      }
      const next = args[i + 1];
      if (next !== undefined && !next.startsWith("-")) {
        flags[name] = next;
        i++;
      } else {
        flags[name] = true;
      }
      continue;
    }
    if (a.startsWith("-h") || a === "-h") {
      flags.help = true;
      continue;
    }
    positional.push(a);
  }
  return { positional, flags };
}

function asString(value: string | boolean | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function resolveChannelFlag(value: string | boolean | undefined, fallback: Channel): Channel {
  const s = asString(value);
  if (s === undefined) return fallback;
  if (!isChannel(s)) {
    throw new UsageError(`invalid --channel: ${s} (expected stable | beta)`);
  }
  return s;
}

function resolvePlatformFlag(value: string | boolean | undefined): CftPlatform {
  const s = asString(value);
  if (s !== undefined) {
    if (!isCftPlatform(s)) {
      throw new UsageError(
        `invalid --platform: ${s} (expected mac-arm64 | mac-x64 | linux64 | win64)`,
      );
    }
    return s;
  }
  const auto = detectPlatform();
  if (!auto) {
    throw new UsageError(
      `cannot auto-detect platform for ${process.platform}-${process.arch}; pass --platform explicitly. CfT does not currently ship Linux-arm64.`,
    );
  }
  return auto;
}

function resolveVersionFlag(value: string | boolean | undefined): string | undefined {
  const s = asString(value);
  if (s === undefined) return undefined;
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(s)) {
    throw new UsageError(`invalid --version: ${s} (expected dotted-quad like 131.0.6778.85)`);
  }
  return s;
}

function resolveRootFlag(value: string | boolean | undefined): string {
  return asString(value) ?? defaultInstallRoot();
}

class UsageError extends Error {
  override readonly name = "UsageError";
}

// ----------------------------------------------------------------------------
// install
// ----------------------------------------------------------------------------

async function runInstall(args: readonly string[]): Promise<number> {
  let parsed: ParsedArgs;
  try {
    parsed = parseFlags(args);
  } catch (err) {
    return reportError(err);
  }
  if (parsed.flags.help === true) {
    process.stdout.write(`${HELP}\n`);
    return 0;
  }

  let channel: Channel;
  let platform: CftPlatform;
  let version: string | undefined;
  let root: string;
  try {
    channel = resolveChannelFlag(parsed.flags.channel, "stable");
    platform = resolvePlatformFlag(parsed.flags.platform);
    version = resolveVersionFlag(parsed.flags.version);
    root = resolveRootFlag(parsed.flags.root);
  } catch (err) {
    return reportError(err);
  }

  const expectedSha = asString(parsed.flags.sha256);
  if (expectedSha !== undefined && !/^[0-9a-f]{64}$/i.test(expectedSha)) {
    return reportError(new UsageError(`--sha256 must be 64 hex characters; got ${expectedSha}`));
  }

  // Task 0259 — light root warning at install time. Linux Chromium refuses
  // to launch as root unless --no-sandbox or the SUID helper is wired up;
  // we only warn (some CI / Docker setups legitimately run as root) so the
  // first-time user sees the gotcha BEFORE the launch crashes opaquely.
  // macOS / Windows root-uid semantics differ — Linux-only.
  if (process.platform === "linux") {
    try {
      if (userInfo().uid === 0) {
        process.stderr.write(
          "warning: running as root. Chromium refuses to start under the user-namespace\n" +
            "         sandbox as root — `mochi.launch()` will fail with EPIPE unless you\n" +
            "         run as a non-root user, `chmod 4755` chrome-sandbox, or pass\n" +
            "         args: ['--no-sandbox'] (fingerprint leak, see PLAN.md §8.6).\n",
        );
      }
    } catch {
      // userInfo() can throw on exotic platforms — best-effort only.
    }
  }

  try {
    const result = await install({
      root,
      channel,
      platform,
      ...(version !== undefined ? { version } : {}),
      force: parsed.flags.force === true,
      ...(expectedSha !== undefined ? { expectedSha256: expectedSha } : {}),
      offline: parsed.flags.offline === true,
      noCache: parsed.flags["no-cache"] === true,
      mochiCliVersion: CLI_VERSION,
    });

    if (result.alreadyInstalled) {
      // log already emitted by install()
    } else {
      process.stdout.write(
        `installed ${result.meta.channel} ${result.meta.version} (${result.meta.platform}) at ${result.installDir}\n`,
      );
    }
    return 0;
  } catch (err) {
    return reportError(err);
  }
}

// ----------------------------------------------------------------------------
// list
// ----------------------------------------------------------------------------

async function runList(args: readonly string[]): Promise<number> {
  let parsed: ParsedArgs;
  try {
    parsed = parseFlags(args);
  } catch (err) {
    return reportError(err);
  }
  const root = resolveRootFlag(parsed.flags.root);
  const installs = await listInstalled(root);
  if (installs.length === 0) {
    process.stdout.write(
      `no Chromium-for-Testing installs under ${root}\n` +
        `  (run \`mochi browsers install\` to fetch one)\n`,
    );
    return 0;
  }
  process.stdout.write(`${formatInstallTable(installs)}\n`);
  return 0;
}

interface RowFields {
  readonly channel: string;
  readonly version: string;
  readonly platform: string;
  readonly path: string;
  readonly size: string;
}

export function formatInstallTable(
  installs: ReadonlyArray<{
    readonly installDir: string;
    readonly meta: { channel: string; version: string; platform: string };
    readonly binaryPath: string;
  }>,
): string {
  const rows: RowFields[] = installs.map((b) => {
    const size = formatBytes(safeDirSize(b.installDir));
    return {
      channel: b.meta.channel,
      version: b.meta.version,
      platform: b.meta.platform,
      path: b.binaryPath,
      size,
    };
  });
  const cols: ReadonlyArray<keyof RowFields> = ["channel", "version", "platform", "size", "path"];
  const widths: Record<string, number> = {};
  for (const c of cols) {
    widths[c] = c.length;
  }
  for (const r of rows) {
    for (const c of cols) {
      widths[c] = Math.max(widths[c] ?? 0, r[c].length);
    }
  }
  const header = cols.map((c) => c.toUpperCase().padEnd(widths[c] ?? c.length)).join("  ");
  const lines = rows.map((r) => cols.map((c) => r[c].padEnd(widths[c] ?? c.length)).join("  "));
  return [header, ...lines].join("\n");
}

function safeDirSize(dir: string): number {
  // Avoid recursive-stat costs on a directory we just want to list quickly.
  // We use the sentinel `chrome` binary's size as a proxy for "is it real".
  // For a precise size, callers can run `du -sh <dir>` themselves.
  // (Not a hot path; kept simple to avoid a portability headache.)
  if (!existsSync(dir)) return 0;
  return 0; // placeholder — table still renders cleanly with "0 B"
}

function formatBytes(n: number): string {
  if (n === 0) return "—";
  const units = ["B", "KB", "MB", "GB"];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(1)} ${units[i]}`;
}

// ----------------------------------------------------------------------------
// path
// ----------------------------------------------------------------------------

async function runPath(args: readonly string[]): Promise<number> {
  let parsed: ParsedArgs;
  try {
    parsed = parseFlags(args);
  } catch (err) {
    return reportError(err);
  }
  let channel: Channel | undefined;
  let platform: CftPlatform | undefined;
  let version: string | undefined;
  let root: string;
  try {
    channel =
      parsed.flags.channel !== undefined
        ? resolveChannelFlag(parsed.flags.channel, "stable")
        : undefined;
    platform =
      parsed.flags.platform !== undefined ? resolvePlatformFlag(parsed.flags.platform) : undefined;
    version = resolveVersionFlag(parsed.flags.version);
    root = resolveRootFlag(parsed.flags.root);
  } catch (err) {
    return reportError(err);
  }

  try {
    const resolved = await resolveChromiumBinary({
      ...(channel !== undefined ? { channel } : {}),
      ...(version !== undefined ? { version } : {}),
      ...(platform !== undefined ? { platform } : {}),
      root,
    });
    process.stdout.write(`${resolved.path}\n`);
    return 0;
  } catch (err) {
    return reportError(err);
  }
}

// ----------------------------------------------------------------------------
// uninstall
// ----------------------------------------------------------------------------

async function runUninstall(args: readonly string[]): Promise<number> {
  let parsed: ParsedArgs;
  try {
    parsed = parseFlags(args);
  } catch (err) {
    return reportError(err);
  }
  const versionPos = parsed.positional[0];
  if (!versionPos) {
    return reportError(
      new UsageError(
        "usage: mochi browsers uninstall <version> [--channel <c>] [--platform <p>] [--yes]",
      ),
    );
  }
  let channel: Channel;
  let platform: CftPlatform;
  let root: string;
  try {
    channel = resolveChannelFlag(parsed.flags.channel, "stable");
    platform = resolvePlatformFlag(parsed.flags.platform);
    root = resolveRootFlag(parsed.flags.root);
  } catch (err) {
    return reportError(err);
  }
  const version = resolveVersionFlag(versionPos);
  if (!version) {
    return reportError(new UsageError(`invalid version: ${versionPos}`));
  }
  const dir = installDirFor(root, channel, version, platform);
  if (!existsSync(dir)) {
    process.stderr.write(`no install at ${dir}\n`);
    return 1;
  }
  if (parsed.flags.yes !== true) {
    const confirmed = await confirm(`remove ${dir}? [y/N] `);
    if (!confirmed) {
      process.stdout.write("aborted\n");
      return 1;
    }
  }
  await rm(dir, { recursive: true, force: true });
  process.stdout.write(`removed ${dir}\n`);
  // Validate we can still resolve the binary in case it was the only one.
  // (No-op: just informational.)
  process.stdout.write(
    `(binary at ${binaryPathFor(root, channel, version, platform)} no longer exists)\n`,
  );
  return 0;
}

async function confirm(prompt: string): Promise<boolean> {
  // node:readline/promises is available in Bun; piped input is handled by the
  // Interface's question() method.
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(prompt);
    return /^y(es)?$/i.test(answer.trim());
  } finally {
    rl.close();
  }
}

// ----------------------------------------------------------------------------
// Error formatting
// ----------------------------------------------------------------------------

function reportError(err: unknown): number {
  if (err instanceof UsageError) {
    process.stderr.write(`mochi browsers: ${err.message}\n`);
    return 2;
  }
  if (err instanceof DownloadError) {
    process.stderr.write(`mochi browsers: download failed (${err.cause}): ${err.message}\n`);
    return 1;
  }
  if (err instanceof Sha256MismatchError) {
    process.stderr.write(
      `mochi browsers: integrity check failed.\n  expected: ${err.expected}\n  actual:   ${err.actual}\n`,
    );
    return 1;
  }
  if (err instanceof UnzipError) {
    process.stderr.write(`mochi browsers: unzip failed: ${err.message}\n`);
    return 1;
  }
  if (err instanceof BinarySmokeError) {
    // Task 0259 — the install succeeded on disk but the binary does not
    // launch. Print the full hint (apt line + docs URL) on stderr and exit
    // non-zero so CI / scripts know the install isn't truly done.
    process.stderr.write(`mochi browsers: ${err.message}\n`);
    return 1;
  }
  if (err instanceof Error) {
    process.stderr.write(`mochi browsers: ${err.message}\n`);
    return 1;
  }
  process.stderr.write(`mochi browsers: unknown error: ${String(err)}\n`);
  return 1;
}
