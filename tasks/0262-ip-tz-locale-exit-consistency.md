# 0262: exit-IP / timezone / locale consistency with privacy-fallback

**Package:** `core` + `net` (probe via wreq) + `consistency` (timezone rule additions)
**Phase:** `0.2`
**Estimated size:** M
**Dependencies:** 0251 (`--lang` flag), 0261 (UA-CH metadata) ideally landed first

## Goal

Close the cross-layer leak where `(profile.timezone, profile.locale)` and the apparent **exit IP** disagree — a fingerprinter computing `Date.getTimezoneOffset()` and cross-referencing against the IP's geolocation sees a mismatch. Today mochi takes matrix values as canonical regardless of proxy egress; with a residential proxy in country B and a US-West profile, every page call to `Intl.DateTimeFormat().resolvedOptions().timeZone` is a clean tell.

The fix is layered:

1. **Probe the exit IP at launch** through the configured proxy (using wreq, so the probe carries the same TLS / headers as user traffic) and derive the IP's geolocation.
2. **Cross-reference with the matrix**. On mismatch, behave per `LaunchOptions.geoConsistency`:
   - `"privacy-fallback"` *(default)* — override `matrix.timezone = "UTC"` and `matrix.locale = "en-US"` + log a warning. The session now fingerprints as a privacy-conscious user (Tor / Brave / hardened-Firefox-style), which is benign in most threat models.
   - `"auto-correct"` — override matrix values with IP-derived ones (best-fit timezone for the IP's lat/long, primary locale for the country). Most "stealth" but assumes the user is OK with overriding their declared profile.
   - `"strict"` — throw a hard error and require the user to either pick a matching profile or change proxy.
   - `"off"` — skip the probe entirely (fallback mode, useful when the probe service is rate-limited or for tests).

The default is `"privacy-fallback"` because UTC+en-US is the failure-mode-of-least-tampering: it identifies the user as privacy-aware, NOT as automated. Across thousands of real users, mismatched-tz-vs-IP is the canonical bot signature; UTC+en-US looks like every Tor user.

## Success criteria

### Probe service

- [ ] New `packages/core/src/geo-probe.ts` (or `packages/net/src/geo-probe.ts` — pick the layer that has cleanest access to wreq + matrix). Single function `probeExitGeo(opts: { proxy?: string; matrix: MatrixV1 }): Promise<ExitGeo | null>`.
- [ ] Probe target: a small set of known-stable, free-tier geolocation endpoints. Prefer `https://ipinfo.io/json` or `https://ipapi.co/json/` (both have generous free tiers, no auth required for low volume). Document why each was chosen; rotate to fall back if one is rate-limited.
- [ ] Probe makes the request through the **same** wreq preset the session would use for user traffic (so the geolocation service sees the same JA4 / headers as the actual page). This ensures the probe doesn't itself become detectable.
- [ ] `ExitGeo` shape: `{ ip, country, region, city, timezone, postalCode, lat, lng }`.
- [ ] **Probe failure** (network error, rate limit, malformed response): return `null`. Caller then decides per `geoConsistency`.

### Cross-reference + override

- [ ] In `packages/core/src/launch.ts`, AFTER `deriveMatrix` and BEFORE `spawnChromium`:
  ```ts
  const matrix = deriveMatrix(profile, opts.seed);
  const geo = await probeExitGeo({ proxy: normalizedProxy, matrix });
  const adjusted = reconcileGeoConsistency(matrix, geo, opts.geoConsistency ?? "privacy-fallback");
  ```
  `reconcileGeoConsistency` returns either the original matrix, a UTC+en-US-adjusted matrix, or the IP-derived-overridden matrix; throws on `"strict"` mismatch.
- [ ] **Mismatch criteria**:
  - Timezone mismatch = matrix timezone offset ≠ IP timezone offset (compare offsets, not zone names — `America/New_York` and `America/Detroit` share the same offset and are equivalent for fingerprinting).
  - Locale mismatch = matrix locale's primary country ≠ IP country (e.g. `en-US` matrix + `DE` IP → mismatch; `en-US` matrix + `US` IP → match).
- [ ] Override application: the adjusted matrix flows into `spawnChromium` (so `--lang` reflects it) AND into the inject layer (so `navigator.language(s)`, `Intl.DateTimeFormat().resolvedOptions().timeZone`, and `Date.getTimezoneOffset()` all reflect it).
- [ ] CDP `Emulation.setTimezoneOverride` is the canonical mechanism for the JS-side `Intl.DateTimeFormat`. Verify v0.1.x already uses it; if not, add. Inject must NOT manually rewrite `Date.prototype.getTimezoneOffset` — that's detectable via prototype-shape checks. Use the CDP override.

### Inject coverage check

- [ ] Verify the inject pipeline already spoofs `Intl.DateTimeFormat().resolvedOptions().timeZone` (probably via `Emulation.setTimezoneOverride` from session.ts). If it doesn't, add it as part of this brief — the override is a single CDP send at session start.
- [ ] Verify `Date.getTimezoneOffset()` returns the matrix value. Should follow automatically from `Emulation.setTimezoneOverride` because Chromium's V8 uses the same internal timezone source. Add a contract test pinning this.

### `LaunchOptions.geoConsistency`

- [ ] New field on `LaunchOptions`:
  ```ts
  geoConsistency?: "privacy-fallback" | "auto-correct" | "strict" | "off";
  ```
  Default: `"privacy-fallback"`.
- [ ] Each mode behaves per the goal section. Document each clearly in JSDoc.

### Tests

- [ ] Unit test for `reconcileGeoConsistency` covering all 4 modes × match / mismatch / probe-null cases.
- [ ] Unit test for `probeExitGeo` against a mocked wreq response (don't hit ipinfo.io in unit tests).
- [ ] Cross-package contract test: `Session` with mocked CDP captures `Emulation.setTimezoneOverride` params, asserts they match the post-reconciliation matrix.
- [ ] Live conformance test (gated `MOCHI_E2E=1 + MOCHI_ONLINE=1`): launch through the configured proxy, navigate to a Bun.serve fixture that captures the request IP + runs `Intl.DateTimeFormat().resolvedOptions().timeZone` in page JS. Assert: timezone offset agrees with IP geolocation OR is UTC (privacy-fallback path triggered). Either result is acceptable; the unconditional fail is "matrix-PT timezone, EU IP".

### Other

- [ ] `docs/limits.md` v0.2 entry naming: probe rate-limit handling, the choice of `privacy-fallback` as default, the case where Tor exit nodes themselves geolocate to wrong countries (probe through Tor → fallback to UTC+en-US is correct behavior).
- [ ] PLAN.md amendment in §9 (relational consistency) noting the IP/TZ/Locale axis as a cross-layer concern.
- [ ] Changeset: minor on `@mochi.js/core` (new LaunchOptions field), patch on `@mochi.js/net` (probe).
- [ ] **DON'T cache probe results across sessions** — proxy IPs rotate, the cache becomes stale, and a stale cache is worse than no cache.

## Out of scope

- Per-request geolocation cross-checks during the session — out of scope. One probe at launch is enough; if the proxy rotates mid-session and you care, restart.
- Country-blocking (e.g. block sessions where IP is in a country sanctions list) — different concern, document but defer.
- Geolocation API spoofing (`navigator.geolocation.getCurrentPosition`) — already covered by the existing geolocation rule (verify R-number); ties into this brief because the spoofed lat/lng must match the IP. Update that rule's derivation to consume the post-reconciliation matrix.
- Battery-API timezone-leak (some mobile profiles leak timezone via `Battery API` charging-rate behavior) — niche, document, defer.

## Implementation notes

- See PLAN.md §9 (relational consistency).
- `wreq` already supports proxy egress; the geo-probe just makes a single GET through the same `wreqPreset` the session uses. No new dep.
- For the timezone-offset compare: convert both to absolute offset minutes via `Intl.DateTimeFormat(...).formatToParts(new Date())`. Compare integer offsets. Don't compare zone names — too many equivalences.
- For the country-from-locale parse: `new Intl.Locale(matrix.locale).region` gives `"US"` for `"en-US"`. Compare to IP country code.
- The `auto-correct` mode is the "trust mochi's IP-derived defaults over your declared profile" mode. Power users who want it explicit can pass it; default users get `privacy-fallback`.

## Validation

```sh
bun run typecheck && bun run lint && bun run test && bun run test:contract
# Live: MOCHI_PROXY=<your-proxy> MOCHI_E2E=1 MOCHI_ONLINE=1 \
#   bun test packages/harness/src/conformance/stealth/__tests__/geo-consistency.test.ts
# Manual: launch with a US profile + EU proxy + privacy-fallback → verify
# Intl.DateTimeFormat().resolvedOptions().timeZone === "UTC" and warning logged.
```

## Submission

```sh
bun work create 0262 core
cd worktrees/0262
# implement
bun work submit 0262 --draft
```
