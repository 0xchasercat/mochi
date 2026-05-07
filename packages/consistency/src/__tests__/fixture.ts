/**
 * Shared test fixture — a Mac M2 Chrome profile used by the unit tests.
 * Kept here so the per-rule + determinism tests share one canonical input.
 */
import type { ProfileV1 } from "../generated/profile";

export const MAC_M2_CHROME: ProfileV1 = {
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

export const WIN11_EDGE: ProfileV1 = {
  id: "win11-edge-stable",
  version: "1.0.0",
  engine: "chromium",
  browser: { name: "edge", channel: "stable", minVersion: "131", maxVersion: "133" },
  os: { name: "windows", version: "11", arch: "x64" },
  device: {
    vendor: "dell",
    model: "xps-15-9530",
    cpuFamily: "intel-core-i7",
    cores: 16,
    memoryGB: 32,
  },
  display: { width: 1920, height: 1200, dpr: 1, colorDepth: 24, pixelDepth: 24 },
  gpu: {
    vendor: "Intel Inc.",
    renderer: "Intel Iris Xe Graphics",
    webglUnmaskedVendor: "Google Inc. (Intel Inc.)",
    webglUnmaskedRenderer: "ANGLE (Intel Inc., Intel Iris Xe Graphics, OpenGL 4.1)",
    webglMaxTextureSize: 16384,
    webglMaxColorAttachments: 8,
    webglExtensions: [],
  },
  audio: { contextSampleRate: 48000, audioWorkletLatency: 0.0102, destinationMaxChannelCount: 2 },
  fonts: { family: "win11-baseline", list: ["Segoe UI"] },
  timezone: "America/New_York",
  locale: "en-US",
  languages: ["en-US", "en"],
  behavior: { hand: "right", tremor: 0.2, wpm: 60, scrollStyle: "smooth" },
  wreqPreset: "edge_131_windows",
  userAgent:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0",
  uaCh: {},
  entropyBudget: { fixed: [], perSeed: [] },
};
