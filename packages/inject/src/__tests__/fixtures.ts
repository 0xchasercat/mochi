/**
 * Shared test fixtures for the inject unit tests.
 *
 * The canonical matrix is a deterministically-derived `MatrixV1` for
 * `(profile = mac-m2-chrome-stable-fixture, seed = "fixture-seed")`. We
 * pin a hand-built fixture rather than calling `deriveMatrix` so the
 * inject tests stay independent of the consistency engine's exact
 * behaviour — what we want is "given THIS matrix, the payload spoofs
 * THIS surface".
 *
 * The contract test in `tests/contract/inject-payload.contract.test.ts`
 * uses the consistency engine's real `deriveMatrix` for the sha256 pin.
 */

import type { MatrixV1 } from "@mochi.js/consistency";

export const FIXTURE_MATRIX: MatrixV1 = {
  id: "mac-m2-chrome-stable-fixture",
  version: "0.0.0-fixture",
  engine: "chromium",
  browser: { name: "chrome", channel: "stable", minVersion: "131", maxVersion: "133" },
  os: { name: "macos", version: "14", arch: "arm64" },
  device: {
    vendor: "Apple",
    model: "Mac14,2",
    cpuFamily: "apple-silicon-m2",
    cores: 8,
    memoryGB: 16,
  },
  display: { width: 1728, height: 1117, dpr: 2, colorDepth: 30, pixelDepth: 30 },
  gpu: {
    vendor: "Apple Inc.",
    renderer: "Apple M2",
    webglUnmaskedVendor: "Google Inc. (Apple)",
    webglUnmaskedRenderer: "ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)",
    webglMaxTextureSize: 16384,
    webglMaxColorAttachments: 8,
    webglExtensions: ["ANGLE_instanced_arrays", "EXT_blend_minmax", "EXT_color_buffer_half_float"],
  },
  audio: { contextSampleRate: 48000, audioWorkletLatency: 0.005, destinationMaxChannelCount: 2 },
  fonts: {
    family: "macos-baseline",
    list: ["Helvetica", "Helvetica Neue", "Arial", "Times", "Courier"],
  },
  timezone: "America/Los_Angeles",
  locale: "en-US",
  languages: ["en-US", "en"],
  behavior: { hand: "right", tremor: 0.18, wpm: 60, scrollStyle: "smooth" },
  wreqPreset: "chrome_131_macos",
  userAgent:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.6778.86 Safari/537.36",
  uaCh: {
    "sec-ch-ua": '"Google Chrome";v="131", "Not.A/Brand";v="8", "Chromium";v="131"',
    "sec-ch-ua-platform": '"macOS"',
    "sec-ch-ua-platform-version": '"14.0.0"',
    "sec-ch-ua-arch": '"arm"',
    "sec-ch-ua-bitness": '"64"',
    "sec-ch-ua-mobile": "?0",
    "navigator-platform": "MacIntel",
    "navigator-vendor": "Google Inc.",
    "navigator-appCodeName": "Mozilla",
    "navigator-product": "Gecko",
    "navigator-cookieEnabled": "true",
    "navigator-maxTouchPoints": "0",
    "navigator-webdriver": "false",
    "navigator-appVersion":
      "5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.6778.86 Safari/537.36",
    "screen-availSize": JSON.stringify({ availWidth: 1728, availHeight: 1092 }),
    "screen-dimensions": JSON.stringify({
      width: 1728,
      height: 1117,
      availWidth: 1728,
      availHeight: 1092,
    }),
    "window-viewport": JSON.stringify({
      innerWidth: 1728,
      innerHeight: 1005,
      outerWidth: 1728,
      outerHeight: 1092,
    }),
    "mouseEvent-screen-formula": JSON.stringify({
      screenX: "clientX + window.screenX",
      screenY: "clientY + window.screenY",
      rule: "R-041",
    }),
  },
  entropyBudget: { fixed: [], perSeed: [] },
  seed: "fixture-seed",
  derivedAt: "2026-01-01T00:00:00.000Z",
  consistencyEngineVersion: "0.2.0-fixture",
};
