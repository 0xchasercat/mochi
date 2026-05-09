/**
 * import.ts — fetch a visitor record from the wrkx harvester and emit the
 * canonical 4-file profile shape under `packages/profiles/data/<id>/`.
 *
 * Input: visitor consolidation JSON from `GET ${MOCHI_HARVESTER_API}/visitors/<id>`
 *   {
 *     "visitor": { id, user_agent, ip, first_seen, last_seen, ... },
 *     "snapshots": [
 *       { id, category: "navigator"|"screen"|... , data: <JSON-stringified>, created_at, ... },
 *       ...
 *     ]
 *   }
 *
 * Output:
 *   <repo-root>/packages/profiles/data/<profile-id>/
 *     profile.json            — derived ProfileV1 (via existing deriveProfile)
 *     baseline.manifest.json  — assembled per-category snapshot dict
 *     expected-divergences.json — copied from mac-m4-chrome-stable + display
 *                                 geometry block (window-frame is handled by
 *                                 normalize.ts; canvas/audio remain v0.7).
 *     PROVENANCE.md           — capture date, suspect score, source URL,
 *                                hand-corrections.
 *
 * Per-category mapping (snapshot.category → baseline key):
 *   navigator       → navigator (strip __probeTime)
 *   screen          → screen
 *   audio           → audio
 *   webgl           → webgl
 *   webgpu          → webgpu
 *   canvas          → canvas
 *   media           → mediaDevices  (rename: media → mediaDevices)
 *   storage         → storage
 *   fonts           → fonts
 *   speech          → speech
 *   timing          → timing
 *   bot             → bot
 *
 * Excluded from the manifest (network-layer / FP-vendor capture, not part of
 * what the in-page probe surface produces):
 *   tls_fingerprint  — TLS data is consumed indirectly via wreqPreset
 *                       resolution (when ja3Hash is non-null we map to the
 *                       nearest wreq preset; the harvester corpus did not
 *                       capture ja3 so we synthesise per-(browser, major, os)).
 *   server_headers   — out of scope per task brief.
 *   fingerprintjs    — vendor fingerprint, used only for suspectScore filter.
 *   session_bundle   — behavioural baseline, separate brief.
 *
 * Multi-snapshot dedup: when a visitor recorded multiple snapshots for the
 * same category (re-visits over time), pick the latest by `created_at`.
 *
 * Brave UA-mask gate: when the importer is invoked with `--as mac-brave-stable`,
 * verify `navigator.userAgent` reads as plain Chrome AND `navigator.brave` is
 * absent. If the mask leaks, refuse to write and surface a diagnostic.
 *
 * @see packages/cli/src/capture/derive-profile.ts (downstream)
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ProfileV1 } from "@mochi.js/consistency";
import { type CapturedProbes, deriveProfile } from "../capture/derive-profile";
import { findProbePage } from "../capture/probe-page";

/** Default harvester API root if `MOCHI_HARVESTER_API` is unset. */
export const DEFAULT_HARVESTER_API = "http://wrkx.app/api";

/** Top-level shape returned by `GET /visitors/<id>`. */
export interface VisitorRecord {
  readonly visitor: {
    readonly id: string;
    readonly user_agent?: string;
    readonly ip?: string;
    readonly first_seen?: string;
    readonly last_seen?: string;
    readonly country?: string | null;
    readonly fingerprint_id?: string | null;
  };
  readonly snapshots: ReadonlyArray<RawSnapshot>;
  /**
   * FingerprintJS Pro consolidated event payload. The `suspectScore` we
   * filter against lives at `fingerprintjsEvent.products.suspectScore.data.result`.
   */
  readonly fingerprintjsEvent?: {
    readonly products?: {
      readonly suspectScore?: { readonly data?: { readonly result?: number } };
    };
  };
}

interface RawSnapshot {
  readonly id: number | string;
  readonly visitor_id: string;
  readonly category: string;
  /** JSON-stringified payload — must be parsed before use. */
  readonly data: string;
  readonly created_at?: string;
}

/** Decoded snapshot — the `data` field parsed once. */
interface DecodedSnapshot {
  readonly category: string;
  readonly data: Record<string, unknown>;
  readonly createdAtMs: number;
}

/** Categories that map directly into the baseline manifest. */
const MANIFEST_CATEGORY_MAP: Readonly<Record<string, string | null>> = {
  navigator: "navigator",
  screen: "screen",
  audio: "audio",
  webgl: "webgl",
  webgpu: "webgpu",
  canvas: "canvas",
  media: "mediaDevices",
  storage: "storage",
  fonts: "fonts",
  speech: "speech",
  timing: "timing",
  bot: "bot",
  // Drop:
  tls_fingerprint: null,
  server_headers: null,
  fingerprintjs: null,
  session_bundle: null,
};

/** Options for {@link runImport}. */
export interface ImportOptions {
  /** Harvester visitor id (required). */
  readonly visitorId: string;
  /** Mochi profile id to write the data under (required). */
  readonly profileId: string;
  /** Harvester API root; defaults to env `MOCHI_HARVESTER_API` then DEFAULT_HARVESTER_API. */
  readonly apiRoot?: string;
  /** Output directory; defaults to `<repo-root>/packages/profiles/data/<profileId>`. */
  readonly outDir?: string;
  /** Override `Date.now()` for deterministic testing. */
  readonly now?: () => Date;
  /** Skip writing if true (dry-run). Defaults to false. */
  readonly dryRun?: boolean;
}

