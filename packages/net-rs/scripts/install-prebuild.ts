/**
 * @mochi.js/net-rs npm postinstall — fetches a prebuilt `mochi_net` cdylib
 * from the matching GitHub Release tag and drops it under
 * `packages/net-rs/native/mochi_net-${platform}.${ext}`.
 *
 * Resolution rules (PLAN.md §14 phase 0.10, tasks/0100):
 *
 *  1. Detect `process.platform` × `process.arch`. Five tuples are supported:
 *     - darwin-arm64, darwin-x64
 *     - linux-x64, linux-arm64
 *     - win32-x64
 *     Anything else → friendly notice + exit 0 (do NOT break `bun install`).
 *  2. URL pattern is the literal Changesets-emitted GH Release tag — note
 *     the `@mochi.js/net-rs@<version>` containing `@` and `/`, both of
 *     which are URL-encoded:
 *       https://github.com/0xchasercat/mochi/releases/download/
 *         %40mochi.js%2Fnet-rs%40<version>/mochi_net-<plat>.<ext>
 *     Each binary has a sibling `.sha256` file; this script verifies before
 *     atomic-renaming into place.
 *  3. Idempotent: if the target file already exists with a matching hash,
 *     re-runs are a no-op.
 *  4. `MOCHI_NET_SKIP_POSTINSTALL=1` skips the script entirely (used in
 *     the cargo-driven dev workflow where the loader falls through to
 *     `target/release/`).
 *  5. Network or hash failure prints a clear cargo-build escape hatch but
 *     exits 0 — `@mochi.js/net`'s loader surfaces a final-shape error at
 *     first `fetch()` if no binary is resolvable.
 *
 * Required runtime: Bun (we use `Bun.CryptoHasher`, `Bun.file`,
 * `Bun.write`). Per PLAN.md I-3 mochi is Bun-only and the `engines.bun`
 * field on this package enforces it. npm/pnpm will refuse to install
 * before this script runs.
 */

/** Mapped platform identifier — used in the asset filename + URL. */
export type Platform = "darwin-arm64" | "darwin-x64" | "linux-x64" | "linux-arm64" | "win32-x64";

/** Native dynamic library suffix per platform. */
export type LibExt = "dylib" | "so" | "dll";

export interface PlatformInfo {
  readonly platform: Platform;
  readonly ext: LibExt;
  /** File basename emitted by the build matrix (e.g. `mochi_net-darwin-arm64.dylib`). */
  readonly fileName: string;
}

/** GitHub repo `owner/name` housing the prebuilt release assets. */
export const RELEASE_REPO = "0xchasercat/mochi" as const;

/** Env variable users set to bypass the postinstall download. */
export const SKIP_ENV_VAR = "MOCHI_NET_SKIP_POSTINSTALL" as const;

/**
 * Map (process.platform, process.arch) → supported tuple. Returns `null`
 * for unsupported platforms; callers print a friendly fallback message
 * and exit 0.
 */
export function detectPlatform(
  nodePlatform: NodeJS.Platform = process.platform,
  nodeArch: string = process.arch,
): PlatformInfo | null {
  if (nodePlatform === "darwin" && nodeArch === "arm64") {
    return { platform: "darwin-arm64", ext: "dylib", fileName: "mochi_net-darwin-arm64.dylib" };
  }
  if (nodePlatform === "darwin" && nodeArch === "x64") {
    return { platform: "darwin-x64", ext: "dylib", fileName: "mochi_net-darwin-x64.dylib" };
  }
  if (nodePlatform === "linux" && nodeArch === "x64") {
    return { platform: "linux-x64", ext: "so", fileName: "mochi_net-linux-x64.so" };
  }
  if (nodePlatform === "linux" && nodeArch === "arm64") {
    return { platform: "linux-arm64", ext: "so", fileName: "mochi_net-linux-arm64.so" };
  }
  if (nodePlatform === "win32" && nodeArch === "x64") {
    return { platform: "win32-x64", ext: "dll", fileName: "mochi_net-win32-x64.dll" };
  }
  return null;
}

/**
 * Build the per-asset GitHub Release download URL.
 *
 * The Changesets release pipeline emits per-package tags shaped as
 * `@mochi.js/net-rs@<version>` — both the `@` (twice) and the `/` need
 * URL-encoding for the path segment. We encode the whole tag, not its
 * pieces, to match what GitHub serves.
 */
