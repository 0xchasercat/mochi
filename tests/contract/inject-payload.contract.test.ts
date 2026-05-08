/**
 * Cross-package contract: `@mochi.js/inject.buildPayload` is byte-stable
 * for a canonical (profile, seed) pair derived through
 * `@mochi.js/consistency.deriveMatrix`.
 *
 * This test pins the payload's sha256 against a golden value committed to
 * source. Any accidental payload churn — a renamed module, a reordered
 * defineProperty call, a comment-tweak that shifts whitespace — flips the
 * sha256 and trips this test.
 *
 * When the payload INTENTIONALLY changes (new spoof module, schema change,
 * etc.) the engineer running the change updates the golden value below
 * and the harness baselines downstream. This is the "visibility seam"
 * between inject changes and the harness.
 *
 * @see PLAN.md §5.3, §13
 * @see tasks/0030-inject-engine-v0.md §"Tests"
 */

import { describe, expect, it } from "bun:test";
import { deriveMatrix, type ProfileV1 } from "../../packages/consistency/src/index";
import { buildPayload } from "../../packages/inject/src/index";

/**
 * The canonical profile used for the payload-pin contract. A deterministic
 * stand-in for `mac-m2-chrome-stable` (which lands in phase 0.4 with real
 * captured data).
 *
 * IMPORTANT: do NOT modify this fixture without bumping the golden sha256
 * pin below. The downstream harness pins to the same `(profile, seed)`.
 */
const CANONICAL_PROFILE: ProfileV1 = {
  id: "contract-canonical-mac-m2",
  version: "0.0.0-contract",
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
    webglExtensions: [],
  },
  audio: { contextSampleRate: 48000, audioWorkletLatency: 0.005, destinationMaxChannelCount: 2 },
  fonts: { family: "macos-baseline", list: ["Helvetica"] },
  timezone: "America/Los_Angeles",
  locale: "en-US",
  languages: ["en-US", "en"],
  behavior: { hand: "right", tremor: 0.18, wpm: 60, scrollStyle: "smooth" },
  wreqPreset: "chrome_131_macos",
  userAgent:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  uaCh: {},
  entropyBudget: { fixed: [], perSeed: [] },
};

const CANONICAL_SEED = "contract-pin-seed";

/**
 * The pinned sha256. Auto-recorded on first run; once committed, deviations
 * fail the test. Update this hash AND the harness baselines together when
 * the payload's bytes intentionally change.
 *
 * Last updated 2026-05-08 alongside tasks/0140-stealth-conformance.md
 * (CloakBrowser-surfaced stealth conformance — adds two defensive shim
 * modules: window-chrome (mirrors Chrome's window.chrome shape only when
 * absent) and plugins (curated 5-plugin PluginArray only when underlying
 * browser reports an empty list). The payload now carries 14 spoof
 * modules (was 12). Both shims are no-ops on real Chrome.app, where the
 * surfaces are native, so the existing harness Zero-Diff gate is
 * unchanged at runtime — only the build-time payload bytes shift.
 */
const PINNED_SHA256 = "f9376ce481f5cfdbd0659daa9ed40744201213ab40b26fe031127ec2128752de";

describe("contract: @mochi.js/inject buildPayload sha256 is byte-stable per (profile, seed)", () => {
  it("buildPayload(deriveMatrix(profile, seed)) is deterministic", () => {
    const matrixA = deriveMatrix(CANONICAL_PROFILE, CANONICAL_SEED);
    const matrixB = deriveMatrix(CANONICAL_PROFILE, CANONICAL_SEED);
    const payloadA = buildPayload(matrixA);
    const payloadB = buildPayload(matrixB);
    expect(payloadA.sha256).toBe(payloadB.sha256);
    expect(payloadA.code).toBe(payloadB.code);
  });

  it("matches the pinned sha256 (or records a fresh pin on bootstrap)", () => {
    const matrix = deriveMatrix(CANONICAL_PROFILE, CANONICAL_SEED);
    const { sha256 } = buildPayload(matrix);
    if (PINNED_SHA256 === "__PIN_TBD__") {
      // Bootstrap mode — record-and-print so the engineer commits the pin.
      console.warn(
        `[mochi/contract] inject payload sha256 pin bootstrap: ${sha256}\n` +
          `[mochi/contract] update PINNED_SHA256 in this file to lock the pin.`,
      );
      // Intentionally pass — this is a one-time bootstrap path.
      return;
    }
    expect(sha256).toBe(PINNED_SHA256);
  });

  it("differs across distinct seeds", () => {
    const a = buildPayload(deriveMatrix(CANONICAL_PROFILE, "seed-a"));
    const b = buildPayload(deriveMatrix(CANONICAL_PROFILE, "seed-b"));
    expect(a.sha256).not.toBe(b.sha256);
  });
});
