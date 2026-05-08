/**
 * Per-rule unit tests — each v0.2 rule gets a golden assertion driving the
 * relational lock for the canonical Mac M2 + Win11 profiles. The tests
 * exercise the rules through the full `deriveMatrix` pipeline rather than
 * by calling `rule.derive` directly, so the integration is what's locked.
 */
import { describe, expect, it } from "bun:test";
import { deriveMatrix } from "../derive";
import { MAC_M2_CHROME, WIN11_EDGE } from "./fixture";

const SEED = "rule-test-seed";

describe("rules — v0.2 ruleset (golden lock)", () => {
  const macMatrix = deriveMatrix(MAC_M2_CHROME, SEED);
  const winMatrix = deriveMatrix(WIN11_EDGE, SEED);

  it("R-001: webgl unmasked vendor wraps device vendor in 'Google Inc. (...)'", () => {
    expect(macMatrix.gpu.webglUnmaskedVendor).toBe("Google Inc. (Apple)");
    expect(winMatrix.gpu.webglUnmaskedVendor).toBe("Google Inc. (Intel Inc.)");
  });

  it("R-002: webgl unmasked renderer wraps in ANGLE prefix", () => {
    expect(macMatrix.gpu.webglUnmaskedRenderer).toBe(
      "ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)",
    );
    expect(winMatrix.gpu.webglUnmaskedRenderer).toBe(
      "ANGLE (Intel, Intel Iris Xe Graphics, OpenGL 4.1)",
    );
  });

  it("R-003: max texture size lookup", () => {
    expect(macMatrix.gpu.webglMaxTextureSize).toBe(16384);
    expect(winMatrix.gpu.webglMaxTextureSize).toBe(16384);
  });

  it("R-004: userAgent contains the seeded build version", () => {
    expect(macMatrix.userAgent).toContain("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)");
    expect(macMatrix.userAgent).toMatch(/Chrome\/131\.0\.\d+\.\d+/);
    expect(winMatrix.userAgent).toContain("Windows NT 10.0; Win64; x64");
    expect(winMatrix.userAgent).toMatch(/Edg\/131\.0\.\d+\.\d+/);
  });

  it("R-005: sec-ch-ua brand list — branded, GREASE (pinned v=8), Chromium", () => {
    expect(macMatrix.uaCh["sec-ch-ua"]).toBe(
      '"Google Chrome";v="131", "Not.A/Brand";v="8", "Chromium";v="131"',
    );
    expect(winMatrix.uaCh["sec-ch-ua"]).toBe(
      '"Microsoft Edge";v="131", "Not.A/Brand";v="8", "Chromium";v="131"',
    );
  });

  it("R-006: sec-ch-ua-platform", () => {
    expect(macMatrix.uaCh["sec-ch-ua-platform"]).toBe('"macOS"');
    expect(winMatrix.uaCh["sec-ch-ua-platform"]).toBe('"Windows"');
  });

  it("R-007: sec-ch-ua-platform-version is the quoted OS version", () => {
    expect(macMatrix.uaCh["sec-ch-ua-platform-version"]).toBe('"14"');
    expect(winMatrix.uaCh["sec-ch-ua-platform-version"]).toBe('"11"');
  });

  it("R-008: device.cores passthrough — mirrors profile.device.cores exactly", () => {
    expect(macMatrix.device.cores).toBe(8);
    expect(winMatrix.device.cores).toBe(16);
  });

  it("R-009: device.memoryGB caps at 8 (Chrome quantization)", () => {
    expect(macMatrix.device.memoryGB).toBe(8);
    expect(winMatrix.device.memoryGB).toBe(8);
  });

  it("R-010: screen-dimensions tuple includes width, height, availWidth, availHeight", () => {
    const dims = JSON.parse(macMatrix.uaCh["screen-dimensions"] ?? "null") as {
      width: number;
      height: number;
      availWidth: number;
      availHeight: number;
    };
    expect(dims.width).toBe(2560);
    expect(dims.height).toBe(1664);
    expect(dims.availWidth).toBe(2560);
    expect(dims.availHeight).toBe(1664 - 25); // mac menubar
  });

  it("R-011: colorDepth passthrough", () => {
    expect(macMatrix.display.colorDepth).toBe(30);
    expect(winMatrix.display.colorDepth).toBe(24);
  });

  it("R-012: dpr passthrough", () => {
    expect(macMatrix.display.dpr).toBe(2);
    expect(winMatrix.display.dpr).toBe(1);
  });

  it("R-013: fonts.list is the OS baseline", () => {
    expect(macMatrix.fonts.list).toContain("Arial");
    expect(macMatrix.fonts.list).toContain("Helvetica");
    expect(winMatrix.fonts.list).toContain("Segoe UI");
    expect(winMatrix.fonts.list).toContain("Calibri");
  });

  it("R-014: timezone passthrough", () => {
    expect(macMatrix.timezone).toBe("America/Los_Angeles");
    expect(winMatrix.timezone).toBe("America/New_York");
  });

  it("R-015: locale passthrough", () => {
    expect(macMatrix.locale).toBe("en-US");
  });

  it("R-016: languages passthrough", () => {
    expect(macMatrix.languages).toEqual(["en-US", "en"]);
  });

  it("R-017: navigator.platform per OS", () => {
    expect(macMatrix.uaCh["navigator-platform"]).toBe("MacIntel");
    expect(winMatrix.uaCh["navigator-platform"]).toBe("Win32");
  });

  it("R-018: navigator.vendor — 'Google Inc.' on chromium-family", () => {
    expect(macMatrix.uaCh["navigator-vendor"]).toBe("Google Inc.");
    expect(winMatrix.uaCh["navigator-vendor"]).toBe("Google Inc.");
  });

  it("R-019: seed-derived noise is 32-hex-char (16-byte) string", () => {
    expect(macMatrix.uaCh["seed-derived-noise"]).toMatch(/^[0-9a-f]{32}$/);
  });

  it("R-020: maxTouchPoints = 0 on desktop", () => {
    expect(macMatrix.uaCh["navigator-maxTouchPoints"]).toBe("0");
  });

  it("R-021: avail-screen subtracts OS chrome", () => {
    const avail = JSON.parse(macMatrix.uaCh["screen-availSize"] ?? "null") as {
      availWidth: number;
      availHeight: number;
    };
    expect(avail.availHeight).toBe(1664 - 25);
  });

  it("R-022: navigator.webdriver = false", () => {
    expect(macMatrix.uaCh["navigator-webdriver"]).toBe("false");
  });

  it("R-023: ua-build-hash is 8-hex-char (4-byte) string", () => {
    expect(macMatrix.uaCh["ua-build-hash"]).toMatch(/^[0-9a-f]{8}$/);
  });

  it("R-024: gpu.webglExtensions is the curated vendor list, non-empty", () => {
    expect(macMatrix.gpu.webglExtensions.length).toBeGreaterThan(0);
    expect(macMatrix.gpu.webglExtensions).toContain("WEBGL_debug_renderer_info");
    // Apple-class includes ASTC; Intel-class doesn't.
    expect(macMatrix.gpu.webglExtensions).toContain("WEBGL_compressed_texture_astc");
    expect(winMatrix.gpu.webglExtensions).not.toContain("WEBGL_compressed_texture_astc");
  });

  it("R-025: max color attachments = 8 on desktop GPUs", () => {
    expect(macMatrix.gpu.webglMaxColorAttachments).toBe(8);
    expect(winMatrix.gpu.webglMaxColorAttachments).toBe(8);
  });

  it("R-026: navigator.appVersion is userAgent without 'Mozilla/' prefix", () => {
    expect(macMatrix.uaCh["navigator-appVersion"]).toBe(
      macMatrix.userAgent.replace(/^Mozilla\//, ""),
    );
  });

  it("R-027: navigator.appCodeName = 'Mozilla'", () => {
    expect(macMatrix.uaCh["navigator-appCodeName"]).toBe("Mozilla");
  });

  it("R-028: navigator.product = 'Gecko'", () => {
    expect(macMatrix.uaCh["navigator-product"]).toBe("Gecko");
  });

  it("R-029: window-viewport carries inner/outer dimensions", () => {
    const vp = JSON.parse(macMatrix.uaCh["window-viewport"] ?? "null") as {
      innerWidth: number;
      innerHeight: number;
      outerWidth: number;
      outerHeight: number;
    };
    expect(vp.outerWidth).toBe(2560);
    expect(vp.outerHeight).toBe(1664 - 25);
    expect(vp.innerWidth).toBe(2560);
    expect(vp.innerHeight).toBe(1664 - 25 - 87); // mac browser-chrome
  });

  it("R-030: navigator.cookieEnabled = true", () => {
    expect(macMatrix.uaCh["navigator-cookieEnabled"]).toBe("true");
  });

  // ---- phase-0.7 rules (R-031..R-040) ------------------------------------

  it("R-031: ua-full-version-list is JSON of {brand,version} with tip-locked Chrome 131", () => {
    const raw = macMatrix.uaCh["ua-full-version-list"];
    expect(typeof raw).toBe("string");
    const parsed = JSON.parse(raw ?? "[]") as { brand: string; version: string }[];
    expect(parsed).toEqual([
      { brand: "Google Chrome", version: "131.0.6778.110" },
      { brand: "Not.A/Brand", version: "8.0.0.0" },
      { brand: "Chromium", version: "131.0.6778.110" },
    ]);
  });

  it("R-032: webgpu-features carries the Apple-class catalog", () => {
    const raw = macMatrix.uaCh["webgpu-features"];
    const features = JSON.parse(raw ?? "[]") as string[];
    expect(features).toContain("shader-f16");
    expect(features).toContain("texture-compression-astc");
    expect(features).toContain("subgroups");
    expect(features.length).toBeGreaterThanOrEqual(20);
  });

  it("R-033: webgpu-info has architecture metal-3 for Apple GPUs", () => {
    const raw = macMatrix.uaCh["webgpu-info"];
    const info = JSON.parse(raw ?? "{}") as { architecture: string; vendor: string };
    expect(info.vendor).toBe("apple");
    expect(info.architecture).toBe("metal-3");
  });

  it("R-034: media-devices shape declares audioinput / videoinput / audiooutput", () => {
    const raw = macMatrix.uaCh["media-devices"];
    const devices = JSON.parse(raw ?? "[]") as { kind: string }[];
    const kinds = devices.map((d) => d.kind);
    expect(kinds).toContain("audioinput");
    expect(kinds).toContain("videoinput");
    expect(kinds).toContain("audiooutput");
  });

  it("R-035: media-supported-constraints map includes deviceId + groupId", () => {
    const raw = macMatrix.uaCh["media-supported-constraints"];
    const map = JSON.parse(raw ?? "{}") as Record<string, true>;
    expect(map.deviceId).toBe(true);
    expect(map.groupId).toBe(true);
    expect(map.echoCancellation).toBe(true);
  });

  it("R-036: permissions defaults map sensors to granted, prompts to prompt", () => {
    const raw = macMatrix.uaCh["permissions-defaults"];
    const map = JSON.parse(raw ?? "{}") as Record<string, string>;
    expect(map.geolocation).toBe("prompt");
    expect(map.accelerometer).toBe("granted");
    expect(map["clipboard-write"]).toBe("granted");
  });

  it("R-037: connection defaults to 4g effective type", () => {
    const raw = macMatrix.uaCh.connection;
    const conn = JSON.parse(raw ?? "{}") as { effectiveType: string; saveData: boolean };
    expect(conn.effectiveType).toBe("4g");
    expect(conn.saveData).toBe(false);
  });

  it("R-038: screen-orientation is landscape-primary on desktop", () => {
    const raw = macMatrix.uaCh["screen-orientation"];
    const o = JSON.parse(raw ?? "{}") as { type: string; angle: number };
    expect(o.type).toBe("landscape-primary");
    expect(o.angle).toBe(0);
  });

  it("R-039: media-queries map carries prefers-color-scheme + color-gamut", () => {
    const raw = macMatrix.uaCh["media-queries"];
    const map = JSON.parse(raw ?? "{}") as Record<string, string | boolean>;
    expect(map["prefers-color-scheme"]).toBe("light");
    expect(map["color-gamut"]).toBe("srgb");
    expect(map.monochrome).toBe(false);
  });

  it("R-040: storage-estimate quota scales with cores; usage is 0", () => {
    const raw = macMatrix.uaCh["storage-estimate"];
    const e = JSON.parse(raw ?? "{}") as { quota: number; usage: number };
    expect(e.usage).toBe(0);
    expect(e.quota).toBeGreaterThan(0);
  });

  it("R-041: mouseEvent-screen-formula encodes the clientXY + window.screenXY identity", () => {
    const raw = macMatrix.uaCh["mouseEvent-screen-formula"];
    const f = JSON.parse(raw ?? "{}") as { screenX: string; screenY: string; rule: string };
    expect(f.screenX).toBe("clientX + window.screenX");
    expect(f.screenY).toBe("clientY + window.screenY");
    expect(f.rule).toBe("R-041");
    // Profile-invariant — Win and Mac both lock to the same identity.
    expect(macMatrix.uaCh["mouseEvent-screen-formula"]).toBe(
      winMatrix.uaCh["mouseEvent-screen-formula"],
    );
  });

  // ---- task 0261 rules (R-042..R-046) — UA-CH metadata struct ------------

  it("R-042: sec-ch-ua-arch is quoted arm on apple-silicon, x86 on win-x64", () => {
    expect(macMatrix.uaCh["sec-ch-ua-arch"]).toBe('"arm"');
    expect(winMatrix.uaCh["sec-ch-ua-arch"]).toBe('"x86"');
  });

  it("R-043: sec-ch-ua-bitness is quoted '64' on 64-bit profiles (never numeric)", () => {
    expect(macMatrix.uaCh["sec-ch-ua-bitness"]).toBe('"64"');
    expect(winMatrix.uaCh["sec-ch-ua-bitness"]).toBe('"64"');
    // Type assertion — a future regression that ships numeric `bitness`
    // would still match the JSON-encoded "64" via .toBe but typeof would
    // shift; the contract test in tests/contract/uach-network-parity also
    // covers the CDP-level `typeof` invariant.
    expect(typeof macMatrix.uaCh["sec-ch-ua-bitness"]).toBe("string");
  });

  it("R-044: sec-ch-ua-mobile is ?0 for desktop (Structured-Headers boolean)", () => {
    expect(macMatrix.uaCh["sec-ch-ua-mobile"]).toBe("?0");
    expect(winMatrix.uaCh["sec-ch-ua-mobile"]).toBe("?0");
  });

  it("R-045: sec-ch-ua-model is empty quoted string for desktop OSes (per spec)", () => {
    expect(macMatrix.uaCh["sec-ch-ua-model"]).toBe('""');
    expect(winMatrix.uaCh["sec-ch-ua-model"]).toBe('""');
  });

  it("R-046: ua-full-version is the branded entry's version from R-031's list", () => {
    const macFullList = JSON.parse(macMatrix.uaCh["ua-full-version-list"] ?? "[]") as {
      brand: string;
      version: string;
    }[];
    expect(macMatrix.uaCh["ua-full-version"]).toBe(macFullList[0]?.version);
    // For Chrome 131 the tip table pins this — pinning the literal here
    // catches a regression that flipped the branded entry to GREASE
    // (which would emit "8.0.0.0" — explicitly NOT what we want).
    expect(macMatrix.uaCh["ua-full-version"]).toBe("131.0.6778.110");
  });

  // ---- task 0267 rules (R-047 / R-048) — audio + canvas fingerprint ------

  it("R-047: audio-fingerprint slot carries sampleRate + audioHash + 10-sample window", () => {
    const audio = JSON.parse(macMatrix.uaCh["audio-fingerprint"] ?? "{}") as {
      sampleRate: number;
      audioHash: string;
      sampleValues: number[];
    };
    // Off-list fixture id falls back to the macOS baseline. The shape must
    // be present regardless.
    expect(typeof audio.sampleRate).toBe("number");
    expect(typeof audio.audioHash).toBe("string");
    expect(Array.isArray(audio.sampleValues)).toBe(true);
    expect(audio.sampleValues.length).toBe(10);
  });

  it("R-048: canvas-fingerprint slot carries hash + dataUrlPrefix + dataUrlLength", () => {
    const canvas = JSON.parse(macMatrix.uaCh["canvas-fingerprint"] ?? "{}") as {
      consistent: boolean;
      hash: string;
      dataUrlLength: number;
      dataUrlPrefix: string;
      webpSupport: boolean;
      jpegHighLength: number;
      jpegLowLength: number;
    };
    expect(canvas.consistent).toBe(true);
    expect(canvas.hash).toMatch(/^[0-9A-F]{8}$/);
    expect(canvas.dataUrlPrefix.startsWith("data:image/png;base64,")).toBe(true);
    expect(canvas.dataUrlLength).toBeGreaterThan(canvas.dataUrlPrefix.length);
    expect(typeof canvas.webpSupport).toBe("boolean");
    expect(canvas.jpegHighLength).toBeGreaterThan(0);
    expect(canvas.jpegLowLength).toBeGreaterThan(0);
  });
});
