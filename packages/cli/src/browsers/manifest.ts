/**
 * manifest.ts — Chromium-for-Testing manifest fetcher + parser.
 *
 * Two endpoints are consumed:
 *
 *   - `last-known-good-versions-with-downloads.json` — the *channel index*
 *     (Stable/Beta/Dev/Canary). Used for `--channel stable` resolution when no
 *     `--version` is given. Verified 2026-05-08.
 *   - `known-good-versions-with-downloads.json` — the full historical catalog.
 *     Used when the user supplies an explicit `--version` so we can validate
 *     and look up the download URL. Verified 2026-05-08.
 *
 * **Important caveat (Decision M-1, deviating from the brief):** as of
 * 2026-05-08 the CfT registry does NOT publish per-asset SHA256 hashes — none
 * of the manifest endpoints carry a `sha256`/`hash` field, and there are no
 * sidecar `.sha256` files in the GCS bucket. The brief's "Verifies SHA256 from
 * the CfT manifest entry **before** unpacking" cannot be honored as written.
 *
 * Our resolution: we record the SHA256 we compute at install time in
 * `<installDir>/.mochi-meta.json` so subsequent `--force` reinstalls (or any
 * tooling that wants integrity verification) can compare against a known-good
 * value, and we expose a `--sha256 <hex>` flag on the CLI for users who want
 * to pin against a hash they obtained out-of-band. The hash is also surfaced
 * by `resolveChromiumBinary` for downstream consumers. See `docs/limits.md`.
 *
 * Cache: the manifest JSON is cached on disk for 1h to keep `mochi browsers
 * list/path` cheap during a session. Bypass with `MOCHI_NO_CACHE=1` (mostly
 * useful for tests).
 *
 * @see tasks/0010-mochi-browsers-install.md
 */
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { type CftPlatform, type Channel, isCftPlatform } from "./paths";

const LAST_KNOWN_URL =
  "https://googlechromelabs.github.io/chrome-for-testing/last-known-good-versions-with-downloads.json";
const KNOWN_GOOD_URL =
  "https://googlechromelabs.github.io/chrome-for-testing/known-good-versions-with-downloads.json";

/** TTL for the on-disk manifest cache, in milliseconds. */
const CACHE_TTL_MS = 60 * 60 * 1000;

/**
 * Pinned fallback. Used only when the network is unavailable AND the user did
 * not supply `--version`. Verified to exist in the CfT manifest on 2026-05-08.
 *
 * Update this pin during routine maintenance; the chosen version should be:
 *   1. listed in `known-good-versions-with-downloads.json`
 *   2. recent enough that it isn't EOL
 *   3. stable (no .0 minor — those are dev tip)
 */
export const PINNED_FALLBACK_VERSION = "131.0.6778.85" as const;
export const PINNED_FALLBACK_CHANNEL: Channel = "stable";

/** A single download entry as exposed in the CfT manifest. */
export interface CftDownload {
  readonly platform: CftPlatform;
  readonly url: string;
}

/** A version row from `known-good-versions-with-downloads.json`. */
export interface CftVersionRow {
  readonly version: string;
  readonly downloads: readonly CftDownload[];
}

/** A channel row from `last-known-good-versions-with-downloads.json`. */
export interface CftChannelRow {
  readonly channel: string;
  readonly version: string;
  readonly downloads: readonly CftDownload[];
}

export interface ChannelManifest {
  readonly fetchedAt: number;
  readonly channels: Readonly<Record<string, CftChannelRow>>;
}

export interface KnownGoodManifest {
  readonly fetchedAt: number;
  readonly versions: readonly CftVersionRow[];
}

/** Discriminated error type so callers can attach the right user hint. */
export class ManifestFetchError extends Error {
  override readonly name = "ManifestFetchError";
  override readonly cause: "network" | "http" | "parse";
  constructor(cause: "network" | "http" | "parse", message: string) {
    super(message);
    this.cause = cause;
  }
}

/**
 * Defensively normalize a raw CfT entry. CfT may add new platforms over time;
 * we filter to the ones we know how to install and silently drop the rest.
 */
function normalizeDownloads(raw: unknown): CftDownload[] {
  if (!Array.isArray(raw)) return [];
  const out: CftDownload[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) continue;
    const e = entry as { platform?: unknown; url?: unknown };
    if (typeof e.platform !== "string" || typeof e.url !== "string") continue;
    if (!isCftPlatform(e.platform)) continue;
    out.push({ platform: e.platform, url: e.url });
  }
  return out;
}

/**
 * Parse the `last-known-good-versions-with-downloads.json` payload. Throws
 * {@link ManifestFetchError} with cause `"parse"` if required fields are
 * missing — we'd rather fail loudly than silently install the wrong version.
 */
export function parseChannelManifest(raw: unknown): ChannelManifest {
  if (typeof raw !== "object" || raw === null) {
    throw new ManifestFetchError("parse", "channel manifest is not an object");
  }
  const r = raw as { channels?: unknown };
  if (typeof r.channels !== "object" || r.channels === null) {
    throw new ManifestFetchError("parse", "channel manifest missing `channels` map");
  }
  const out: Record<string, CftChannelRow> = {};
  for (const [name, value] of Object.entries(r.channels)) {
    if (typeof value !== "object" || value === null) continue;
    const v = value as {
      channel?: unknown;
      version?: unknown;
      downloads?: { chrome?: unknown };
    };
    if (typeof v.version !== "string") {
      throw new ManifestFetchError(
        "parse",
        `channel manifest: \`channels.${name}.version\` is not a string`,
      );
    }
    const downloadsRoot = v.downloads;
    const chrome =
      typeof downloadsRoot === "object" && downloadsRoot !== null
        ? (downloadsRoot as { chrome?: unknown }).chrome
        : undefined;
    out[name] = {
      channel: typeof v.channel === "string" ? v.channel : name,
      version: v.version,
      downloads: normalizeDownloads(chrome),
    };
  }
  return { fetchedAt: Date.now(), channels: out };
}

