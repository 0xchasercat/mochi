/**
 * User-Agent + UA-CH rules. Cover R-004, R-005, R-006, R-007, R-023, R-026,
 * R-031, R-042, R-043, R-044, R-045, R-046.
 *
 * R-023 produces a seed-derived build-hash that R-004 consumes — that's the
 * v0.2 chain that gives the rule DAG real (non-trivial) edges.
 *
 * R-042..R-046 close the UA-CH cross-layer gap exposed by 0255:
 * `Network.setUserAgentOverride` accepts a structured `userAgentMetadata`
 * shape from which Chromium derives every `Sec-CH-UA*` request header. Core
 * needs to pass that struct, and the values for `architecture`, `bitness`,
 * `mobile`, `model`, and the single-string `ua-full-version` were not yet
 * in the matrix. These rules add them so core + inject can both read from
 * the same source of truth (PLAN.md I-5).
 *
 * @see PLAN.md §9.2
 */

import type { ProfileV1 } from "../generated/profile";
import { defineRule, type Rule } from "../rule";
import {
  deriveBuildVersion,
  deriveSecChUa,
  deriveUserAgent,
  lookupTipFullVersion,
} from "./lookups/browser";
import { SEC_CH_UA_PLATFORM_BY_OS } from "./lookups/os";

type OsName = ProfileV1["os"]["name"];
type OsArch = ProfileV1["os"]["arch"];
type BrowserName = ProfileV1["browser"]["name"];

/**
 * R-023 — `[seed]` (with the engine PRNG forking off `(profile.id, seed)`)
 * → `uaCh.ua-build-hash`.
 *
 * The PRNG state is itself derived from `(profile.id, seed)` (see prng/seed.ts),
 * so this rule only needs to read the seed value to enforce its declared
 * dependency on the seed in the rule DAG. The actual entropy comes from the
 * PRNG argument injected by the engine.
 */
export const R023: Rule = defineRule<readonly [string], string>({
  id: "R-023",
  description: "Seed-derived UA build-hash — drives the build-number variance in R-004",
  inputs: ["seed"],
  output: "uaCh.ua-build-hash",
  derive(_inputs, prng) {
    // 8 hex chars = 4 bytes — plenty of entropy for a build-number lookup
    // and short enough to inspect in JSON dumps.
    return prng.nextHex(4);
  },
});

/**
 * R-004 — `[os.name, browser.name, browser.minVersion, uaCh.ua-build-hash]`
 * → `userAgent`. Tip-stable when the lookup table has a published patch for
 * `(browser, major)`; otherwise the build hash from R-023 fans out to a
 * stable `<major>.0.<build>.<patch>` triple. Tip-locking matches what real
 * Chromium reports in `userAgent` + `userAgentDataHighEntropy.fullVersionList`,
 * which the harness compares structurally.
 *
 * v0.7 ranks the tip lookup ahead of seed-derived because real-device
 * captures observe the published tip; the seed-derived path is reserved
 * for ad-hoc majors (canary, beta) that aren't yet in the tip table.
 */
export const R004: Rule = defineRule<readonly [OsName, BrowserName, string, string], string>({
  id: "R-004",
  description: "User-Agent template + tip-locked patch (fallback: seed-driven build variance)",
  inputs: ["os.name", "browser.name", "browser.minVersion", "uaCh.ua-build-hash"],
  output: "userAgent",
  derive([osName, browser, minVersion, buildHash]) {
    // Tip lookup first — closes the harness divergence on
    // navigator.userAgent + userAgentDataHighEntropy.fullVersionList[*].version
    // for the captured Mac M4 baseline. PLAN.md §9.2 R-031.
    const tip = lookupTipFullVersion(browser, minVersion);
    if (tip !== null) {
      return deriveUserAgent(osName, browser, tip);
    }
    // Convert the hex build-hash to a 32-bit number — the lower 31 bits are
    // enough; the build/patch derivation uses small modular bands.
    const u32 = parseInt(buildHash.slice(0, 8), 16) >>> 0;
    const fullVersion = deriveBuildVersion(minVersion, u32);
    return deriveUserAgent(osName, browser, fullVersion);
  },
});

/**
 * R-005 — `[os.name (declared but unused), browser.name, browser.minVersion]`
 * → `uaCh.sec-ch-ua`. Brand list with deterministic GREASE entry.
 *
 * `os.name` is part of the declared input tuple per the brief's contract
 * even though the brand list is OS-independent — the lock represents the
 * relationship that the Sec-CH-UA header is observed alongside the OS.
 */
export const R005: Rule = defineRule<readonly [OsName, BrowserName, string], string>({
  id: "R-005",
  description: "Sec-CH-UA brand list",
  inputs: ["os.name", "browser.name", "browser.minVersion"],
  output: "uaCh.sec-ch-ua",
  derive([_osName, browser, minVersion]) {
    return deriveSecChUa(browser, minVersion);
  },
});

