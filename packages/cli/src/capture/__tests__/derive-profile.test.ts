/**
 * Unit tests for `deriveProfile` — the probe-JSON → ProfileV1 translator.
 *
 * Covers the heuristics:
 *   - Apple Silicon Mn detection from `webgl.unmaskedRenderer`
 *   - Intel/AMD detection on Win/Linux
 *   - OS / arch detection from navigator + UAD high-entropy
 *   - cores / memoryGB derivation
 *   - languages list, fonts list, gpu, audio, display passthrough
 *   - schema validation: every fixture round-trips through validate()
 */

import { describe, expect, it } from "bun:test";
import { deriveProfile } from "../derive-profile";
import { loadProfileSchema, validate } from "../validate";

function macM2Probes() {
  return {
    navigator: {
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.6778.86 Safari/537.36",
      platform: "MacIntel",
      vendor: "Google Inc.",
      hardwareConcurrency: 8,
      deviceMemory: 8,
      language: "en-US",
      languages: ["en-US", "en"],
      userAgentData: {
        brands: [
          { brand: "Chromium", version: "131" },
          { brand: "Google Chrome", version: "131" },
          { brand: "Not_A Brand", version: "24" },
        ],
        mobile: false,
        platform: "macOS",
      },
      userAgentDataHighEntropy: {
        architecture: "arm",
        bitness: "64",
        platformVersion: "14.5.0",
        model: "Mac",
        fullVersionList: [{ brand: "Google Chrome", version: "131.0.6778.86" }],
      },
    },
    screen: {
      width: 1728,
      height: 1117,
      devicePixelRatio: 2,
      colorDepth: 30,
      pixelDepth: 30,
    },
    webgl: {
      unmaskedVendor: "Google Inc. (Apple)",
      unmaskedRenderer: "ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)",
      maxTextureSize: 16384,
      maxColorAttachments: 8,
      extensions: ["EXT_color_buffer_float", "OES_texture_float_linear"],
    },
    audio: { sampleRate: 48000, baseLatency: 0.0058, maxChannelCount: 2 },
    fonts: { detected: ["Helvetica", "Helvetica Neue", "Menlo", "Monaco"] },
    timing: { timezone: "America/Los_Angeles" },
  };
}

function win11ChromeProbes() {
  return {
    navigator: {
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.6778.86 Safari/537.36",
      platform: "Win32",
      hardwareConcurrency: 16,
      deviceMemory: 8,
      language: "en-US",
      languages: ["en-US", "en"],
      userAgentData: {
        brands: [
          { brand: "Chromium", version: "131" },
          { brand: "Google Chrome", version: "131" },
        ],
        mobile: false,
        platform: "Windows",
      },
      userAgentDataHighEntropy: {
        architecture: "x86",
        bitness: "64",
        platformVersion: "15.0.0",
        model: "",
      },
    },
    screen: {
      width: 2560,
      height: 1440,
      devicePixelRatio: 1,
      colorDepth: 24,
      pixelDepth: 24,
    },
    webgl: {
      unmaskedVendor: "Google Inc. (NVIDIA)",
      unmaskedRenderer: "ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Direct3D11 vs_5_0 ps_5_0, D3D11)",
      maxTextureSize: 16384,
      maxColorAttachments: 8,
    },
    audio: { sampleRate: 48000, baseLatency: 0.01, maxChannelCount: 2 },
    fonts: { detected: ["Arial", "Calibri", "Segoe UI", "Tahoma"] },
    timing: { timezone: "America/New_York" },
  };
}

describe("deriveProfile()", () => {
  it("translates a Mac M2 probe payload into a valid ProfileV1", async () => {
    const profile = deriveProfile(macM2Probes(), { profileId: "mac-m2-test" });
    expect(profile.id).toBe("mac-m2-test");
    expect(profile.engine).toBe("chromium");
    expect(profile.os.name).toBe("macos");
    expect(profile.os.arch).toBe("arm64");
    expect(profile.os.version).toBe("14.5.0");
    expect(profile.device.cpuFamily).toBe("apple-silicon-m2");
    expect(profile.device.cores).toBe(8);
    // memoryGB = navigator.deviceMemory * 2 = 8 * 2 = 16 (matches the typical Mac M2 16GB).
    expect(profile.device.memoryGB).toBe(16);
    expect(profile.display.dpr).toBe(2);
    expect(profile.gpu.webglUnmaskedVendor).toBe("Google Inc. (Apple)");
    expect(profile.gpu.webglUnmaskedRenderer).toContain("Apple M2");
    expect(profile.audio.contextSampleRate).toBe(48000);
    expect(profile.fonts.list).toContain("Helvetica");
    expect(profile.timezone).toBe("America/Los_Angeles");
    expect(profile.locale).toBe("en-US");
    expect(profile.languages).toEqual(["en-US", "en"]);
    expect(profile.userAgent).toContain("Chrome/131.0.6778.86");
    expect(profile.browser.name).toBe("chrome");
    expect(profile.browser.minVersion).toBe("131");
    expect(profile.wreqPreset).toBe("chrome_131_macos");
  });

  it("translates a Win11 Chrome NVIDIA probe payload into a valid ProfileV1", () => {
    const profile = deriveProfile(win11ChromeProbes(), { profileId: "win11-chrome-test" });
    expect(profile.os.name).toBe("windows");
    expect(profile.os.arch).toBe("x64");
    expect(profile.device.cpuFamily).toBe("intel-core");
    expect(profile.device.cores).toBe(16);
    expect(profile.gpu.vendor).toBe("NVIDIA Corporation");
    expect(profile.gpu.renderer).toContain("NVIDIA");
    expect(profile.wreqPreset).toBe("chrome_131_windows");
    expect(profile.fonts.list).toContain("Arial");
  });

  it("derived profile passes schema validation", async () => {
    const schema = await loadProfileSchema();
    const probesList = [macM2Probes(), win11ChromeProbes()];
    for (let i = 0; i < probesList.length; i++) {
      const profile = deriveProfile(probesList[i] ?? {}, { profileId: `roundtrip-${i}` });
      const result = validate(profile, schema);
      if (!result.valid) {
        // Surface the failing path so debugging is straightforward.
        console.error("schema errors:", result.errors);
      }
      expect(result.valid).toBe(true);
    }
  });

  it("falls back to safe defaults when probe payload is empty", async () => {
    const profile = deriveProfile({}, { profileId: "empty" });
    expect(profile.id).toBe("empty");
    expect(profile.os.name).toBe("macos"); // default UA implies mac
    const schema = await loadProfileSchema();
    const result = validate(profile, schema);
    expect(result.valid).toBe(true);
  });

  it("apple silicon variants are detected — M1, M2, M3, M4", () => {
    const variants = [
      { renderer: "ANGLE (Apple, ANGLE Metal Renderer: Apple M1)", expected: "apple-silicon-m1" },
      { renderer: "ANGLE (Apple, ANGLE Metal Renderer: Apple M2)", expected: "apple-silicon-m2" },
      {
        renderer: "ANGLE (Apple, ANGLE Metal Renderer: Apple M3 Pro)",
        expected: "apple-silicon-m3",
      },
      {
        renderer: "ANGLE (Apple, ANGLE Metal Renderer: Apple M4 Max)",
        expected: "apple-silicon-m4",
      },
    ];
    for (const v of variants) {
      const probes = macM2Probes();
      probes.webgl.unmaskedRenderer = v.renderer;
      const profile = deriveProfile(probes, { profileId: "variant" });
      expect(profile.device.cpuFamily).toBe(v.expected);
    }
  });
});
