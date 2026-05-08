---
"@mochi.js/core": minor
---

Add exit-IP / timezone / locale consistency probe + reconciler with
privacy-fallback default (task 0262).

Closes the cross-layer leak where `(matrix.timezone, matrix.locale)` and
the apparent **exit IP** disagree — a fingerprinter computing
`Date.getTimezoneOffset()` and cross-referencing against the IP's
geolocation sees a mismatch any time the matrix doesn't match the proxy
egress (US-West profile + EU residential proxy → -480min vs UTC+1, the
canonical bot signature).

At launch, `@mochi.js/core` now probes the apparent exit IP through wreq
(using the matrix's TLS preset, so the geo service sees the same JA4 /
headers as user traffic). 7-endpoint registry (`ip.decodo.com/json`,
`ipinfo.io/json`, `ipwho.is/`, `api.ip.sb/geoip`, `ifconfig.co/json`,
`api.iplocation.net/`, `ipapi.co/json/`), shuffled-sequential, 2s per
endpoint, 4-attempt cap. Per-endpoint adapter normalises to a shared
`ExitGeo` shape; schema mismatch returns `null` (no throw).

The reconciler cross-references the probed geo against the matrix's
`(timezone, locale)` and applies one of four
`LaunchOptions.geoConsistency` modes:
- `"privacy-fallback"` *(default)* — override matrix to `UTC` + `en-US`
  on mismatch (or probe failure). Fingerprints as a Tor / hardened-FF
  user. Benign in most threat models.
- `"auto-correct"` — override matrix tz/locale with IP-derived values.
- `"strict"` — throw `GeoMismatchError` on mismatch.
- `"off"` — skip the probe entirely (offline tests).

Mismatch criteria use timezone OFFSET minutes (via
`Intl.DateTimeFormat({timeZoneName: "longOffset"})`), not zone names —
`America/New_York` and `America/Detroit` share an offset and fingerprint
identically. Locale region comes from `Intl.Locale(matrix.locale).region`.

JS-side timezone spoof delivered per-target via CDP
`Emulation.setTimezoneOverride` — drives both
`Intl.DateTimeFormat().resolvedOptions().timeZone` AND
`Date.getTimezoneOffset()` because Chromium's V8 reads from the same
internal source. Single CDP send, no `Network.enable` / `Emulation.enable`
required (so PLAN.md §8.2 invariants are unaffected).

Probe results are NOT cached across sessions — proxy IPs rotate; stale
cache is worse than no cache.

PLAN.md §9 amended with the new `9.6` subsection (cross-layer IP/TZ/Locale
consistency). `docs/content/docs/reference/limits.md` documents the
probe rate-limit handling, the privacy-fallback default rationale, and
the Tor-exit edge case.
