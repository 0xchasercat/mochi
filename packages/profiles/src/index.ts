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
 * @see PLAN.md §5.6 and §12
 */
import { join } from "node:path";

export const VERSION = "0.0.1" as const;

// ProfileV1's canonical source-of-truth lives in @mochi.js/consistency.
// Re-exported here through a generated shim so this package is a pure consumer
// of the type without duplicating the shape. See PLAN.md §5.6.
export type { ProfileV1 } from "./generated/profile";

import type { ProfileV1 } from "./generated/profile";

/** ProfileV1 IDs that ship in the v1 catalog. */
export const KNOWN_PROFILE_IDS = [
  "mac-m4-chrome-stable",
  "mac-m2-chrome-stable",
  "mac-m1-chrome-stable",
  "mac-intel-chrome-stable",
  "win11-chrome-stable",
  "win11-edge-stable",
  "linux-chrome-stable",
  // Imported from harvester corpus per
  "mac-chrome-stable",
  "mac-chrome-beta",
  "windows-chrome-stable",
  "mac-brave-stable",
] as const satisfies readonly string[];

export type ProfileId = (typeof KNOWN_PROFILE_IDS)[number];

/**
 * The subset of {@link KNOWN_PROFILE_IDS} for which a captured baseline
 * (`data/<id>/profile.json`) actually ships in the npm package. The rest are
 * declared in the catalog so the type system tracks them, but {@link getProfile}
 * throws {@link ProfileBaselineMissingError} for those — callers should
 * fall back to a placeholder synthesis (see `@mochi.js/core.launch`'s
 * `synthesizePlaceholderProfile` for the pattern).
 */
const PROFILES_WITH_CAPTURED_BASELINE: ReadonlySet<ProfileId> = new Set([
  "mac-m4-chrome-stable",
  "mac-chrome-stable",
  "mac-chrome-beta",
  "linux-chrome-stable",
  "mac-brave-stable",
  "windows-chrome-stable",
]);

/** Thrown when `id` isn't in {@link KNOWN_PROFILE_IDS} at all. */
export class UnknownProfileIdError extends Error {
  override readonly name = "UnknownProfileIdError";
  readonly id: string;
  constructor(id: string) {
    super(
      `@mochi.js/profiles: unknown profile id "${id}". ` +
        `Expected one of: ${KNOWN_PROFILE_IDS.join(", ")}.`,
    );
    this.id = id;
  }
}

/**
 * Thrown when `id` is a known catalog entry but no captured baseline
 * (`data/<id>/profile.json`) ships in the package — typically a
 * declared-but-not-yet-captured device class. Callers may catch this
 * and fall back to a synthesized placeholder profile.
 */
export class ProfileBaselineMissingError extends Error {
  override readonly name = "ProfileBaselineMissingError";
  readonly id: ProfileId;
  constructor(id: ProfileId) {
    super(
      `@mochi.js/profiles: profile "${id}" is declared in KNOWN_PROFILE_IDS ` +
        `but no captured baseline ships in the package. ` +
        `Profiles with captured baselines: ${[...PROFILES_WITH_CAPTURED_BASELINE].join(", ")}.`,
    );
    this.id = id;
  }
}

/** True when `id` is a known catalog entry. */
function isKnownProfileId(id: string): id is ProfileId {
  return (KNOWN_PROFILE_IDS as readonly string[]).includes(id);
}

/**
 * True when {@link getProfile} can successfully load `id` (i.e. the id is
 * known AND a captured baseline ships). Useful for callers that want to
 * decide between the real-baseline path and a placeholder synthesis without
 * catching exceptions.
 */
export async function hasProfile(id: string): Promise<boolean> {
  if (!isKnownProfileId(id)) return false;
  if (!PROFILES_WITH_CAPTURED_BASELINE.has(id)) return false;
  return await Bun.file(profilePath(id)).exists();
}

/**
 * Resolve a profile by id, loading the captured `data/<id>/profile.json`
 * baseline that ships with this package.
 *
 * Throws:
 *   - {@link UnknownProfileIdError} if `id` isn't in {@link KNOWN_PROFILE_IDS}.
 *   - {@link ProfileBaselineMissingError} if `id` is known but no baseline
 *     ships in the package — callers may fall back to a placeholder.
 */
export async function getProfile(id: ProfileId): Promise<ProfileV1> {
  if (!isKnownProfileId(id)) {
    // Defensive: callers using `as ProfileId` may sneak unknown values past
    // the type system. Surface a precise error rather than a file-not-found.
    throw new UnknownProfileIdError(id);
  }
  if (!PROFILES_WITH_CAPTURED_BASELINE.has(id)) {
    throw new ProfileBaselineMissingError(id);
  }
  const file = Bun.file(profilePath(id));
  if (!(await file.exists())) {
    // Inconsistency between the in-source set and the on-disk data —
    // surface as the same baseline-missing error so callers' fallback
    // logic still kicks in. This shouldn't happen in published builds.
    throw new ProfileBaselineMissingError(id);
  }
  return (await file.json()) as ProfileV1;
}

/**
 * Absolute path to a profile's captured `profile.json`. Uses
 * `import.meta.dir` so the lookup works both in-source (running from
 * `packages/profiles/src/`) and after publish (the `data/` dir ships as a
 * sibling of `src/` per the package's `files` array).
 */
function profilePath(id: ProfileId): string {
  return join(import.meta.dir, "..", "data", id, "profile.json");
}
