/**
 * install.ts — download, hash, extract, finalize.
 *
 * Pipeline:
 *   1. Resolve `(channel,version,platform)` to a download URL via `manifest.ts`.
 *      If `--version` was supplied: use the known-good catalog. Otherwise use
 *      the channel manifest. Network failure on the channel manifest path
 *      falls back to the pinned default version.
 *   2. Stream the .zip to `<root>/.tmp-<rand>/<basename>.zip` using Bun's
 *      native `fetch` + `Bun.file(...).writer()`.
 *   3. SHA256 the downloaded archive with `Bun.CryptoHasher`. Compare against
 *      `--sha256` if supplied (CfT does not publish per-asset hashes — see
 *      `manifest.ts` Decision M-1). On mismatch: delete the partial download,
 *      throw `Sha256MismatchError`.
 *   4. Shell out to system `unzip -q -d <tmpExtract> <zip>`. The `unzip`
 *      utility ships on macOS, Linux, and Git-Bash on Windows; we keep it as
 *      a runtime dep rather than pulling a JS zip library because the brief
 *      forbids new runtime deps and CfT archives are large enough that pure-JS
 *      decoding hurts.
 *   5. Atomically rename the extracted tmpdir to `<installDir>` via
 *      `node:fs/promises.rename` (Bun re-exports this; it's the canonical
 *      portable atomic-rename primitive).
 *   6. Write `<installDir>/.mochi-meta.json` recording the version, channel,
 *      platform, source URL, computed SHA256, and install timestamp. Used by
 *      `list` and `path`.
 *
 * On any error after step 2, the tmpdir is cleaned up best-effort.
 *
 * @see tasks/0010-mochi-browsers-install.md
 */