/** R-006 — `os.name` → `uaCh.sec-ch-ua-platform` (enum). */
export const R006: Rule = defineRule<readonly [OsName], string>({
  id: "R-006",
  description: "Sec-CH-UA-Platform enum",
  inputs: ["os.name"],
  output: "uaCh.sec-ch-ua-platform",
  derive([osName]) {
    return SEC_CH_UA_PLATFORM_BY_OS[osName];
  },
});

/** R-007 — `os.version` → `uaCh.sec-ch-ua-platform-version` (passthrough, quoted). */
export const R007: Rule = defineRule<readonly [string], string>({
  id: "R-007",
  description: "Sec-CH-UA-Platform-Version — quoted OS marketing version",
  inputs: ["os.version"],
  output: "uaCh.sec-ch-ua-platform-version",
  derive([version]) {
    return `"${version}"`;
  },
});

/**
 * R-026 — `userAgent` → `uaCh.navigator-appVersion`. `navigator.appVersion`
 * historically returns the UA without the leading `"Mozilla/"` prefix.
 */
export const R026: Rule = defineRule<readonly [string], string>({
  id: "R-026",
  description: "navigator.appVersion = userAgent without leading 'Mozilla/'",
  inputs: ["userAgent"],
  output: "uaCh.navigator-appVersion",
  derive([userAgent]) {
    return userAgent.replace(/^Mozilla\//, "");
  },
});

/**
 * R-031 — `[browser.name, browser.minVersion]` → `uaCh.ua-full-version-list`.
 *
 * Emits a JSON-encoded brand list with FULL `<major>.0.<build>.<patch>`
 * versions, mirroring what `navigator.userAgentData.getHighEntropyValues({
 * hints:["fullVersionList"]})` returns on real Chromium. The brand list
 * itself reuses R-005's ordering — Branded → GREASE → Chromium — but the
 * `version` field is the tip-locked patch (or `<major>.0.0.0` for GREASE,
 * which is canonical Chromium behaviour).
 *
 * Inject (`client-hints.ts`) parses this JSON and serves it from
 * `getHighEntropyValues`. Without this rule the inject layer falls back to
 * the brand-list majors (`"147"`), which mismatches the captured baseline.
 *
 * @see PLAN.md §9.2 / §13.6
 */
export const R031: Rule = defineRule<readonly [BrowserName, string], string>({
  id: "R-031",
  description: "uaCh.ua-full-version-list — tip-locked Sec-CH-UA-Full-Version-List",
  inputs: ["browser.name", "browser.minVersion"],
  output: "uaCh.ua-full-version-list",
  derive([browser, minVersion]) {
    const tip = lookupTipFullVersion(browser, minVersion);
    const fullVersion = tip ?? `${minVersion}.0.0.0`;
    // Brand-list shape mirrors R-005. GREASE pinned to `8.0.0.0` (Chromium-
    // spec): the GREASE entry's full version is its own canonical placeholder,
    // not the browser tip. Chromium-canonical brands use the same tip as the
    // branded entry.
    const brands = [
      { brand: brandLabel(browser), version: fullVersion },
      { brand: "Not.A/Brand", version: "8.0.0.0" },
      { brand: "Chromium", version: fullVersion },
    ];
    return JSON.stringify(brands);
  },
});

/** Brand label parallel to SEC_CH_UA_BRANDS_BY_BROWSER. */
function brandLabel(browser: BrowserName): string {
  switch (browser) {
    case "chrome":
      return "Google Chrome";
    case "edge":
      return "Microsoft Edge";
    case "brave":
      return "Brave";
    case "arc":
      return "Arc";
    case "opera":
      return "Opera";
  }
}

/**
 * R-042 — `os.arch` → `uaCh.sec-ch-ua-arch`.
 *
 * Quoted on the wire (`'"arm"'` / `'"x86"'`) — matches the on-the-wire
 * shape Chrome emits for `Sec-CH-UA-Arch`. The corresponding
 * `userAgentMetadata.architecture` CDP enum is the unquoted form
 * (`"arm" | "x86" | ""`); `Session` strips the quotes when it builds the
 * metadata struct.
 *
 * macOS Apple Silicon → `"arm"`, Intel → `"x86"`. Linux/Windows mirror the
 * profile arch directly. Per Chromium source, the enum is `"arm"`/`"x86"`
 * even on 64-bit (the bit-width lives in `bitness`, R-043).
 */
export const R042: Rule = defineRule<readonly [OsArch], string>({
  id: "R-042",
  description: "Sec-CH-UA-Arch — quoted CPU family (arm | x86)",
  inputs: ["os.arch"],
  output: "uaCh.sec-ch-ua-arch",
  derive([arch]) {
    return arch === "arm64" ? '"arm"' : '"x86"';
  },
});

/**
 * R-043 — `os.arch` → `uaCh.sec-ch-ua-bitness`.
 *
 * Quoted on the wire (`'"64"'` / `'"32"'`). Per CDP source the
 * corresponding `userAgentMetadata.bitness` enum is a STRING (`"64" | "32"
 * | ""`) — never numeric, even though the value is digits-only. `Session`
 * unquotes when populating the metadata struct.
 */
export const R043: Rule = defineRule<readonly [OsArch], string>({
  id: "R-043",
  description: "Sec-CH-UA-Bitness — quoted bit-width string",
  inputs: ["os.arch"],
  output: "uaCh.sec-ch-ua-bitness",
  derive([arch]) {
    // arm64 + x64 → 64-bit; x86 → 32-bit. Captured-baseline parity with
    // packages/cli/src/capture/derive-profile.ts (the live capture path).
    return arch === "x86" ? '"32"' : '"64"';
  },
});

/**
 * R-044 — `os.name` → `uaCh.sec-ch-ua-mobile`.
 *
 * Wire shape is `"?0"` (desktop) or `"?1"` (mobile) — Structured-Headers
 * boolean. v1 schema's OS enum is `"macos" | "windows" | "linux"` (all
 * desktop), so this rule always emits `"?0"`. Future Android/iOS profiles
 * (v2) will flip the mapping; the rule is shaped to receive `os.name`
 * directly so the change is one switch-arm wide.
 */
export const R044: Rule = defineRule<readonly [OsName], string>({
  id: "R-044",
  description: "Sec-CH-UA-Mobile — Structured-Headers boolean (?0 desktop, ?1 mobile)",
  inputs: ["os.name"],
  output: "uaCh.sec-ch-ua-mobile",
  derive([osName]) {
    // v1 enum is desktop-only; the explicit switch keeps the v2 add-mobile
    // path obvious. (Per Chromium source the only mobile platforms that
    // populate Sec-CH-UA-Mobile=?1 are Android + iOS — desktop Linux on a
    // touchscreen still emits ?0.)
    switch (osName) {
      case "macos":
      case "windows":
      case "linux":
        return "?0";
    }
  },
});

/**
 * R-045 — `os.name` → `uaCh.sec-ch-ua-model`.
 *
 * Per spec, desktop platforms always emit an empty string for
 * `Sec-CH-UA-Model` regardless of the actual hardware (`device.model` is
 * read elsewhere in the matrix but Chromium does NOT plumb it to this
 * header for desktop OSes — only Android/iOS Chrome populates the field
 * with the device marketing name, e.g. `"Pixel 7"`). v1's OS enum is
 * desktop-only so the wire value is always `'""'` (the empty quoted
 * string).
 *
 * Captured-baseline parity: real desktop Chrome emits the header as
 * `Sec-CH-UA-Model: ""`, NOT as the absence of the header.
 */
export const R045: Rule = defineRule<readonly [OsName], string>({
  id: "R-045",
  description: "Sec-CH-UA-Model — empty quoted string for desktop OSes",
  inputs: ["os.name"],
  output: "uaCh.sec-ch-ua-model",
  derive([osName]) {
    switch (osName) {
      case "macos":
      case "windows":
      case "linux":
        return '""';
    }
  },
});

/**
 * R-046 — `uaCh.ua-full-version-list` → `uaCh.ua-full-version`.
 *
 * The single-string `ua-full-version` form (legacy `Sec-CH-UA-Full-Version`,
 * deprecated in favour of the list form but still emitted by Chrome and
 * still surfaced by `userAgentData.getHighEntropyValues({hints:["uaFullVersion"]})`)
 * is the FIRST brand entry's version in the list — i.e. the BRANDED entry
 * (Google Chrome / Microsoft Edge / etc.), NOT the GREASE entry and NOT
 * the Chromium entry.
 *
 * The list shape is locked by R-031 to `[Branded, GREASE, Chromium]`, so
 * `[0].version` is always the right answer.
 *
 * Inject (`client-hints.ts`) reads the same value via `SPOOF_FULL_VERSION_LIST[0].version`;
 * the network metadata path reads it via `matrix.uaCh["ua-full-version"]`.
 * Single source of truth = the list.
 */
export const R046: Rule = defineRule<readonly [string], string>({
  id: "R-046",
  description: "ua-full-version — branded-entry version from the full-version-list",
  inputs: ["uaCh.ua-full-version-list"],
  output: "uaCh.ua-full-version",
  derive([fullVersionListJson]) {
    // R-031 always emits a JSON array with at least the branded entry at
    // index 0. Defensive parse: if the JSON is malformed for any reason we
    // throw rather than silently degrade — silent fallback would mask a
    // real upstream bug, which 0051 (Group A) already taught us about.
    const parsed = JSON.parse(fullVersionListJson) as unknown;
    if (!Array.isArray(parsed) || parsed.length === 0) {
      throw new Error(
        `[mochi/consistency] R-046: uaCh.ua-full-version-list is not a non-empty JSON array (got ${fullVersionListJson})`,
      );
    }
    const first = parsed[0] as { brand?: unknown; version?: unknown };
    if (typeof first.version !== "string" || first.version.length === 0) {
      throw new Error(
        `[mochi/consistency] R-046: uaCh.ua-full-version-list[0] has no string 'version' field (got ${JSON.stringify(first)})`,
      );
    }
    return first.version;
  },
});

export const USER_AGENT_RULES: readonly Rule[] = [
  R023,
  R004,
  R005,
  R006,
  R007,
  R026,
  R031,
  R042,
  R043,
  R044,
  R045,
  R046,
];
