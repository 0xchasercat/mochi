/**
 * subcommand.ts — `mochi harness` dispatcher.
 *
 * Argv shape (after the leading `harness` token):
 *
 *   mochi harness <profile-id> [--include-online] [--out <dir>]
 *                              [--browser <path>] [--seed <s>] [--no-headless]
 *   mochi harness all          [--include-online] [--out <dir>]
 *                              [--browser <path>] [--no-headless]
 *
 * Without `--out`, prints the verdict + counts + structuralMatchPct.
 * With `--out <dir>`, writes `report.json` + `report.html` next to the
 * verdict line for the orchestrator to inspect.
 *
 * @see PLAN.md §13.6
 * @see tasks/0050-harness-mvp.md
 */

import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import {
  type DiffReportV1,
  listProfiles,
  type RunHarnessOptions,
  html as renderHtml,
  summary as renderSummary,
  runHarnessAgainstProfile,
} from "@mochi.js/harness";

const HELP = `mochi harness — run the validation harness against a profile

USAGE:
  mochi harness <profile-id> [--include-online] [--out <dir>]
                             [--browser <path>] [--seed <s>] [--no-headless]
  mochi harness all          [--include-online] [--out <dir>]
                             [--browser <path>] [--no-headless]

DESCRIPTION:
  Drives a Mochi-spoofed session through tests/fixtures/probe-page.html,
  normalizes per-session entropy on both the captured manifest and the
  committed baseline, structurally diffs the two, categorizes each entry
  as guid-class | intentional | material, and prints a verdict.

  PR gate: counts.material === 0.

OPTIONS:
  --include-online      Also run the online suite (creep.js, sannysoft, …).
                        Plumbed for v0.5.x; not yet wired.
  --out <dir>           Write report.json + report.html to <dir>/<profile-id>/.
  --browser <path>      Override the Chromium binary. Falls back to
                        MOCHI_CHROMIUM_PATH or \`mochi browsers install\`.
  --seed <s>            Override the seed. Default: harness-<profile-id>.
  --no-headless         Run the browser headed (default: headless).
  --help, -h            Show this message.

ENVIRONMENT:
  MOCHI_CHROMIUM_PATH   Override the Chromium binary path (consumed by core).

EXIT CODES:
   0   verdict EQUIVALENT (counts.material === 0)
   1   verdict DIVERGED   (counts.material > 0)
   2   usage error
`;

interface ParsedArgs {
  readonly positional: readonly string[];
  readonly flags: Readonly<Record<string, string | boolean>>;
}

const BOOL_FLAGS = new Set(["help", "include-online", "no-headless", "headless"]);

export function parseFlags(args: readonly string[]): ParsedArgs {
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === undefined) continue;
    if (a === "--") {
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
    if (a === "-h") {
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

class UsageError extends Error {
  override readonly name = "UsageError";
}

/**
 * Top-level dispatch for `mochi harness`. Returns a process exit code.
 */
export async function runHarnessCommand(argv: readonly string[]): Promise<number> {
  let parsed: ParsedArgs;
  try {
    parsed = parseFlags(argv);
  } catch (err) {
    return reportError(err);
  }

  if (parsed.flags.help === true || argv.length === 0) {
    process.stdout.write(`${HELP}\n`);
    return parsed.flags.help === true ? 0 : 1;
  }

  const target = parsed.positional[0];
  if (target === undefined) {
    return reportError(new UsageError("missing profile id (or `all`)"));
  }

  // Headless: default true; --no-headless disables, --headless re-enables.
  let headless = true;
  if (parsed.flags["no-headless"] === true) headless = false;
  if (parsed.flags.headless === true) headless = true;

  const opts: RunHarnessOptions = {
    online: parsed.flags["include-online"] === true,
    headless,
    ...(asString(parsed.flags.browser) !== undefined
      ? { browserPath: asString(parsed.flags.browser) }
      : {}),
    ...(asString(parsed.flags.seed) !== undefined ? { seed: asString(parsed.flags.seed) } : {}),
  };

  const outDir = asString(parsed.flags.out);

  try {
    if (target === "all") {
      const ids = await listProfiles();
      if (ids.length === 0) {
        process.stderr.write("mochi harness: no profiles found in packages/profiles/data/\n");
        return 1;
      }
      let worstExit = 0;
      for (const id of ids) {
        const code = await runOne(id, opts, outDir);
        if (code > worstExit) worstExit = code;
      }
      return worstExit;
    }
    return runOne(target, opts, outDir);
  } catch (err) {
    return reportError(err);
  }
}

async function runOne(
  profileId: string,
  opts: RunHarnessOptions,
  outDir: string | undefined,
): Promise<number> {
  process.stdout.write(`[mochi harness] running against ${profileId} …\n`);
  const report = await runHarnessAgainstProfile(profileId, opts);
  process.stdout.write(`\n${profileId}\n${renderSummary(report)}\n`);

  if (outDir !== undefined) {
    await writeArtifacts(outDir, profileId, report);
  }

  return report.verdict === "EQUIVALENT" ? 0 : 1;
}

async function writeArtifacts(
  outDir: string,
  profileId: string,
  report: DiffReportV1,
): Promise<void> {
  const dir = join(outDir, profileId);
  await mkdir(dir, { recursive: true });
  const jsonPath = join(dir, "report.json");
  const htmlPath = join(dir, "report.html");
  await Bun.write(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  await Bun.write(htmlPath, renderHtml(report));
  process.stdout.write(`  written: ${jsonPath}\n  written: ${htmlPath}\n`);
}

function reportError(err: unknown): number {
  if (err instanceof UsageError) {
    process.stderr.write(`mochi harness: ${err.message}\n${HELP}\n`);
    return 2;
  }
  if (err instanceof Error) {
    process.stderr.write(`mochi harness: ${err.message}\n`);
    return 1;
  }
  process.stderr.write(`mochi harness: unknown error: ${String(err)}\n`);
  return 1;
}
