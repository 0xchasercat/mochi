import { describe, expect, it } from "bun:test";
import { deriveMatrix, type ProfileV1, VERSION } from "../index";

/**
 * Minimal valid ProfileV1 fixture. Real profiles live in @mochi.js/profiles
 * (phase 0.4); this fixture exists only so the v0.0.1 claim test can pass a
 * type-correct argument to the not-yet-implemented deriveMatrix() throw-path.
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

describe("@mochi.js/consistency (claim release)", () => {
  it("exports VERSION", () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("deriveMatrix throws until phase 0.2", () => {
    expect(() => deriveMatrix(FIXTURE, "seed")).toThrow(/not yet implemented/);
  });
});
