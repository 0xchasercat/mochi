/**
 * Navigator-surface rules. Cover R-008, R-009, R-015, R-016, R-017, R-018,
 * R-020, R-022, R-027, R-028, R-030.
 *
 * `device.cores` and `device.memoryGB` are written back into the matrix's
 * device subtree — those slots represent both the input device data AND
 * the spoofed `navigator.{hardwareConcurrency,deviceMemory}` outputs since
 * they're the single source of truth.
 *
 * `navigator.platform`, `navigator.vendor`, `navigator.{appCodeName,product,
 *  cookieEnabled,maxTouchPoints}`, and `webdriver` have no schema slot — they
 * are encoded as additional `uaCh` keys (uaCh's schema is open-keyed strings).
 *
 * @see PLAN.md §9.2
 */

import type { ProfileV1 } from "../generated/profile";
import { defineRule, type Rule } from "../rule";
import { PLATFORM_BY_OS } from "./lookups/os";

type OsName = ProfileV1["os"]["name"];
type BrowserName = ProfileV1["browser"]["name"];

/**
 * R-008 — `[device.cpuFamily]` → `device.cores`.
 *
 * The brief lists `device.cpuFamily` as the input and "navigator.hardware
 * Concurrency" as the conceptual output. The matrix's slot for hardware
 * concurrency is `device.cores`. We treat `cpuFamily` as the lock-input —
 * the relationship "this CPU family always reports N cores" is what the
 * rule encodes — and look up cores from a small table. Unknown families
 * fall back to a sensible default (8) that matches the bulk of the v1
 * desktop catalog.
 */
export const R008: Rule = defineRule<readonly [string], number>({
  id: "R-008",
  description: "navigator.hardwareConcurrency from CPU family",
  inputs: ["device.cpuFamily"],
  output: "device.cores",
  derive([cpuFamily]) {
    return inferCoresFromCpuFamily(cpuFamily);
  },
});

/** R-009 — `device.memoryGB` → `device.memoryGB` (capped at 8 per Chrome). */
export const R009: Rule = defineRule<readonly [number], number>({
  id: "R-009",
  description: "navigator.deviceMemory cap at 8 — Chrome quantizes the value",
  inputs: ["device.memoryGB"],
  output: "device.memoryGB",
  derive([memoryGB]) {
    // Chrome reports a quantized value: 0.25, 0.5, 1, 2, 4, 8. We snap to 8
    // for any device with ≥ 8 GiB and otherwise round down to the nearest
    // standard step. Real devices < 8 GiB are rare in v1 catalog but
    // handled defensively.
    if (memoryGB >= 8) return 8;
    if (memoryGB >= 4) return 4;
    if (memoryGB >= 2) return 2;
    if (memoryGB >= 1) return 1;
    return 1;
  },
});

/** R-015 — `locale` → `locale` (passthrough; navigator.language is the same value). */
export const R015: Rule = defineRule<readonly [string], string>({
  id: "R-015",
  description: "navigator.language — passthrough of profile.locale",
  inputs: ["locale"],
  output: "locale",
  derive([locale]) {
    return locale;
  },
});

/** R-016 — `languages` → `languages` (passthrough; navigator.languages is the array). */
export const R016: Rule = defineRule<readonly [readonly string[]], readonly string[]>({
  id: "R-016",
  description: "navigator.languages — passthrough of profile.languages",
  inputs: ["languages"],
  output: "languages",
  derive([languages]) {
    return [...languages];
  },
});

/** R-017 — `os.name` → `uaCh.navigator-platform`. "MacIntel"/"Win32"/"Linux x86_64". */
export const R017: Rule = defineRule<readonly [OsName], string>({
  id: "R-017",
  description: "navigator.platform per OS",
  inputs: ["os.name"],
  output: "uaCh.navigator-platform",
  derive([osName]) {
    return PLATFORM_BY_OS[osName];
  },
});

