/**
 * Unit: payload runtime overrides.
 *
 * Loads the payload string into a synthesized JS sandbox (no Bun.spawn,
 * no real Chromium) and asserts each spoofed property reads back the
 * matrix value.
 *
 * The sandbox is a minimal stand-in — the real proof is the E2E test in
 * `packages/core/src/__tests__/inject.e2e.test.ts`. These unit tests
 * verify the payload's *intent* and exercise the structure on the fast
 * feedback loop.
 */

import { describe, expect, it } from "bun:test";
import { buildPayload } from "../build";
import { FIXTURE_MATRIX } from "./fixtures";
import { runPayloadInSandbox } from "./sandbox";

describe("inject runtime overrides — navigator", () => {
  it("overrides navigator.userAgent", () => {
    const { code } = buildPayload(FIXTURE_MATRIX);
    const sb = runPayloadInSandbox(code);
    expect(sb.navigator.userAgent).toBe(FIXTURE_MATRIX.userAgent);
  });

  it("overrides navigator.platform from uaCh", () => {
    const { code } = buildPayload(FIXTURE_MATRIX);
    const sb = runPayloadInSandbox(code);
    expect(sb.navigator.platform).toBe(FIXTURE_MATRIX.uaCh["navigator-platform"]);
  });

  it("overrides navigator.vendor from uaCh", () => {
    const { code } = buildPayload(FIXTURE_MATRIX);
    const sb = runPayloadInSandbox(code);
    expect(sb.navigator.vendor).toBe(FIXTURE_MATRIX.uaCh["navigator-vendor"]);
  });

  it("overrides navigator.appVersion from uaCh", () => {
    const { code } = buildPayload(FIXTURE_MATRIX);
    const sb = runPayloadInSandbox(code);
    expect(sb.navigator.appVersion).toBe(FIXTURE_MATRIX.uaCh["navigator-appVersion"]);
  });

  it("overrides navigator.{appCodeName,product}", () => {
    const { code } = buildPayload(FIXTURE_MATRIX);
    const sb = runPayloadInSandbox(code);
    expect(sb.navigator.appCodeName).toBe("Mozilla");
    expect(sb.navigator.product).toBe("Gecko");
  });

  it("overrides navigator.cookieEnabled to boolean true", () => {
    const { code } = buildPayload(FIXTURE_MATRIX);
    const sb = runPayloadInSandbox(code);
    expect(sb.navigator.cookieEnabled).toBe(true);
  });

  it("overrides navigator.maxTouchPoints to number 0", () => {
    const { code } = buildPayload(FIXTURE_MATRIX);
    const sb = runPayloadInSandbox(code);
    expect(sb.navigator.maxTouchPoints).toBe(0);
  });

  it("overrides navigator.webdriver to boolean false", () => {
    const { code } = buildPayload(FIXTURE_MATRIX);
    const sb = runPayloadInSandbox(code);
    expect(sb.navigator.webdriver).toBe(false);
  });

  it("overrides navigator.hardwareConcurrency from device.cores", () => {
    const { code } = buildPayload(FIXTURE_MATRIX);
    const sb = runPayloadInSandbox(code);
    expect(sb.navigator.hardwareConcurrency).toBe(FIXTURE_MATRIX.device.cores);
  });

  it("overrides navigator.deviceMemory from device.memoryGB", () => {
    const { code } = buildPayload(FIXTURE_MATRIX);
    const sb = runPayloadInSandbox(code);
    expect(sb.navigator.deviceMemory).toBe(FIXTURE_MATRIX.device.memoryGB);
  });

  it("overrides navigator.language and navigator.languages", () => {
    const { code } = buildPayload(FIXTURE_MATRIX);
    const sb = runPayloadInSandbox(code);
    expect(sb.navigator.language).toBe(FIXTURE_MATRIX.locale);
    expect(sb.navigator.languages).toEqual(FIXTURE_MATRIX.languages);
  });

  it("makes navigator.languages a frozen array", () => {
    const { code } = buildPayload(FIXTURE_MATRIX);
    const sb = runPayloadInSandbox(code);
    const arr = sb.navigator.languages as unknown[];
    expect(Object.isFrozen(arr)).toBe(true);
  });
});

