/**
 * Locale + timezone + fonts rules. Cover R-013, R-014, R-019.
 *
 * R-015 (locale → navigator.language) and R-016 (languages →
 * navigator.languages) live in `navigator.ts` since they belong to the
 * navigator surface even though their inputs are top-level locale fields.
 *
 * @see PLAN.md §9.2
 */

import type { ProfileV1 } from "../generated/profile";
import { defineRule, type Rule } from "../rule";
import { FONTS_BY_OS } from "./lookups/os";

type OsName = ProfileV1["os"]["name"];

/**
 * R-013 — `os.name` → `fonts.list`. Curated baseline list per OS. The full
 * device-specific list (e.g. mac-m2 vs mac-intel) lands in phase 0.7.
 */
export const R013: Rule = defineRule<readonly [OsName], readonly string[]>({
  id: "R-013",
  description: "fonts.list — curated OS baseline; phase 0.7 expands per device",
  inputs: ["os.name"],
  output: "fonts.list",
  derive([osName]) {
    return [...FONTS_BY_OS[osName]];
  },
});

/**
 * R-014 — `timezone` → `timezone`. Passthrough; the inject layer surfaces
 * this via `Intl.DateTimeFormat().resolvedOptions().timeZone` overrides.
 */
export const R014: Rule = defineRule<readonly [string], string>({
  id: "R-014",
  description: "Intl.DateTimeFormat() resolvedOptions().timeZone — passthrough",
  inputs: ["timezone"],
  output: "timezone",
  derive([tz]) {
    return tz;
  },
});

/**
 * R-019 — `[seed]` → `uaCh.seed-derived-noise`.
 *
 * A seed-derived placeholder for any future per-seed fingerprint slot
 * (visitor-id-style values exist in phase 0.7 — for now we record the
 * deterministic noise the engine *would* use for them).
 *
 * The PRNG state is forked per (profile.id, seed) by `seedToPrng`, so this
 * rule produces different bytes per seed but the same bytes per (profile,
 * seed) pair. The output is a 16-byte hex string.
 */
export const R019: Rule = defineRule<readonly [string], string>({
  id: "R-019",
  description: "Seed-derived noise placeholder — visitorId precursor",
  inputs: ["seed"],
  output: "uaCh.seed-derived-noise",
  derive(_inputs, prng) {
    return prng.nextHex(16);
  },
});

export const LOCALE_RULES: readonly Rule[] = [R013, R014, R019];