/**
 * Parse the `known-good-versions-with-downloads.json` payload. Same fail-loud
 * discipline as {@link parseChannelManifest}.
 */
export function parseKnownGoodManifest(raw: unknown): KnownGoodManifest {
  if (typeof raw !== "object" || raw === null) {
    throw new ManifestFetchError("parse", "known-good manifest is not an object");
  }
  const r = raw as { versions?: unknown };
  if (!Array.isArray(r.versions)) {
    throw new ManifestFetchError("parse", "known-good manifest missing `versions` array");
  }
  const versions: CftVersionRow[] = [];
  for (const entry of r.versions) {
    if (typeof entry !== "object" || entry === null) continue;
    const e = entry as { version?: unknown; downloads?: { chrome?: unknown } };
    if (typeof e.version !== "string") continue;
    const chrome =
      typeof e.downloads === "object" && e.downloads !== null
        ? (e.downloads as { chrome?: unknown }).chrome
        : undefined;
    versions.push({ version: e.version, downloads: normalizeDownloads(chrome) });
  }
  return { fetchedAt: Date.now(), versions };
}

/**
 * Map our lowercase channel name to the manifest's case (`stable` → `Stable`).
 * The CfT registry capitalizes channel names; we hide that detail.
 */
export function channelKey(channel: Channel): "Stable" | "Beta" {
  return channel === "stable" ? "Stable" : "Beta";
}

/**
 * Look up the download URL for a `(channel,platform)` pair from a parsed
 * channel manifest. Returns `null` if the platform isn't shipped in that
 * channel.
 */
export function findChannelDownload(
  manifest: ChannelManifest,
  channel: Channel,
  platform: CftPlatform,
): { version: string; url: string } | null {
  const row = manifest.channels[channelKey(channel)];
  if (!row) return null;
  const dl = row.downloads.find((d) => d.platform === platform);
  if (!dl) return null;
  return { version: row.version, url: dl.url };
}

/**
 * Look up the download URL for a `(version,platform)` pair in the historical
 * catalog. Returns `null` if the version doesn't exist or doesn't ship that
 * platform.
 */
export function findVersionDownload(
  manifest: KnownGoodManifest,
  version: string,
  platform: CftPlatform,
): { url: string } | null {
  const row = manifest.versions.find((v) => v.version === version);
  if (!row) return null;
  const dl = row.downloads.find((d) => d.platform === platform);
  if (!dl) return null;
  return { url: dl.url };
}

interface FetchOpts {
  /** Override the on-disk cache directory. Defaults to `<root>/.cache/`. */
  readonly cacheDir: string;
  /** Bypass the on-disk cache (always hit the network). */
  readonly noCache?: boolean;
}

/**
 * Read a JSON file, returning null on any error (missing, corrupt, etc.).
 * Silent — the caller decides whether to refetch.
 */
async function tryReadCached(path: string): Promise<unknown | null> {
  try {
    const file = Bun.file(path);
    if (!(await file.exists())) return null;
    return await file.json();
  } catch {
    return null;
  }
}

async function writeCacheJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await Bun.write(path, JSON.stringify(value));
}

/**
 * Fetch + cache the channel manifest (Stable/Beta/Dev/Canary versions).
 * Network errors propagate as {@link ManifestFetchError} with cause
 * `"network"`; callers (typically `install.ts`) translate that into the
 * "use pinned default" fallback path.
 */
export async function fetchChannelManifest(opts: FetchOpts): Promise<ChannelManifest> {
  const cachePath = join(opts.cacheDir, "channel-manifest.json");
  if (!opts.noCache) {
    const cached = await tryReadCached(cachePath);
    if (cached !== null) {
      try {
        const parsed = parseChannelManifest(cached);
        if (Date.now() - parsed.fetchedAt < CACHE_TTL_MS) return parsed;
      } catch {
        // fall through to network refetch
      }
    }
  }
  const raw = await fetchJson(LAST_KNOWN_URL);
  const parsed = parseChannelManifest(raw);
  await writeCacheJson(cachePath, raw).catch(() => undefined);
  return parsed;
}

export async function fetchKnownGoodManifest(opts: FetchOpts): Promise<KnownGoodManifest> {
  const cachePath = join(opts.cacheDir, "known-good-manifest.json");
  if (!opts.noCache) {
    const cached = await tryReadCached(cachePath);
    if (cached !== null) {
      try {
        const parsed = parseKnownGoodManifest(cached);
        if (Date.now() - parsed.fetchedAt < CACHE_TTL_MS) return parsed;
      } catch {
        // fall through to network refetch
      }
    }
  }
  const raw = await fetchJson(KNOWN_GOOD_URL);
  const parsed = parseKnownGoodManifest(raw);
  await writeCacheJson(cachePath, raw).catch(() => undefined);
  return parsed;
}

/**
 * Bun-native fetch + JSON decode with discriminated error mapping. Used by
 * both manifest fetchers; not exported because callers should go through the
 * cache layer above.
 */
async function fetchJson(url: string): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(url);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new ManifestFetchError("network", `failed to reach ${url}: ${msg}`);
  }
  if (!res.ok) {
    throw new ManifestFetchError("http", `${url} returned HTTP ${res.status} ${res.statusText}`);
  }
  try {
    return await res.json();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new ManifestFetchError("parse", `failed to JSON-decode ${url}: ${msg}`);
  }
}
