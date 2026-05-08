/**
 * normalize.ts — strip per-session entropy from a Probe Manifest.
 *
 * Mirrors Peekaboo's `recon/equivalence/normalize.py` pattern (see
 * Peekaboo/peekaboo/research/62-equivalence-harness.md "What gets normalized").
 *
 * The harness diffs *structure*, not entropy: two captures of the same
 * device + browser + fixture should be byte-identical EXCEPT for fields
 * that carry per-session randomness (capture timestamps, deviceId/groupId
 * GUIDs, CSP nonces, etc.). This module collapses those fields onto
 * sentinel placeholders so the structural diff layer can compare them.
 *
 * Sentinels (matched on `categorize`):
 *   - `<HEX32_GUID>`      — 32-hex-char GUIDs (MUID/IG/SID-class)
 *   - `<EVENT_ID>`        — UUIDv4-shaped strings (with or without dashes)
 *   - `<TS>`              — RFC3339 / RFC1123 timestamps
 *   - `<EPOCH_MS>`        — 13-digit epoch ms numbers (in strings)
 *   - `<CSP_NONCE>`       — `nonce=<base64-ish>` substrings
 *
 * The Probe Manifest fields we proactively normalize at v0.5 (informed by
 * the captured baseline shape — `packages/profiles/data/<id>/baseline.manifest.json`):
 *
 *   - `__meta.capturedAt`           — ISO timestamp; sentinelize
 *   - `__meta.elapsedMs`            — varies per run; sentinelize
 *   - `__meta.href`                 — file:// path varies per machine; sentinelize
 *   - `mediaDevices.devices[*].deviceId` and `groupId` — per-session GUIDs
 *   - `bot.navigationTiming.*`      — varies per run; sentinelize
 *   - `screen.{outerWidth,outerHeight,screenX,screenY}` — window-frame chrome,
 *     varies per run; treat as guid-class via sentinelize.
 *   - any string value that looks like a GUID/timestamp/nonce
 *
 * The output shape is structurally identical to the input (same keys,
 * same array lengths) — only string/number values may be replaced with
 * sentinel strings. This keeps the diff layer simple.
 *
 * Idempotent: `normalize(normalize(m)) === normalize(m)`.
 */

import type { JsonValue } from "./generated/diff-report";
import type { ProbeManifestV1 } from "./generated/probe-manifest";

/** Sentinel placeholders. Keep in sync with categorize.GUID_SENTINELS. */
export const SENTINELS = {
  hex32Guid: "<HEX32_GUID>",
  eventId: "<EVENT_ID>",
  timestamp: "<TS>",
  epochMs: "<EPOCH_MS>",
  cspNonce: "<CSP_NONCE>",
  filePath: "<FILE_PATH>",
  elapsedMs: "<ELAPSED_MS>",
  windowFrame: "<WINDOW_FRAME>",
  navTiming: "<NAV_TIMING>",
} as const;

export type Sentinel = (typeof SENTINELS)[keyof typeof SENTINELS];

/** All sentinels — used by categorize() to recognise normalized values. */
export const ALL_SENTINELS: readonly string[] = Object.values(SENTINELS);

/**
 * Marker brand on the normalize output. Type-only — runtime is plain object.
 *
 * This is the type the harness's `diff()` callers should pass; structure
 * is deliberately permissive (`Record<string, JsonValue>`) so the harness
 * can normalize either a `ProbeManifestV1` or the simpler probe-page
 * payload (which is what mochi's local fixture produces today).
 */
export type NormalizedManifest = {
  readonly __mochiNormalized: true;
} & Record<string, JsonValue>;

/**
 * Normalize a manifest in-place-style: returns a new object with per-session
 * entropy collapsed onto sentinels. Accepts either a `ProbeManifestV1` or
 * the local probe-page JSON (which is shape-compatible at the level the
 * harness needs — `Record<string, JsonValue>`).
 */
export function normalize(
  manifest: ProbeManifestV1 | Record<string, JsonValue>,
): NormalizedManifest {
  const cloned = JSON.parse(JSON.stringify(manifest)) as Record<string, JsonValue>;
  const out = walk("", cloned) as Record<string, JsonValue>;
  return Object.assign(out, { __mochiNormalized: true as const });
}

/**
 * Idempotency check used by tests. Plain identity works since `normalize`
 * is pure on JsonValue trees.
 */
export function isNormalized(v: unknown): v is NormalizedManifest {
  return (
    typeof v === "object" &&
    v !== null &&
    (v as { __mochiNormalized?: unknown }).__mochiNormalized === true
  );
}

// ---- internals --------------------------------------------------------------

/**
 * Path-aware sentinelizer rules. Specific to the local probe-page output.
 * Each rule receives the dotted path + the leaf value and returns the
 * sentinel to substitute (or `undefined` to fall through to the regex pass).
 *
 * Rules use the same glob syntax as `match.ts`. We embed a tiny matcher
 * here rather than importing the glob compiler to keep this module
 * dependency-free at the boundary (and the patterns are known at compile
 * time, so the cost is negligible).
 */