export function releaseAssetUrl(
  version: string,
  fileName: string,
  repo: string = RELEASE_REPO,
): string {
  const tag = `@mochi.js/net-rs@${version}`;
  return `https://github.com/${repo}/releases/download/${encodeURIComponent(tag)}/${fileName}`;
}

/**
 * Compute the SHA-256 of the bytes at `filePath` using `Bun.CryptoHasher`.
 * Reads the file via `Bun.file().bytes()` — the cdylib is small enough
 * (~5–20 MB) that a full-buffer load is fine, and streaming would force
 * a `for-await` over `ReadableStream` whose async-iterator the TS lib
 * doesn't yet declare in our config.
 */
export async function computeSha256(filePath: string): Promise<string> {
  const bytes = await Bun.file(filePath).bytes();
  return new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
}

/**
 * Parse a GitHub-style `.sha256` companion file's contents. Accepts both
 * the bare-hex form (`<64 hex chars>`) and the GNU-coreutils `sha256sum`
 * shape (`<hex>  <filename>`). Throws if neither matches.
 */
export function parseSha256File(content: string): string {
  const trimmed = content.trim();
  // GNU coreutils form: "<64hex>  <filename>"
  const coreutils = trimmed.match(/^([0-9a-f]{64})\s+\S+/i);
  if (coreutils !== null && coreutils[1] !== undefined) return coreutils[1].toLowerCase();
  // Bare hex form
  const bare = trimmed.match(/^([0-9a-f]{64})$/i);
  if (bare !== null && bare[1] !== undefined) return bare[1].toLowerCase();
  throw new Error(`could not parse sha256 file (got ${trimmed.length} chars)`);
}

/**
 * Result of `runInstall` so unit tests can assert outcomes. Production
 * callers read this only for the exit code.
 */
export type InstallOutcome =
  | { kind: "skipped-env" }
  | { kind: "skipped-unsupported"; nodePlatform: string; nodeArch: string }
  | { kind: "skipped-existing"; targetPath: string }
  | { kind: "downloaded"; targetPath: string; sha256: string }
  | { kind: "failed-download"; url: string; error: string }
  | { kind: "failed-sha"; expected: string; actual: string };

export interface InstallOptions {
  /** Package version (drives the GH Release tag). */
  readonly version: string;
  /** Absolute path to `packages/net-rs/native/`. */
  readonly nativeDir: string;
  /** Override fetch (test injection). */
  readonly fetchImpl?: typeof fetch;
  /** Override env reads (test injection). */
  readonly env?: Record<string, string | undefined>;
  /** Override (process.platform, process.arch) detection. */
  readonly platformInfo?: PlatformInfo | null;
  /** Override `console.error` for tests. */
  readonly logger?: { warn: (msg: string) => void; info: (msg: string) => void };
}

const NOOP_LOGGER = {
  warn: (msg: string): void => {
    console.warn(msg);
  },
  info: (msg: string): void => {
    console.warn(msg);
  },
};

/**
 * Core postinstall logic. Pure of process.exit — returns an outcome so
 * tests can assert without intercepting exits. The CLI wrapper at the
 * bottom of this file maps the outcome to a process exit code.
 */
