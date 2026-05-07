/**
 * User-Agent + UA-CH rules. Cover R-004, R-005, R-006, R-007, R-023, R-026.
 *
 * R-023 produces a seed-derived build-hash that R-004 consumes — that's the
 * v0.2 chain that gives the rule DAG real (non-trivial) edges.
 *
 * @see PLAN.md §9.2
 */

import type { ProfileV1 } from "../generated/profile";
import { defineRule, type Rule } from "../rule";
import { deriveBuildVersion, deriveSecChUa, deriveUserAgent } from "./lookups/browser";
import { SEC_CH_UA_PLATFORM_BY_OS } from "./lookups/os";

type OsName = ProfileV1["os"]["name"];
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
 * → `userAgent`. The build hash from R-023 fans out to a stable
 * `<major>.0.<build>.<patch>` triple, which gets substituted into the
 * platform's UA template.
 */
export const R004: Rule = defineRule<readonly [OsName, BrowserName, string, string], string>({
  id: "R-004",
  description: "User-Agent template + seed-driven build-number variance",
  inputs: ["os.name", "browser.name", "browser.minVersion", "uaCh.ua-build-hash"],
  output: "userAgent",
  derive([osName, browser, minVersion, buildHash]) {
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

export const USER_AGENT_RULES: readonly Rule[] = [R023, R004, R005, R006, R007, R026];
