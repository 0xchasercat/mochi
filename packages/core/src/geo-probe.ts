/**
 * Exit-IP geo-probe — closes the cross-layer leak where
 * `(matrix.timezone, matrix.locale)` and the apparent **exit IP** disagree.
 *
 * A fingerprinter computing `Date.getTimezoneOffset()` and cross-referencing
 * against the IP's geolocation sees a mismatch when, e.g., the user runs a
 * US-West profile through an EU-egressing residential proxy. mochi takes
 * matrix values as canonical regardless of proxy egress; this module is the
 * first half of the fix (the second half is {@link reconcileGeoConsistency}
 * in `launch.ts`).
 *
 * The probe issues a single GET through the same `wreq` preset the session
 * would use for user traffic, so the geolocation service sees the **same
 * JA4 / headers** as the actual page — the probe doesn't itself become
 * detectable. The probe respects the `proxy` option; if unset, the probe
 * goes direct (which is fine — the user's exit IP is the host's IP).
 *
 * ### Endpoint registry (verified working 2026-05-09)
 *
 * | Endpoint | Schema | Notes |
 * |---|---|---|
 * | `https://ip.decodo.com/json` | `{proxy, country, city}` | rich shape |
 * | `https://ipinfo.io/json` | `{country, timezone, loc}` | flat |
 * | `https://ipwho.is/` | `{country_code, timezone.id}` | rich |
 * | `https://api.ip.sb/geoip` | `{country_code, timezone}` | secondary |
 * | `https://ifconfig.co/json` | `{country_iso, time_zone}` | secondary |
 * | `https://api.iplocation.net/` | country-only | last resort |
 * | `https://ipapi.co/json/` | rate-limited | KEEP — expect failures |
 *
 * ### Strategy
 *
 * Shuffled-sequential. 2s per-endpoint timeout, 4-attempt cap. All 4 fail
 * → return `null` and let the caller fall through to its `geoConsistency`
 * mode (default `privacy-fallback`).
 *
 * **No cross-session caching** — proxy IPs rotate; stale cache is worse
 * than no cache. (`docs/limits.md` —)
 *
 * @see PLAN.md §9 (relational consistency — IP/TZ/Locale axis)
 */

import type { MatrixV1 } from "@mochi.js/consistency";
import { fetch as netFetch } from "@mochi.js/net";

/**
 * Normalised geolocation derived from one of the probe endpoints. The
 * probe layer never reads the proxy's raw response shape — every adapter
 * normalises into this single record.
 *
 * `country` is required (it's the load-bearing field — locale-region
 * compares against it). All other location fields are best-effort; an
 * adapter MUST return `null` if it can't resolve at least
 * `{ip, country, timezone}`.
 */
export interface ExitGeo {
  /** The egressing IP as observed by the geolocation service. */
  readonly ip: string;
  /** ISO-3166-1 alpha-2 country code, e.g. `"TH"`. Uppercase. */
  readonly country: string;
  /** Best-effort administrative region (state/province). */
  readonly region?: string;
  /** Best-effort city name. */
  readonly city?: string;
  /** IANA timezone identifier, e.g. `"Asia/Bangkok"`. */
  readonly timezone: string;
  /** Postal / ZIP code, when available. */
  readonly postalCode?: string;
  /** Latitude (decimal degrees). */
  readonly lat?: number;
  /** Longitude (decimal degrees). */
  readonly lng?: number;
  /** Which endpoint answered — for diagnostics + the `_internalProbe` log. */
  readonly source: string;
}

/** Per-endpoint adapter: a URL + a parser that returns `null` on schema mismatch. */
interface Adapter {
  readonly url: string;
  readonly parse: (json: unknown) => ExitGeo | null;
}

/**
 * Coerce an arbitrary JSON value to a non-empty string, or undefined.
 * Adapters use this to be defensive against schema drift.
 */
function s(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t.length === 0 ? undefined : t;
}

/** Coerce to a finite number, or undefined. */
function n(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const f = Number.parseFloat(v);
    return Number.isFinite(f) ? f : undefined;
  }
  return undefined;
}

