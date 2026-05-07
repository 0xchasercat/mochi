/**
 * End-to-end integration test: launch real Chromium, navigate to a data URL,
 * and read page state.
 *
 * Gated by `MOCHI_E2E=1` so the default `bun test` run stays fast and offline.
 * Set `MOCHI_CHROMIUM_PATH` (or rely on the @mochi.js/cli resolveChromiumBinary
 * once 0010 lands) to pick the binary.
 *
 * Budget: < 10 seconds total.
 */

import { describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { mochi } from "../index";

const E2E_ENABLED = process.env.MOCHI_E2E === "1";
const TEST_TIMEOUT_MS = 10_000;

const describeOrSkip = E2E_ENABLED ? describe : describe.skip;

describeOrSkip("@mochi.js/core E2E (MOCHI_E2E=1)", () => {
  it(
    "launches Chromium, navigates to a data URL, reads text + content, closes",
    async () => {
      const session = await mochi.launch({
        profile: "test",
        seed: "e2e",
        // Headless so CI / non-interactive runs work cleanly.
        headless: true,
      });
      try {
        // Sanity: the user-data-dir was created and the matrix carries our seed.
        expect(session.seed).toBe("e2e");
        expect(session.profile.seed).toBe("e2e");

        const page = await session.newPage();
        await page.goto("data:text/html,<title>hi</title><h1>world</h1>");
        const text = await page.text("h1");
        expect(text).toBe("world");
        const html = await page.content();
        expect(html).toContain("<title>hi</title>");
      } finally {
        await session.close();
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "removes the user-data-dir on close()",
    async () => {
      const session = await mochi.launch({ profile: "test", seed: "x", headless: true });
      const dir = session._internalUserDataDir();
      expect(existsSync(dir)).toBe(true);
      await session.close();
      expect(existsSync(dir)).toBe(false);
    },
    TEST_TIMEOUT_MS,
  );
});
