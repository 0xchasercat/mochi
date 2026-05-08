/**
 * @mochi.js/profiles — captured-baseline data fixtures.
 *
 * Each profile is a directory under `data/<id>/` containing:
 *   - profile.json (ProfileV1 spec the consistency engine consumes)
 *   - baseline.manifest.json (Probe Manifest captured from the real device)
 *   - audio/*.bin (precomputed OfflineAudioContext fingerprint bytes)
 *   - canvas/*.json (precomputed canvas hash maps)
 *   - PROVENANCE.md (capturer + machine + date)
 *
 * v0.0.1 claim release; first profile (`mac-m2-chrome-stable`) lands in phase 0.4.
 *
 * @see PLAN.md §5.6 and §12
 */
export const VERSION = "0.0.1" as const;

// ProfileV1's canonical source-of-truth lives in @mochi.js/consistency.
// Re-exported here through a generated shim so this package is a pure consumer
// of the type without duplicating the shape. See PLAN.md §5.6.
export type { ProfileV1 } from "./generated/profile";

/** ProfileV1 IDs that ship in the v1 catalog. */
export const KNOWN_PROFILE_IDS = [
  "mac-m4-chrome-stable",
  "mac-m2-chrome-stable",
  "mac-m1-chrome-stable",
  "mac-intel-chrome-stable",
  "win11-chrome-stable",
  "win11-edge-stable",
  "linux-chrome-stable",
  // Imported from harvester corpus per task 0260.
  "mac-chrome-stable",
  "mac-chrome-beta",
  "windows-chrome-stable",
  "mac-brave-stable",
] as const satisfies readonly string[];

export type ProfileId = (typeof KNOWN_PROFILE_IDS)[number];

/**
 * Resolve a profile by id. Lands in phase 0.4 when the first baseline is captured.
 */
export function getProfile(_id: ProfileId): never {
  throw new Error(
    "@mochi.js/profiles.getProfile is not yet implemented (v0.0.1 claim). " +
      "Lands in phase 0.4; see PLAN.md §12.",
  );
}