/**
 * Build an `ExitGeo` from the per-adapter scratch fields, validating the
 * minimum required set (`ip`, `country`, `timezone`). Returns `null` if any
 * are missing — this is the schema-mismatch signal that drives the caller
 * to the next endpoint.
 */
function build(
  scratch: {
    ip?: string;
    country?: string;
    region?: string;
    city?: string;
    timezone?: string;
    postalCode?: string;
    lat?: number;
    lng?: number;
  },
  source: string,
): ExitGeo | null {
  const ip = scratch.ip;
  const country = scratch.country;
  const timezone = scratch.timezone;
  if (ip === undefined || country === undefined || timezone === undefined) return null;
  const out: {
    ip: string;
    country: string;
    region?: string;
    city?: string;
    timezone: string;
    postalCode?: string;
    lat?: number;
    lng?: number;
    source: string;
  } = { ip, country: country.toUpperCase(), timezone, source };
  if (scratch.region !== undefined) out.region = scratch.region;
  if (scratch.city !== undefined) out.city = scratch.city;
  if (scratch.postalCode !== undefined) out.postalCode = scratch.postalCode;
  if (scratch.lat !== undefined) out.lat = scratch.lat;
  if (scratch.lng !== undefined) out.lng = scratch.lng;
  return out;
}

/**
 * The endpoint registry. Per-adapter `parse` MUST return `null` on schema
 * mismatch, never throw — schemas drift over time and the caller falls
 * through to the next endpoint.
 *
 * Order at definition time is irrelevant; the probe shuffles per-call.
 */
