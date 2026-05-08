/**
 * Extras — phase-0.7 polish rules that round out the JS-derivable harness
 * surface. Cover R-034..R-040.
 *
 * These rules are pure passthroughs over static lookups (per PLAN.md §6.1
 * "profile is the source of truth, lookups are for genuinely-derived-from-
 * primitives" and the I-5 lesson from 0051). Every output lands as a
 * JSON-encoded string under `uaCh.*` since the schema's `uaCh` is the
 * single open-keyed expansion slot at v0.7.
 *
 * @see PLAN.md §9.2, §13.6
 * @see tasks/0070-consistency-rules-full.md
 */

import type { ProfileV1 } from "../generated/profile";
import { defineRule, type Rule } from "../rule";
import { DEVICES_BY_OS, SUPPORTED_CONSTRAINTS } from "./lookups/media-devices";
import { PERMISSIONS_DEFAULT_STATE } from "./lookups/permissions";
import { DESKTOP_ORIENTATION, MEDIA_QUERY_DEFAULTS } from "./lookups/screen-extras";

type OsName = ProfileV1["os"]["name"];

/**
 * R-034 — `os.name` → `uaCh.media-devices` JSON shape.
 *
 * The output bundles the typical (kind, label) device shape from the
 * lookup; deviceId/groupId stay empty here and are filled in by the inject-
 * side seeded xoshiro derivation. Keeping the seeded IDs out of the matrix
 * keeps the matrix byte-stable per (profile, seed) — same matrix, two
 * inject runs, identical IDs.
 */
export const R034: Rule = defineRule<readonly [OsName], string>({
  id: "R-034",
  description: "MediaDevices.enumerateDevices shape (without seeded IDs) per OS",
  inputs: ["os.name"],
  output: "uaCh.media-devices",
  derive([osName]) {
    return JSON.stringify(DEVICES_BY_OS[osName]);
  },
});

/**
 * R-035 — `os.name` → `uaCh.media-supported-constraints` JSON map.
 *
 * Static across desktop OS at this Chrome major; we still gate the rule on
 * `os.name` so the DAG records the relationship (PLAN.md §9.2 "rules
 * declare their semantic dependency, not just the data dependency").
 */
export const R035: Rule = defineRule<readonly [OsName], string>({
  id: "R-035",
  description: "MediaDevices.getSupportedConstraints map (Chrome ≥ 130 default)",
  inputs: ["os.name"],
  output: "uaCh.media-supported-constraints",
  derive() {
    return JSON.stringify(SUPPORTED_CONSTRAINTS);
  },
});

/**
 * R-036 — `os.name` → `uaCh.permissions-defaults` JSON map.
 *
 * Stable across desktop Chrome: most permissions default to `"prompt"`,
 * the sensor cluster + clipboard-write to `"granted"`. Inject overrides
 * `Permissions.prototype.query` to consult this map.
 */
export const R036: Rule = defineRule<readonly [OsName], string>({
  id: "R-036",
  description: "Permissions.query default-state map per fresh-profile Chrome",
  inputs: ["os.name"],
  output: "uaCh.permissions-defaults",
  derive() {
    return JSON.stringify(PERMISSIONS_DEFAULT_STATE);
  },
});

/**
 * R-037 — `os.name` → `uaCh.connection` (Network Information API JSON).
 *
 * Chrome desktop reports `effectiveType: "4g"`, plausible downlink ≈
 * 10 mbps, RTT ≈ 50ms, saveData false. Captured baselines vary on
 * downlink/rtt by physical link; harness normalize sentinelizes those
 * leaves so we ship plausible defaults here.
 */
export const R037: Rule = defineRule<readonly [OsName], string>({
  id: "R-037",
  description: "navigator.connection (NetworkInformation) defaults",
  inputs: ["os.name"],
  output: "uaCh.connection",
  derive() {
    return JSON.stringify({
      effectiveType: "4g",
      downlink: 10,
      rtt: 50,
      saveData: false,
    });
  },
});

/** R-038 — `os.name` → `uaCh.screen-orientation` JSON `{type, angle}`. */
export const R038: Rule = defineRule<readonly [OsName], string>({
  id: "R-038",
  description: "screen.orientation — landscape-primary on desktop",
  inputs: ["os.name"],
  output: "uaCh.screen-orientation",
  derive() {
    return JSON.stringify(DESKTOP_ORIENTATION);
  },
});

/** R-039 — `os.name` → `uaCh.media-queries` JSON map of feature → answer. */
export const R039: Rule = defineRule<readonly [OsName], string>({
  id: "R-039",
  description: "matchMedia default answers for desktop Chrome captures",
  inputs: ["os.name"],
  output: "uaCh.media-queries",
  derive() {
    return JSON.stringify(MEDIA_QUERY_DEFAULTS);
  },
});

/**
 * R-040 — `[device.cores]` → `uaCh.storage-estimate` JSON `{quota, usage}`.
 *
 * Chrome's `navigator.storage.estimate()` returns a quota that scales with
 * available disk; harness normalize sentinelizes the `quota` leaf, so the
 * exact value does not need to match. We seed a plausible value derived
 * from the device cores (a stable proxy that varies per profile).
 */
export const R040: Rule = defineRule<readonly [number], string>({
  id: "R-040",
  description: "navigator.storage.estimate() — quota proxy + zero usage",
  inputs: ["device.cores"],
  output: "uaCh.storage-estimate",
  derive([cores]) {
    // ~74 GB per core baseline — gives 64 GB on 1-core through 1 TB on
    // 14-core. Real Chrome reports per-disk-free-space; the exact number
    // is sentinelized by harness normalize so any plausible int works.
    const quota = cores * 74_000_000_000;
    return JSON.stringify({ quota, usage: 0 });
  },
});

export const EXTRAS_RULES: readonly Rule[] = [R034, R035, R036, R037, R038, R039, R040];
