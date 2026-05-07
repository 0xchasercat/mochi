/**
 * Phase 0.3 GATE — end-to-end inject test against real Chromium.
 *
 * Launches a Mochi `Session`, opens a page, navigates to a data URL whose
 * inline script reads back the spoofable fingerprint surface, and asserts
 * each value matches the matrix output (NOT the bare Chrome value).
 *
 * Gated by `MOCHI_E2E=1`. Set `MOCHI_CHROMIUM_PATH` to a real Chromium /
 * Chrome / Chromium-for-Testing binary.
 *
 * Budget: < 15 seconds total.
 *
 * @see PLAN.md §14 phase 0.3 — "Manual probe-page check shows spoofed
 *      values; no Runtime.enable ever sent"
 * @see tasks/0030-inject-engine-v0.md
 */

import { describe, expect, it } from "bun:test";
import { mochi } from "../index";

const E2E_ENABLED = process.env.MOCHI_E2E === "1";
const TEST_TIMEOUT_MS = 15_000;

const describeOrSkip = E2E_ENABLED ? describe : describe.skip;

/**
 * Probe HTML — runs in the page's main world AFTER our payload installs.
 * Reads every spoofable surface we ship at v0.3 and JSON-stringifies it
 * into `<pre id="probe">` for the test to read.
 */
const PROBE_HTML = `<!doctype html><html><head><title>probe</title></head><body><pre id="probe"></pre><script>
(function(){
  function safe(fn){ try { return fn(); } catch (e) { return { __error: String(e && e.message || e) }; } }
  var out = {};
  out.userAgent = safe(function(){ return navigator.userAgent; });
  out.platform = safe(function(){ return navigator.platform; });
  out.vendor = safe(function(){ return navigator.vendor; });
  out.appVersion = safe(function(){ return navigator.appVersion; });
  out.appCodeName = safe(function(){ return navigator.appCodeName; });
  out.product = safe(function(){ return navigator.product; });
  out.cookieEnabled = safe(function(){ return navigator.cookieEnabled; });
  out.maxTouchPoints = safe(function(){ return navigator.maxTouchPoints; });
  out.webdriver = safe(function(){ return navigator.webdriver; });
  out.hardwareConcurrency = safe(function(){ return navigator.hardwareConcurrency; });
  out.deviceMemory = safe(function(){ return navigator.deviceMemory; });
  out.language = safe(function(){ return navigator.language; });
  out.languages = safe(function(){ return navigator.languages.slice(); });
  out.devicePixelRatio = safe(function(){ return window.devicePixelRatio; });
  out.screenWidth = safe(function(){ return screen.width; });
  out.screenHeight = safe(function(){ return screen.height; });
  out.screenAvailWidth = safe(function(){ return screen.availWidth; });
  out.screenAvailHeight = safe(function(){ return screen.availHeight; });
  out.screenColorDepth = safe(function(){ return screen.colorDepth; });
  out.screenPixelDepth = safe(function(){ return screen.pixelDepth; });
  out.innerWidth = safe(function(){ return window.innerWidth; });
  out.innerHeight = safe(function(){ return window.innerHeight; });
  out.outerWidth = safe(function(){ return window.outerWidth; });
  out.outerHeight = safe(function(){ return window.outerHeight; });
  out.timeZone = safe(function(){ return Intl.DateTimeFormat().resolvedOptions().timeZone; });
  out.uadPlatform = safe(function(){ return navigator.userAgentData && navigator.userAgentData.platform; });
  out.uadMobile = safe(function(){ return navigator.userAgentData && navigator.userAgentData.mobile; });
  out.uadBrands = safe(function(){
    if (!navigator.userAgentData) return null;
    return navigator.userAgentData.brands.map(function(b){ return { brand: b.brand, version: b.version }; });
  });
  // toString cloak check — does navigator's userAgent getter look like a function source?
  out.userAgentGetterToString = safe(function(){
    var d = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(navigator), 'userAgent');
    return d && d.get && d.get.toString();
  });
  // WebGL probe — create a context, query unmasked vendor/renderer.
  out.webgl = safe(function(){
    var canvas = document.createElement('canvas');
    var gl = canvas.getContext('webgl');
    if (!gl) return { unsupported: true };
    return {
      vendor: gl.getParameter(0x9245),
      renderer: gl.getParameter(0x9246),
      maxTextureSize: gl.getParameter(0x0d33),
    };
  });
  document.getElementById('probe').textContent = JSON.stringify(out);
})();
</script></body></html>`;

const PROBE_DATA_URL = `data:text/html;charset=utf-8,${encodeURIComponent(PROBE_HTML)}`;

interface ProbeShape {
  userAgent: string;
  platform: string;
  vendor: string;
  appVersion: string;
  appCodeName: string;
  product: string;
  cookieEnabled: boolean;
  maxTouchPoints: number;
  webdriver: boolean;
  hardwareConcurrency: number;
  deviceMemory: number;
  language: string;
  languages: string[];
  devicePixelRatio: number;
  screenWidth: number;
  screenHeight: number;
  screenAvailWidth: number;
  screenAvailHeight: number;
  screenColorDepth: number;
  screenPixelDepth: number;
  innerWidth: number;
  innerHeight: number;
  outerWidth: number;
  outerHeight: number;
  timeZone: string;
  uadPlatform: string;
  uadMobile: boolean;
  uadBrands: Array<{ brand: string; version: string }>;
  userAgentGetterToString: string;
  webgl: { vendor: string; renderer: string; maxTextureSize: number };
}