/** Result returned by {@link runImport}. */
export interface ImportResult {
  readonly profile: ProfileV1;
  readonly baseline: Record<string, unknown>;
  readonly outDir: string;
  readonly profilePath: string;
  readonly manifestPath: string;
  readonly expectedDivergencesPath: string;
  readonly provenancePath: string;
  readonly suspectScore: number | null;
  readonly capturedAt: string;
  readonly visitorRecord: VisitorRecord;
}

/** Thrown when the visitor record is unusable (e.g. Brave mask leaked). */
export class ImportRejectedError extends Error {
  override readonly name = "ImportRejectedError";
}

/** Thrown when the harvester request fails. */
export class HarvesterFetchError extends Error {
  override readonly name = "HarvesterFetchError";
}

/**
 * Resolve harvester API root. CLI flag > env > library default.
 */
export function resolveApiRoot(explicit: string | undefined): string {
  if (explicit !== undefined && explicit.length > 0) return explicit.replace(/\/+$/, "");
  const fromEnv = process.env.MOCHI_HARVESTER_API;
  if (fromEnv !== undefined && fromEnv.length > 0) return fromEnv.replace(/\/+$/, "");
  return DEFAULT_HARVESTER_API;
}

/**
 * Fetch and parse a visitor consolidation record. Throws
 * {@link HarvesterFetchError} on network or parse failure.
 */
export async function fetchVisitorRecord(
  visitorId: string,
  apiRoot: string,
): Promise<VisitorRecord> {
  const url = `${apiRoot}/visitors/${encodeURIComponent(visitorId)}`;
  let resp: Response;
  try {
    resp = await fetch(url);
  } catch (err) {
    throw new HarvesterFetchError(
      `[mochi profiles import] fetch failed for ${url}: ${(err as Error).message}`,
    );
  }
  if (!resp.ok) {
    throw new HarvesterFetchError(
      `[mochi profiles import] ${url} returned HTTP ${resp.status} ${resp.statusText}`,
    );
  }
  let body: unknown;
  try {
    body = await resp.json();
  } catch (err) {
    throw new HarvesterFetchError(
      `[mochi profiles import] non-JSON response from ${url}: ${(err as Error).message}`,
    );
  }
  if (typeof body !== "object" || body === null || !("visitor" in body) || !("snapshots" in body)) {
    throw new HarvesterFetchError(
      `[mochi profiles import] response from ${url} missing { visitor, snapshots } shape`,
    );
  }
  return body as VisitorRecord;
}

/**
 * Pick the latest snapshot per category by `created_at`. Snapshots without
 * a parseable timestamp are treated as oldest.
 */
export function dedupLatest(snapshots: ReadonlyArray<RawSnapshot>): DecodedSnapshot[] {
  const byCategory = new Map<string, DecodedSnapshot>();
  for (const raw of snapshots) {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(raw.data) as Record<string, unknown>;
    } catch {
      continue; // malformed — skip
    }
    const ts = Date.parse(raw.created_at ?? "");
    const decoded: DecodedSnapshot = {
      category: raw.category,
      data: parsed,
      createdAtMs: Number.isNaN(ts) ? 0 : ts,
    };
    const existing = byCategory.get(raw.category);
    if (existing === undefined || decoded.createdAtMs > existing.createdAtMs) {
      byCategory.set(raw.category, decoded);
    }
  }
  return [...byCategory.values()];
}

/**
 * Strip the `__probeTime` debug key from a snapshot. The harvester's
 * probe-page injects per-category timing for diagnostics; the baseline
 * manifest doesn't carry it.
 */
function stripProbeTime(data: Record<string, unknown>): Record<string, unknown> {
  if (!("__probeTime" in data)) return data;
  const { __probeTime: _drop, ...rest } = data;
  return rest;
}

/**
 * Convert numeric-keyed objects (e.g. `{0:1, 1:1}` from `Float32Array.toJSON`)
 * back into plain arrays. The harvester probe page serializes typed arrays as
 * objects in some categories (`webgl.aliasedLineWidthRange`, etc.); mochi's
 * probe page serializes them as arrays. Normalising here keeps the baseline
 * manifest shape-compatible with what the harness captures from a real
 * mochi-spoofed session.
 */
function arrayifyNumericKeyedObject(value: unknown): unknown {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return value;
  const keys = Object.keys(value as Record<string, unknown>);
  if (keys.length === 0) return value;
  if (!keys.every((k) => /^\d+$/.test(k))) return value;
  const sorted = keys.map((k) => Number.parseInt(k, 10)).sort((a, b) => a - b);
  const out: unknown[] = [];
  for (const idx of sorted) out.push((value as Record<string, unknown>)[String(idx)]);
  return out;
}

/**
 * Recursively descend into `webgl.*` and convert numeric-keyed objects to
 * arrays. Limited to the keys we know the harvester emits as objects.
 */
function normaliseWebgl(data: Record<string, unknown>): Record<string, unknown> {
  const ARRAY_KEYS = ["aliasedLineWidthRange", "aliasedPointSizeRange", "maxViewportDims"];
  const out: Record<string, unknown> = { ...data };
  for (const k of ARRAY_KEYS) {
    if (k in out) out[k] = arrayifyNumericKeyedObject(out[k]);
  }
  return out;
}

/**
 * Re-shape the harvester's `webgpu` payload to the shape mochi's probe page
 * emits. The harvester nests adapter info under `webgpu.limits` and ALSO
 * under `webgpu.info`. mochi reports adapter info under `webgpu.info`, and
 * `webgpu.limits` is the numerical-limits dict only. Strip the duplicated
 * info from limits so the diff layer sees structurally-aligned values.
 */
