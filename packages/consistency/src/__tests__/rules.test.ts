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
});
