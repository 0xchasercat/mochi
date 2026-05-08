/**
 * @mochi.js/cli/browsers — programmatic surface for `mochi browsers …` and
 * the `resolveChromiumBinary` helper consumed by `@mochi.js/core` (task 0011).
 *
 * The split between this file, `install.ts`, `manifest.ts`, and `paths.ts`:
 *   - `paths.ts`     — pure: platform mapping + on-disk layout
 *   - `manifest.ts`  — CfT registry fetcher + parser + cache layer
 *   - `install.ts`   — download/verify/extract/finalize pipeline
 *   - `index.ts`     — listing, resolution, and the public API
 *   - `subcommand.ts` — `mochi browsers <action>` dispatch
 *
 * The public API exported here is the one downstream packages should depend
 * on; everything else is implementation detail.
 *
 * @see PLAN.md §5.8
 * @see tasks/0010-mochi-browsers-install.md
 */
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { type InstallMeta, readInstallMeta } from "./install";
import {
  binaryPathFor,
  type CftPlatform,
  type Channel,
  defaultInstallRoot,
  detectPlatform,
  isCftPlatform,
  isChannel,
} from "./paths";

export {
  assertBinaryLaunches,
  BinarySmokeError,
  type BinarySmokeResult,
  DownloadError,
  type InstallMeta,
  type InstallResult,
  install,
  resolveDownload,
  Sha256MismatchError,
  smokeBinary,
  UnzipError,
} from "./install";
export {
  ManifestFetchError,
  PINNED_FALLBACK_CHANNEL,
  PINNED_FALLBACK_VERSION,
} from "./manifest";
export {
  CFT_PLATFORMS,
  type CftPlatform,
  CHANNELS,
  type Channel,
  defaultInstallRoot,
  detectPlatform,
  isCftPlatform,
  isChannel,
} from "./paths";

/**
 * One installed browser as surfaced by `list` / `path` / `resolveChromiumBinary`.
 */
export interface InstalledBrowser {
  readonly installDir: string;
  readonly binaryPath: string;
  readonly meta: InstallMeta;
}

/**
 * Walk `<root>/*` and read each `.mochi-meta.json`. Directories without a
 * meta file (foreign installs, partial extractions, the `.cache/` and
 * `.tmp-*` siblings) are silently skipped.
 *
 * Sort order: most-recently-installed first.
 */
export async function listInstalled(
  root: string = defaultInstallRoot(),
): Promise<InstalledBrowser[]> {
  let entries: string[];
  try {
    entries = await readdir(root);
  } catch {
    return [];
  }
  const out: InstalledBrowser[] = [];
  for (const name of entries) {
    if (name.startsWith(".")) continue;
    const dir = join(root, name);
    const meta = await readInstallMeta(dir);
    if (!meta) continue;
    out.push({
      installDir: dir,
      binaryPath: binaryPathFor(root, meta.channel, meta.version, meta.platform),
      meta,
    });
  }
  out.sort((a, b) => b.meta.installedAt.localeCompare(a.meta.installedAt));
  return out;
}

export interface ResolveChromiumOpts {
  readonly channel?: Channel;
  readonly version?: string;
  readonly platform?: string;
  /** Override the install root. Default: ~/.mochi/browsers (or $MOCHI_BROWSERS_ROOT). */
  readonly root?: string;
}

export interface ResolvedChromium {
  readonly path: string;
  readonly channel: string;
  readonly version: string;
  readonly platform: string;
}

export class ChromiumNotFoundError extends Error {
  override readonly name = "ChromiumNotFoundError";
}

/**
 * Find the Chromium binary that best matches the caller's preferences.
 *
 * Resolution order:
 *   1. `MOCHI_CHROMIUM_PATH` env var → returned as-is, version="env-override".
 *      Lets ops override every other rule for emergency-fix scenarios.
 *   2. Explicit `version` (and optional `channel`) → exact match in installed set.
 *   3. Explicit `channel` (no version) → most recently installed in that channel.
 *   4. No args → most recently installed install (any channel).
 *   5. None of the above → throw {@link ChromiumNotFoundError} pointing at
 *      `mochi browsers install`.
 *
 * Platform defaults to the runtime's detected CfT platform; pass an explicit
 * value when resolving for a remote machine (cross-platform CI rigs etc.).
 */
export async function resolveChromiumBinary(
  opts: ResolveChromiumOpts = {},
): Promise<ResolvedChromium> {
  const envOverride = process.env.MOCHI_CHROMIUM_PATH;
  if (envOverride && envOverride.length > 0) {
    return {
      path: envOverride,
      channel: "env-override",
      version: "env-override",
      platform: opts.platform ?? detectPlatform() ?? "unknown",
    };
  }

  const platform = ((): CftPlatform | null => {
    if (opts.platform) {
      return isCftPlatform(opts.platform) ? opts.platform : null;
    }
    return detectPlatform();
  })();

  if (opts.platform && platform === null) {
    throw new ChromiumNotFoundError(
      `unsupported platform: ${opts.platform}. Supported: mac-arm64, mac-x64, linux64, win64.`,
    );
  }

  const root = opts.root ?? defaultInstallRoot();
  const all = await listInstalled(root);

  const matches = all.filter((b) => {
    if (platform && b.meta.platform !== platform) return false;
    if (opts.channel && b.meta.channel !== opts.channel) return false;
    if (opts.version && b.meta.version !== opts.version) return false;
    return true;
  });

  if (matches.length === 0) {
    const hint = formatNoMatchHint(opts, root);
    throw new ChromiumNotFoundError(hint);
  }

  // listInstalled already sorted by installedAt desc, so [0] is the most
  // recent qualifying install.
  const pick = matches[0];
  if (!pick) {
    // unreachable; guard for noUncheckedIndexedAccess
    throw new ChromiumNotFoundError(formatNoMatchHint(opts, root));
  }
  return {
    path: pick.binaryPath,
    channel: pick.meta.channel,
    version: pick.meta.version,
    platform: pick.meta.platform,
  };
}

function formatNoMatchHint(opts: ResolveChromiumOpts, root: string): string {
  const filters: string[] = [];
  if (opts.channel) filters.push(`channel=${opts.channel}`);
  if (opts.version) filters.push(`version=${opts.version}`);
  if (opts.platform) filters.push(`platform=${opts.platform}`);
  const filterStr = filters.length > 0 ? ` matching ${filters.join(", ")}` : "";
  const installCmd = opts.version
    ? `mochi browsers install --version ${opts.version}`
    : opts.channel
      ? `mochi browsers install --channel ${opts.channel}`
      : "mochi browsers install";
  return (
    `no Chromium-for-Testing install found${filterStr} under ${root}.\n` +
    `Run \`${installCmd}\` to fetch one, or set MOCHI_CHROMIUM_PATH to a binary you already have.`
  );
}

/**
 * Re-export of {@link isChannel}/{@link isCftPlatform} for consumers that
 * receive raw strings from CLI args and need to narrow.
 */
export const guards = { isChannel, isCftPlatform } as const;
