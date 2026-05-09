/**
 * subcommand.ts — `mochi capture <flags>` dispatcher.
 *
 * Argv shape (after the leading `capture` token):
 *
 *   mochi capture --profile-id <id> [--browser <path>] [--out <dir>]
 *                 [--seed <s>] [--no-headless] [--interactive]
 *                 [--capturer <name>] [--machine <model>]
 *                 [--browser-version <v>] [--mochi-version <v>]
 *                 [--notes <text>]
 *
 * Defaults match `runCapture()`: outDir → `packages/profiles/data/<id>/`,
 * seed → `capture-<id>`, headless → true.
 *
 * @see PLAN.md §12.1
 */

import { ChromiumNotFoundError } from "../browsers/index";
import { type CaptureOptions, CaptureValidationError, runCapture } from "./index";

const HELP = `mochi capture — capture a baseline ProfileV1 + manifest from a real device

USAGE:
  mochi capture --profile-id <id> [--browser <path>] [--out <dir>] [--seed <s>]
                [--no-headless] [--interactive]
                [--capturer <name>] [--machine <model>]
                [--browser-version <v>] [--mochi-version <v>] [--notes <text>]

DESCRIPTION:
  Drives a bare, un-spoofed Chromium against tests/fixtures/probe-page.html,
  derives a ProfileV1 from the captured probes, validates against
  schemas/profile.schema.json, and writes the result to
  packages/profiles/data/<id>/ (or --out).

  Output:
    profile.json            — the derived ProfileV1
    baseline.manifest.json  — the raw probe payload (ProbeManifestV1 shape)
    PROVENANCE.md           — capturer / machine / browser version / etc.

ENVIRONMENT:
  MOCHI_CHROMIUM_PATH     Override Chromium binary path.

SAFETY:
  The captured ProfileV1 inherits the device's REAL fingerprint values.
  Do not run \`mochi capture\` on a machine you wouldn't use to publish
  a profile. PLAN.md §12.2 (provenance discipline).
`;

interface ParsedArgs {
  readonly positional: readonly string[];
  readonly flags: Readonly<Record<string, string | boolean>>;
}

const BOOL_FLAGS = new Set(["help", "interactive", "no-headless", "headless"]);

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
 * Top-level dispatch for `mochi capture`. Pure-ish: writes to
 * stdout/stderr and returns an exit code.
 */
export async function runCaptureCommand(argv: readonly string[]): Promise<number> {
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

  const profileId = asString(parsed.flags["profile-id"]);
  if (!profileId) {
    return reportError(new UsageError("missing required --profile-id"));
  }

  // Headless default = true; --no-headless disables; --headless re-enables.
  let headless = true;
  if (parsed.flags["no-headless"] === true) headless = false;
  if (parsed.flags.headless === true) headless = true;

  const opts: CaptureOptions = {
    profileId,
    ...(asString(parsed.flags.out) !== undefined ? { outDir: asString(parsed.flags.out) } : {}),
    ...(asString(parsed.flags.browser) !== undefined
      ? { browserPath: asString(parsed.flags.browser) }
      : {}),
    ...(asString(parsed.flags.seed) !== undefined ? { seed: asString(parsed.flags.seed) } : {}),
    headless,
    interactive: parsed.flags.interactive === true,
    provenanceInputs: {
      ...(asString(parsed.flags.capturer) !== undefined
        ? { capturer: asString(parsed.flags.capturer) }
        : {}),
      ...(asString(parsed.flags.machine) !== undefined
        ? { machine: asString(parsed.flags.machine) }
        : {}),
      ...(asString(parsed.flags["browser-version"]) !== undefined
        ? { browserVersion: asString(parsed.flags["browser-version"]) }
        : {}),
      ...(asString(parsed.flags["mochi-version"]) !== undefined
        ? { mochiVersion: asString(parsed.flags["mochi-version"]) }
        : {}),
      ...(asString(parsed.flags.notes) !== undefined
        ? { notes: asString(parsed.flags.notes) }
        : {}),
    },
  };

  try {
    const result = await runCapture(opts);
    process.stdout.write(
      [
        `captured ${profileId}`,
        `  profile:  ${result.profilePath}`,
        `  manifest: ${result.manifestPath}`,
        `  provenance: ${result.provenancePath}`,
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
    process.stderr.write(`mochi capture: ${err.message}\n`);
    return 2;
  }
  if (err instanceof ChromiumNotFoundError) {
    process.stderr.write(`mochi capture: ${err.message}\n`);
    return 1;
  }
  if (err instanceof CaptureValidationError) {
    process.stderr.write(`mochi capture: ${err.message}\n`);
    process.stderr.write(`  invalid output written to: ${err.invalidDir}\n`);
    for (const e of err.errors.slice(0, 10)) {
      process.stderr.write(`    ${e.path}: ${e.message}\n`);
    }
    if (err.errors.length > 10) {
      process.stderr.write(`    … and ${err.errors.length - 10} more\n`);
    }
    return 1;
  }
  if (err instanceof Error) {
    process.stderr.write(`mochi capture: ${err.message}\n`);
    return 1;
  }
  process.stderr.write(`mochi capture: unknown error: ${String(err)}\n`);
  return 1;
}