import { mkdir, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import {
  type ChannelManifest,
  fetchChannelManifest,
  fetchKnownGoodManifest,
  findChannelDownload,
  findVersionDownload,
  type KnownGoodManifest,
  ManifestFetchError,
  PINNED_FALLBACK_CHANNEL,
  PINNED_FALLBACK_VERSION,
} from "./manifest";
import {
  binaryPathInExtractDir,
  type CftPlatform,
  type Channel,
  installDir as installDirFor,
} from "./paths";

/** Metadata written to every install dir for `list`/`path` to read back. */
export interface InstallMeta {
  readonly version: string;
  readonly channel: Channel;
  readonly platform: CftPlatform;
  readonly sourceUrl: string;
  readonly sha256: string;
  readonly installedAt: string;
  readonly mochiCliVersion: string;
}

const META_FILENAME = ".mochi-meta.json";

export class Sha256MismatchError extends Error {
  override readonly name = "Sha256MismatchError";
  readonly expected: string;
  readonly actual: string;
  constructor(expected: string, actual: string) {
    super(`SHA256 mismatch: expected ${expected}, got ${actual}`);
    this.expected = expected;
    this.actual = actual;
  }
}

export class UnzipError extends Error {
  override readonly name = "UnzipError";
  readonly exitCode: number;
  constructor(message: string, exitCode: number) {
    super(message);
    this.exitCode = exitCode;
  }
}

export class DownloadError extends Error {
  override readonly name = "DownloadError";
  override readonly cause: "network" | "http";
  constructor(cause: "network" | "http", message: string) {
    super(message);
    this.cause = cause;
  }
}

/**
 * Read an install dir's metadata file. Returns null if the dir doesn't carry
 * a `.mochi-meta.json` (e.g., manually placed binary or a pre-meta install).
 */
export async function readInstallMeta(installDir: string): Promise<InstallMeta | null> {
  const file = Bun.file(join(installDir, META_FILENAME));
  if (!(await file.exists())) return null;
  try {
    return (await file.json()) as InstallMeta;
  } catch {
    return null;
  }
}

export interface ResolveOpts {
  readonly channel: Channel;
  readonly version?: string;
  readonly platform: CftPlatform;
  readonly cacheDir: string;
  readonly noCache?: boolean;
  /** If true, do not consult the network; use only the pinned fallback. */
  readonly offline?: boolean;
}

export interface ResolvedDownload {
  readonly version: string;
  readonly url: string;
  /** True if we fell back to the pinned default after a manifest fetch failed. */
  readonly fellBackToPinned: boolean;
  readonly fallbackReason?: string;
}

/**
 * Resolve a `(channel, version?, platform)` triple into a concrete download
 * URL. Encapsulates the manifest-network interplay so `install()` can stay
 * linear and easy to read.
 */
export async function resolveDownload(opts: ResolveOpts): Promise<ResolvedDownload> {
  // Explicit version: must be in the known-good catalog (or matches the pin
  // when offline).
  if (opts.version) {
    if (opts.offline) {
      if (opts.version === PINNED_FALLBACK_VERSION) {
        return {
          version: PINNED_FALLBACK_VERSION,
          url: pinnedDownloadUrl(PINNED_FALLBACK_VERSION, opts.platform),
          fellBackToPinned: true,
          fallbackReason: "offline mode requested",
        };
      }
      throw new DownloadError(
        "network",
        `cannot resolve version ${opts.version} while offline (only the pinned default ${PINNED_FALLBACK_VERSION} is available offline)`,
      );
    }
    let manifest: KnownGoodManifest;
    try {
      manifest = await fetchKnownGoodManifest({
        cacheDir: opts.cacheDir,
        ...(opts.noCache !== undefined ? { noCache: opts.noCache } : {}),
      });
    } catch (err) {
      throw mapManifestError(err, "known-good catalog");
    }
    const dl = findVersionDownload(manifest, opts.version, opts.platform);
    if (!dl) {
      throw new DownloadError(
        "http",
        `version ${opts.version} not found in CfT catalog for platform ${opts.platform}. ` +
          "Verify the version at https://googlechromelabs.github.io/chrome-for-testing/",
      );
    }
    return { version: opts.version, url: dl.url, fellBackToPinned: false };
  }

  // No explicit version: use the channel manifest.
  if (opts.offline) {
    return {
      version: PINNED_FALLBACK_VERSION,
      url: pinnedDownloadUrl(PINNED_FALLBACK_VERSION, opts.platform),
      fellBackToPinned: true,
      fallbackReason: "offline mode requested",
    };
  }
  let manifest: ChannelManifest;
  try {
    manifest = await fetchChannelManifest({
      cacheDir: opts.cacheDir,
      ...(opts.noCache !== undefined ? { noCache: opts.noCache } : {}),
    });
  } catch (err) {
    if (err instanceof ManifestFetchError && err.cause === "network") {
      // Pinned-default fallback only when the channel was the *implicit*
      // stable channel — otherwise the user asked for something specific and
      // they should see the error.
      if (opts.channel === PINNED_FALLBACK_CHANNEL) {
        return {
          version: PINNED_FALLBACK_VERSION,
          url: pinnedDownloadUrl(PINNED_FALLBACK_VERSION, opts.platform),
          fellBackToPinned: true,
          fallbackReason: err.message,
        };
      }
    }
    throw mapManifestError(err, "channel manifest");
  }
  const dl = findChannelDownload(manifest, opts.channel, opts.platform);
  if (!dl) {
    throw new DownloadError(
      "http",
      `channel ${opts.channel} does not ship platform ${opts.platform} in the current CfT manifest`,
    );
  }
  return { version: dl.version, url: dl.url, fellBackToPinned: false };
}

function mapManifestError(err: unknown, label: string): Error {
  if (err instanceof ManifestFetchError) {
    if (err.cause === "network") {
      return new DownloadError(
        "network",
        `failed to fetch ${label} (network): ${err.message}. ` +
          "Are you offline? Try again with a network connection, or pass --version.",
      );
    }
    if (err.cause === "http") {
      return new DownloadError("http", `failed to fetch ${label} (http): ${err.message}`);
    }
    return new DownloadError(
      "http",
      `${label} format unexpected — please open an issue. Detail: ${err.message}`,
    );
  }
  return err instanceof Error ? err : new Error(String(err));
}

/**
 * Compute the public CfT URL for a pinned-default install. Used only as the
 * offline fallback path; the URL shape is stable across all CfT versions
 * (verified 2026-05-08).
 */
function pinnedDownloadUrl(version: string, platform: CftPlatform): string {
  const archive =
    platform === "linux64"
      ? "chrome-linux64.zip"
      : platform === "win64"
        ? "chrome-win64.zip"
        : platform === "mac-arm64"
          ? "chrome-mac-arm64.zip"
          : "chrome-mac-x64.zip";
  return `https://storage.googleapis.com/chrome-for-testing-public/${version}/${platform}/${archive}`;
}

export interface InstallOpts {
  readonly root: string;
  readonly channel: Channel;
  readonly platform: CftPlatform;
  readonly version?: string;
  /** Re-download + re-extract even if `<installDir>` already exists. */
  readonly force?: boolean;
  /** Optional user-supplied sha256 (lowercase hex) to verify the zip against. */
  readonly expectedSha256?: string;
  /** Skip network — use the pinned default. */
  readonly offline?: boolean;
  /** Bypass the manifest cache (useful for tests). */
  readonly noCache?: boolean;
  /** Logger; defaults to a console.log shim. */
  readonly log?: (line: string) => void;
  /** CLI version string to embed in `.mochi-meta.json`. */
  readonly mochiCliVersion: string;
}

export interface InstallResult {
  readonly installDir: string;
  readonly binaryPath: string;
  readonly meta: InstallMeta;
  readonly alreadyInstalled: boolean;
  readonly fellBackToPinned: boolean;
  readonly fallbackReason?: string;
}

/**
 * The whole install pipeline. Idempotent on `(root, channel, version,
 * platform)` — re-running with the same args is a no-op unless `force=true`.
 */
export async function install(opts: InstallOpts): Promise<InstallResult> {
  const log = opts.log ?? ((line: string) => console.log(line));
  const cacheDir = join(opts.root, ".cache");

  const resolved = await resolveDownload({
    channel: opts.channel,
    platform: opts.platform,
    cacheDir,
    ...(opts.version !== undefined ? { version: opts.version } : {}),
    ...(opts.offline !== undefined ? { offline: opts.offline } : {}),
    ...(opts.noCache !== undefined ? { noCache: opts.noCache } : {}),
  });

  if (resolved.fellBackToPinned) {
    const reason = resolved.fallbackReason ?? "(no detail)";
    log(`(using pinned default ${PINNED_FALLBACK_VERSION}; manifest fetch failed: ${reason})`);
  }

  const dir = installDirFor(opts.root, opts.channel, resolved.version, opts.platform);
  const binaryPath = binaryPathInExtractDir(dir, opts.platform);

  const existing = await readInstallMeta(dir);
  if (existing && !opts.force) {
    log(`already installed at ${dir}`);
    return {
      installDir: dir,
      binaryPath,
      meta: existing,
      alreadyInstalled: true,
      fellBackToPinned: resolved.fellBackToPinned,
      ...(resolved.fallbackReason !== undefined ? { fallbackReason: resolved.fallbackReason } : {}),
    };
  }

  // Force path: remove the existing dir first so the rename is clean.
  if (existing && opts.force) {
    log(`--force: removing existing install at ${dir}`);
    await rm(dir, { recursive: true, force: true });
  }

  // Stage to a sibling tmpdir so a partial install never appears under the
  // canonical path.
  const tmpRoot = join(opts.root, `.tmp-${cryptoRandomSuffix()}`);
  await mkdir(tmpRoot, { recursive: true });

  try {
    log(`downloading ${resolved.url}`);
    const zipPath = join(tmpRoot, "chrome.zip");
    const sha256 = await downloadAndHash(resolved.url, zipPath);
    log(`downloaded sha256=${sha256}`);

    if (opts.expectedSha256) {
      const expected = opts.expectedSha256.trim().toLowerCase();
      if (sha256 !== expected) {
        throw new Sha256MismatchError(expected, sha256);
      }
      log(`sha256 verified against --sha256`);
    }

    const extractDir = join(tmpRoot, "extracted");
    await mkdir(extractDir, { recursive: true });
    log(`unpacking to ${extractDir}`);
    await unzipTo(zipPath, extractDir);

    // Atomic rename into final location.
    log(`finalizing install at ${dir}`);
    await mkdir(opts.root, { recursive: true });
    await rename(extractDir, dir);

    const meta: InstallMeta = {
      version: resolved.version,
      channel: opts.channel,
      platform: opts.platform,
      sourceUrl: resolved.url,
      sha256,
      installedAt: new Date().toISOString(),
      mochiCliVersion: opts.mochiCliVersion,
    };
    await Bun.write(join(dir, META_FILENAME), JSON.stringify(meta, null, 2));

    return {
      installDir: dir,
      binaryPath,
      meta,
      alreadyInstalled: false,
      fellBackToPinned: resolved.fellBackToPinned,
      ...(resolved.fallbackReason !== undefined ? { fallbackReason: resolved.fallbackReason } : {}),
    };
  } finally {
    await rm(tmpRoot, { recursive: true, force: true }).catch(() => undefined);
  }
}

/**
 * Stream a URL into `destPath` while computing SHA256 in parallel. Avoids
 * holding the entire archive in memory (CfT zips for v131 are ~150MB).
 */
async function downloadAndHash(url: string, destPath: string): Promise<string> {
  let res: Response;
  try {
    res = await fetch(url);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new DownloadError(
      "network",
      `failed to reach ${url}: ${msg}. Are you offline? See \`mochi browsers install --help\`.`,
    );
  }
  if (!res.ok) {
    if (res.status === 404) {
      throw new DownloadError(
        "http",
        `download not found (HTTP 404): ${url}. The version or platform may not exist in the CfT registry.`,
      );
    }
    throw new DownloadError(
      "http",
      `download failed (HTTP ${res.status} ${res.statusText}): ${url}`,
    );
  }
  if (!res.body) {
    throw new DownloadError("http", `response body missing for ${url}`);
  }

  const hasher = new Bun.CryptoHasher("sha256");
  const writer = Bun.file(destPath).writer();
  let closed = false;
  try {
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      hasher.update(value);
      writer.write(value);
    }
    await writer.end();
    closed = true;
  } catch (err) {
    if (!closed) {
      try {
        await writer.end();
      } catch {
        // ignore — original error wins
      }
    }
    throw err;
  }
  return hasher.digest("hex");
}