export const ADAPTERS: readonly Adapter[] = [
  {
    url: "https://ip.decodo.com/json",
    parse(json) {
      const j = json as {
        proxy?: { ip?: unknown };
        country?: { code?: unknown };
        city?: {
          name?: unknown;
          state?: unknown;
          time_zone?: unknown;
          zip_code?: unknown;
          latitude?: unknown;
          longitude?: unknown;
        };
      };
      return build(
        {
          ...(s(j.proxy?.ip) !== undefined ? { ip: s(j.proxy?.ip) } : {}),
          ...(s(j.country?.code) !== undefined ? { country: s(j.country?.code) } : {}),
          ...(s(j.city?.name) !== undefined ? { city: s(j.city?.name) } : {}),
          ...(s(j.city?.state) !== undefined ? { region: s(j.city?.state) } : {}),
          ...(s(j.city?.time_zone) !== undefined ? { timezone: s(j.city?.time_zone) } : {}),
          ...(s(j.city?.zip_code) !== undefined ? { postalCode: s(j.city?.zip_code) } : {}),
          ...(n(j.city?.latitude) !== undefined ? { lat: n(j.city?.latitude) } : {}),
          ...(n(j.city?.longitude) !== undefined ? { lng: n(j.city?.longitude) } : {}),
        },
        "decodo",
      );
    },
  },
  {
    url: "https://ipinfo.io/json",
    parse(json) {
      const j = json as {
        ip?: unknown;
        country?: unknown;
        city?: unknown;
        region?: unknown;
        timezone?: unknown;
        postal?: unknown;
        loc?: unknown;
      };
      const scratch: {
        ip?: string;
        country?: string;
        region?: string;
        city?: string;
        timezone?: string;
        postalCode?: string;
        lat?: number;
        lng?: number;
      } = {};
      const ip = s(j.ip);
      const country = s(j.country);
      const tz = s(j.timezone);
      const region = s(j.region);
      const city = s(j.city);
      const postal = s(j.postal);
      if (ip !== undefined) scratch.ip = ip;
      if (country !== undefined) scratch.country = country;
      if (tz !== undefined) scratch.timezone = tz;
      if (region !== undefined) scratch.region = region;
      if (city !== undefined) scratch.city = city;
      if (postal !== undefined) scratch.postalCode = postal;
      const loc = s(j.loc);
      if (loc !== undefined) {
        const parts = loc.split(",");
        if (parts.length === 2) {
          const lat = n(parts[0]);
          const lng = n(parts[1]);
          if (lat !== undefined) scratch.lat = lat;
          if (lng !== undefined) scratch.lng = lng;
        }
      }
      return build(scratch, "ipinfo");
    },
  },
  {
    url: "https://ipwho.is/",
    parse(json) {
      const j = json as {
        success?: unknown;
        ip?: unknown;
        country_code?: unknown;
        city?: unknown;
        region?: unknown;
        timezone?: { id?: unknown };
        postal?: unknown;
        latitude?: unknown;
        longitude?: unknown;
      };
      // ipwho.is signals "couldn't locate" via {success: false}; treat as
      // schema mismatch so we fall through.
      if (j.success === false) return null;
      const scratch: {
        ip?: string;
        country?: string;
        region?: string;
        city?: string;
        timezone?: string;
        postalCode?: string;
        lat?: number;
        lng?: number;
      } = {};
      const ip = s(j.ip);
      const country = s(j.country_code);
      const region = s(j.region);
      const city = s(j.city);
      const tz = s(j.timezone?.id);
      const postal = s(j.postal);
      const lat = n(j.latitude);
      const lng = n(j.longitude);
      if (ip !== undefined) scratch.ip = ip;
      if (country !== undefined) scratch.country = country;
      if (tz !== undefined) scratch.timezone = tz;
      if (region !== undefined) scratch.region = region;
      if (city !== undefined) scratch.city = city;
      if (postal !== undefined) scratch.postalCode = postal;
      if (lat !== undefined) scratch.lat = lat;
      if (lng !== undefined) scratch.lng = lng;
      return build(scratch, "ipwhois");
    },
  },
  {
    url: "https://api.ip.sb/geoip",
    parse(json) {
      const j = json as {
        ip?: unknown;
        country_code?: unknown;
        country?: unknown;
        city?: unknown;
        region?: unknown;
        timezone?: unknown;
        latitude?: unknown;
        longitude?: unknown;
      };
      const scratch: {
        ip?: string;
        country?: string;
        region?: string;
        city?: string;
        timezone?: string;
        lat?: number;
        lng?: number;
      } = {};
      const ip = s(j.ip);
      // ip.sb uses `country_code`, not `country` (which is the full name).
      const country = s(j.country_code);
      const region = s(j.region);
      const city = s(j.city);
      const tz = s(j.timezone);
      const lat = n(j.latitude);
      const lng = n(j.longitude);
      if (ip !== undefined) scratch.ip = ip;
      if (country !== undefined) scratch.country = country;
      if (tz !== undefined) scratch.timezone = tz;
      if (region !== undefined) scratch.region = region;
      if (city !== undefined) scratch.city = city;
      if (lat !== undefined) scratch.lat = lat;
      if (lng !== undefined) scratch.lng = lng;
      return build(scratch, "ipsb");
    },
  },
  {
    url: "https://ifconfig.co/json",
    parse(json) {
      const j = json as {
        ip?: unknown;
        country_iso?: unknown;
        country?: unknown;
        city?: unknown;
        region_name?: unknown;
        time_zone?: unknown;
        zip_code?: unknown;
        latitude?: unknown;
        longitude?: unknown;
      };
      const scratch: {
        ip?: string;
        country?: string;
        region?: string;
        city?: string;
        timezone?: string;
        postalCode?: string;
        lat?: number;
        lng?: number;
      } = {};
      const ip = s(j.ip);
      // ifconfig.co exposes the alpha-2 as `country_iso`.
      const country = s(j.country_iso);
      const region = s(j.region_name);
      const city = s(j.city);
      const tz = s(j.time_zone);
      const postal = s(j.zip_code);
      const lat = n(j.latitude);
      const lng = n(j.longitude);
      if (ip !== undefined) scratch.ip = ip;
      if (country !== undefined) scratch.country = country;
      if (tz !== undefined) scratch.timezone = tz;
      if (region !== undefined) scratch.region = region;
      if (city !== undefined) scratch.city = city;
      if (postal !== undefined) scratch.postalCode = postal;
      if (lat !== undefined) scratch.lat = lat;
      if (lng !== undefined) scratch.lng = lng;
      return build(scratch, "ifconfig");
    },
  },
  {
    url: "https://api.iplocation.net/",
    parse(json) {
      // api.iplocation.net is country-only — no timezone — so it cannot
      // satisfy build()'s minimum set. We keep it in the registry as a
      // last-resort sanity check (the brief calls it out explicitly): the
      // adapter ALWAYS returns `null`, which forces the caller to the next
      // endpoint while still counting toward the 4-attempt cap. If a future
      // schema gains a timezone field, lift it here.
      void json;
      return null;
    },
  },
  {
    url: "https://ipapi.co/json/",
    parse(json) {
      const j = json as {
        ip?: unknown;
        country_code?: unknown;
        country?: unknown;
        city?: unknown;
        region?: unknown;
        timezone?: unknown;
        postal?: unknown;
        latitude?: unknown;
        longitude?: unknown;
        error?: unknown;
        reason?: unknown;
      };
      // ipapi.co's rate-limit response is `{error: true, reason: "RateLimited"}`.
      if (j.error === true) return null;
      const scratch: {
        ip?: string;
        country?: string;
        region?: string;
        city?: string;
        timezone?: string;
        postalCode?: string;
        lat?: number;
        lng?: number;
      } = {};
      const ip = s(j.ip);
      const country = s(j.country_code) ?? s(j.country);
      const region = s(j.region);
      const city = s(j.city);
      const tz = s(j.timezone);
      const postal = s(j.postal);
      const lat = n(j.latitude);
      const lng = n(j.longitude);
      if (ip !== undefined) scratch.ip = ip;
      if (country !== undefined) scratch.country = country;
      if (tz !== undefined) scratch.timezone = tz;
      if (region !== undefined) scratch.region = region;
      if (city !== undefined) scratch.city = city;
      if (postal !== undefined) scratch.postalCode = postal;
      if (lat !== undefined) scratch.lat = lat;
      if (lng !== undefined) scratch.lng = lng;
      return build(scratch, "ipapi");
    },
  },
];

