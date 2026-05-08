/**
 * Conformance — patching integrity (port of `test_humanize_unit.mjs §5,
 * §8, §9, §10`).
 *
 * Upstream tests assert on CloakBrowser-internal slots: `page._original`,
 * `page._humanCfg`, `page._humanCursor`, `mainFrame._humanPatched`. mochi
 * has no such slots — `Page` is a plain class with first-class methods
 * (PLAN.md §7), and there's no monkey-patch layer. The semantic the
 * upstream tests are protecting is:
 *
 *   1. The framework hasn't broken native browser APIs (no observable side
 *      effect on the runtime's prototypes).
 *   2. The behavioral surface is wired through (the public methods exist
 *      and are callable).
 *   3. A non-humanized session still works for non-behavioral methods
 *      (CloakBrowser's `humanize: false`); mochi's behavioral surface is
 *      always wired but the Matrix's `behavior` block governs realism.
 *
 * What we test instead:
 *
 *   1. The `Page` class exposes `humanClick`, `humanMove`, `humanType`,
 *      `humanScroll`, `cursorPosition` as functions.
 *   2. After driving `humanX` calls, the page's native APIs are intact
 *      (`document.querySelector`, `Element.prototype.click`, etc., still
 *      work and have native `[native code]` toString).
 *   3. The cursor state composes correctly across calls (a synthesis of
 *      §10's "humanCursor present"): `cursorPosition()` updates after each
 *      move/click and reflects the realized end-point.
 *
 * Most checks are offline (just inspecting the Page class). The
 * native-API integrity check is gated by `MOCHI_E2E=1` since it requires
 * a real Chromium attach.
 *
 * @see tasks/0150-humanize-conformance.md
 * @see PLAN.md §7 / §11
 */

import { describe, expect, it } from "bun:test";
import { mochi, Page } from "@mochi.js/core";
import { E2E_ENABLED, TEST_PROFILE_ID } from "../helpers";

const TEST_TIMEOUT_MS = 20_000;
const describeOrSkip = E2E_ENABLED ? describe : describe.skip;

describe("humanize conformance — patching integrity (offline)", () => {
  it("Page exposes humanClick / humanMove / humanType / humanScroll / cursorPosition", () => {
    const proto = Page.prototype as unknown as Record<string, unknown>;
    expect(typeof proto.humanClick).toBe("function");
    expect(typeof proto.humanMove).toBe("function");
    expect(typeof proto.humanType).toBe("function");
    expect(typeof proto.humanScroll).toBe("function");
    expect(typeof proto.cursorPosition).toBe("function");
  });

  it("the behavioral surface is wired through @mochi.js/behavioral (deterministic)", async () => {
    // Equivalent to upstream's "page.click is humanized" — we assert that
    // Page.humanClick.toString() references the synth function (or a wrapper
    // that does). The mochi check: the function source mentions "synthesize"
    // / "trajectory" / "Bezier" markers, OR runs the synth through behavioral.
    const proto = Page.prototype as unknown as Record<string, unknown>;
    const src = String(proto.humanClick);
    expect(src.length).toBeGreaterThan(0);
    // Source contains references to the synth helpers (smoke-level check;
    // a deeper one is the E2E test that observes the realized event stream).
    expect(src).toMatch(/synthesize|trajectory|Bezier|cursor/i);
  });
});

describeOrSkip("humanize conformance — patching integrity E2E (MOCHI_E2E=1)", () => {
  it(
    "after humanX calls, native APIs remain intact (no prototype tampering)",
    async () => {
      const session = await mochi.launch({
        profile: TEST_PROFILE_ID,
        seed: "patching-integrity-e2e",
        headless: true,
      });
      try {
        const page = await session.newPage();
        await page.goto(
          "data:text/html," +
            encodeURIComponent(`
              <!doctype html>
              <html><body>
                <button id="b" style="position:absolute;left:100px;top:100px;width:80px;height:30px;">x</button>
                <input id="i" />
              </body></html>
            `),
        );
        // Drive a humanClick + humanType + humanMove to exercise the
        // behavioral surface fully.
        await page.humanMove(150, 150);
        await page.humanClick("#b", { preMoveSettle: false });
        await page.humanType("#i", "abc", { mistakeRate: 0 });

        // Native API integrity:
        const integrity = (await page.evaluate(function (this: Document) {
          const w = this.defaultView as Window;
          return {
            // querySelector still works.
            qs: typeof this.querySelector === "function",
            qsToString: this.querySelector.toString().includes("[native code]"),
            // addEventListener still works.
            ael: typeof w.addEventListener === "function",
            aelToString: w.addEventListener.toString().includes("[native code]"),
            // HTMLElement.prototype.click is intact.
            elClick: typeof HTMLElement.prototype.click === "function",
            elClickToString: HTMLElement.prototype.click.toString().includes("[native code]"),
            // Function.prototype.toString itself isn't broken.
            fpts: Function.prototype.toString.toString().includes("[native code]"),
          };
        } as () => unknown)) as {
          qs: boolean;
          qsToString: boolean;
          ael: boolean;
          aelToString: boolean;
          elClick: boolean;
          elClickToString: boolean;
          fpts: boolean;
        };

        expect(integrity.qs).toBe(true);
        expect(integrity.qsToString).toBe(true);
        expect(integrity.ael).toBe(true);
        expect(integrity.aelToString).toBe(true);
        expect(integrity.elClick).toBe(true);
        expect(integrity.elClickToString).toBe(true);
        expect(integrity.fpts).toBe(true);
      } finally {
        await session.close();
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "cursor state composes across humanX calls",
    async () => {
      const session = await mochi.launch({
        profile: TEST_PROFILE_ID,
        seed: "patching-cursor-compose",
        headless: true,
      });
      try {
        const page = await session.newPage();
        await page.goto(
          "data:text/html," +
            encodeURIComponent(`
              <!doctype html>
              <html><body style="margin:0;padding:0;height:1500px;">
                <button id="a" style="position:absolute;left:100px;top:100px;width:60px;height:30px;">a</button>
                <button id="b" style="position:absolute;left:600px;top:500px;width:60px;height:30px;">b</button>
              </body></html>
            `),
        );

        // Initial cursor should be at the matrix-derived display center,
        // not (0, 0). The placeholder profile maps to a 1920x1080 display.
        const initial = page.cursorPosition();
        expect(initial.x).toBeGreaterThan(0);
        expect(initial.y).toBeGreaterThan(0);

        await page.humanMove(120, 120);
        const afterMove = page.cursorPosition();
        expect(Math.abs(afterMove.x - 120)).toBeLessThanOrEqual(2);
        expect(Math.abs(afterMove.y - 120)).toBeLessThanOrEqual(2);

        await page.humanClick("#b", { preMoveSettle: false });
        const afterClick = page.cursorPosition();
        // Should now be inside the #b box (600..660, 500..530).
        expect(afterClick.x).toBeGreaterThanOrEqual(600);
        expect(afterClick.x).toBeLessThanOrEqual(660);
        expect(afterClick.y).toBeGreaterThanOrEqual(500);
        expect(afterClick.y).toBeLessThanOrEqual(530);
      } finally {
        await session.close();
      }
    },
    TEST_TIMEOUT_MS,
  );
});
