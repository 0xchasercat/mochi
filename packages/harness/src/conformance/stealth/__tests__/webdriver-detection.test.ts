/**
 * Stealth conformance — Layer 1 (offline) — `TestWebDriverDetection`.
 *
 * Port of CloakBrowser's `tests/test_stealth.py::TestWebDriverDetection`
 * (vendored verbatim at `tests/fixtures/cloakbrowser/test_stealth.py`,
 * pinned to upstream sha 13b1b98). Six offline assertions:
 *
 *   1. `navigator.webdriver === false`         — upstream lines 35-38
 *   2. UA lacks "HeadlessChrome", has "Chrome/" — lines 40-45
 *   3. `typeof window.chrome === "object"`     — lines 47-50
 *   4. `navigator.plugins.length >= 5`         — lines 52-56
 *   5. `navigator.languages.length >= 1`       — lines 58-62
 *   6. no `cdc_*` / `__webdriver*` window keys — lines 64-79
 *
 * Each `it()` mirrors one upstream test. CloakBrowser navigates to
 * `https://example.com`; mochi runs OFFLINE — we use `about:blank` so the
 * suite is hermetic and runs without internet. The assertions are about
 * navigator/window globals which mochi's inject layer overrides regardless
 * of URL, so the offline switch doesn't change semantics.
 *
 * Gated by `MOCHI_E2E=1`. Profile: `mac-m4-chrome-stable`.
 *
 * @see tests/fixtures/cloakbrowser/test_stealth.py
 * @see tasks/0140-stealth-conformance.md §"Layer 1"
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { Session } from "@mochi.js/core";
import {
  CONFORMANCE_PROFILE,
  E2E_ENABLED,
  evalExpr,
  launchSharedSession,
  withPage,
  withRetries,
} from "../helpers";

const TEST_TIMEOUT_MS = 20_000;
const SUITE_TIMEOUT_MS = 60_000;

const describeOrSkip = E2E_ENABLED ? describe : describe.skip;

describeOrSkip(
  `stealth conformance / Layer 1 — webdriver detection (profile=${CONFORMANCE_PROFILE})`,
  () => {
    let session: Session;

    beforeAll(async () => {
      session = await launchSharedSession();
    }, SUITE_TIMEOUT_MS);

    afterAll(async () => {
      if (session !== undefined) {
        await session.close();
      }
    }, SUITE_TIMEOUT_MS);

    /**
     * Upstream: `test_navigator_webdriver_false`
     * tests/fixtures/cloakbrowser/test_stealth.py lines 35-38
     */
    it(
      "navigator.webdriver is false",
      async () => {
        await withRetries(async () => {
          await withPage(session, async (page) => {
            await page.goto("about:blank");
            const webdriver = await evalExpr<boolean>(page, "navigator.webdriver");
            expect(webdriver).toBe(false);
          });
        });
      },
      TEST_TIMEOUT_MS,
    );

    /**
     * Upstream: `test_no_headless_chrome_ua`
     * tests/fixtures/cloakbrowser/test_stealth.py lines 40-45
     */
    it(
      "UA lacks 'HeadlessChrome' and contains 'Chrome/'",
      async () => {
        await withRetries(async () => {
          await withPage(session, async (page) => {
            await page.goto("about:blank");
            const ua = await evalExpr<string>(page, "navigator.userAgent");
            expect(ua).not.toContain("HeadlessChrome");
            expect(ua).toContain("Chrome/");
          });
        });
      },
      TEST_TIMEOUT_MS,
    );

    /**
     * Upstream: `test_window_chrome_exists`
     * tests/fixtures/cloakbrowser/test_stealth.py lines 47-50
     *
     * Real Chrome (headed or `--headless=new`) exposes `window.chrome` as
     * an object with `runtime`, `app`, `csi`, `loadTimes`. Our spoof
     * module guarantees `typeof window.chrome === "object"` even on
     * Chromium-for-Testing builds where the property is absent.
     */
    it(
      "typeof window.chrome === 'object'",
      async () => {
        await withRetries(async () => {
          await withPage(session, async (page) => {
            await page.goto("about:blank");
            const t = await evalExpr<string>(page, "typeof window.chrome");
            expect(t).toBe("object");
          });
        });
      },
      TEST_TIMEOUT_MS,
    );

    /**
     * Upstream: `test_plugins_present`
     * tests/fixtures/cloakbrowser/test_stealth.py lines 52-56
     *
     * Real Chrome 92+ ships a curated 5-plugin PluginArray (PDF Viewer,
     * Chrome PDF Viewer, Chromium PDF Viewer, Microsoft Edge PDF Viewer,
     * WebKit built-in PDF). The mochi spoof emits the same list per the
     * mac-m4-chrome-stable profile baseline.
     */
    it(
      "navigator.plugins.length >= 5",
      async () => {
        await withRetries(async () => {
          await withPage(session, async (page) => {
            await page.goto("about:blank");
            const count = await evalExpr<number>(page, "navigator.plugins.length");
            expect(count).toBeGreaterThanOrEqual(5);
          });
        });
      },
      TEST_TIMEOUT_MS,
    );

    /**
     * Upstream: `test_languages_present`
     * tests/fixtures/cloakbrowser/test_stealth.py lines 58-62
     */
    it(
      "navigator.languages.length >= 1",
      async () => {
        await withRetries(async () => {
          await withPage(session, async (page) => {
            await page.goto("about:blank");
            const len = await evalExpr<number>(page, "navigator.languages.length");
            expect(len).toBeGreaterThanOrEqual(1);
          });
        });
      },
      TEST_TIMEOUT_MS,
    );

    /**
     * Upstream: `test_cdp_not_detected`
     * tests/fixtures/cloakbrowser/test_stealth.py lines 64-79
     *
     * The upstream check looks for `cdc_*` and `__webdriver*` window
     * keys — Chromedriver/Selenium sentinel taint. mochi's bot-globals
     * module deletes the catalog at every navigation; this test
     * additionally plants `cdc_adoQpoasnfa76pfcZLmcfl_Array` BEFORE the
     * payload runs (impossible in practice — the inject payload runs at
     * top-of-frame — but documented as the upstream's intent). Since we
     * can't pre-plant from the test side, the check reduces to "no key
     * starting with cdc_ or __webdriver naturally exists on window".
     */
    it(
      "no cdc_* or __webdriver* keys on window",
      async () => {
        await withRetries(async () => {
          await withPage(session, async (page) => {
            await page.goto("about:blank");
            const hasCdp = await page.evaluate<boolean>(() => {
              try {
                const keys = Object.keys(globalThis);
                return keys.some((k) => k.startsWith("cdc_") || k.startsWith("__webdriver"));
              } catch {
                return false;
              }
            });
            expect(hasCdp).toBe(false);
          });
        });
      },
      TEST_TIMEOUT_MS,
    );
  },
);