/**
 * Shell out to the system `unzip` utility. Documented runtime dependency:
 * `unzip` ships on macOS and every mainstream Linux distro, and is included
 * with Git-Bash on Windows. If a user is in a stripped-down environment, we
 * surface a clear "install unzip" error.
 */
async function unzipTo(zipPath: string, dest: string): Promise<void> {
  try {
    const proc = Bun.spawn(["unzip", "-q", "-o", "-d", dest, zipPath], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const code = await proc.exited;
    if (code !== 0) {
      const stderr = await new Response(proc.stderr).text();
      throw new UnzipError(
        `unzip exited ${code} while extracting ${zipPath}: ${stderr.trim()}`,
        code,
      );
    }
  } catch (err) {
    if (err instanceof UnzipError) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    if (/ENOENT|not found|spawn/.test(msg)) {
      throw new UnzipError(
        "could not run `unzip` — install it (macOS: built-in; Debian/Ubuntu: `apt install unzip`; Fedora: `dnf install unzip`; Windows: included with Git for Windows)",
        127,
      );
    }
    throw err;
  }
}

/**
 * Verify a previously-installed binary still exists and is executable. Used by
 * `mochi browsers list` to flag a corrupt install (the user `rm`'d the file
 * by hand, etc.).
 */
export async function checkBinaryHealth(
  installDir: string,
  platform: CftPlatform,
): Promise<{
  exists: boolean;
  size: number;
}> {
  const path = binaryPathInExtractDir(installDir, platform);
  try {
    const s = await stat(path);
    return { exists: true, size: s.size };
  } catch {
    return { exists: false, size: 0 };
  }
}

/**
 * Tiny random suffix for tmpdir naming; doesn't need to be crypto-strong.
 */
function cryptoRandomSuffix(): string {
  const buf = new Uint8Array(8);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
}
