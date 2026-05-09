/**
 * subcommand.ts — `mochi profiles <subcommand> <flags>` dispatcher.
 *
 * Argv shape (after the leading `profiles` token):
 *
 *   mochi profiles import <visitor-id> --as <profile-id> [--out <dir>]
 *                                      [--api <root>] [--dry-run]
 *
 * Reads `MOCHI_HARVESTER_API` from env if `--api` is omitted; defaults to
 * `http://wrkx.app/api`. `MOCHI_HARVESTER_API` is read at runtime — never
 * committed.
 *
 */

import { HarvesterFetchError, ImportRejectedError, runImport } from "./import";

const HELP = `mochi profiles — manage the local profile catalog

USAGE:
  mochi profiles import <visitor-id> --as <profile-id> [--out <dir>]
                                     [--api <root>] [--dry-run]

DESCRIPTION:
  Pulls a consolidated visitor record from the harvester API
  (\`MOCHI_HARVESTER_API\` env or --api flag, defaults to http://wrkx.app/api),
  normalizes per-category snapshot shape, derives a ProfileV1, and emits the
  canonical 4-file profile dir under \`packages/profiles/data/<profile-id>/\`:

    profile.json              the derived ProfileV1
    baseline.manifest.json    the per-category probe payload
    expected-divergences.json v0.7-deferred surface (audio/canvas)
    PROVENANCE.md             upstream URL, suspectScore, hand-corrections

  When the visitor record contains multiple snapshots per category (re-visits
  over time), the importer keeps the most recent by \`created_at\`.

  Brave UA-mask gate: when --as ends with \`brave-stable\` (or otherwise
  contains \`brave\`), the importer checks that the captured navigator
  surface looks like plain Chrome (UA reports Chrome, navigator.brave absent).
  If the mask leaks, the import is refused — a Brave-fingerprint stamped as
  Chrome would mis-spoof.

OPTIONS:
  --as <profile-id>     Profile id to write under (required).
  --out <dir>           Override the output directory.
  --api <root>          Override harvester API root (defaults to
                        MOCHI_HARVESTER_API env, then http://wrkx.app/api).
  --dry-run             Fetch + derive + validate; skip writes.
  --help, -h            Show this message.

ENVIRONMENT:
  MOCHI_HARVESTER_API   Harvester base URL (e.g. http://wrkx.app/api).

EXIT CODES:
   0   profile written
   1   import rejected (Brave mask leak / mobile / fetch failure / etc.)
   2   usage error
`;

interface ParsedArgs {
  readonly positional: readonly string[];
  readonly flags: Readonly<Record<string, string | boolean>>;
}

const BOOL_FLAGS = new Set(["help", "dry-run"]);

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
 * Top-level dispatch for `mochi profiles`. Returns a process exit code.
 */
export async function runProfilesCommand(argv: readonly string[]): Promise<number> {
  const sub = argv[0];
  if (sub === undefined || sub === "--help" || sub === "-h" || sub === "help") {
    process.stdout.write(`${HELP}\n`);
    return sub === undefined ? 1 : 0;
  }
  if (sub !== "import") {
    process.stderr.write(`mochi profiles: unknown subcommand '${sub}'\n${HELP}\n`);
    return 2;
  }

  let parsed: ParsedArgs;
  try {
    parsed = parseFlags(argv.slice(1));
  } catch (err) {
    return reportError(err);
  }

  if (parsed.flags.help === true) {
    process.stdout.write(`${HELP}\n`);
    return 0;
  }

  const visitorId = parsed.positional[0];
  if (visitorId === undefined || visitorId.length === 0) {
    return reportError(new UsageError("missing required <visitor-id> positional"));
  }

  const profileId = asString(parsed.flags.as);
  if (profileId === undefined || profileId.length === 0) {
    return reportError(new UsageError("missing required --as <profile-id>"));
  }

  try {
    const result = await runImport({
      visitorId,
      profileId,
      ...(asString(parsed.flags.api) !== undefined ? { apiRoot: asString(parsed.flags.api) } : {}),
      ...(asString(parsed.flags.out) !== undefined ? { outDir: asString(parsed.flags.out) } : {}),
      dryRun: parsed.flags["dry-run"] === true,
    });
    if (parsed.flags["dry-run"] === true) {
      process.stdout.write(
        [
          `[mochi profiles import] dry-run for ${profileId}`,
          `  upstream: ${visitorId}`,
          `  suspectScore: ${result.suspectScore ?? "unknown"}`,
          `  capturedAt: ${result.capturedAt}`,
          `  derived os: ${result.profile.os.name} ${result.profile.os.version} ${result.profile.os.arch}`,
          `  derived browser: ${result.profile.browser.name} ${result.profile.browser.minVersion}`,
          "",
        ].join("\n"),
      );
      return 0;
    }
    process.stdout.write(
      [
        `imported ${profileId} from ${visitorId}`,
        `  profile:               ${result.profilePath}`,
        `  baseline:              ${result.manifestPath}`,
        `  expected-divergences:  ${result.expectedDivergencesPath}`,
        `  provenance:            ${result.provenancePath}`,
        `  suspectScore:          ${result.suspectScore ?? "unknown"}`,
        "",
      ].join("\n"),
    );
    return 0;
  } catch (err) {
    return reportError(err);
  }
}

function reportError(err: unknown): number {
  if (err instanceof UsageError) {
    process.stderr.write(`mochi profiles: ${err.message}\n`);
    return 2;
  }
  if (err instanceof ImportRejectedError) {
    process.stderr.write(`${err.message}\n`);
    return 1;
  }
  if (err instanceof HarvesterFetchError) {
    process.stderr.write(`${err.message}\n`);
    return 1;
  }
  if (err instanceof Error) {
    process.stderr.write(`mochi profiles: ${err.message}\n`);
    return 1;
  }
  process.stderr.write(`mochi profiles: unknown error: ${String(err)}\n`);
  return 1;
}
