/**
 * Cross-package contract: `mochi.launch({profile, seed})` exposes a
 * `Session.profile` that is the relationally-locked Matrix derived by
 * `@mochi.js/consistency.deriveMatrix` from the same `(profile, seed)` pair.
 *
 * The test does NOT spawn Chromium — it calls `deriveMatrix` directly with
 * the same inputs the launch path would, and verifies the values match the
 * v0.2 rule outputs for a known fixture. This keeps the contract test
 * offline and fast while still exercising the binding surface that
 * `@mochi.js/core` consumes.
 *
 * @see PLAN.md §5.2
 * @see tasks/0020-consistency-engine-v0.md
 */
import { describe, expect, it } from "bun:test";
import {
  CONSISTENCY_ENGINE_VERSION,
  deriveMatrix,
  type ProfileV1,
} from "../../packages/consistency/src/index";

const FIXTURE: ProfileV1 = {
  id: "mac-m2-chrome-stable",
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
    webglUnmaskedRenderer: "ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)",
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

const SEED = "contract-derivation-seed";

describe("contract: deriveMatrix output (v0.2 golden)", () => {
  const matrix = deriveMatrix(FIXTURE, SEED);

  it("stamps the seed and engine version", () => {
    expect(matrix.seed).toBe(SEED);
    expect(matrix.consistencyEngineVersion).toBe(CONSISTENCY_ENGINE_VERSION);
  });

  it("derivedAt is a parseable ISO-8601 timestamp", () => {
    expect(Date.parse(matrix.derivedAt)).not.toBeNaN();
  });

  it("R-001/R-002: webgl unmasked strings match the rule lookups", () => {
    expect(matrix.gpu.webglUnmaskedVendor).toBe("Google Inc. (Apple)");
    expect(matrix.gpu.webglUnmaskedRenderer).toBe(
      "ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)",
    );
  });

  it("R-004 + R-023: userAgent has a seed-driven build version", () => {
    // Same seed → same UA. Different seed → different UA.
    const second = deriveMatrix(FIXTURE, SEED);
    expect(matrix.userAgent).toBe(second.userAgent);
    const other = deriveMatrix(FIXTURE, `${SEED}-other`);
    expect(matrix.userAgent).not.toBe(other.userAgent);
    expect(matrix.userAgent).toMatch(/Chrome\/131\.0\.\d+\.\d+/);
  });

  it("R-005/R-006/R-007: client-hints are populated", () => {
    expect(matrix.uaCh["sec-ch-ua"]).toContain("Google Chrome");
    expect(matrix.uaCh["sec-ch-ua-platform"]).toBe('"macOS"');
    expect(matrix.uaCh["sec-ch-ua-platform-version"]).toBe('"14"');
  });

  it("R-013: fonts.list matches the macOS baseline (and includes a known macOS-only font)", () => {
    expect(matrix.fonts.list).toContain("Helvetica Neue");
  });

  it("matrix round-trips through JSON without loss", () => {
    const trip = JSON.parse(JSON.stringify(matrix));
    expect(trip).toEqual(matrix);
  });

  it("two derivations of the same (profile, seed) match byte-for-byte (excluding derivedAt)", () => {
    const a = deriveMatrix(FIXTURE, SEED);
    const b = deriveMatrix(FIXTURE, SEED);
    const { derivedAt: _x, ...aRest } = a;
    const { derivedAt: _y, ...bRest } = b;
    expect(JSON.stringify(aRest)).toBe(JSON.stringify(bRest));
  });
});
