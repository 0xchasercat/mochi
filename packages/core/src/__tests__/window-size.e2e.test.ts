/**
 * Task 0252 conformance E2E — verify the OS-level outer-window pin
 * (`--window-size=<W>,<H>`, derived from `matrix.display.{width,height}`)
 * is honored under `--headless=new` such that
 * `window.outerWidth === matrix.display.width`.
 *
 * UDC issue #2242 documents that `--window-size` is honored at the OS
 * level under headless, but the JS API surface (`window.outerWidth/Height`)
 * historically did not reflect it without a CDP `Browser.setWindowBounds`
 * follow-up. This test is the canonical check that the leak is closed
 * end-to-end on the Chromium versions we care about. If `outerWidth`
 * comes back as 800 (the legacy headless default) the test fails loudly
 * and the orchestrator knows to layer in the CDP fix.
 *
 * Mochi's inject layer also defines `window.outerWidth/outerHeight` from
 * `matrix.uaCh["window-viewport"]` (R-029). On macOS the R-029 outerWidth
 * equals `display.width` exactly (OS_CHROME_WIDTH = 0), so the assertion
 * holds regardless of whether the OS-level honoring works as promised.
 * The OS-level fix is what hardens the surface against:
 *   - inject-bypassed flows (`bypassInject: true`, `mochi capture`)
 *   - cross-realm reads where the spoof hasn't installed yet
 *
 * Gated by `MOCHI_E2E=1`. Set `MOCHI_CHROMIUM_PATH` to a real binary.
 *
 * @see UDC `__init__.py:410-411`, UDC issue #2242
 */

import { describe, expect, it } from "bun:test";
import { mochi } from "../index";

const E2E_ENABLED = process.env.MOCHI_E2E === "1";
const TEST_TIMEOUT_MS = 15_000;

const describeOrSkip = E2E_ENABLED ? describe : describe.skip;

const PROBE_HTML = `<!doctype html><html><body><pre id="p"></pre><script>
document.getElementById("p").textContent = JSON.stringify({
  outerWidth: window.outerWidth,
  outerHeight: window.outerHeight,
  screenWidth: screen.width,
  screenHeight: screen.height,
});
</script></body></html>`;

const PROBE_DATA_URL = `data:text/html;charset=utf-8,${encodeURIComponent(PROBE_HTML)}`;

interface ProbeShape {
  outerWidth: number;
  outerHeight: number;
  screenWidth: number;
  screenHeight: number;
}

describeOrSkip("@mochi.js/core --window-size E2E (MOCHI_E2E=1) — task 0252", () => {
  it(
    "window.outerWidth matches matrix.display.width under --headless=new",
    async () => {
      const session = await mochi.launch({
        seed: "task-0252-window-size",
        headless: true,
        profile: {
          id: "window-size-e2e-fixture",
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
          // Distinctive non-default dimensions so an 800×600 leak is glaring.
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
        if (matrix === null) throw new Error("[mochi e2e] expected matrix-derived session");
        const page = await session.newPage();
        await page.goto(PROBE_DATA_URL);
        const txt = await page.text("#p");
        if (txt === null) throw new Error("[mochi e2e] probe element produced no textContent");
        const probe = JSON.parse(txt) as ProbeShape;

        // Task 0252 success criterion #4: probe-time conformance.
        // The 800×600 leak under --headless=new manifests as outerWidth=800.
        // Failing here means the OS-level pin is NOT honored AND the inject
        // spoof did not install — orchestrator should layer in CDP
        // `Browser.setWindowBounds` per UDC issue #2242 follow-up.
        expect(probe.outerWidth).toBe(matrix.display.width);
        expect(probe.outerWidth).not.toBe(800);

        // screen.width must match too (separate path: inject layer R-010).
        expect(probe.screenWidth).toBe(matrix.display.width);
        expect(probe.screenHeight).toBe(matrix.display.height);
      } finally {
        await session.close();
      }
    },
    TEST_TIMEOUT_MS,
  );
});