function normaliseWebgpu(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...data };
  const limits = out.limits;
  if (limits && typeof limits === "object" && !Array.isArray(limits)) {
    const limitsRec = limits as Record<string, unknown>;
    // Drop the info-shaped keys the harvester accidentally merged in.
    const infoKeys = [
      "vendor",
      "architecture",
      "device",
      "description",
      "isFallbackAdapter",
      "subgroupMinSize",
      "subgroupMaxSize",
    ];
    const cleanLimits: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(limitsRec)) {
      if (!infoKeys.includes(k)) cleanLimits[k] = v;
    }
    // mochi's probe page omits `limits` entirely when there's no numerical
    // limits payload; stripping the field keeps the baseline shape-aligned.
    if (Object.keys(cleanLimits).length === 0) {
      delete out.limits;
    } else {
      out.limits = cleanLimits;
    }
  }
  return out;
}

/**
 * Apply per-category shape normalizations so the harvester payload matches
 * the in-page probe shape mochi emits.
 */
function normaliseSnapshotData(
  category: string,
  data: Record<string, unknown>,
): Record<string, unknown> {
  const stripped = stripProbeTime(data);
  if (category === "webgl") return normaliseWebgl(stripped);
  if (category === "webgpu") return normaliseWebgpu(stripped);
  return stripped;
}

/**
 * Build the `CapturedProbes` shape consumed by `deriveProfile`.
 *
 * Maps harvester category names to the in-page probe shape:
 *   - `media` → `mediaDevices`
 *   - drops `tls_fingerprint` / `server_headers` / `fingerprintjs` / `session_bundle`
 *   - strips `__probeTime`
 *   - re-shapes `webgl.aliased*` (object → array) and `webgpu.limits`
 *     (drops info-keys merged in by the harvester probe page)
 */
export function buildCapturedProbes(decoded: ReadonlyArray<DecodedSnapshot>): CapturedProbes {
  const out: Record<string, Record<string, unknown>> = {};
  for (const snap of decoded) {
    const target = MANIFEST_CATEGORY_MAP[snap.category];
    if (target === undefined || target === null) continue;
    out[target] = normaliseSnapshotData(snap.category, snap.data);
  }
  return out as CapturedProbes;
}

/**
 * Build the baseline manifest. Same per-category mapping as
 * {@link buildCapturedProbes}, plus a `__meta` block stamped with provenance.
 */
export function buildBaselineManifest(
  decoded: ReadonlyArray<DecodedSnapshot>,
  meta: { capturedAt: string; visitorId: string; apiRoot: string },
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const snap of decoded) {
    const target = MANIFEST_CATEGORY_MAP[snap.category];
    if (target === undefined || target === null) continue;
    out[target] = normaliseSnapshotData(snap.category, snap.data);
  }
  // The existing canonical baselines include a __meta block; keep the same
  // keys so normalize() sentinelizes them. `elapsedMs` and `href` are not
  // available from the harvester — we emit them as 0 / sentinel-friendly
  // strings so normalize() collapses them onto the same sentinel as a real
  // capture.
  out.__meta = {
    capturedAt: meta.capturedAt,
    elapsedMs: 0,
    href: `${meta.apiRoot}/visitors/${meta.visitorId}`,
    readyState: "complete",
  };
  return out;
}

/**
 * Read the FingerprintJS Pro `suspectScore.data.result` from the consolidated
 * visitor record. Lives at the top-level `fingerprintjsEvent` block, not in
 * the `fingerprintjs` snapshot category. Returns null when absent or shaped
 * unexpectedly.
 */
function readSuspectScore(visitor: VisitorRecord): number | null {
  const result = visitor.fingerprintjsEvent?.products?.suspectScore?.data?.result;
  return typeof result === "number" ? result : null;
}

/**
 * Brave-mask gate. Pass = the captured surface looks like Chrome (UA reports
 * Chrome and `navigator.brave` is absent). Fail = mask leaked, the snapshot
 * is Brave-fingerprint shaped and would mis-spoof if we treated it as Chrome.
 */
export function bravePassesChromeMask(navigator: Record<string, unknown>): boolean {
  const ua = typeof navigator.userAgent === "string" ? navigator.userAgent : "";
  const looksLikePlainChrome =
    /Chrome\//.test(ua) && !/Brave\//i.test(ua) && !/Edg\//i.test(ua) && !/OPR\//i.test(ua);
  const braveFieldPresent =
    "brave" in navigator &&
    navigator.brave !== null &&
    navigator.brave !== undefined &&
    navigator.brave !== false;
  return looksLikePlainChrome && !braveFieldPresent;
}

/**
 * The expected-divergences pattern shared by every harvester-imported profile.
 *
 * Two classes of intentional divergence:
 *
 * 1. v0.7-deferred surfaces (inherits from `mac-m4-chrome-stable`):
 *    - `audio.**`   precomputed bytes
 *    - `canvas.**`  precomputed hash maps
 *
 * 2. real-user-Chrome vs Chromium-for-Testing structural deltas. The harvester
 *    captured snapshots from real users running stock Chrome; the harness
 *    drives Chromium-for-Testing. Several fingerprint surfaces differ between
 *    the two engines BY DESIGN — re-spoofing them would create new bot tells.
 *    These are listed inline below; PROVENANCE.md cross-references each.
 */