describe("inject runtime overrides — screen + viewport", () => {
  it("overrides screen.{width,height,colorDepth,pixelDepth}", () => {
    const { code } = buildPayload(FIXTURE_MATRIX);
    const sb = runPayloadInSandbox(code);
    expect(sb.screen.width).toBe(FIXTURE_MATRIX.display.width);
    expect(sb.screen.height).toBe(FIXTURE_MATRIX.display.height);
    expect(sb.screen.colorDepth).toBe(FIXTURE_MATRIX.display.colorDepth);
    expect(sb.screen.pixelDepth).toBe(FIXTURE_MATRIX.display.pixelDepth);
  });

  it("overrides screen.{availWidth,availHeight} from uaCh", () => {
    const { code } = buildPayload(FIXTURE_MATRIX);
    const sb = runPayloadInSandbox(code);
    const expected = JSON.parse(FIXTURE_MATRIX.uaCh["screen-availSize"] as string) as {
      availWidth: number;
      availHeight: number;
    };
    expect(sb.screen.availWidth).toBe(expected.availWidth);
    expect(sb.screen.availHeight).toBe(expected.availHeight);
  });

  it("overrides window.devicePixelRatio from display.dpr", () => {
    const { code } = buildPayload(FIXTURE_MATRIX);
    const sb = runPayloadInSandbox(code);
    expect((sb.window as unknown as { devicePixelRatio: unknown }).devicePixelRatio).toBe(
      FIXTURE_MATRIX.display.dpr,
    );
  });

  it("overrides window.{innerWidth,innerHeight,outerWidth,outerHeight} from uaCh", () => {
    const { code } = buildPayload(FIXTURE_MATRIX);
    const sb = runPayloadInSandbox(code);
    const expected = JSON.parse(FIXTURE_MATRIX.uaCh["window-viewport"] as string) as Record<
      string,
      number
    >;
    const win = sb.window as Record<string, unknown>;
    expect(win.innerWidth).toBe(expected.innerWidth);
    expect(win.innerHeight).toBe(expected.innerHeight);
    expect(win.outerWidth).toBe(expected.outerWidth);
    expect(win.outerHeight).toBe(expected.outerHeight);
  });
});

describe("inject runtime overrides — webgl", () => {
  it("returns spoofed UNMASKED_VENDOR_WEBGL", () => {
    const { code } = buildPayload(FIXTURE_MATRIX);
    const sb = runPayloadInSandbox(code);
    const proto = sb.WebGLRenderingContext.prototype as { getParameter: (p: number) => unknown };
    expect(proto.getParameter(0x9245)).toBe(FIXTURE_MATRIX.gpu.webglUnmaskedVendor);
  });

  it("returns spoofed UNMASKED_RENDERER_WEBGL", () => {
    const { code } = buildPayload(FIXTURE_MATRIX);
    const sb = runPayloadInSandbox(code);
    const proto = sb.WebGLRenderingContext.prototype as { getParameter: (p: number) => unknown };
    expect(proto.getParameter(0x9246)).toBe(FIXTURE_MATRIX.gpu.webglUnmaskedRenderer);
  });

  it("returns spoofed MAX_TEXTURE_SIZE", () => {
    const { code } = buildPayload(FIXTURE_MATRIX);
    const sb = runPayloadInSandbox(code);
    const proto = sb.WebGLRenderingContext.prototype as { getParameter: (p: number) => unknown };
    expect(proto.getParameter(0x0d33)).toBe(FIXTURE_MATRIX.gpu.webglMaxTextureSize);
  });

  it("falls through to native for non-spoofed pname", () => {
    const { code } = buildPayload(FIXTURE_MATRIX);
    const sb = runPayloadInSandbox(code);
    const proto = sb.WebGLRenderingContext.prototype as { getParameter: (p: number) => unknown };
    // sandbox's native returns "BARE-<pname>"
    expect(proto.getParameter(7937)).toBe("BARE-7937");
  });

  it("WebGL2 returns spoofed MAX_COLOR_ATTACHMENTS", () => {
    const { code } = buildPayload(FIXTURE_MATRIX);
    const sb = runPayloadInSandbox(code);
    const proto = sb.WebGL2RenderingContext.prototype as { getParameter: (p: number) => unknown };
    expect(proto.getParameter(0x8cdf)).toBe(FIXTURE_MATRIX.gpu.webglMaxColorAttachments);
  });
});

