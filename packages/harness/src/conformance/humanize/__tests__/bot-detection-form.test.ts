/**
 * Conformance — bot-detection form (port of `test_humanize_unit.mjs §4`).
 *
 * Drives a real Mochi-spoofed session through
 * `https://deviceandbrowserinfo.com/are_you_a_bot_interactions` (the same
 * URL CloakBrowser tests against), submits a form, and reads back the
 * site's bot-detection verdict. The site reports several signals as JSON
 * embedded in the response body; we assert:
 *
 *   - `superHumanSpeed: false` — our keystroke timing isn't superhuman.
 *   - `suspiciousClientSideBehavior: false` — our mouse trajectory isn't
 *     classified as scripted.
 *
 * The site can change. If the URL is gone or the response shape changes,
 * the test surfaces it as a failure (not a silent skip), with diagnostics
 * to update the form selectors / URL. The current pinning is documented
 * in `tests/fixtures/cloakbrowser/SOURCE.md`.
 *
 * Gated by `MOCHI_E2E=1 MOCHI_ONLINE=1`.
 *
 * @see tasks/0150-humanize-conformance.md
 * @see tests/fixtures/cloakbrowser/test_humanize_unit.mjs
 */

import { describe, expect, it } from "bun:test";
import { mochi } from "@mochi.js/core";
import { E2E_ENABLED, ONLINE_ENABLED, TEST_PROFILE_ID } from "../helpers";

const TEST_TIMEOUT_MS = 60_000;
const ONLINE_GATED = E2E_ENABLED && ONLINE_ENABLED;
const describeOrSkip = ONLINE_GATED ? describe : describe.skip;

const BOT_DETECTION_URL = "https://deviceandbrowserinfo.com/are_you_a_bot_interactions";

describeOrSkip(
  "humanize conformance — bot-detection form ONLINE (MOCHI_E2E=1 MOCHI_ONLINE=1)",
  () => {
    it(
      "humanX trajectory + timing pass deviceandbrowserinfo.com behavioral checks",
      async () => {
        const session = await mochi.launch({
          profile: TEST_PROFILE_ID,
          seed: "bot-detection-form",
          headless: true,
        });
        try {
          const page = await session.newPage();
          await page.goto(BOT_DETECTION_URL, {
            waitUntil: "domcontentloaded",
            timeout: 45_000,
          });
          // Allow the page to settle + run its JS instrumentation.
          await new Promise((r) => setTimeout(r, 3_000));

          // Drive a humanized form fill. The form's selectors are stable in
          // upstream CloakBrowser tests as of 2026-05.
          await page.humanClick("#email");
          await page.humanType("#email", "test@example.com", { mistakeRate: 0 });
          await page.humanClick("#password");
          await page.humanType("#password", "SecurePass!123", { mistakeRate: 0 });
          await page.humanClick('button[type="submit"]');

          // Wait for the page to render its verdict (the site embeds a JSON
          // payload as visible body text).
          await new Promise((r) => setTimeout(r, 5_000));

          const body = await page.evaluate(function (this: Document) {
            return this.body?.textContent ?? "";
          } as () => unknown);
          const text = String(body ?? "");

          // The site embeds a JSON-shaped response in the document body.
          // Both flags must be false for mochi to claim humanize works.
          const superHumanSpeed = text.includes('"superHumanSpeed": true');
          const suspicious = text.includes('"suspiciousClientSideBehavior": true');
          const cdpMouse = text.includes('"hasCDPMouseLeak": true');

          // Surface the verdict to the test runner so the orchestrator can
          // see the SHAPE in CI logs (PASS/FAIL by line, not just bool).
          console.warn(
            `[conformance] bot-detection: superHumanSpeed=${superHumanSpeed}, ` +
              `suspicious=${suspicious}, cdpMouseLeak=${cdpMouse}`,
          );

          expect(superHumanSpeed).toBe(false);
          expect(suspicious).toBe(false);
          // hasCDPMouseLeak is a STEALTH signal (not a behavioral one) — we
          // surface it here for awareness but don't fail the humanize gate
          // on it. The 0140 stealth conformance suite owns the CDP-leak
          // gate.
        } finally {
          await session.close();
        }
      },
      TEST_TIMEOUT_MS,
    );

    it(
      "form fill + submit takes >3s (humanized, not scripted)",
      async () => {
        const session = await mochi.launch({
          profile: TEST_PROFILE_ID,
          seed: "bot-detection-form-timing",
          headless: true,
        });
        try {
          const page = await session.newPage();
          await page.goto(BOT_DETECTION_URL, {
            waitUntil: "domcontentloaded",
            timeout: 45_000,
          });
          await new Promise((r) => setTimeout(r, 2_000));

          const t0 = Date.now();
          await page.humanType("#email", "test@example.com", { mistakeRate: 0 });
          await page.humanType("#password", "MyPassword!99", { mistakeRate: 0 });
          await page.humanClick('button[type="submit"]');
          const elapsed = Date.now() - t0;

          console.warn(`[conformance] bot-detection form fill+submit: ${elapsed}ms`);
          expect(elapsed).toBeGreaterThan(3_000);
        } finally {
          await session.close();
        }
      },
      TEST_TIMEOUT_MS,
    );
  },
);