/**
 * Total attempt cap across the (shuffled) registry. 4 × 2s = 8s wall-time
 * worst case. Tunable in tests via {@link ProbeOptions.maxAttempts}.
 */
const DEFAULT_MAX_ATTEMPTS = 4;
/** Per-endpoint timeout (ms). */
const DEFAULT_PER_ENDPOINT_TIMEOUT_MS = 2000;

/**
 * Injection seam for the underlying HTTP transport. Production uses
 * `@mochi.js/net`'s `fetch` (so the probe carries the same JA4/headers as
 * user traffic). Tests inject a stub.
 *
 * @internal
 */
export type ProbeFetch = (
  url: string,
  init: { preset: string; proxy?: string; timeoutMs: number },
) => Promise<Response>;

/** Options for {@link probeExitGeo}. */
export interface ProbeOptions {
  /** Optional outbound proxy URL — `user:pass@host:port` form is fine. */
  readonly proxy?: string;
  /** The matrix whose `wreqPreset` drives the TLS fingerprint of the probe. */
  readonly matrix: Pick<MatrixV1, "wreqPreset">;
  /**
   * Override the default 4-attempt cap. Tests use 2 to keep wall-time low;
   * production sticks with 4.
   */
  readonly maxAttempts?: number;
  /** Override the per-endpoint timeout. Tests use 50ms. */
  readonly perEndpointTimeoutMs?: number;
  /**
   * Inject a custom `fetch` transport (for tests). Defaults to
   * `@mochi.js/net`'s `fetch` so the probe shares the session's TLS preset.
   * @internal
   */
  readonly fetch?: ProbeFetch;
  /**
   * Deterministic shuffle hook — tests pass an identity function to keep
   * the registry order stable. Defaults to a Fisher-Yates with `Math.random`.
   * @internal
   */
  readonly shuffle?: (xs: readonly Adapter[]) => readonly Adapter[];
}

/**
 * Default `ProbeFetch` — issues the request through `@mochi.js/net`'s
 * one-shot `fetch` so the geo service sees the same JA4 as user traffic.
 *
 * The per-call timeout is mapped onto the wreq `timeoutMs` field; we do
 * NOT also wrap with `AbortController` because Bun's `Response` from the
 * FFI path is synchronous and we want the wreq layer to own the timeout
 * (a layered `AbortController` would race with the Rust handle drop).
 */
