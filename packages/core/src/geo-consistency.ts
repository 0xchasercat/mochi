/**
 * Geo-consistency reconciler — cross-references the matrix's declared
 * `(timezone, locale)` against the probed exit-IP geolocation and
 * applies a `LaunchOptions.geoConsistency` policy on mismatch.
 *
 * The default policy is `"privacy-fallback"`: on mismatch (or probe
 * failure), override the matrix to `UTC` + `en-US`. The session then
 * fingerprints as a privacy-conscious user (Tor / Brave / hardened-FF
 * style), which is benign in most threat models — across thousands of
 * real users, mismatched-tz-vs-IP is the canonical bot signature; UTC
 * + en-US looks like every Tor user.
 *
 * @see PLAN.md §9 — relational consistency, IP/TZ/Locale axis
 * @see tasks/0262-ip-tz-locale-exit-consistency.md
 */

import type { MatrixV1 } from "@mochi.js/consistency";
import type { ExitGeo } from "./geo-probe";

/**
 * Reconciliation modes for `(matrix.timezone, matrix.locale)` vs exit IP.
 *
 * - `"privacy-fallback"` *(default)* — on mismatch (or probe failure),
 *   override to `UTC` + `en-US`. Fingerprints as a Tor-class user. UTC
 *   + en-US is the failure-mode-of-least-tampering: it identifies the
 *   user as privacy-aware, not as automated.
 * - `"auto-correct"` — on mismatch, override the matrix's timezone with
 *   the IP's timezone and the locale's region with the IP's country.
 *   Most "stealth" but trusts mochi's IP-derived defaults over the
 *   user's declared profile.
 * - `"strict"` — throw on mismatch. The user must change profile or
 *   change proxy.
 * - `"off"` — skip the probe entirely. Used by tests and by users with
 *   rate-limit problems.
 */
export type GeoConsistencyMode = "privacy-fallback" | "auto-correct" | "strict" | "off";

/**
 * Outcome of a reconciliation pass — exposed for diagnostics + the
 * planned `_internalReconcile` test seam. `kind === "ok"` means the
 * matrix passes through unchanged; `"override"` means we adjusted the
 * matrix per the policy; `"strict-throw"` is the strict-mode error path
 * (caller throws).
 */
export interface GeoReconcileResult {
  /** Possibly-adjusted matrix (always a fresh object when adjusted). */
  readonly matrix: MatrixV1;
  /** What happened. `"ok"` is the no-mismatch fast path. */
  readonly action: "ok" | "no-probe" | "off" | "privacy-fallback" | "auto-correct";
  /** The geo result that drove this decision (null for `"no-probe"` / `"off"`). */
  readonly geo: ExitGeo | null;
  /** Human-readable mismatch summary, when applicable. */
  readonly reason?: string;
}

/**
 * Thrown by {@link reconcileGeoConsistency} when `mode === "strict"` and
 * the probe revealed a mismatch. Signals the user MUST adjust either the
 * profile or the proxy.
 */
export class GeoMismatchError extends Error {
  readonly matrix: { timezone: string; locale: string };
  readonly geo: ExitGeo;
  readonly reason: string;
  constructor(matrix: { timezone: string; locale: string }, geo: ExitGeo, reason: string) {
    super(
      `[mochi] geoConsistency: strict — exit-IP geo (${geo.country}/${geo.timezone}, ` +
        `via ${geo.source}) does not match matrix (${matrix.locale}/${matrix.timezone}): ` +
        `${reason}. Change the profile to match the proxy egress, change the proxy, ` +
        `or pass geoConsistency: "privacy-fallback" | "auto-correct" | "off".`,
    );
    this.name = "GeoMismatchError";
    this.matrix = matrix;
    this.geo = geo;
    this.reason = reason;
  }
}

/**
 * Compute the **integer minutes offset** of an IANA timezone for a given
 * reference date. Uses `Intl.DateTimeFormat(...).formatToParts(...)` to
 * extract the "longOffset" part — the most stable cross-runtime path that
 * works for both fixed-offset zones (`UTC`, `Etc/GMT+8`) and DST-aware
 * zones (`America/New_York`).
 *
 * The brief calls this out: `America/New_York` and `America/Detroit`
 * share the same offset and are equivalent for fingerprinting; we MUST
 * compare offsets, not zone names.
 *
 * Returns `null` if the zone string isn't recognised (caller treats this
 * as "incomparable" and bails out to the per-mode policy).
 */
