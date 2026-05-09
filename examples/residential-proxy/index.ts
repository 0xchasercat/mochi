/**
 * Recipe: Residential proxy with geo reconciliation.
 *
 * Pipe a session through a residential / datacenter proxy with HTTP / SOCKS5
 * auth (handled transparently via CDP `Fetch.authRequired`), and reconcile
 * the matrix's `(timezone, locale)` against the proxy's exit-IP geo using
 * `geoConsistency: "privacy-fallback"` (default). On mismatch the matrix
 * overrides to UTC + en-US (Tor / Brave shape) instead of the canonical bot
 * signature of `America/Los_Angeles` over a London exit IP.
 *
 * @see https://mochijs.com/docs/guides/recipe-residential-proxy
 */

import { GeoMismatchError, mochi } from "@mochi.js/core";

const PROXY_URL = process.env.PROXY_URL ?? "http://user:pass@residential.example.net:8080";

// One-time hint: if mochi auto-flipped to headless on a Linux server because
// DISPLAY isn't set, `detectLinuxServerEnv()` is the introspection seam.
//   const env = mochi.detectLinuxServerEnv();
//   console.log(env.rationale);

const session = await mochi.launch({
  profile: "mac-m4-chrome-stable",
  seed: "uk-shopper-001",
  // Inline URL form — credentials get stripped from --proxy-server (Chromium
  // rejects inline auth) and replayed via Fetch.authRequired. SOCKS5 + HTTPS
  // work the same way. For reserved chars in passwords, prefer the
  // ProxyConfig shape: { server, username, password }.
  proxy: PROXY_URL,
  // privacy-fallback (default): on mismatch or probe failure, override the
  // matrix to UTC + en-US. Benign in most threat models. Alternatives:
  //   "auto-correct" — trust the IP's tz/locale over the declared profile
  //   "strict"       — throw GeoMismatchError on real mismatch
  //   "off"          — skip the probe entirely
  geoConsistency: "privacy-fallback",
});

try {
  console.log(`session resolved: tz=${session.profile.timezone} locale=${session.profile.locale}`);

  const page = await session.newPage();
  await page.goto("https://target.example.com/uk/products");
  await Bun.write("./out/page.html", await page.content());

  // Out-of-band side-channel API call — same proxy, same wreqPreset, so
  // JA4 stays coherent with the browser navigation.
  const apiResp = await session.fetch("https://api.example.com/inventory");
  console.log(`api ${apiResp.status}`);
} catch (err) {
  if (err instanceof GeoMismatchError) {
    console.error(`geo mismatch: matrix tz=${err.matrix.timezone} vs ip tz=${err.geo.timezone}`);
    console.error(`switch profile / proxy or relax to "privacy-fallback".`);
  } else {
    throw err;
  }
} finally {
  await session.close();
}
