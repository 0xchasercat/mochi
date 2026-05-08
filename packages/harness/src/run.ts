/**
 * run.ts — `runHarnessAgainstProfile` orchestrator.
 *
 * Wires capture → normalize → diff → categorize → report against a
 * profile from `@mochi.js/profiles`. The default flow:
 *
 *   1. Resolve the profile + baseline from
 *      `packages/profiles/data/<id>/{profile.json,baseline.manifest.json}`.
 *   2. Resolve the per-profile `expected-divergences.json` (optional).
 *   3. Launch a Mochi `Session` with the FULL inject pipeline active
 *      (i.e. `bypassInject: false`). The Matrix is derived inside
 *      `mochi.launch`.
 *   4. Drive the session through `tests/fixtures/probe-page.html` via
 *      `capture()`.
 *   5. Normalize both sides; structurally diff; categorize each entry
 *      against the profile's intentional list; build a `DiffReportV1`.
 *   6. Close the session.
 *
 * The phase 0.5 gate (PLAN.md §13.6, §14): `report.counts.material === 0`.
 *
 * @see PLAN.md §13.2 / §13.6
 * @see tasks/0050-harness-mvp.md
 */

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import type { ProfileV1 } from "@mochi.js/consistency";
import { mochi } from "@mochi.js/core";
import { type CapturedProbeManifest, capture } from "./capture";
import { categorizeAll, type ExpectedDivergences } from "./categorize";
import { countLeaves, diff } from "./diff";
import type { DiffReportV1, JsonValue } from "./generated/diff-report";
import { normalize } from "./normalize";
import { report } from "./report";

/**
 * Options accepted by {@link runHarnessAgainstProfile}.
 */
export interface RunHarnessOptions {
  /**
   * When true, runs the online suite (creep.js / sannysoft / etc.) in
   * addition to the local fixture. v0.5 plumbs this flag but does NOT
   * implement the online runners — see PLAN.md §14 phase 0.5.x.
   */
  readonly online?: boolean;
  /**
   * Override the profiles data directory. Defaults to
   * `<repo-root>/packages/profiles/data`.
   */
  readonly profilesDir?: string;
  /**
   * Override the start directory for repo-root resolution. Defaults to
   * `process.cwd()`.
   */
  readonly cwd?: string;
  /**
   * Override the random seed used for matrix derivation. Defaults to
   * `harness-<profileId>` for stable byte-identical reruns.
   */
  readonly seed?: string;
  /**
   * Run the browser headless. Default `true`.
   */
  readonly headless?: boolean;
  /**
   * Override Chromium binary path. Falls back to `MOCHI_CHROMIUM_PATH`
   * (read by the CDP launch path) when omitted.
   */
  readonly browserPath?: string;
  /**
   * Probe-completion polling timeout in ms. Default 30000.
   */
  readonly probeTimeoutMs?: number;
}

/**
 * Resolve a profile + its baseline + its expected-divergences and run
 * the full harness pipeline. Returns the resulting `DiffReportV1`.
 */
export async function runHarnessAgainstProfile(
  profileId: string,
  opts: RunHarnessOptions = {},
): Promise<DiffReportV1> {
  if (opts.online === true) {
    // PLAN.md §14 phase 0.5.x; intentionally not implemented at v0.5.
    throw new Error(
      "[mochi harness] --include-online is plumbed but not yet wired — phase 0.5.x. See PLAN.md §13.5.",
    );
  }

  const profilesDir = opts.profilesDir ?? defaultProfilesDir(opts.cwd);
  const profileDir = join(profilesDir, profileId);
  if (!existsSync(profileDir)) {
    throw new Error(
      `[mochi harness] profile directory not found: ${profileDir}\n` +
        `  Expected packages/profiles/data/${profileId}/ with profile.json + baseline.manifest.json.`,
    );
  }

  const [profile, baseline, expected] = await Promise.all([
    loadProfile(profileDir),
    loadBaseline(profileDir),
    loadExpectedDivergences(profileDir),
  ]);
  const expectedPaths = (expected?.paths ?? []).map((p) => p.path);

  // Launch a real Mochi session — full spoofing pipeline active. Hermetic
  // mode opts in to the harness-only flag set (suppresses updater traffic,
  // default-apps auto-install, sync, feed prefetches) so baseline conformance
  // isn't perturbed by network noise. Production `mochi.launch()` callers
  // get `hermetic: false` by default. Task 0256, PLAN.md §8.6.
  const session = await mochi.launch({
    profile,
    seed: opts.seed ?? `harness-${profileId}`,
    headless: opts.headless ?? true,
    hermetic: true,
    ...(opts.browserPath !== undefined ? { binary: opts.browserPath } : {}),
  });
  let captured: CapturedProbeManifest;
  try {
    const captureOpts: { probeTimeoutMs?: number; cwd?: string } = {};
    if (opts.probeTimeoutMs !== undefined) captureOpts.probeTimeoutMs = opts.probeTimeoutMs;
    if (opts.cwd !== undefined) captureOpts.cwd = opts.cwd;
    captured = await capture(session, captureOpts);
  } finally {
    await session.close();
  }

  return diffAndReport({
    profileId,
    baseline,
    captured,
    expectedDivergencePaths: expectedPaths,
  });
}

