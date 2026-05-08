/**
 * Cross-package contract: per-profile audio + canvas fingerprint blobs.
 *
 * For every shipped real-device profile under `packages/profiles/data/`,
 * we assert:
 *
 *   1. The profile's `baseline.manifest.json` carries `audio.audioHash` +
 *      `audio.sampleValues` and `canvas.hash` + `canvas.dataUrlPrefix` +
 *      `canvas.dataUrlLength` (the captures imported in 0260).
 *   2. R-047 / R-048 in `@mochi.js/consistency` populate
 *      `matrix.uaCh["audio-fingerprint"]` and `matrix.uaCh["canvas-fingerprint"]`
 *      with the same captured values.
 *   3. The inject payload's canvas synth round-trips: re-materialising the
 *      data URL from the embedded prefix+filler+tail produces a string
 *      whose `hashString` matches the captured baseline byte-exactly
 *      (the load-bearing meet-in-the-middle search).
 *   4. The audio module embeds the captured `audioHash` + 10-sample window
 *      verbatim in the emitted source.
 *
 * This is the offline gate that fires in CI before the (online) harness
 * E2E runs. A profile that fails this contract will diff loudly against
 * the harness baseline and is the canonical "you broke audio/canvas" signal.
 *
 * @see tasks/0267-audio-canvas-fingerprint-blobs.md
 */

import { describe, expect, it } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { deriveMatrix, type ProfileV1 } from "../../packages/consistency/src/index";
import { buildPayload } from "../../packages/inject/src/index";

const REPO_ROOT = (() => {
  let dir = import.meta.dirname;
  for (let i = 0; i < 32; i++) {
    if (existsSync(join(dir, "scripts", "mochi-work.ts"))) return dir;
    dir = join(dir, "..");
  }
  throw new Error("could not locate repo root");
})();

const PROFILES_DIR = join(REPO_ROOT, "packages", "profiles", "data");

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

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** Probe-side hashString — mirrors `tests/fixtures/probe-page.html`. */
function hashString(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h << 5) - h + s.charCodeAt(i);
    h |= 0;
  }
  return (h >>> 0).toString(16).toUpperCase().padStart(8, "0");
}

/**
 * Re-materialise the data URL from the inject payload's embedded
 * `SPOOF_PNG_PREFIX` / `SPOOF_PNG_TAIL` / `SPOOF_PNG_FILLER_LEN` —
 * mirrors what the runtime IIFE does.
 */
function rematerialise(payloadCode: string): {
  prefix: string;
  tail: string;
  fillerLen: number;
  url: string;
} | null {
  const prefMatch = payloadCode.match(/var SPOOF_PNG_PREFIX = (".*?");/);
  const tailMatch = payloadCode.match(/var SPOOF_PNG_TAIL = (".*?");/);
  const lenMatch = payloadCode.match(/var SPOOF_PNG_FILLER_LEN = (\d+);/);
  if (prefMatch === null || tailMatch === null || lenMatch === null) return null;
  const prefix = JSON.parse(prefMatch[1]!) as string;
  const tail = JSON.parse(tailMatch[1]!) as string;
  const fillerLen = Number.parseInt(lenMatch[1]!, 10);
  let filler = "";
  for (let i = 0; i < fillerLen; i++) filler += B64[(i * 7 + 11) % 64];
  return { prefix, tail, fillerLen, url: prefix + filler + tail };
}

describe("contract: audio + canvas fingerprint blobs (task 0267)", () => {
  const ids = shippedProfileDirs();

  it("ships at least 5 real-device profiles with audio + canvas captures", () => {
    expect(ids.length).toBeGreaterThanOrEqual(5);
  });

  for (const id of ids) {
    describe(id, () => {
      const dir = join(PROFILES_DIR, id);
      const profile = JSON.parse(readFileSync(join(dir, "profile.json"), "utf8")) as ProfileV1;
      const baseline = JSON.parse(readFileSync(join(dir, "baseline.manifest.json"), "utf8")) as {
        audio: { sampleRate: number; audioHash: string; sampleValues: number[] };
        canvas: {
          consistent: boolean;
          hash: string;
          dataUrlLength: number;
          dataUrlPrefix: string;
          webpSupport: boolean;
          jpegHighLength: number;
          jpegLowLength: number;
        };
      };
      const matrix = deriveMatrix(profile, "contract-seed");
      const payload = buildPayload(matrix);

      it("baseline.manifest carries audio + canvas captures", () => {
        expect(typeof baseline.audio.audioHash).toBe("string");
        expect(Array.isArray(baseline.audio.sampleValues)).toBe(true);
        expect(baseline.audio.sampleValues.length).toBeGreaterThanOrEqual(10);
        expect(baseline.canvas.hash).toMatch(/^[0-9A-F]{8}$/);
        expect(baseline.canvas.dataUrlLength).toBeGreaterThan(50);
        expect(baseline.canvas.dataUrlPrefix.startsWith("data:image/png;base64,")).toBe(true);
      });

      it("R-047 mirrors the captured audioHash + sampleValues window into matrix.uaCh", () => {
        const audio = JSON.parse(matrix.uaCh["audio-fingerprint"] ?? "{}") as {
          sampleRate: number;
          audioHash: string;
          sampleValues: number[];
        };
        expect(audio.audioHash).toBe(baseline.audio.audioHash);
        expect(audio.sampleValues.slice(0, 10)).toEqual(baseline.audio.sampleValues.slice(0, 10));
      });

      it("R-048 mirrors the captured canvas hash + length + prefix into matrix.uaCh", () => {
        const canvas = JSON.parse(matrix.uaCh["canvas-fingerprint"] ?? "{}") as {
          hash: string;
          dataUrlLength: number;
          dataUrlPrefix: string;
        };
        expect(canvas.hash).toBe(baseline.canvas.hash);
        expect(canvas.dataUrlLength).toBe(baseline.canvas.dataUrlLength);
        expect(canvas.dataUrlPrefix).toBe(baseline.canvas.dataUrlPrefix);
      });

      it("inject payload emits a canvas synth marker (build-time hash check passed)", () => {
        expect(payload.code).toContain("canvas-fingerprint synth verified");
      });

      it("inject payload's canvas synth round-trips to the captured hash + length", () => {
        const r = rematerialise(payload.code);
        expect(r).not.toBeNull();
        if (r === null) return;
        expect(r.url.length).toBe(baseline.canvas.dataUrlLength);
        expect(r.url.startsWith(baseline.canvas.dataUrlPrefix)).toBe(true);
        expect(hashString(r.url)).toBe(baseline.canvas.hash);
      });

      it("inject payload embeds the captured audioHash literal", () => {
        expect(payload.code).toContain(JSON.stringify(baseline.audio.audioHash));
      });

      it("inject payload embeds the first captured audio sample literal", () => {
        // Each captured sample appears as a JS Number literal in the
        // emitted source. We pick the first to pin the embedding.
        const firstSample = baseline.audio.sampleValues[0]!;
        expect(payload.code).toContain(String(firstSample));
      });
    });
  }
});