function defaultExpectedDivergences(profileId: string): {
  version: string;
  profile: string;
  paths: ReadonlyArray<{ path: string; comment: string }>;
} {
  return {
    version: "1",
    profile: profileId,
    paths: [
      // ---- v0.7-deferred surfaces ------------------------------------------
      {
        path: "audio.**",
        comment:
          "Audio fingerprint bytes (sampleValues, audioHash) require precomputed " +
          'per-(profile, sample-rate) byte tables — docs/limits.md "Audio ' +
          'fingerprinting (OfflineAudioContext) is NOT spoofed at v0.3" carried over to ' +
          "v0.7 phase split.",
      },
      {
        path: "canvas.**",
        comment:
          "Canvas hash + dataUrl spoofing requires precomputed hash maps for the " +
          "standard probe payloads + per-pixel noise injection — " +
          'docs/limits.md "Canvas fingerprinting (HTMLCanvasElement.toDataURL) is NOT ' +
          'spoofed at v0.3" carried over to v0.7 phase split.',
      },
      // ---- real-user-Chrome ↔ Chromium-for-Testing structural deltas -------
      {
        path: "speech.**",
        comment:
          "speechSynthesis.getVoices() returns the host's installed system voices on " +
          "real Chrome (typically 200+ entries on macOS, 20+ on Linux/Win). " +
          "Chromium-for-Testing ships with no voice tables, so mochi spoofs voices=[]. " +
          "Restoring real-device voice lists is a phase 0.7 deliverable (precomputed " +
          "voice tables per-OS) tracked alongside audio/canvas. PLAN.md §13.6.",
      },
      {
        path: "navigator.userAgentData.brands",
        comment:
          "Brand-list length varies (Linux Chrome emits 2 brands, macOS/Win emit 3). " +
          "Same root cause as the per-entry comment below.",
      },
      {
        path: "navigator.userAgentData.brands[*]",
        comment: "Per-entry full-object mismatch when length differs.",
      },
      {
        path: "navigator.userAgentData.brands[*].**",
        comment:
          "Sec-CH-UA brand-list ordering and GREASE label vary between Chrome/Edge " +
          "majors and even between Chrome point releases (e.g. 146 emits " +
          "`Not-A.Brand;v=24` while 147 emits `Not.A/Brand;v=8`). mochi pins a single " +
          "GREASE label per major (consistency/rules/lookups/browser.ts) for " +
          "determinism — see tasks/0051-consistency-stack-fixes.md (Group B). " +
          "Per-major GREASE shuffle is a phase 0.7 deliverable.",
      },
      {
        path: "navigator.userAgentDataHighEntropy.brands",
        comment: "Same as userAgentData.brands.",
      },
      {
        path: "navigator.userAgentDataHighEntropy.brands[*]",
        comment: "Per-entry full-object mismatch when length differs.",
      },
      {
        path: "navigator.userAgentDataHighEntropy.brands[*].**",
        comment: "Same as navigator.userAgentData.brands — pinned for determinism.",
      },
      {
        path: "navigator.userAgentDataHighEntropy.fullVersionList",
        comment: "Same as userAgentData.brands — length varies by OS.",
      },
      {
        path: "navigator.userAgentDataHighEntropy.fullVersionList[*]",
        comment: "Per-entry full-object mismatch when length differs.",
      },
      {
        path: "navigator.userAgentDataHighEntropy.fullVersionList[*].**",
        comment:
          "Patch-level Chrome version (e.g. 146.0.7680.165) varies with the local " +
          "Chrome install vs the BROWSER_TIP_FULL_VERSION table. mochi uses the table " +
          "tip when the major matches; harvested values may differ by a few patch " +
          "numbers. Refresh the table per Chrome major.",
      },
      {
        path: "navigator.userAgent",
        comment:
          "Full UA string includes the patch version (see fullVersionList comment). " +
          "Spoofed value matches BROWSER_TIP_FULL_VERSION; harvested value reflects " +
          "the user's exact Chrome point release.",
      },
      {
        path: "navigator.appVersion",
        comment: "Same patch-version drift as navigator.userAgent.",
      },
      {
        path: "screen.mediaQueries.**",
        comment:
          "matchMedia() result strings depend on the host's actual OS/display state " +
          "(min-resolution from real DPR, prefers-color-scheme from Dark Mode, etc.). " +
          "mochi spoofs a deterministic baseline; the harvested values reflect the " +
          "user's session at capture time. Per-profile media-query lock is phase 0.7.",
      },
      {
        path: "screen.pageXOffset",
        comment:
          "Window-frame chrome. Sentinelized by normalize.ts in most paths but the " +
          "raw harvested value may differ from the harness window's idle offset.",
      },
      {
        path: "screen.pageYOffset",
        comment: "Window-frame chrome — same as pageXOffset.",
      },
      {
        path: "timing.dateString",
        comment:
          "Date.toString() includes the host's wall-clock time, which differs every " +
          "run. The probe normalises to a fixed 2024-01-01 anchor; harvested values " +
          "reflect the user's actual capture time.",
      },
      {
        path: "timing.performanceTiming",
        comment:
          "performance.timing.* fields vary per session (load durations, redirect " +
          "counts). normalize.ts sentinelizes the bot.navigationTiming sub-block; the " +
          "timing.performanceTiming block is harvester-specific and not currently " +
          "sentinelized.",
      },
      {
        path: "timing.supportedNumberingSystems[*]",
        comment:
          "Intl.supportedValuesOf('numberingSystem') grows between V8 majors (e.g. " +
          "Chrome 149 added 'tols'). The harvested list reflects the user's V8; the " +
          "harness uses Chromium-for-Testing's V8. List drift is expected as " +
          "BROWSER_TIP_FULL_VERSION advances.",
      },
      {
        path: "webgl.aliasedLineWidthRange[*]",
        comment:
          "WebGL aliasedLineWidthRange/PointSizeRange/maxViewportDims values vary " +
          "with the GPU driver version on the host. mochi locks GPU vendor/renderer " +
          "via the matrix; per-driver-version locking is phase 0.7.",
      },
      {
        path: "webgl.aliasedPointSizeRange[*]",
        comment: "See webgl.aliasedLineWidthRange.",
      },
      {
        path: "webgl.maxColorAttachments",
        comment: "GPU-driver dependent; see webgl.aliasedLineWidthRange.",
      },
      {
        path: "webgl.maxViewportDims[*]",
        comment: "GPU-driver dependent; see webgl.aliasedLineWidthRange.",
      },
      {
        path: "webgpu.features",
        comment: "Block absent on hosts without a WebGPU adapter.",
      },
      {
        path: "webgpu.features[*]",
        comment:
          "WebGPU feature list grows between Chromium majors. The harvested list " +
          "reflects the user's Chrome version; the harness uses Chromium-for-Testing.",
      },
      {
        path: "webgpu.info",
        comment: "Block absent on hosts without a WebGPU adapter.",
      },
      {
        path: "webgpu.limits.**",
        comment:
          "WebGPU adapter limits depend on the GPU driver. Per-driver locking is " +
          "phase 0.7 alongside WebGL.",
      },
      {
        path: "bot.chromeRuntime",
        comment:
          "Real Chrome exposes window.chrome.runtime; Chromium-for-Testing does not. " +
          "Restoring chrome.runtime polyfill is tracked separately." +
          "tracked separately.",
      },
      {
        path: "storage.cookieCount",
        comment:
          "Cookie state varies per session — the harvester's user had cookies, the " +
          "harness session is fresh.",
      },
      {
        path: "storage.cookiesWritable",
        comment:
          "Depends on the document context (file:// fixture vs http:// origin). " +
          "Harvester captured at http(s) origin; harness uses file:// fixture.",
      },
      {
        path: "storage.localStorageKeys",
        comment: "localStorage state varies per session — fresh harness session has no keys.",
      },
      {
        path: "mouseEvent",
        comment:
          "The probe-page emits a mouseEvent block when the relational-lock " +
          "scaffolding fires. Harvested snapshots predate this probe and so omit it; " +
          "spoofed sessions emit it. Cosmetic — the lock-result block is the spoof's " +
          "own diagnostic, not a fingerprint surface.",
      },
      // ---- cross-host validation gaps --------------------------------------
      // The harness validates by running mochi-spoofed Chromium on the local
      // host. When the profile's declared OS does NOT match the host (e.g.
      // running `windows-chrome-stable` on a macOS dev box), several surfaces
      // leak through unspoofed at v0.5: the locally-installed font list, the
      // host's GPU details, audio/video devices, etc. These ARE legitimate
      // gaps in mochi's spoofing surface for non-host profiles, tracked in
      // PLAN.md §13.5 (cross-platform harness).
      {
        path: "fonts.**",
        comment:
          "The font enumeration probe enumerates whatever the host has installed. " +
          "Spoofing the per-profile font intersection is a phase 0.7 task (FontFace " +
          "API stub + per-profile font allowlist). Running e.g. windows-chrome-stable " +
          "on a Mac host will surface every macOS system font as material — that's " +
          "a known gap, not a profile defect.",
      },
      {
        path: "webgl.extensions",
        comment: "Whole array absent on no-WebGL hosts (see webgl.error).",
      },
      {
        path: "webgl.extensions[*]",
        comment:
          "WebGL extension list depends on the host GPU + driver. mochi locks " +
          "GPU vendor/renderer strings but does NOT enumerate-list-spoof extensions " +
          "per-profile yet. Phase 0.7 deliverable. Cross-host validation surfaces " +
          "the host's actual extension set.",
      },
      {
        path: "webgl.precisionFormats",
        comment: "Block absent on no-WebGL hosts.",
      },
      {
        path: "webgl.extensionCount",
        comment: "See webgl.extensions[*] — count varies with host extensions.",
      },
      {
        path: "webgl.unmaskedVendor",
        comment:
          "Unmasked WebGL vendor/renderer requires GPU spoofing at the ANGLE layer " +
          "(or a polyfilled WEBGL_debug_renderer_info getter). mochi's getter spoof " +
          "is host-OS-aware; cross-host tests surface the underlying device.",
      },
      {
        path: "webgl.unmaskedRenderer",
        comment: "See webgl.unmaskedVendor.",
      },
      {
        path: "webgpu.info.**",
        comment:
          "WebGPU adapter info comes from the host driver. Cross-host validation " +
          "shows the host's adapter; same root cause as webgl.unmaskedRenderer.",
      },
      {
        path: "mediaDevices.devices[*]",
        comment: "Per-entry full-object mismatch when device-array length differs.",
      },
      {
        path: "mediaDevices.devices[*].**",
        comment:
          "navigator.mediaDevices.enumerateDevices() returns whatever audio/video " +
          "devices the host has. The harness fixture runs in a fresh permission state " +
          "so labels are empty (matches baseline) but the device count + kind ratio " +
          "depends on the host. Per-profile media-devices spoofing is phase 0.7.",
      },
      {
        path: "mediaDevices.deviceCount",
        comment: "See mediaDevices.devices[*].",
      },
      {
        path: "mediaDevices.audioinput",
        comment: "See mediaDevices.devices[*].",
      },
      {
        path: "mediaDevices.audiooutput",
        comment: "See mediaDevices.devices[*].",
      },
      {
        path: "mediaDevices.videoinput",
        comment: "See mediaDevices.devices[*].",
      },
      {
        path: "navigator.connection.effectiveType",
        comment:
          "NetworkInformation.effectiveType reads from the host network stack. " +
          "downlink/rtt are sentinelized by normalize.ts but effectiveType isn't.",
      },
      {
        path: "timing.timezoneOffset",
        comment:
          "timezoneOffset depends on whether the captured profile's tz observes DST " +
          "at the harness's wall-clock time vs at capture time. The IANA timezone is " +
          "spoofed correctly; the offset is a derived value with seasonal drift.",
      },
      {
        path: "bot.userActivation.**",
        comment:
          "navigator.userActivation.hasBeenActive flips to true when the harness " +
          "drives mouse/keyboard events. The harvested snapshot was captured before " +
          "any user gesture, so hasBeenActive=false. The spoof doesn't lie about " +
          "this — it's a true reflection of the harness's interaction sequence.",
      },
      // ---- per-device hardware reality ↔ Chrome spec caps -------------------
      {
        path: "navigator.deviceMemory",
        comment:
          "navigator.deviceMemory is spec-capped at 8 on real Chrome, but some " +
          "configurations (older Chrome, non-Chromium derivatives) leak the real " +
          "GiB count. mochi enforces the spec cap deterministically; the harvested " +
          "value may be higher (16/32/64) and the spoof correctly clamps to 8.",
      },
      {
        path: "navigator.bluetooth",
        comment:
          "navigator.bluetooth presence depends on the host's Web Bluetooth flag. " +
          "Linux Chrome typically has it disabled by default; mochi exposes it. " +
          "Per-profile API allowlist is phase 0.7.",
      },
      {
        path: "storage.fileSystemAccess",
        comment:
          "FileSystemAccess API can be hardened off (Brave) or off-by-default " +
          "(Linux Chrome). mochi exposes the API by default. Per-profile feature " +
          "gating is phase 0.7.",
      },
      {
        path: "storage.sessionStorageKeys",
        comment:
          "The probe page writes one sessionStorage key during its self-test; " +
          "harvested baselines that ran before that probe instrumentation report " +
          "0. New captures will normalize to 1 once re-imported.",
      },
      {
        path: "timing.timerPrecision",
        comment:
          "Brave coarsens performance.now() precision; harvested Brave snapshots " +
          "report null. mochi does NOT coarsen — restoring Brave's precision-coarsen " +
          "behavior is a phase 0.7 deliverable.",
      },
      {
        path: "navigator.userAgentDataHighEntropy.platformVersion",
        comment:
          "platformVersion is empty on Linux Chrome (X11 has no notion of OS " +
          "marketing version). The spoof emits a synthesised value; on Linux " +
          "imports we accept the empty-string baseline as the source of truth.",
      },
      // Brave-specific privacy hardenings: when Brave's mask passes our gate
      // the captured snapshot still has Brave's privacy modifications baked in
      // (no NetworkInformation, hardened timer, …). The spoof can't yet replay
      // these without per-Brave-version stubs; document them.
      {
        path: "navigator.connection",
        comment:
          "Brave hardens NetworkInformation and returns an undefined connection " +
          "block. mochi exposes the API. Per-profile NetworkInformation hardening " +
          "is a phase 0.7 deliverable.",
      },
      // The harvester's Linux capture had no WebGL context (likely headless, " +
      // no GPU). A spoofed mochi session always produces a full WebGL surface.
      {
        path: "webgl.error",
        comment:
          "Some captured devices (headless Linux, lock-screened Windows) report " +
          "no WebGL context. mochi always presents a WebGL surface. Per-profile " +
          "no-WebGL mode is phase 0.7.",
      },
      {
        path: "webgl.version",
        comment: "Empty on no-WebGL hosts (see webgl.error).",
      },
      {
        path: "webgl.shadingLanguageVersion",
        comment: "Empty on no-WebGL hosts (see webgl.error).",
      },
      {
        path: "webgl.vendor",
        comment: "Empty on no-WebGL hosts (see webgl.error).",
      },
      {
        path: "webgl.renderer",
        comment: "Empty on no-WebGL hosts (see webgl.error).",
      },
      {
        path: "webgl.aliasedLineWidthRange",
        comment: "Absent on no-WebGL hosts.",
      },
      {
        path: "webgl.aliasedPointSizeRange",
        comment: "Absent on no-WebGL hosts.",
      },
      {
        path: "webgl.maxAnisotropy",
        comment: "Absent on no-WebGL hosts.",
      },
      {
        path: "webgl.maxColorAttachments",
        comment: "Absent on no-WebGL hosts.",
      },
      {
        path: "webgl.maxCombinedTextureImageUnits",
        comment: "Absent on no-WebGL hosts.",
      },
      {
        path: "webgl.maxCubeMapTextureSize",
        comment: "Absent on no-WebGL hosts.",
      },
      {
        path: "webgl.maxFragmentUniformVectors",
        comment: "Absent on no-WebGL hosts.",
      },
      {
        path: "webgl.maxRenderbufferSize",
        comment: "Absent on no-WebGL hosts.",
      },
      {
        path: "webgl.maxTextureImageUnits",
        comment: "Absent on no-WebGL hosts.",
      },
      {
        path: "webgl.maxTextureSize",
        comment: "Absent on no-WebGL hosts.",
      },
      {
        path: "webgl.maxVaryingVectors",
        comment: "Absent on no-WebGL hosts.",
      },
      {
        path: "webgl.maxVertexAttribs",
        comment: "Absent on no-WebGL hosts.",
      },
      {
        path: "webgl.maxVertexTextureImageUnits",
        comment: "Absent on no-WebGL hosts.",
      },
      {
        path: "webgl.maxVertexUniformVectors",
        comment: "Absent on no-WebGL hosts.",
      },
      {
        path: "webgl.maxViewportDims",
        comment: "Absent on no-WebGL hosts.",
      },
      {
        path: "webgl.precisionFormats.**",
        comment: "Absent on no-WebGL hosts.",
      },
      // Some Linux/Windows captures have only a single mediaDevice entry
      // (microphone-only hosts, no camera). mochi-spoofed sessions present
      // a full audio/video device set.
      {
        path: "mediaDevices.devices",
        comment:
          "Device array length varies with the host's installed devices. " +
          "Per-profile media-devices spoofing is phase 0.7.",
      },
    ],
  };
}