/** R-018 — `browser.name` → `uaCh.navigator-vendor`. "Google Inc." universally. */
export const R018: Rule = defineRule<readonly [BrowserName], string>({
  id: "R-018",
  description: "navigator.vendor — 'Google Inc.' for chromium-family browsers",
  inputs: ["browser.name"],
  output: "uaCh.navigator-vendor",
  derive() {
    // All chromium-family browsers report "Google Inc." here. Brave/Arc/etc.
    // are detected via Sec-CH-UA brands, not the legacy `navigator.vendor`.
    return "Google Inc.";
  },
});

/** R-020 — `os.name` → `uaCh.navigator-maxTouchPoints`. 0 on desktop. */
export const R020: Rule = defineRule<readonly [OsName], string>({
  id: "R-020",
  description: "navigator.maxTouchPoints — 0 on desktop OSes",
  inputs: ["os.name"],
  output: "uaCh.navigator-maxTouchPoints",
  derive() {
    // v0.2 catalog is desktop-only; mobile profiles ship in v2 per PLAN.md §16.
    return "0";
  },
});

/** R-022 — `[os.name, browser.name]` → `uaCh.navigator-webdriver`. "false". */
export const R022: Rule = defineRule<readonly [OsName, BrowserName], string>({
  id: "R-022",
  description: "navigator.webdriver — false on real browsers",
  inputs: ["os.name", "browser.name"],
  output: "uaCh.navigator-webdriver",
  derive() {
    return "false";
  },
});

/** R-027 — `[os.name, browser.name]` → `uaCh.navigator-appCodeName`. */
export const R027: Rule = defineRule<readonly [OsName, BrowserName], string>({
  id: "R-027",
  description: "navigator.appCodeName — 'Mozilla' universally",
  inputs: ["os.name", "browser.name"],
  output: "uaCh.navigator-appCodeName",
  derive() {
    return "Mozilla";
  },
});

/** R-028 — `os.name` → `uaCh.navigator-product`. */
export const R028: Rule = defineRule<readonly [OsName], string>({
  id: "R-028",
  description: "navigator.product — 'Gecko' universally",
  inputs: ["os.name"],
  output: "uaCh.navigator-product",
  derive() {
    return "Gecko";
  },
});

/** R-030 — `[os.name, browser.name]` → `uaCh.navigator-cookieEnabled`. */
export const R030: Rule = defineRule<readonly [OsName, BrowserName], string>({
  id: "R-030",
  description: "navigator.cookieEnabled — true",
  inputs: ["os.name", "browser.name"],
  output: "uaCh.navigator-cookieEnabled",
  derive() {
    return "true";
  },
});

export const NAVIGATOR_RULES: readonly Rule[] = [
  R008,
  R009,
  R015,
  R016,
  R017,
  R018,
  R020,
  R022,
  R027,
  R028,
  R030,
];

// ---- helpers ----------------------------------------------------------------

/**
 * Map a coarse CPU family string to a logical-core count. Unknown families
 * fall back to 8 — the most common value for the v1 desktop catalog.
 */
function inferCoresFromCpuFamily(cpuFamily: string): number {
  const f = cpuFamily.toLowerCase();
  if (f.includes("apple-silicon-m1")) return 8;
  if (f.includes("apple-silicon-m2")) return 8;
  if (f.includes("apple-silicon-m3")) return 8;
  if (f.includes("apple-silicon-m4")) return 10;
  if (f.includes("apple-silicon")) return 8;
  if (f.includes("intel-core-i3")) return 4;
  if (f.includes("intel-core-i5")) return 8;
  if (f.includes("intel-core-i7")) return 12;
  if (f.includes("intel-core-i9")) return 16;
  if (f.includes("amd-ryzen-3")) return 8;
  if (f.includes("amd-ryzen-5")) return 12;
  if (f.includes("amd-ryzen-7")) return 16;
  if (f.includes("amd-ryzen-9")) return 24;
  return 8;
}