describe("inject runtime overrides — client-hints (userAgentData)", () => {
  it("exposes brands, mobile, platform via the userAgentData getter", () => {
    const { code } = buildPayload(FIXTURE_MATRIX);
    const sb = runPayloadInSandbox(code);
    const uad = sb.navigator.userAgentData as {
      brands: Array<{ brand: string; version: string }>;
      mobile: boolean;
      platform: string;
    };
    expect(uad).toBeDefined();
    expect(uad.platform).toBe("macOS");
    expect(uad.mobile).toBe(false);
    expect(uad.brands.length).toBe(3);
    const brandSet = new Set(uad.brands.map((b) => b.brand));
    expect(brandSet.has("Chromium")).toBe(true);
    expect(brandSet.has("Google Chrome")).toBe(true);
  });

  it("toJSON() returns brands+mobile+platform", () => {
    const { code } = buildPayload(FIXTURE_MATRIX);
    const sb = runPayloadInSandbox(code);
    const uad = sb.navigator.userAgentData as { toJSON(): Record<string, unknown> };
    const j = uad.toJSON();
    expect(j.platform).toBe("macOS");
    expect(j.mobile).toBe(false);
    expect(Array.isArray(j.brands)).toBe(true);
  });

  it("getHighEntropyValues returns the requested hints", async () => {
    const { code } = buildPayload(FIXTURE_MATRIX);
    const sb = runPayloadInSandbox(code);
    const uad = sb.navigator.userAgentData as {
      getHighEntropyValues(hints: string[]): Promise<Record<string, unknown>>;
    };
    const hev = await uad.getHighEntropyValues(["architecture", "bitness", "platformVersion"]);
    expect(hev.architecture).toBe("arm");
    expect(hev.bitness).toBe("64");
    expect(hev.platformVersion).toBe("14.0.0");
  });
});

describe("inject runtime overrides — timing (Intl.DateTimeFormat)", () => {
  it("resolvedOptions().timeZone returns matrix.timezone", () => {
    const { code } = buildPayload(FIXTURE_MATRIX);
    const sb = runPayloadInSandbox(code);
    const dtf = new sb.Intl.DateTimeFormat();
    expect(dtf.resolvedOptions().timeZone).toBe(FIXTURE_MATRIX.timezone);
  });
});

describe("inject runtime overrides — fonts", () => {
  it("document.fonts.size matches matrix.fonts.list.length", () => {
    const { code } = buildPayload(FIXTURE_MATRIX);
    const sb = runPayloadInSandbox(code);
    const fonts = sb.document.fonts as { size: number };
    expect(fonts.size).toBe(FIXTURE_MATRIX.fonts.list.length);
  });

  it("for…of iterates the matrix font list", () => {
    const { code } = buildPayload(FIXTURE_MATRIX);
    const sb = runPayloadInSandbox(code);
    const fonts = sb.document.fonts as unknown as Iterable<{ family: string }>;
    const families: string[] = [];
    for (const f of fonts) {
      families.push(f.family);
    }
    expect(families).toEqual([...FIXTURE_MATRIX.fonts.list]);
  });

  it("check(spec) returns true for matrix-listed fonts", () => {
    const { code } = buildPayload(FIXTURE_MATRIX);
    const sb = runPayloadInSandbox(code);
    const fonts = sb.document.fonts as { check(spec: string): boolean };
    expect(fonts.check("12px Helvetica")).toBe(true);
    expect(fonts.check("16px 'Helvetica Neue'")).toBe(true);
  });

  it("check(spec) returns false for unknown fonts", () => {
    const { code } = buildPayload(FIXTURE_MATRIX);
    const sb = runPayloadInSandbox(code);
    const fonts = sb.document.fonts as { check(spec: string): boolean };
    expect(fonts.check("12px DefinitelyNotInTheList")).toBe(false);
  });
});

describe("inject runtime overrides — bot-globals cleanup", () => {
  it("deletes automation sentinel keys if present", () => {
    const { code } = buildPayload(FIXTURE_MATRIX);
    const sb = runPayloadInSandbox(code);
    // Plant a sentinel pre-payload.
    (sb.window as Record<string, unknown>).cdc_adoQpoasnfa76pfcZLmcfl_Array = "tainted";
    // Re-run a fresh payload to clean. The sandbox runner above already
    // ran once; for this we run the payload again on the same sandbox.
    // Simpler: plant the key inside the sandbox before run; but sandbox
    // is built fresh by runPayloadInSandbox. Test the cleanup tail by
    // running a new sandbox + planting.
    const sb2 = runPayloadInSandbox(
      `(function(){window.cdc_adoQpoasnfa76pfcZLmcfl_Array='tainted';})();${code}`,
    );
    expect(
      (sb2.window as Record<string, unknown>).cdc_adoQpoasnfa76pfcZLmcfl_Array,
    ).toBeUndefined();
    // Also confirm in sb2 that the sentinel is gone.
    void sb;
  });
});
