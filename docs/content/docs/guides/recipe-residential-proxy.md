---
title: "Recipe: Residential proxy with geo reconciliation"
description: HTTP / SOCKS5 proxy auth via inline URL or ProxyConfig, plus geoConsistency to close the IP-vs-timezone leak.
order: 23
category: guides
lastUpdated: 2026-05-09
---

## Scenario

You bought residential proxies. Your script picks `mac-m4-chrome-stable` (US profile, `America/Los_Angeles`, `en-US`) and fires it through a London exit IP. The site fingerprints you and bounces because: the IP geolocates to UTC+0, but `Intl.DateTimeFormat().resolvedOptions().timeZone` reports `America/Los_Angeles`, and `navigator.language` is `en-US`. Real users don't have that combination. That's the canonical bot signature — every commercial fingerprinting vendor checks for it.

mochi handles two things here. First, proxy authentication: HTTP basic, HTTPS, SOCKS5 and SOCKS4 user/pass, all answered through CDP `Fetch.authRequired` — no extension, no `Runtime.enable`. Second, geo reconciliation: `LaunchOptions.geoConsistency` probes the proxy's exit IP and either falls back to a benign privacy posture (UTC + en-US, the Tor / Brave shape), auto-corrects the matrix to the IP's timezone, or throws — your choice.

## Complete code listing

```ts
import { mochi, GeoMismatchError } from "@mochi.js/core";

const session = await mochi.launch({
  profile: "mac-m4-chrome-stable",
  seed: "uk-shopper-001",
  // Inline URL form — credentials get stripped from --proxy-server and
  // replayed via Fetch.authRequired. SOCKS5 and HTTPS work the same way.
  proxy: process.env.PROXY_URL ?? "http://user:pass@residential.example.net:8080",
  // privacy-fallback (default): on mismatch or probe failure, override the
  // matrix to UTC + en-US. The session fingerprints as a privacy-conscious
  // user (Tor / Brave / hardened-FF), which is benign in most threat models.
  geoConsistency: "privacy-fallback",
});
try {
  console.log(`Session running on tz=${session.profile.timezone} locale=${session.profile.locale}`);

  const page = await session.newPage();
  await page.goto("https://target.example.com/uk/products");
  const html = await page.content();
  await Bun.write("./out/page.html", html);

  // Side-channel API hit on the SAME proxy + the matrix's wreqPreset, so
  // wire fingerprint stays JA4-coherent with the browser.
  const apiResp = await session.fetch("https://api.example.com/inventory");
  console.log(`api ${apiResp.status}`);
} catch (err) {
  if (err instanceof GeoMismatchError) {
    console.error(`geo mismatch: matrix tz=${err.matrix.timezone} vs ip tz=${err.geo.timezone}`);
    console.error(`switch profile or proxy to align — or relax to "privacy-fallback".`);
  } else {
    throw err;
  }
} finally {
  await session.close();
}
```

## What's happening here

- **`proxy: "http://user:pass@host:port"`** — `mochi.launch` runs the URL through `parseProxyUrl`. Credentials are stripped from the `--proxy-server=` flag (Chromium rejects inline auth there) and re-installed via a CDP `Fetch.authRequired` listener that answers HTTP, HTTPS, SOCKS5, and SOCKS4 challenges. The full URL (with creds) is also forwarded to `@mochi.js/net` so `Session.fetch` traffic shares the same authenticated egress.
- **Or `proxy: { server, username?, password? }`** — explicit `ProxyConfig` shape. Useful when credentials contain reserved characters that don't percent-encode cleanly.
- **`geoConsistency: "privacy-fallback"` (default).** Before the first navigation, mochi probes the proxy's exit IP via `wreq` (using the matrix's `wreqPreset`, so the geo-lookup service sees the same JA4 / headers as user traffic). If `tzOffsetMinutes(matrix.timezone)` doesn't agree with the IP's timezone, the matrix's `timezone` is overridden to UTC and `locale` to `en-US`. The session prints a `[mochi] geoConsistency=privacy-fallback: privacy-fallback applied` warning — that's the matrix being adjusted, not an error.
- **`session.profile`** — the *resolved* `MatrixV1` after geo reconciliation. Read `session.profile.timezone` to confirm what the page will see; it may differ from the input profile when `privacy-fallback` or `auto-correct` triggered.
- **`GeoMismatchError`** — thrown when `geoConsistency: "strict"` AND the proxy's exit IP doesn't agree with the matrix. Probe failure (network blip) does NOT throw under `strict` — only a real mismatch does. The error carries `.matrix.{timezone, locale}`, `.geo.{country, timezone, ip}`, and `.reason`.
- **`session.fetch(url, init?)`** — out-of-band HTTP through the per-Session `NetCtx`. The wire fingerprint matches the matrix's `wreqPreset` so the side-channel API call is JA4-coherent with the browser navigation. Forwards the proxy URL automatically.

## Things that go wrong

