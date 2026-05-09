/**
 * Conformance — fill clearing (port of `test_humanize_unit.mjs §3` /
 * `test_human_visual.mjs` "type, press, clear").
 *
 * Upstream tests `page.locator(sel).fill('replaced text')` against an input
 * that already has content and asserts the new value replaces the old. The
 * mochi equivalent is `page.humanType(sel, '', ...)` to clear, followed by
 * a regular `humanType(sel, newText)` — or the same single call to
 * `humanType` when CloakBrowser's `fill()` semantics are inlined into the
 * helper.
 *
 * Tests:
 *   1. `humanType("", selector)` empties an input that has prior content.
 *   2. The clear call takes >100ms (realistic key timing — not a synchronous
 *      `el.value = ''`).
 *   3. After clearing, a subsequent `humanType(selector, "...")` writes the
 *      new content cleanly.
 *   4. Calling `humanType("", selector)` against an already-empty input is
 *      a no-op (no Backspace events fired).
 *
 * Gated by `MOCHI_E2E=1`.
 *
 * @see PLAN.md §11.2
 */

import { describe, expect, it } from "bun:test";
import { mochi } from "@mochi.js/core";
import { E2E_ENABLED, TEST_PROFILE_ID } from "../helpers";

const TEST_TIMEOUT_MS = 25_000;
const describeOrSkip = E2E_ENABLED ? describe : describe.skip;

const FORM_HTML =
  "data:text/html," +
  encodeURIComponent(`
    <!doctype html>
    <html><head><title>fill-clearing</title></head>
    <body style="margin:0;padding:0;">
      <input id="i" style="position:absolute;left:50px;top:50px;width:280px;height:32px;font-size:16px;" />
      <script>
        window.__keys = { keydown: [], keyup: [] };
        for (const t of ["keydown","keyup"]) {
          document.addEventListener(t, (e) => {
            window.__keys[t].push({ t: performance.now(), key: e.key });
          }, true);
        }
      </script>
    </body></html>
  `);

interface KeyLog {
  keydown: { t: number; key: string }[];
  keyup: { t: number; key: string }[];
}

describeOrSkip("humanize conformance — fill clearing E2E (MOCHI_E2E=1)", () => {
  it(
    "humanType('', selector) empties a populated input",
    async () => {
      const session = await mochi.launch({
        profile: TEST_PROFILE_ID,
        seed: "fill-clearing-empty",
        headless: true,
      });
      try {
        const page = await session.newPage();
        await page.goto(FORM_HTML);
        await page.humanType("#i", "initial text", { mistakeRate: 0 });
        // Sanity check: input has 'initial text'.
        const before = await page.evaluate(function (this: Document) {
          const el = this.querySelector("#i") as HTMLInputElement | null;
          return el?.value ?? null;
        } as () => unknown);
        expect(before).toBe("initial text");

        // Reset key log before the clear so we can observe the Backspaces.
        await page.evaluate(function (this: Document) {
          const w = this.defaultView as unknown as { __keys: KeyLog };
          w.__keys = { keydown: [], keyup: [] };
        } as () => unknown);

        const t0 = Date.now();
        await page.humanType("#i", "");
        const elapsed = Date.now() - t0;

        const after = await page.evaluate(function (this: Document) {
          const el = this.querySelector("#i") as HTMLInputElement | null;
          return el?.value ?? null;
        } as () => unknown);
        expect(after).toBe("");

        // The clear should have taken >100ms (realistic key timing).
        expect(elapsed).toBeGreaterThan(100);

        // Backspace events were fired.
        const log = (await page.evaluate(function (this: Document) {
          const w = this.defaultView as unknown as { __keys: KeyLog };
          return w.__keys;
        } as () => unknown)) as KeyLog;
        const backspaces = log.keydown.filter((e) => e.key === "Backspace");
        expect(backspaces.length).toBe("initial text".length);
      } finally {
        await session.close();
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "after clearing, humanType writes new content cleanly",
    async () => {
      const session = await mochi.launch({
        profile: TEST_PROFILE_ID,
        seed: "fill-clearing-rewrite",
        headless: true,
      });
      try {
        const page = await session.newPage();
        await page.goto(FORM_HTML);
        await page.humanType("#i", "old", { mistakeRate: 0 });
        await page.humanType("#i", "");
        await page.humanType("#i", "new content", { mistakeRate: 0 });
        const value = await page.evaluate(function (this: Document) {
          const el = this.querySelector("#i") as HTMLInputElement | null;
          return el?.value ?? null;
        } as () => unknown);
        expect(value).toBe("new content");
      } finally {
        await session.close();
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "humanType('', selector) on an empty input is a no-op (no Backspaces)",
    async () => {
      const session = await mochi.launch({
        profile: TEST_PROFILE_ID,
        seed: "fill-clearing-empty-noop",
        headless: true,
      });
      try {
        const page = await session.newPage();
        await page.goto(FORM_HTML);

        // Reset key log.
        await page.evaluate(function (this: Document) {
          const w = this.defaultView as unknown as { __keys: KeyLog };
          w.__keys = { keydown: [], keyup: [] };
        } as () => unknown);

        await page.humanType("#i", "");

        const log = (await page.evaluate(function (this: Document) {
          const w = this.defaultView as unknown as { __keys: KeyLog };
          return w.__keys;
        } as () => unknown)) as KeyLog;
        const backspaces = log.keydown.filter((e) => e.key === "Backspace");
        expect(backspaces.length).toBe(0);
      } finally {
        await session.close();
      }
    },
    TEST_TIMEOUT_MS,
  );
});
