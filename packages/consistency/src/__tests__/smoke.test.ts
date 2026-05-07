/**
 * Smoke test for @mochi.js/consistency v0.2.
 *
 * Verifies the package's public surface — VERSION, deriveMatrix shape,
 * and the engine version stamp. Per-rule unit tests live alongside in
 * `__tests__/rules.test.ts`; determinism + DAG tests live in their own
 * test files.
 */
import { describe, expect, it } from "bun:test";
import { CONSISTENCY_ENGINE_VERSION, deriveMatrix, type ProfileV1, RULES, VERSION } from "../index";

/**
 * Minimal valid ProfileV1 fixture covering the Mac M2 catalog profile.
 * Real profiles ship with `@mochi.js/profiles` (phase 0.4).
 */
const FIXTURE: ProfileV1 = {
  id: "test-profile",
  version: "1.0.0",
  engine: "chromium",
  browser: { name: "chrome", channel: "stable", minVersion: "131", maxVersion: "133" },
  os: { name: "macos", version: "14", arch: "arm64" },
  device: {
    vendor: "apple",
    model: "mac14,2",
    cpuFamily: "apple-silicon-m2",
    cores: 8,
    memoryGB: 16,
  },
  display: { width: 2560, height: 1664, dpr: 2, colorDepth: 30, pixelDepth: 30 },
  gpu: {
    vendor: "Apple",
    renderer: "Apple M2",
    webglUnmaskedVendor: "Google Inc. (Apple)",
    webglUnmaskedRenderer: "ANGLE (Apple, ANGLE Metal Renderer: Apple M2)",
    webglMaxTextureSize: 16384,
    webglMaxColorAttachments: 8,
    webglExtensions: [],
  },
  audio: { contextSampleRate: 44100, audioWorkletLatency: 0.0058, destinationMaxChannelCount: 2 },
  fonts: { family: "macos-system-arial-pack", list: ["Arial"] },
  timezone: "America/Los_Angeles",
  locale: "en-US",
  languages: ["en-US", "en"],
  behavior: { hand: "right", tremor: 0.18, wpm: 65, scrollStyle: "smooth" },
  wreqPreset: "chrome_131_macos",
  userAgent:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  uaCh: { "sec-ch-ua-platform": '"macOS"' },
  entropyBudget: { fixed: ["gpu.vendor"], perSeed: ["display.width"] },
};

describe("@mochi.js/consistency (v0.2 smoke)", () => {
  it("exports a semver-shaped VERSION", () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("exports a semver-shaped CONSISTENCY_ENGINE_VERSION", () => {
    expect(CONSISTENCY_ENGINE_VERSION).toBe("0.2.0");
  });

  it("ships at least the 30 v0.2 rules", () => {
    expect(RULES.length).toBeGreaterThanOrEqual(30);
  });

  it("deriveMatrix returns a MatrixV1 with seed + engine version stamped", () => {
    const matrix = deriveMatrix(FIXTURE, "seed-1");
    expect(matrix.seed).toBe("seed-1");
    expect(matrix.consistencyEngineVersion).toBe(CONSISTENCY_ENGINE_VERSION);
    expect(typeof matrix.derivedAt).toBe("string");
    // Sanity: the matrix carries the profile identity unchanged.
    expect(matrix.id).toBe(FIXTURE.id);
    expect(matrix.engine).toBe("chromium");
  });

  it("rejects empty seeds", () => {
    expect(() => deriveMatrix(FIXTURE, "")).toThrow(/non-empty/);
  });
});