export function tzOffsetMinutes(zone: string, ref: Date = new Date()): number | null {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      timeZoneName: "longOffset",
    }).formatToParts(ref);
    const tzPart = parts.find((p) => p.type === "timeZoneName")?.value;
    if (tzPart === undefined) return null;
    // longOffset shape: "GMT+05:30", "GMT-08:00", "GMT" (== 0).
    if (tzPart === "GMT" || tzPart === "UTC") return 0;
    const m = /^(?:GMT|UTC)([+-])(\d{1,2})(?::?(\d{2}))?$/.exec(tzPart);
    if (m === null) return null;
    const sign = m[1] === "-" ? -1 : 1;
    const hours = Number.parseInt(m[2] ?? "0", 10);
    const mins = Number.parseInt(m[3] ?? "0", 10);
    if (!Number.isFinite(hours) || !Number.isFinite(mins)) return null;
    return sign * (hours * 60 + mins);
  } catch {
    return null;
  }
}

/**
 * Extract the alpha-2 region code from a BCP-47 locale via `Intl.Locale`.
 * `"en-US"` → `"US"`, `"de-DE"` → `"DE"`, `"en"` → `null` (no region).
 */
export function localeRegion(locale: string): string | null {
  try {
    const region = new Intl.Locale(locale).region;
    if (region === undefined || region.length === 0) return null;
    return region.toUpperCase();
  } catch {
    return null;
  }
}

/**
 * Tiny country-code → primary-locale lookup for `auto-correct` mode.
 * Covers the major proxy-egress countries; falls back to `en-<CC>` for
 * unknown codes (which is wrong for, say, Korea, but is at most a
 * lower-stealth-ceiling fallback rather than a hard fail).
 *
 * Order chosen for the most common residential-proxy egress destinations.
 */
const PRIMARY_LOCALE_BY_COUNTRY: Readonly<Record<string, string>> = {
  US: "en-US",
  GB: "en-GB",
  CA: "en-CA",
  AU: "en-AU",
  IE: "en-IE",
  NZ: "en-NZ",
  DE: "de-DE",
  AT: "de-AT",
  CH: "de-CH",
  FR: "fr-FR",
  BE: "fr-BE",
  IT: "it-IT",
  ES: "es-ES",
  MX: "es-MX",
  AR: "es-AR",
  BR: "pt-BR",
  PT: "pt-PT",
  NL: "nl-NL",
  PL: "pl-PL",
  RU: "ru-RU",
  UA: "uk-UA",
  CN: "zh-CN",
  HK: "zh-HK",
  TW: "zh-TW",
  JP: "ja-JP",
  KR: "ko-KR",
  IN: "hi-IN",
  ID: "id-ID",
  TH: "th-TH",
  VN: "vi-VN",
  TR: "tr-TR",
  IL: "he-IL",
  SA: "ar-SA",
  AE: "ar-AE",
  EG: "ar-EG",
  ZA: "en-ZA",
  SG: "en-SG",
  MY: "ms-MY",
  PH: "en-PH",
  SE: "sv-SE",
  NO: "nb-NO",
  DK: "da-DK",
  FI: "fi-FI",
  CZ: "cs-CZ",
  HU: "hu-HU",
  RO: "ro-RO",
  GR: "el-GR",
};

/** Best-effort primary locale for an ISO-3166-1 alpha-2 country code. */
function primaryLocaleFor(country: string): string {
  return PRIMARY_LOCALE_BY_COUNTRY[country.toUpperCase()] ?? `en-${country.toUpperCase()}`;
}

/**
 * Return a fresh matrix with `timezone`/`locale`/`languages` overridden.
 * Other fields (display, GPU, audio, etc.) are preserved so the rest of
 * the relational lock stays intact. The brief's I-5 invariant: `MatrixV1`
 * is the single source of truth, so we hand back the same shape with
 * just the geo-axis fields swapped.
 *
 * Note: `wreqPreset` and `userAgent` are NOT touched — those carry
 * OS/browser semantics, not geo. The reconciler is purely a geo-axis
 * adjustment.
 */
function withGeoOverride(
  matrix: MatrixV1,
  overrides: { timezone: string; locale: string; languages: readonly [string, ...string[]] },
): MatrixV1 {
  const [head, ...tail] = overrides.languages;
  return {
    ...matrix,
    timezone: overrides.timezone,
    locale: overrides.locale,
    languages: [head, ...tail],
  };
}