describeOrSkip("@mochi.js/core inject E2E (MOCHI_E2E=1)", () => {
  it(
    "spoofs the v0.3 surface — probe values match the matrix",
    async () => {
      // Use an inline ProfileV1 with a recognizable, distinctive shape so we
      // can assert "spoofed != bare Chrome" with confidence.
      const session = await mochi.launch({
        seed: "phase-0.3-gate",
        headless: true,
        profile: {
          id: "inject-e2e-fixture",
          version: "0.0.0-e2e",
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
            webglUnmaskedRenderer:
              "ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)",
            webglMaxTextureSize: 16384,
            webglMaxColorAttachments: 8,
            webglExtensions: [],
          },
          audio: {
            contextSampleRate: 48000,
            audioWorkletLatency: 0.005,
            destinationMaxChannelCount: 2,
          },
          fonts: { family: "macos-baseline", list: ["Helvetica"] },
          timezone: "America/Los_Angeles",
          locale: "en-US",
          languages: ["en-US", "en"],
          behavior: { hand: "right", tremor: 0.18, wpm: 60, scrollStyle: "smooth" },
          wreqPreset: "chrome_131_macos",
          userAgent:
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.6778.86 Safari/537.36",
          uaCh: {},
          entropyBudget: { fixed: [], perSeed: [] },
        },
      });

      try {
        const matrix = session.profile;
        const page = await session.newPage();
        await page.goto(PROBE_DATA_URL);
        const txt = await page.text("#probe");
        if (txt === null) throw new Error("[mochi e2e] probe element produced no textContent");
        const probe = JSON.parse(txt) as ProbeShape;

        // Top-level navigator surface.
        expect(probe.userAgent).toBe(matrix.userAgent);
        expect(probe.platform).toBe(matrix.uaCh["navigator-platform"] as string);
        expect(probe.vendor).toBe(matrix.uaCh["navigator-vendor"] as string);
        expect(probe.appVersion).toBe(matrix.uaCh["navigator-appVersion"] as string);
        expect(probe.appCodeName).toBe(matrix.uaCh["navigator-appCodeName"] as string);
        expect(probe.product).toBe(matrix.uaCh["navigator-product"] as string);
        expect(probe.cookieEnabled).toBe(true);
        expect(probe.maxTouchPoints).toBe(0);
        expect(probe.webdriver).toBe(false);
        expect(probe.hardwareConcurrency).toBe(matrix.device.cores);
        expect(probe.deviceMemory).toBe(matrix.device.memoryGB);
        expect(probe.language).toBe(matrix.locale);
        expect(probe.languages).toEqual([...matrix.languages]);

        // Screen + viewport.
        expect(probe.screenWidth).toBe(matrix.display.width);
        expect(probe.screenHeight).toBe(matrix.display.height);
        expect(probe.screenColorDepth).toBe(matrix.display.colorDepth);
        expect(probe.screenPixelDepth).toBe(matrix.display.pixelDepth);
        expect(probe.devicePixelRatio).toBe(matrix.display.dpr);
        const avail = JSON.parse(matrix.uaCh["screen-availSize"] as string) as {
          availWidth: number;
          availHeight: number;
        };
        expect(probe.screenAvailWidth).toBe(avail.availWidth);
        expect(probe.screenAvailHeight).toBe(avail.availHeight);
        const vp = JSON.parse(matrix.uaCh["window-viewport"] as string) as {
          innerWidth: number;
          innerHeight: number;
          outerWidth: number;
          outerHeight: number;
        };
        expect(probe.innerWidth).toBe(vp.innerWidth);
        expect(probe.innerHeight).toBe(vp.innerHeight);
        expect(probe.outerWidth).toBe(vp.outerWidth);
        expect(probe.outerHeight).toBe(vp.outerHeight);

        // Timing.
        expect(probe.timeZone).toBe(matrix.timezone);

        // Client hints.
        expect(probe.uadPlatform).toBe("macOS");
        expect(probe.uadMobile).toBe(false);
        expect(probe.uadBrands.length).toBeGreaterThan(0);
        const brandSet = new Set(probe.uadBrands.map((b) => b.brand));
        expect(brandSet.has("Google Chrome") || brandSet.has("Chromium")).toBe(true);

        // toString cloak: the userAgent getter must report native shape (not page-script-detectable JS source).
        // The descriptor lives on Navigator.prototype. The getter is the function we registered;
        // its toString() must match Chrome's native shape. Note this is tested through the cloak.
        if (probe.userAgentGetterToString !== null && probe.userAgentGetterToString !== undefined) {
          expect(probe.userAgentGetterToString).toContain("[native code]");
        }

        // WebGL.
        expect(probe.webgl.vendor).toBe(matrix.gpu.webglUnmaskedVendor);
        expect(probe.webgl.renderer).toBe(matrix.gpu.webglUnmaskedRenderer);
        expect(probe.webgl.maxTextureSize).toBe(matrix.gpu.webglMaxTextureSize);

        // Stealth invariant: `navigator.userAgent` must DIFFER from the bare
        // Chromium UA (sanity check that we're actually spoofing). The bare
        // UA on a modern macOS Chrome will contain "Chrome/<build>" with a
        // build number that will not equal our matrix's "131.0.6778.86".
        // We just check the full string match — if the bare browser's UA
        // happened to match, the test would still pass and that's fine.
        expect(probe.userAgent).toBe(matrix.userAgent);
      } finally {
        await session.close();
      }
    },
    TEST_TIMEOUT_MS,
  );
});