- **`proxy: { bypass: ["..."] }`.** That's Playwright. mochi has no proxy bypass list — the proxy URL is the entire surface. If you need bypass, do it at the OS / shell level (or pre-resolve the URL yourself before passing it to `goto`).
- **`geoConsistency: "off"` blindly.** `"off"` skips the probe entirely — the network round-trip cost goes away but you keep the IP-vs-timezone leak. Use it for offline tests or when the geo-probe service is rate-limited, not as a "make the warning stop" hack.
- **`geoConsistency: "auto-correct"` over a sketchy proxy.** Auto-correct trusts mochi's IP-derived defaults over your declared profile. If your proxy provider rotates exit IPs mid-session, the matrix you started with isn't the matrix the page sees later. `"privacy-fallback"` is the safer default for stable identity.
- **Mismatched proxy creds in URL vs `ProxyConfig`.** `proxy: { server: "http://baduser:badpass@host:port", username: "good", password: "good" }` — explicit `username`/`password` win. The URL credentials are silently overridden. Pick one shape.
- **Setting a proxy on `Session.fetch` directly.** There is no per-call proxy override. The proxy comes from `LaunchOptions.proxy` and is shared between the browser and the FFI. To call a different proxy mid-flow, open a second session.
- **SOCKS5 user/pass on patched / minimal Chromium builds.** `Fetch.authRequired` may not fire on the SOCKS handshake on some custom builds. Verified against modern stable. See [Limits → Proxy authentication](/docs/reference/limits).

## See also

- [`guides/proxy-auth`](/docs/guides/proxy-auth) — full proxy URL grammar + `ProxyConfig` reference.
- [`guides/recipe-multi-session-pool`](/docs/guides/recipe-multi-session-pool) — fan out one proxy per worker.
- [`guides/recipe-warm-session-replay`](/docs/guides/recipe-warm-session-replay) — pair geo reconciliation with cookie warming.
- [`api/core`](/docs/api/core) — `LaunchOptions.proxy`, `ProxyConfig`, `geoConsistency`, `GeoMismatchError`, `probeExitGeo`, `reconcileGeoConsistency`.
- [`concepts/ja4-coherence`](/docs/concepts/ja4-coherence) — why the FFI shares the same proxy as the browser.

<!-- llm-context:start
Page purpose: cookbook recipe — running mochi behind a residential / datacenter
proxy with HTTP / HTTPS / SOCKS5 auth, plus the geoConsistency reconciliation
between the matrix's (timezone, locale) and the proxy's exit-IP geo.

Key API symbols + signatures (verified against packages/core/src/launch.ts +
geo-consistency.ts as of 2026-05-09):
  mochi.launch(opts: {
    profile: ProfileId | ProfileV1;
    seed: string;
    proxy?: string | ProxyConfig;       // "http://user:pass@host:port" or "socks5://..."
    geoConsistency?: "privacy-fallback" | "auto-correct" | "strict" | "off";
    ...
  }): Promise<Session>
  ProxyConfig: { server: string; username?: string; password?: string }
  session.profile: MatrixV1                       // resolved matrix after reconciliation
  session.fetch(url, init?): Promise<Response>    // shares LaunchOptions.proxy
  GeoMismatchError extends Error                  // .matrix, .geo, .reason
  parseProxyUrl(url): ParsedProxy                 // exported for advanced use
  probeExitGeo(opts): Promise<ExitGeo | null>
  reconcileGeoConsistency(matrix, geo, mode): GeoReconcileResult
  tzOffsetMinutes(zone, ref?): number | null
  localeRegion(locale): string | null

Common LLM hallucinations + corrections:
  - WRONG: `proxy: { bypass: [...] }`               → there is no bypass list; mochi has no equivalent
  - WRONG: passing proxy on a per-call basis        → CORRECT: proxy is a launch-time option; one Session = one egress
  - WRONG: `geoConsistency: true`                   → CORRECT: it's a string enum, default `"privacy-fallback"`
  - WRONG: setting `headers: { "Proxy-Authorization": ... }`  → handled transparently by Fetch.authRequired
  - WRONG: `LaunchOptions.proxyUrl`                 → CORRECT: `LaunchOptions.proxy`
  - WRONG: calling `parseProxyUrl` to "test" creds  → it only parses; it doesn't validate
  - WRONG: `session.profile.profile`                → CORRECT: `session.profile` is the MatrixV1 directly

Geo modes (exact strings):
  "privacy-fallback" — DEFAULT. On mismatch / probe-fail: override matrix to UTC + en-US.
  "auto-correct"     — On mismatch: override matrix.timezone with IP tz, locale with primary IP-country guess.
  "strict"           — Throw GeoMismatchError on real mismatch. Probe failure does NOT throw under strict.
  "off"              — Skip probe entirely.

Cross-references on mochijs.com:
  - https://mochijs.com/docs/guides/proxy-auth
  - https://mochijs.com/docs/guides/recipe-multi-session-pool
  - https://mochijs.com/docs/guides/recipe-warm-session-replay
  - https://mochijs.com/docs/api/core
  - https://mochijs.com/docs/concepts/ja4-coherence
  - https://mochijs.com/docs/concepts/network-ffi
  - https://mochijs.com/docs/reference/limits
llm-context:end -->
