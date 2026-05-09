/**
 * Live conformance for task 0266 — `Fetch.fulfillRequest` body splice.
 *
 * Boots a Bun.serve fixture that hands the browser an HTML document whose
 * inline `<script>` would normally race the inject. Asserts:
 *
 *   - `__mochi_inject_marker === true` after navigation (our payload ran).
 *   - The original document's `window.__before === true` (page script ran too).
 *   - **Critical**: `__mochi_inject_marker` was set BEFORE the document's
 *     first inline script — the timing property the splice is supposed to
 *     guarantee. The fixture's first `<script>` records `__after_marker`
 *     reflecting whether the marker was already truthy at that moment.
 *   - No `<script class="__mochi_init_script__">` survives in the DOM after
 *     load — the self-removal worked.
 *
 * Gated by `MOCHI_E2E=1`. Set `MOCHI_CHROMIUM_PATH` if needed.
 *
 * @see PLAN.md §8.4
 */

import { describe, expect, it } from "bun:test";
import { mochi } from "../index";

const E2E_ENABLED = process.env.MOCHI_E2E === "1";
const TEST_TIMEOUT_MS = 20_000;

const describeOrSkip = E2E_ENABLED ? describe : describe.skip;

const PROBE_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>0266</title>
<script>
  // First page-script. Records whether our inject marker was already true
  // by the time this line runs. If the splice landed correctly this will be
  // true; if the splice raced behind us, it will be undefined/false.
  window.__before = true;
  window.__after_marker = window.__mochi_inject_marker === true;
</script>
</head>
<body>
  <pre id="probe"></pre>
  <script>
    // After-DOM script: dump the captured state for the test to read.
    document.getElementById('probe').textContent = JSON.stringify({
      before: window.__before === true,
      injected: window.__mochi_inject_marker === true,
      orderedFirst: window.__after_marker === true,
      surviving: document.querySelectorAll('script.__mochi_init_script__').length,
    });
  </script>
</body></html>`;

describeOrSkip("@mochi.js/core init-injector E2E (MOCHI_E2E=1, task 0266)", () => {
  it(
    "splices payload before page's first <script> and self-removes",
    async () => {
      // Spin up a one-shot HTTP server so we exercise the real Fetch
      // domain (data: URLs do NOT trigger Fetch.requestPaused).
      const server = Bun.serve({
        port: 0,
        fetch() {
          return new Response(PROBE_HTML, {
            headers: {
              "Content-Type": "text/html; charset=utf-8",
              // Restrictive CSP so the rewriter is exercised.
              "Content-Security-Policy": "default-src 'self'; script-src 'self'",
            },
          });
        },
      });

      const url = `http://127.0.0.1:${server.port}/`;
      const session = await mochi.launch({
        seed: "phase-0266-gate",
        headless: true,
        profile: {
          id: "init-injector-e2e",
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
        const page = await session.newPage();
        await page.goto(url);
        const txt = await page.text("#probe");
        if (txt === null) throw new Error("[mochi e2e] probe element produced no textContent");
        const probe = JSON.parse(txt) as {
          before: boolean;
          injected: boolean;
          orderedFirst: boolean;
          surviving: number;
        };

        // Both the page script and our inject ran.
        expect(probe.before).toBe(true);
        expect(probe.injected).toBe(true);
        // CRITICAL: our marker was set before the page's first <script> ran.
        expect(probe.orderedFirst).toBe(true);
        // Self-removal worked — no surviving init-script tags.
        expect(probe.surviving).toBe(0);
      } finally {
        await session.close();
        server.stop();
      }
    },
    TEST_TIMEOUT_MS,
  );
});