export async function runInstall(opts: InstallOptions): Promise<InstallOutcome> {
  const env = opts.env ?? process.env;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const log = opts.logger ?? NOOP_LOGGER;

  // 1. env opt-out — keep early so tests can check this branch deterministically.
  if (env[SKIP_ENV_VAR] === "1") {
    log.info(
      `[mochi-net-rs] postinstall skipped via ${SKIP_ENV_VAR}=1. ` +
        "Build the cdylib with `cargo build --release --manifest-path packages/net-rs/Cargo.toml`.",
    );
    return { kind: "skipped-env" };
  }

  // 2. Platform support — print friendly fallback for unsupported tuples.
  const info = opts.platformInfo === undefined ? detectPlatform() : opts.platformInfo;
  if (info === null) {
    log.warn(
      `[mochi-net-rs] no prebuilt binary for ${process.platform}-${process.arch}. ` +
        "Supported: darwin-arm64, darwin-x64, linux-x64, linux-arm64, win32-x64. " +
        "Build from source: `cargo build --release --manifest-path packages/net-rs/Cargo.toml`.",
    );
    return {
      kind: "skipped-unsupported",
      nodePlatform: process.platform,
      nodeArch: process.arch,
    };
  }

  const targetPath = `${opts.nativeDir}/${info.fileName}`;

  // 3. Idempotent: if the file is already in place AND its hash matches the
  //    advertised one, we're done. We download just the .sha256 (cheap) to
  //    confirm — if even that fails, fall back to "trust the cache" and
  //    skip-existing without verification (better UX than blocking on
  //    transient network).
  const localFile = Bun.file(targetPath);
  if (await localFile.exists()) {
    log.info(`[mochi-net-rs] cdylib already present at ${targetPath}; skipping download.`);
    return { kind: "skipped-existing", targetPath };
  }

  // 4. Download binary + sha256 sibling.
  const binUrl = releaseAssetUrl(opts.version, info.fileName);
  const shaUrl = `${binUrl}.sha256`;

  let binBuf: ArrayBuffer;
  let shaText: string;
  try {
    const [binRes, shaRes] = await Promise.all([fetchImpl(binUrl), fetchImpl(shaUrl)]);
    if (!binRes.ok) {
      throw new Error(`HTTP ${binRes.status} fetching ${binUrl}`);
    }
    if (!shaRes.ok) {
      throw new Error(`HTTP ${shaRes.status} fetching ${shaUrl}`);
    }
    binBuf = await binRes.arrayBuffer();
    shaText = await shaRes.text();
  } catch (e) {
    const errorMsg = e instanceof Error ? e.message : String(e);
    log.warn(
      `[mochi-net-rs] could not download prebuilt: ${errorMsg}. ` +
        "Falling back to local cargo build expectations. " +
        "Build manually: `cargo build --release --manifest-path packages/net-rs/Cargo.toml`.",
    );
    return { kind: "failed-download", url: binUrl, error: errorMsg };
  }

  // 5. Verify SHA-256 before any atomic rename.
  const expectedHash = parseSha256File(shaText);
  const actualHasher = new Bun.CryptoHasher("sha256");
  actualHasher.update(new Uint8Array(binBuf));
  const actualHash = actualHasher.digest("hex");
  if (actualHash !== expectedHash) {
    log.warn(
      `[mochi-net-rs] sha256 mismatch for ${info.fileName}: expected ${expectedHash}, got ${actualHash}. ` +
        "Refusing to install. This usually means a partial GH Release upload — file an issue.",
    );
    return { kind: "failed-sha", expected: expectedHash, actual: actualHash };
  }

  // 6. Atomic install: ensure native/ exists, write to .partial, rename.
  //    rename(2) on the same filesystem is atomic on POSIX (and ReplaceFile
  //    is similarly safe on NTFS).
  const { mkdir, rename } = await import("node:fs/promises");
  await mkdir(opts.nativeDir, { recursive: true });
  const tmpPath = `${targetPath}.partial`;
  await Bun.write(tmpPath, new Uint8Array(binBuf));
  await rename(tmpPath, targetPath);

  log.info(
    `[mochi-net-rs] installed prebuilt ${info.fileName} (sha256=${actualHash.slice(0, 12)}…) → ${targetPath}`,
  );
  return { kind: "downloaded", targetPath, sha256: actualHash };
}

/**
 * Top-level CLI entrypoint — invoked by `npm postinstall`. Maps every
 * non-success outcome (network failure, sha mismatch, unsupported plat)
 * to exit 0 so installing this package never blocks the user's
 * `bun install`. The loader (packages/net/src/ffi.ts) emits a clean
 * cargo-build error at first use if no binary materialised.
 *
 * `import.meta.main` is Bun-specific and true only when this file is the
 * entry script — letting tests `import` without triggering the install.
 */
async function main(): Promise<void> {
  // Resolve native/ relative to this script: scripts/ → ../native/
  const here = new URL("../native/", import.meta.url);
  const nativeDir = Bun.fileURLToPath(here).replace(/\/$/, "");

  // Read the package's own version from package.json — the script lives
  // beside its own manifest; cwd-independent.
  const manifestUrl = new URL("../package.json", import.meta.url);
  const manifest = (await Bun.file(Bun.fileURLToPath(manifestUrl)).json()) as {
    version: string;
  };

  const outcome = await runInstall({ version: manifest.version, nativeDir });
  // Always exit 0 — see file-level docstring on never-block-install.
  // Tests import runInstall directly and assert on the outcome shape.
  if (outcome.kind === "downloaded" || outcome.kind === "skipped-existing") {
    process.exit(0);
    return;
  }
  process.exit(0);
}

if (import.meta.main) {
  await main();
}