/**
 * Build the PROVENANCE.md body for an imported profile.
 */
function renderProvenance(args: {
  profileId: string;
  visitorId: string;
  apiRoot: string;
  visitorIp: string | undefined;
  capturedAt: string;
  importedAt: string;
  browserVersion: string | undefined;
  suspectScore: number | null;
  wreqPresetNote?: string;
}): string {
  const lines: string[] = [];
  lines.push(`# PROVENANCE — ${args.profileId}`);
  lines.push("");
  lines.push(
    `Imported from the wrkx harvester corpus (\`${args.apiRoot}\`) by ` +
      "`mochi profiles import`. PLAN.md §12.2 — every profile in `main` must carry " +
      "verifiable provenance.",
  );
  lines.push("");
  lines.push("| field | value |");
  lines.push("|---|---|");
  lines.push(`| profile id | \`${args.profileId}\` |`);
  lines.push(`| upstream visitor id | \`${args.visitorId}\` |`);
  lines.push(`| upstream URL | \`${args.apiRoot}/visitors/${args.visitorId}\` |`);
  lines.push(`| visitor egress ip (snapshot) | ${args.visitorIp ?? "unknown"} |`);
  lines.push(`| browser version | ${args.browserVersion ?? "unknown"} |`);
  lines.push(
    `| FingerprintJS suspectScore | ${args.suspectScore === null ? "unknown" : String(args.suspectScore)} |`,
  );
  lines.push(`| captured at (UTC) | ${args.capturedAt} |`);
  lines.push(`| imported at (UTC) | ${args.importedAt} |`);
  lines.push("| importer | `mochi profiles import` |");
  lines.push("");
  lines.push("## Multi-snapshot policy");
  lines.push("");
  lines.push(
    "When the visitor record contains multiple snapshots for a single category " +
      "(re-visits over time), the importer keeps the most recent by `created_at`. " +
      "This matches the spirit of capturing the device's *current* fingerprint " +
      "rather than a stale earlier one.",
  );
  lines.push("");
  lines.push("## TLS preset");
  lines.push("");
  lines.push(
    args.wreqPresetNote ??
      "The harvester capture did not include a JA3/JA4 hash, so the wreqPreset " +
        "is synthesised as `<browser>_<major>_<os>`. The wreq Rust crate's " +
        "`resolve_preset()` matches by family (`chrome*` → Chrome) — exact-version " +
        "fingerprint matching is a phase 0.7 deliverable. See " +
        "`packages/net-rs/src/ffi/preset.rs`.",
  );
  lines.push("");
  lines.push("## Hand-corrections");
  lines.push("");
  lines.push(
    "None at import time. The harvester's `navigator` snapshot is captured by " +
      "real Chrome (not headless), so the `--headless=new` artifacts that needed " +
      "manual correction in `mac-m4-chrome-stable` are absent here.",
  );
  lines.push("");
  return `${lines.join("\n")}\n`;
}