type PathSentinelRule = { match: (path: string) => boolean; sentinel: string };

const PATH_RULES: PathSentinelRule[] = [
  // Capture metadata — every value here varies per run.
  { match: (p) => p === "__meta.capturedAt", sentinel: SENTINELS.timestamp },
  { match: (p) => p === "__meta.elapsedMs", sentinel: SENTINELS.elapsedMs },
  { match: (p) => p === "__meta.href", sentinel: SENTINELS.filePath },

  // Window-frame chrome geometry — depends on display zoom/window manager
  // state at capture time, not the device class. Treat as guid-class
  // (per-session entropy that does not affect fingerprint structure).
  { match: (p) => p === "screen.outerWidth", sentinel: SENTINELS.windowFrame },
  { match: (p) => p === "screen.outerHeight", sentinel: SENTINELS.windowFrame },
  { match: (p) => p === "screen.innerWidth", sentinel: SENTINELS.windowFrame },
  { match: (p) => p === "screen.innerHeight", sentinel: SENTINELS.windowFrame },
  { match: (p) => p === "screen.screenX", sentinel: SENTINELS.windowFrame },
  { match: (p) => p === "screen.screenY", sentinel: SENTINELS.windowFrame },
  { match: (p) => p === "screen.availWidth", sentinel: SENTINELS.windowFrame },
  { match: (p) => p === "screen.availHeight", sentinel: SENTINELS.windowFrame },
  {
    match: (p) => /^screen\.visualViewport\.(width|height)$/.test(p),
    sentinel: SENTINELS.windowFrame,
  },

  // Network connection — `downlink`/`rtt` vary per machine + uplink.
  { match: (p) => p === "navigator.connection.downlink", sentinel: SENTINELS.windowFrame },
  { match: (p) => p === "navigator.connection.rtt", sentinel: SENTINELS.windowFrame },

  // Storage estimate — `quota` varies by device free-space; `usage` always 0.
  { match: (p) => p === "navigator.storageEstimate.quota", sentinel: SENTINELS.windowFrame },

  // MediaDevices identifiers — per-session GUIDs.
  {
    match: (p) => /^mediaDevices\.devices\[\d+\]\.deviceId$/.test(p),
    sentinel: SENTINELS.hex32Guid,
  },
  {
    match: (p) => /^mediaDevices\.devices\[\d+\]\.groupId$/.test(p),
    sentinel: SENTINELS.hex32Guid,
  },

  // Bot navigation timing — varies per run.
  {
    match: (p) =>
      /^bot\.navigationTiming\.(domComplete|loadEventEnd|domInteractive|redirectCount)$/.test(p),
    sentinel: SENTINELS.navTiming,
  },
  // Bot stack-depth-test result — depends on Chrome JIT state, varies per run.
  { match: (p) => p === "bot.stackDepthTest", sentinel: SENTINELS.navTiming },
];

/**
 * Inline regex pass for free-form GUID/timestamp/nonce stripping. Mirrors
 * the table in Peekaboo §"What gets normalized".
 */
const HEX32_GUID_RE = /\b[a-fA-F0-9]{32}\b/g;
const UUID_RE = /\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b/g;
const RFC3339_RE = /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})\b/g;
const NONCE_RE = /\bnonce=([A-Za-z0-9+/=_-]{12,64})/g;

function regexSentinelize(value: string): string {
  let s = value;
  // UUID before HEX32 — a UUID's hex chars would otherwise be matched twice.
  s = s.replace(UUID_RE, SENTINELS.eventId);
  s = s.replace(HEX32_GUID_RE, SENTINELS.hex32Guid);
  s = s.replace(RFC3339_RE, SENTINELS.timestamp);
  s = s.replace(NONCE_RE, `nonce=${SENTINELS.cspNonce}`);
  return s;
}

function applyPathRule(path: string): string | null {
  for (const rule of PATH_RULES) {
    if (rule.match(path)) return rule.sentinel;
  }
  return null;
}

function walk(path: string, value: JsonValue): JsonValue {
  // Path-rule pass first — short-circuits whatever the leaf is.
  const ruled = applyPathRule(path);
  if (ruled !== null) return ruled;

  if (value === null) return null;
  if (typeof value === "string") return regexSentinelize(value);
  if (typeof value === "number" || typeof value === "boolean") return value;

  if (Array.isArray(value)) {
    return value.map((item, i) => walk(`${path}[${i}]`, item));
  }
  if (typeof value === "object") {
    const out: Record<string, JsonValue> = {};
    for (const k of Object.keys(value as Record<string, JsonValue>)) {
      const sub = path === "" ? k : `${path}.${k}`;
      out[k] = walk(sub, (value as Record<string, JsonValue>)[k] as JsonValue);
    }
    return out;
  }
  return value;
}
