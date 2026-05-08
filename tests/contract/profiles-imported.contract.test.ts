/**
 * Cross-package contract: every imported real-device profile under
 * `packages/profiles/data/` must
 *
 *   1. carry the canonical 4-file shape (profile.json + baseline.manifest.json
 *      + expected-divergences.json + PROVENANCE.md)
 *   2. validate against `schemas/profile.schema.json`
 *   3. round-trip through `deriveMatrix(profile, seed)` without throwing
 *   4. expose UA/uaCh/wreqPreset that match the device-class declaration
 *
 * This is the offline gate that fires in CI before the (online) harness
 * E2E runs. A profile that fails this contract is a half-imported profile
 * and must be dropped from `KNOWN_PROFILE_IDS` rather than shipped.
 *
 * @see tasks/0260-import-harvester-profiles.md
 * @see PLAN.md §12.2 (provenance discipline)
 */

import { describe, expect, it } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { loadProfileSchema, validate } from "../../packages/cli/src/capture/validate";
import { deriveMatrix, type ProfileV1 } from "../../packages/consistency/src/index";
import { KNOWN_PROFILE_IDS } from "../../packages/profiles/src/index";

const REPO_ROOT = (() => {
  let dir = import.meta.dirname;
  for (let i = 0; i < 32; i++) {
    if (existsSync(join(dir, "scripts", "mochi-work.ts"))) return dir;
    dir = join(dir, "..");
  }
  throw new Error("could not locate repo root");
})();

const PROFILES_DIR = join(REPO_ROOT, "packages", "profiles", "data");

/** Profile ids that ship as data dirs (not just placeholder catalog entries). */
function shippedProfileDirs(): string[] {
  if (!existsSync(PROFILES_DIR)) return [];
  return readdirSync(PROFILES_DIR)
    .filter((name) => {
      const sub = join(PROFILES_DIR, name);
      return (
        statSync(sub).isDirectory() &&
        existsSync(join(sub, "profile.json")) &&
        existsSync(join(sub, "baseline.manifest.json"))
      );
    })
    .sort();
}

describe("profiles imported from harvester corpus (task 0260)", () => {
  const ids = shippedProfileDirs();

  it("ships at least 5 profile data dirs (mac×3 + windows + linux + brave)", () => {
    expect(ids.length).toBeGreaterThanOrEqual(5);
    expect(ids).toContain("mac-chrome-stable");
    expect(ids).toContain("mac-chrome-beta");
    expect(ids).toContain("windows-chrome-stable");
    expect(ids).toContain("linux-chrome-stable");
    expect(ids).toContain("mac-m4-chrome-stable");
  });

  it("KNOWN_PROFILE_IDS contains every shipped profile dir", () => {
    for (const id of ids) {
      expect(KNOWN_PROFILE_IDS).toContain(id);
    }
  });

  for (const id of ids) {
    describe(id, () => {
      const dir = join(PROFILES_DIR, id);

      it("has the canonical 4-file shape", () => {
        expect(existsSync(join(dir, "profile.json"))).toBe(true);
        expect(existsSync(join(dir, "baseline.manifest.json"))).toBe(true);
        expect(existsSync(join(dir, "expected-divergences.json"))).toBe(true);
        expect(existsSync(join(dir, "PROVENANCE.md"))).toBe(true);
      });

      it("profile.json validates against the schema", async () => {
        const schema = await loadProfileSchema(REPO_ROOT);
        const profile = JSON.parse(readFileSync(join(dir, "profile.json"), "utf8")) as ProfileV1;
        const result = validate(profile, schema);
        if (!result.valid) {
          // eslint-disable-next-line no-console
          console.error(
            `[${id}] schema errors:\n` +
              result.errors.map((e) => `  ${e.path}: ${e.message}`).join("\n"),
          );
        }
        expect(result.valid).toBe(true);
      });

      it("deriveMatrix(profile, seed) succeeds", () => {
        const profile = JSON.parse(readFileSync(join(dir, "profile.json"), "utf8")) as ProfileV1;
        const matrix = deriveMatrix(profile, `contract-${id}`);
        expect(matrix.id).toBe(id);
        // userAgent must contain the browser major declared by the profile.
        expect(matrix.userAgent).toContain(`Chrome/${profile.browser.minVersion}`);
      });

      it("expected-divergences.json has the v1 shape", () => {
        const ed = JSON.parse(readFileSync(join(dir, "expected-divergences.json"), "utf8")) as {
          version: string;
          profile: string;
          paths: { path: string }[];
        };
        expect(ed.version).toBe("1");
        expect(ed.profile).toBe(id);
        expect(Array.isArray(ed.paths)).toBe(true);
      });

      it("PROVENANCE.md mentions the upstream URL or capture method", () => {
        const text = readFileSync(join(dir, "PROVENANCE.md"), "utf8");
        const mentionsHarvester = /wrkx\.app|harvester|api\/visitors/i.test(text);
        const mentionsCapture = /mochi capture|captured by/i.test(text);
        expect(mentionsHarvester || mentionsCapture).toBe(true);
      });
    });
  }
});