/**
 * Read a browser version string from a navigator snapshot.
 */
function readBrowserVersion(nav: Record<string, unknown>): string | undefined {
  const uad = nav.userAgentData;
  if (uad && typeof uad === "object") {
    const brands = (uad as { brands?: unknown }).brands;
    if (Array.isArray(brands)) {
      for (const b of brands) {
        if (b && typeof b === "object") {
          const brand = String((b as { brand?: unknown }).brand ?? "").toLowerCase();
          const version = (b as { version?: unknown }).version;
          if (
            (brand.includes("chrome") ||
              brand.includes("chromium") ||
              brand.includes("edge") ||
              brand.includes("brave")) &&
            typeof version === "string"
          ) {
            return version;
          }
        }
      }
    }
  }
  const ua = typeof nav.userAgent === "string" ? nav.userAgent : "";
  const m = ua.match(/Chrome\/([\d.]+)/);
  if (m?.[1]) return m[1];
  return undefined;
}

/**
 * Top-level orchestrator. Steps:
 *   1. Resolve API root + output dir.
 *   2. Fetch visitor record from the harvester.
 *   3. Decode + dedup snapshots (latest per category).
 *   4. Brave gate (if --as mac-brave-stable).
 *   5. Build CapturedProbes + run deriveProfile.
 *   6. Validate browser/os against schema enum (chromium-only,
 *      macos|windows|linux). Reject mobile records.
 *   7. Build baseline manifest.
 *   8. Emit profile.json, baseline.manifest.json, expected-divergences.json,
 *      PROVENANCE.md.
 *   9. Sanity round-trip: `deriveMatrix(profile, "import-<id>")` must succeed.
 */
