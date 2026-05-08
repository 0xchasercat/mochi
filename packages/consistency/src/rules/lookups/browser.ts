/**
 * Browser lookup tables — UA templates, vendor strings, brand-list
 * compositions for Sec-CH-UA. v0.2 covers the chromium-family browsers
 * the v1 catalog will ship.
 *
 * @see PLAN.md §9.5 — userAgent + uaCh derivation chain
 */

import type { ProfileV1 } from "../../generated/profile";

/** Browser key matching `ProfileV1["browser"]["name"]`. */
export type BrowserKey = ProfileV1["browser"]["name"];
/** OS key matching `ProfileV1["os"]["name"]`. */
export type OsKey = ProfileV1["os"]["name"];

/**
 * `navigator.vendor` — universally `"Google Inc."` for chromium-family
 * browsers. Brave and Arc leave this untouched even though the brand
 * differs in the UA-CH brand list.
 */
export const VENDOR_BY_BROWSER: Readonly<Record<BrowserKey, string>> = {
  chrome: "Google Inc.",
  edge: "Google Inc.",
  brave: "Google Inc.",
  arc: "Google Inc.",
  opera: "Google Inc.",
};

/**
 * The brand list each browser inserts into Sec-CH-UA. Order is significant —
 * fingerprint surfaces compare the full ordered list verbatim.
 *
 * Real Chrome 110+ emits brands in `[Branded, GREASE, Chromium]` order with
 * a pinned GREASE label (`Not.A/Brand`) and a pinned GREASE major (`8`).
 * The previous ordering (`[Chromium, Branded, GREASE]`) and GREASE label
 * (`Not_A Brand`) were the harness-surfaced bug captured in
 * tasks/0051-consistency-stack-fixes.md (Group B).
 */
export const SEC_CH_UA_BRANDS_BY_BROWSER: Readonly<Record<BrowserKey, readonly string[]>> = {
  chrome: ["Google Chrome", "Not.A/Brand", "Chromium"],
  edge: ["Microsoft Edge", "Not.A/Brand", "Chromium"],
  brave: ["Brave", "Not.A/Brand", "Chromium"],
  arc: ["Arc", "Not.A/Brand", "Chromium"],
  opera: ["Opera", "Not.A/Brand", "Chromium"],
};

/**
 * The pinned GREASE label Chrome 110+ emits. Real Chrome shuffles GREASE
 * per boot for spec compliance; v0.2 keeps a fixed value for determinism.
 * Phase 0.7 may revisit per-boot shuffle.
 */
const GREASE_BRAND = "Not.A/Brand";

/**
 * The pinned GREASE major. Chrome 110+ emits `"Not.A/Brand";v="8"` regardless
 * of the real browser major, by design — the GREASE entry's purpose is to
 * exercise downstream parsers with an unfamiliar value, not to track Chrome.
 */
const GREASE_VERSION = "8";

/** Format a single brand entry as it appears in Sec-CH-UA: `"<brand>";v="<major>"`. */
function formatBrand(brand: string, major: string): string {
  // The spec uses curly-quoted JSON-style escaping — biome won't complain
  // because we treat the literal as data, not source code.
  return `"${brand}";v="${major}"`;
}

/**
 * Compose the full Sec-CH-UA header value. Stable, deterministic, depends
 * only on browser identity + major version. The GREASE entry uses its own
 * pinned version (`8`), not the browser major.
 */
export function deriveSecChUa(browser: BrowserKey, major: string): string {
  const brands = SEC_CH_UA_BRANDS_BY_BROWSER[browser];
  return brands.map((b) => formatBrand(b, b === GREASE_BRAND ? GREASE_VERSION : major)).join(", ");
}

/**
 * UA template substituted with the browser version + a seeded build number
 * variance. The v0.2 templates cover the matrix of (os, browser) declared
 * in the v1 catalog.
 *
 * Template tokens:
 *   `{MAJOR}`  — browser major version (e.g. "131")
 *   `{BUILD}`  — full version string (e.g. "131.0.6778.110")
 */
const UA_TEMPLATES: Readonly<Record<OsKey, Readonly<Record<BrowserKey, string>>>> = {
  macos: {
    chrome:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/{BUILD} Safari/537.36",
    edge: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/{BUILD} Safari/537.36 Edg/{BUILD}",
    brave:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/{BUILD} Safari/537.36",
    arc: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/{BUILD} Safari/537.36",
    opera:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/{BUILD} Safari/537.36 OPR/{MAJOR}.0.0.0",
  },
  windows: {
    chrome:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/{BUILD} Safari/537.36",
    edge: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/{BUILD} Safari/537.36 Edg/{BUILD}",
    brave:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/{BUILD} Safari/537.36",
    arc: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/{BUILD} Safari/537.36",
    opera:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/{BUILD} Safari/537.36 OPR/{MAJOR}.0.0.0",
  },
  linux: {
    chrome:
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/{BUILD} Safari/537.36",
    edge: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/{BUILD} Safari/537.36 Edg/{BUILD}",
    brave:
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/{BUILD} Safari/537.36",
    arc: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/{BUILD} Safari/537.36",
    opera:
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/{BUILD} Safari/537.36 OPR/{MAJOR}.0.0.0",
  },
};

/**
 * Build a User-Agent string given the OS, browser, and a full version.
 * `version` should look like `"131.0.6778.110"`; the major is extracted as
 * the first dot-separated segment.
 */
export function deriveUserAgent(os: OsKey, browser: BrowserKey, version: string): string {
  const major = version.split(".")[0] ?? "0";
  const tmpl = UA_TEMPLATES[os][browser];
  return tmpl.replace(/\{BUILD\}/g, version).replace(/\{MAJOR\}/g, major);
}

/**
 * Build a deterministic full-build version string from a major version and
 * a 32-bit seed-derived integer. The two middle digits ("0.X") are 0 to
 * match Chrome stable; the patch (Y) and build (Z) are seed-derived.
 *
 * Chrome stable build numbers are typically of the form
 * `<major>.0.<build>.<patch>` with `build` ~ 4-digit and `patch` ~ 2-3 digit.
 * v0.2 uses a stable, plausible distribution: build ∈ [6000, 6999],
 * patch ∈ [1, 199].
 */
export function deriveBuildVersion(major: string, seedDerivedU32: number): string {
  const build = 6000 + (seedDerivedU32 % 1000);
  const patch = 1 + (Math.floor(seedDerivedU32 / 1000) % 199);
  return `${major}.0.${build}.${patch}`;
}