const defaultFetch: ProbeFetch = (url, init) => {
  return Promise.resolve(
    netFetch(url, {
      preset: init.preset,
      ...(init.proxy !== undefined ? { proxy: init.proxy } : {}),
      method: "GET",
      headers: { Accept: "application/json" },
      timeoutMs: init.timeoutMs,
      // Connect timeout matches the per-endpoint cap — a stuck SYN is the
      // dominant failure mode against rate-limited endpoints.
      connectTimeoutMs: init.timeoutMs,
    }),
  );
};

/** Fisher-Yates shuffle — non-deterministic, Math.random-backed. */
function defaultShuffle<T>(xs: readonly T[]): readonly T[] {
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = out[i] as T;
    out[i] = out[j] as T;
    out[j] = tmp;
  }
  return out;
}

/**
 * Race a promise against a timeout. Resolves with `null` on timeout (we
 * use `null` as the universal "give up, try next" signal).
 */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    let settled = false;
    const t = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(null);
    }, ms);
    p.then(
      (v) => {
        if (settled) return;
        settled = true;
        clearTimeout(t);
        resolve(v);
      },
      () => {
        if (settled) return;
        settled = true;
        clearTimeout(t);
        resolve(null);
      },
    );
  });
}

/**
 * Probe the exit IP for geolocation. Issues a single GET (through the
 * session's wreq preset, optionally via proxy) against a shuffled registry
 * of geo endpoints, returning the first valid response normalised to
 * {@link ExitGeo}. Returns `null` when all attempts (up to 4 by default)
 * fail.
 *
 * Network errors, non-2xx responses, parse errors, and adapter "schema
 * mismatch" `null`s all count toward the attempt cap and trigger fall-
 * through to the next endpoint. The function NEVER throws — callers
 * branch on `null`.
 *
 * @example
 * const geo = await probeExitGeo({ proxy: "http://eu-residential:..." , matrix });
 * if (geo === null) {
 *   // → privacy-fallback per LaunchOptions.geoConsistency
 * } else {
 *   // → check geo.country / geo.timezone vs matrix
 * }
 */
export async function probeExitGeo(opts: ProbeOptions): Promise<ExitGeo | null> {
  const maxAttempts = opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const perEndpointTimeoutMs = opts.perEndpointTimeoutMs ?? DEFAULT_PER_ENDPOINT_TIMEOUT_MS;
  const fetchFn = opts.fetch ?? defaultFetch;
  const shuffle = opts.shuffle ?? defaultShuffle;
  const order = shuffle(ADAPTERS);
  const cap = Math.min(maxAttempts, order.length);
  for (let i = 0; i < cap; i += 1) {
    const adapter = order[i];
    if (adapter === undefined) continue;
    // Wrap the fetch call in a fresh Promise so synchronous throws (e.g.
    // `dlopen` failure when the cdylib isn't built — common in test envs
    // and on first install before `bun run rust:build`) become rejections
    // and route through `withTimeout`'s null path, NOT through the
    // probeExitGeo throw seam. The brief: probe NEVER throws.
    const respOrNull = await withTimeout(
      new Promise<Response>((resolve, reject) => {
        try {
          fetchFn(adapter.url, {
            preset: opts.matrix.wreqPreset,
            ...(opts.proxy !== undefined ? { proxy: opts.proxy } : {}),
            timeoutMs: perEndpointTimeoutMs,
          }).then(resolve, reject);
        } catch (err) {
          reject(err instanceof Error ? err : new Error(String(err)));
        }
      }),
      perEndpointTimeoutMs,
    );
    if (respOrNull === null) continue;
    if (!respOrNull.ok) continue;
    let json: unknown;
    try {
      json = await respOrNull.json();
    } catch {
      continue;
    }
    let parsed: ExitGeo | null;
    try {
      parsed = adapter.parse(json);
    } catch {
      // Adapters MUST return null on schema mismatch, but we belt-and-
      // suspender against future bugs.
      continue;
    }
    if (parsed === null) continue;
    return parsed;
  }
  return null;
}
