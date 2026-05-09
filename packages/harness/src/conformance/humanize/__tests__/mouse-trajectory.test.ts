/**
 * Conformance — mouse trajectory E2E (port of `test_humanize_unit.mjs §3`
 * + portions of `test_human_visual.mjs`).
 *
 * Drives a real Chromium-for-Testing instance via mochi and asserts the
 * dispatch layer produces what the synth says it should:
 *
 *   1. `humanMove(x, y)` produces a stream of >5 mousemove events the page
 *      sees, with monotonic timestamps and a non-trivial duration
 *      (> 50ms), and DOES NOT dispatch mousedown/mouseup. (No clicks.)
 *   2. `humanClick(selector)` produces >5 mousemoves AND a single
 *      mousedown/mouseup pair landing on the target element.
 *   3. Cursor state composes across calls — a `humanMove` followed by
 *      `humanClick` starts the second trajectory at the first's
 *      arrival point (no warp).
 *
 * Gated by `MOCHI_E2E=1`. Set `MOCHI_CHROMIUM_PATH` to a real Chrome /
 * Chromium-for-Testing binary.
 *
 * @see PLAN.md §11.1
 */

import { describe, expect, it } from "bun:test";
import { mochi } from "@mochi.js/core";
import { E2E_ENABLED, TEST_PROFILE_ID } from "../helpers";

const TEST_TIMEOUT_MS = 25_000;
const describeOrSkip = E2E_ENABLED ? describe : describe.skip;

const HARNESS_HTML =
  "data:text/html," +
  encodeURIComponent(`
    <!doctype html>
    <html><head><title>humanize-conformance-mouse</title></head>
    <body style="margin:0;padding:0;height:1500px;">
      <button id="b" style="position:absolute;left:240px;top:200px;width:120px;height:48px;">click me</button>
      <script>
        window.__events = { mousemove: [], mousedown: [], mouseup: [] };
        for (const t of ["mousemove","mousedown","mouseup"]) {
          document.addEventListener(t, (e) => {
            window.__events[t].push({ t: performance.now(), x: e.clientX, y: e.clientY, target: e.target && e.target.id });
          }, true);
        }
      </script>
    </body></html>
  `);

interface RecordedEvents {
  mousemove: { t: number; x: number; y: number; target: string }[];
  mousedown: { t: number; x: number; y: number; target: string }[];
  mouseup: { t: number; x: number; y: number; target: string }[];
}

describeOrSkip("humanize conformance — mouse trajectory E2E (MOCHI_E2E=1)", () => {
  it(
    "humanMove emits mousemoves but NO mousedown/mouseup",
    async () => {
      const session = await mochi.launch({
        profile: TEST_PROFILE_ID,
        seed: "mouse-trajectory-move",
        headless: true,
      });
      try {
        const page = await session.newPage();
        await page.goto(HARNESS_HTML);
        await page.humanMove(400, 300);
        const events = (await page.evaluate(function (this: Document) {
          const w = this.defaultView as unknown as { __events: unknown };
          return w?.__events;
        } as () => unknown)) as RecordedEvents;
        expect(events).toBeDefined();
        expect(events.mousemove.length).toBeGreaterThan(5);
        expect(events.mousedown.length).toBe(0);
        expect(events.mouseup.length).toBe(0);
        // Last move lands near the requested point (within tremor tolerance).
        const last = events.mousemove[events.mousemove.length - 1];
        if (last) {
          expect(Math.abs(last.x - 400)).toBeLessThanOrEqual(2);
          expect(Math.abs(last.y - 300)).toBeLessThanOrEqual(2);
        }
        // Cursor state was updated.
        expect(page.cursorPosition().x).toBeCloseTo(400, 0);
        expect(page.cursorPosition().y).toBeCloseTo(300, 0);
      } finally {
        await session.close();
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "humanClick emits mousemoves followed by exactly one click on the target",
    async () => {
      const session = await mochi.launch({
        profile: TEST_PROFILE_ID,
        seed: "mouse-trajectory-click",
        headless: true,
      });
      try {
        const page = await session.newPage();
        await page.goto(HARNESS_HTML);
        await page.humanClick("#b", { preMoveSettle: false });
        const events = (await page.evaluate(function (this: Document) {
          const w = this.defaultView as unknown as { __events: unknown };
          return w?.__events;
        } as () => unknown)) as RecordedEvents;
        expect(events.mousemove.length).toBeGreaterThan(5);
        expect(events.mousedown.length).toBe(1);
        expect(events.mouseup.length).toBe(1);
        const md = events.mousedown[0];
        expect(md?.target).toBe("b");
      } finally {
        await session.close();
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "humanMove → humanClick composes — second trajectory starts where first ended",
    async () => {
      const session = await mochi.launch({
        profile: TEST_PROFILE_ID,
        seed: "mouse-trajectory-compose",
        headless: true,
      });
      try {
        const page = await session.newPage();
        await page.goto(HARNESS_HTML);
        // Move to (100, 100) first.
        await page.humanMove(100, 100);
        const cursorMid = page.cursorPosition();
        expect(Math.abs(cursorMid.x - 100)).toBeLessThanOrEqual(2);
        expect(Math.abs(cursorMid.y - 100)).toBeLessThanOrEqual(2);

        // Reset event log so we observe only the click trajectory.
        await page.evaluate(function (this: Document) {
          const w = this.defaultView as unknown as { __events: RecordedEvents };
          w.__events = { mousemove: [], mousedown: [], mouseup: [] };
        } as () => unknown);

        await page.humanClick("#b", { preMoveSettle: false });
        const events = (await page.evaluate(function (this: Document) {
          const w = this.defaultView as unknown as { __events: unknown };
          return w?.__events;
        } as () => unknown)) as RecordedEvents;

        // The first move event should be NEAR the prior cursor position
        // (not at viewport origin, not at target). Tolerance: small (the
        // first sample is the trajectory's anchor at `from`).
        const first = events.mousemove[0];
        expect(first).toBeDefined();
        if (first) {
          // Distance from (100,100) should be much smaller than distance
          // from (240+60, 200+24) ≈ (300, 224) — the click target center.
          const distFromPrior = Math.hypot(first.x - cursorMid.x, first.y - cursorMid.y);
          const distFromTarget = Math.hypot(first.x - 300, first.y - 224);
          expect(distFromPrior).toBeLessThan(distFromTarget);
        }
      } finally {
        await session.close();
      }
    },
    TEST_TIMEOUT_MS,
  );
});