/**
 * Pure post-capture half of the orchestrator — exposed so unit tests can
 * exercise the diff/categorize/report pipeline without spawning a browser.
 */
export function diffAndReport(args: {
  profileId: string;
  baseline: CapturedProbeManifest;
  captured: CapturedProbeManifest;
  expectedDivergencePaths?: readonly string[];
  now?: () => Date;
}): DiffReportV1 {
  const expectedNorm = normalize(args.baseline);
  const actualNorm = normalize(args.captured);

  const rawDiffs = diff(expectedNorm as unknown as JsonValue, actualNorm as unknown as JsonValue);
  const categorized = categorizeAll(rawDiffs, args.expectedDivergencePaths);

  // Use the baseline leaf count for a meaningful structuralMatchPct.
  const baselineLeaves = countLeaves(args.baseline as unknown as JsonValue);
  return report(args.profileId, categorized, baselineLeaves, args.now);
}

// ---- profile / baseline / expected loaders ---------------------------------

export async function loadProfile(profileDir: string): Promise<ProfileV1> {
  const path = join(profileDir, "profile.json");
  const raw = await readFile(path, "utf8");
  return JSON.parse(raw) as ProfileV1;
}

export async function loadBaseline(profileDir: string): Promise<CapturedProbeManifest> {
  const path = join(profileDir, "baseline.manifest.json");
  const raw = await readFile(path, "utf8");
  return JSON.parse(raw) as CapturedProbeManifest;
}

/**
 * Load the per-profile `expected-divergences.json`. Returns `null` when
 * the file is absent — that's fine, the categorizer treats no list as
 * "every divergence is material".
 */
export async function loadExpectedDivergences(
  profileDir: string,
): Promise<ExpectedDivergences | null> {
  const path = join(profileDir, "expected-divergences.json");
  if (!existsSync(path)) return null;
  const raw = await readFile(path, "utf8");
  const parsed = JSON.parse(raw) as ExpectedDivergences;
  if (!Array.isArray(parsed?.paths)) {
    throw new Error(
      `[mochi harness] ${path}: invalid shape — expected { "version": "1", "paths": [...] }`,
    );
  }
  return parsed;
}

// ---- profiles dir resolution ------------------------------------------------

/**
 * Resolve `<repo-root>/packages/profiles/data` by walking up from `start`.
 */
export function defaultProfilesDir(start?: string): string {
  const dir = findRepoRoot(start ?? process.cwd());
  if (dir === null) {
    throw new Error(
      `[mochi harness] could not locate the mochi repo root walking up from ${start ?? process.cwd()}.`,
    );
  }
  return join(dir, "packages", "profiles", "data");
}

function findRepoRoot(start: string): string | null {
  let dir = isAbsolute(start) ? start : join(process.cwd(), start);
  for (let i = 0; i < 32; i++) {
    if (existsSync(join(dir, "scripts", "mochi-work.ts"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
  return null;
}

/**
 * List every profile id under `<profiles-dir>` that has both a
 * `profile.json` AND a `baseline.manifest.json`.
 */
export async function listProfiles(profilesDir?: string): Promise<string[]> {
  const dir = profilesDir ?? defaultProfilesDir();
  const { readdir, stat } = await import("node:fs/promises");
  if (!existsSync(dir)) return [];
  const entries = await readdir(dir);
  const out: string[] = [];
  for (const name of entries) {
    const sub = join(dir, name);
    const s = await stat(sub).catch(() => null);
    if (!s?.isDirectory()) continue;
    if (existsSync(join(sub, "profile.json")) && existsSync(join(sub, "baseline.manifest.json"))) {
      out.push(name);
    }
  }
  return out.sort();
}