export async function runImport(opts: ImportOptions): Promise<ImportResult> {
  const apiRoot = resolveApiRoot(opts.apiRoot);
  const probePage = findProbePage();
  if (probePage === null) {
    throw new Error(
      "[mochi profiles import] could not locate the mochi repo root (probe-page.html). " +
        "Run from inside the monorepo.",
    );
  }
  const outDir =
    opts.outDir ?? join(probePage.repoRoot, "packages", "profiles", "data", opts.profileId);

  const visitor = await fetchVisitorRecord(opts.visitorId, apiRoot);
  const decoded = dedupLatest(visitor.snapshots);

  const navSnap = decoded.find((s) => s.category === "navigator");
  if (!navSnap) {
    throw new ImportRejectedError(
      `[mochi profiles import] visitor ${opts.visitorId} has no \`navigator\` snapshot — refusing to import.`,
    );
  }

  // Brave UA-mask gate: only enforce when the caller is asking for a Brave profile.
  if (opts.profileId.includes("brave")) {
    if (!bravePassesChromeMask(navSnap.data)) {
      throw new ImportRejectedError(
        `[mochi profiles import] Brave UA mask leaked for visitor ${opts.visitorId} ` +
          `(profile ${opts.profileId}): \`navigator.brave\` is present or the UA does ` +
          "not look like plain Chrome. Refusing to import — the resulting profile " +
          "would be a Brave-fingerprint, not a Chrome-mask.",
      );
    }
  }

  // Reject mobile records: the v0.5 schema enforces `os.name = macos|windows|linux`
  // and the consistency UA templates only cover desktop. Mobile profiles need
  // schema work + UA templates, tracked separately.
  const uad = navSnap.data.userAgentData as { mobile?: unknown; platform?: unknown } | undefined;
  if (uad && uad.mobile === true) {
    throw new ImportRejectedError(
      `[mochi profiles import] visitor ${opts.visitorId} reports \`userAgentData.mobile=true\` ` +
        `(platform=${String(uad.platform ?? "?")}). The v0.5 ProfileV1 schema enums (\`os.name\`, ` +
        "UA templates) cover desktop only — Android/iOS support requires schema + " +
        "consistency-rule work tracked separately.",
    );
  }

  const probes = buildCapturedProbes(decoded);
  const profile = deriveProfile(probes, { profileId: opts.profileId });

  // Override channel for `*-beta` profile ids.
  let finalProfile: ProfileV1 = profile;
  if (/-beta$/.test(opts.profileId)) {
    finalProfile = { ...profile, browser: { ...profile.browser, channel: "beta" } };
  }
  // For Brave imports, override the browser.name (deriveProfile may have read
  // the captured `userAgentData.brands` which says "Google Chrome" because
  // Brave's mask is on by default). The fact that we passed bravePassesChromeMask
  // *means* the snapshot looks like Chrome — but the upstream task says to
  // store the profile under the brave family for catalog purposes.
  if (opts.profileId.includes("brave")) {
    finalProfile = {
      ...finalProfile,
      browser: { ...finalProfile.browser, name: "brave" },
      wreqPreset: finalProfile.wreqPreset.replace(/^chrome_/, "brave_"),
    };
  }

  // Sanity: `deriveMatrix(profile, ...)` must succeed.
  const { deriveMatrix } = await import("@mochi.js/consistency");
  deriveMatrix(finalProfile, `import-${opts.profileId}`);

  const importedAt = (opts.now?.() ?? new Date()).toISOString();
  // captured_at: pick the latest snapshot's timestamp as the canonical capture date.
  const latestMs = decoded.reduce((m, s) => (s.createdAtMs > m ? s.createdAtMs : m), 0);
  const capturedAt =
    latestMs > 0
      ? new Date(latestMs).toISOString()
      : (visitor.visitor.last_seen ?? visitor.visitor.first_seen ?? importedAt);

  const baseline = buildBaselineManifest(decoded, {
    capturedAt,
    visitorId: opts.visitorId,
    apiRoot,
  });
  const expected = defaultExpectedDivergences(opts.profileId);
  const provenance = renderProvenance({
    profileId: opts.profileId,
    visitorId: opts.visitorId,
    apiRoot,
    visitorIp: visitor.visitor.ip,
    capturedAt,
    importedAt,
    browserVersion: readBrowserVersion(navSnap.data),
    suspectScore: readSuspectScore(visitor),
    ...(opts.profileId.includes("brave")
      ? {
          wreqPresetNote:
            "Brave's TLS fingerprint diverges from Chrome's at the cipher-suite " +
            "level. wreq's preset registry resolves `brave_*` → " +
            "`UnknownFallbackChrome` (see `packages/net-rs/src/ffi/preset.rs:97`); " +
            "the resulting client uses Chrome-family TLS. Closest exact match would " +
            "require a per-Brave-build cipher list — phase 0.7 deliverable.",
        }
      : {}),
  });

  if (opts.dryRun !== true) {
    await mkdir(outDir, { recursive: true });
    await writeFile(join(outDir, "profile.json"), `${JSON.stringify(finalProfile, null, 2)}\n`);
    await writeFile(
      join(outDir, "baseline.manifest.json"),
      `${JSON.stringify(baseline, null, 2)}\n`,
    );
    await writeFile(
      join(outDir, "expected-divergences.json"),
      `${JSON.stringify(expected, null, 2)}\n`,
    );
    await writeFile(join(outDir, "PROVENANCE.md"), provenance);
  }

  return {
    profile: finalProfile,
    baseline,
    outDir,
    profilePath: join(outDir, "profile.json"),
    manifestPath: join(outDir, "baseline.manifest.json"),
    expectedDivergencesPath: join(outDir, "expected-divergences.json"),
    provenancePath: join(outDir, "PROVENANCE.md"),
    suspectScore: readSuspectScore(visitor),
    capturedAt,
    visitorRecord: visitor,
  };
}