/**
 * Reconcile the matrix against the probed exit-IP geo per the supplied
 * `mode`. Pure: never mutates the input matrix; returns a fresh object on
 * any override path.
 *
 * **Mismatch criteria**:
 *   - **Timezone**: matrix offset minutes ≠ IP offset minutes (computed
 *     via `Intl.DateTimeFormat(timeZoneName: "longOffset")`). Zone-name
 *     equivalence (e.g. `America/New_York` vs `America/Detroit`) is
 *     intentional — they share an offset and fingerprint identically.
 *   - **Locale**: `Intl.Locale(matrix.locale).region` ≠ IP country code.
 *     A locale with no region (`"en"`) is treated as matching any
 *     country (we can't disprove it).
 *
 * **Per-mode behaviour** (matrix passes through unchanged unless
 * mismatch is detected):
 *
 * | Mode | probe = null | tz mismatch | locale mismatch | both match |
 * |---|---|---|---|---|
 * | `privacy-fallback` | UTC+en-US | UTC+en-US | UTC+en-US | passthrough |
 * | `auto-correct` | passthrough (best effort) | IP tz | IP locale | passthrough |
 * | `strict` | passthrough (no probe → no mismatch) | THROW | THROW | passthrough |
 * | `off` | passthrough | n/a (no probe) | n/a | passthrough |
 *
 * The `strict` × `probe = null` case intentionally passes the matrix
 * through. A null probe means "we couldn't talk to any geo endpoint" —
 * which is most often a network blip, not a mismatch. Strict-mode users
 * who want to fail closed on probe failure should pair this with
 * external monitoring.
 *
 * @throws {GeoMismatchError} when `mode === "strict"` and a real
 *   mismatch was detected.
 */
export function reconcileGeoConsistency(
  matrix: MatrixV1,
  geo: ExitGeo | null,
  mode: GeoConsistencyMode,
): GeoReconcileResult {
  if (mode === "off") {
    return { matrix, action: "off", geo: null };
  }
  if (geo === null) {
    if (mode === "privacy-fallback") {
      return {
        matrix: withGeoOverride(matrix, {
          timezone: "UTC",
          locale: "en-US",
          languages: ["en-US", "en"],
        }),
        action: "privacy-fallback",
        geo: null,
        reason: "probe returned null (all endpoints failed); falling back to UTC+en-US",
      };
    }
    // auto-correct + strict: nothing to act on. Pass through.
    return { matrix, action: "no-probe", geo: null };
  }
  // We have a probe result. Compute offset-based mismatch.
  const matrixOffset = tzOffsetMinutes(matrix.timezone);
  const ipOffset = tzOffsetMinutes(geo.timezone);
  const tzMismatch =
    matrixOffset !== null && ipOffset !== null && matrixOffset !== ipOffset
      ? `tz offset ${matrixOffset}min (matrix ${matrix.timezone}) ≠ ${ipOffset}min (IP ${geo.timezone})`
      : null;

  const matrixRegion = localeRegion(matrix.locale);
  // matrixRegion === null => locale has no region (e.g. "en"); treat as
  // permissive match to avoid spurious mismatches.
  const localeMismatch =
    matrixRegion !== null && matrixRegion !== geo.country
      ? `locale region ${matrixRegion} (matrix ${matrix.locale}) ≠ IP country ${geo.country}`
      : null;

  if (tzMismatch === null && localeMismatch === null) {
    return { matrix, action: "ok", geo };
  }

  const reason = [tzMismatch, localeMismatch].filter((x): x is string => x !== null).join("; ");

  if (mode === "strict") {
    throw new GeoMismatchError({ timezone: matrix.timezone, locale: matrix.locale }, geo, reason);
  }
  if (mode === "auto-correct") {
    const newLocale = primaryLocaleFor(geo.country);
    return {
      matrix: withGeoOverride(matrix, {
        timezone: geo.timezone,
        locale: newLocale,
        // languages list: primary locale + its language root (e.g. "de-DE",
        // "de"). Keeps the language root present which sites read for
        // fallback negotiation.
        languages: deriveLanguagesFor(newLocale),
      }),
      action: "auto-correct",
      geo,
      reason,
    };
  }
  // privacy-fallback
  return {
    matrix: withGeoOverride(matrix, {
      timezone: "UTC",
      locale: "en-US",
      languages: ["en-US", "en"],
    }),
    action: "privacy-fallback",
    geo,
    reason,
  };
}

/**
 * Derive the `navigator.languages` list for an `auto-correct` override.
 * Convention: `[primary, primary-language-only, "en"]`, deduped. The "en"
 * tail mirrors what real Chrome instances ship for non-English locales —
 * most users have English as a secondary because Chrome itself defaults
 * the menu language to English on first install in many regions.
 */
function deriveLanguagesFor(locale: string): readonly [string, ...string[]] {
  const out: [string, ...string[]] = [locale];
  const dash = locale.indexOf("-");
  if (dash > 0) {
    const root = locale.slice(0, dash);
    if (!out.includes(root)) out.push(root);
  }
  if (!out.includes("en")) out.push("en");
  return out;
}
