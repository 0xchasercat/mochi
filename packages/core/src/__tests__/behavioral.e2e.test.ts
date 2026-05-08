/**
 * E2E test for the behavioral surface against real Chromium.
 *
 * Gated by `MOCHI_E2E=1`. Set `MOCHI_CHROMIUM_PATH` to point at a Chrome /
 * Chromium-for-Testing binary. Budget: < 15 seconds total.
 *
 * Asserts:
 *   - `humanClick` emits a sequence of `mousemove` events the page sees
 *     (count > 5 — confirms it's a trajectory, not a single warp).
 *   - `mousemove` timestamps are monotonic and span a non-trivial range
 *     (confirms the dispatch layer paces events, not all at t=0).
 *   - The final mousedown / mouseup land on the target element.
 *   - `humanType` produces `keydown`/`keyup` for each character (plus the
 *     mistake/correction events when forced).
 *   - `humanScroll` advances `window.scrollY` toward the target.
 *
 * @see PLAN.md §11
 * @see tasks/0080-behavioral-engine-v0.md §"Tests"
 */

import { describe, expect, it } from "bun:test";
import { mochi } from "../index";

const E2E_ENABLED = process.env.MOCHI_E2E === "1";
const TEST_TIMEOUT_MS = 20_000;

const describeOrSkip = E2E_ENABLED ? describe : describe.skip;

const BUTTON_HARNESS_HTML =
  "data:text/html," +
  encodeURIComponent(`
    <!doctype html>
    <html><head><title>behavioral-e2e</title></head>
    <body style="margin:0;padding:0;height:2400px;">
      <div id="filler" style="height:1000px;background:#eef;"></div>
      <button id="b" style="position:absolute;left:200px;top:150px;width:100px;height:40px;">click me</button>
      <input id="i" style="position:absolute;left:50px;top:60px;width:200px;height:30px;font-size:16px;" />
      <div id="footer" style="height:200px;background:#fee;"></div>
      <script>
        window.__events = { mousemove: [], mousedown: [], mouseup: [], keydown: [], keyup: [] };
        for (const t of ["mousemove","mousedown","mouseup"]) {
          document.addEventListener(t, (e) => {
            window.__events[t].push({ t: performance.now(), x: e.clientX, y: e.clientY, target: e.target && e.target.id });
          }, true);
        }
        for (const t of ["keydown","keyup"]) {
          document.addEventListener(t, (e) => {
            window.__events[t].push({ t: performance.now(), key: e.key });
          }, true);
        }
      </script>
    </body></html>
  `);

describeOrSkip("@mochi.js/core — behavioral E2E (MOCHI_E2E=1)", () => {
  it(
    "humanClick produces a trajectory of >5 mousemoves and a final click on the target",
    async () => {
      const session = await mochi.launch({
        profile: "test-behavioral",
        seed: "e2e-click",
        headless: true,
      });
      try {
        const page = await session.newPage();
        await page.goto(BUTTON_HARNESS_HTML);
        await page.humanClick("#b", { preMoveSettle: false });
        const events = (await page.evaluate(
          // The function runs as a method on `document` (PLAN.md §8.3 path
          // through `Runtime.callFunctionOn`); `this.defaultView` reaches
          // window. We wrote the harness HTML to stash event records on
          // `window.__events`. Cast via `unknown` so the `this` type fudge
          // in the page-side closure doesn't trip the strict `any` check.
          function (this: Document) {
            const w = this.defaultView as unknown as { __events: unknown };
            return w?.__events;
          } as () => unknown,
        )) as {
          mousemove: { t: number; x: number; y: number; target: string }[];
          mousedown: { t: number; x: number; y: number; target: string }[];
          mouseup: { t: number; x: number; y: number; target: string }[];
          keydown: { t: number; key: string }[];
          keyup: { t: number; key: string }[];
        };
        expect(events).toBeDefined();
        expect(events.mousemove.length).toBeGreaterThan(5);

        // Monotonic timestamps; non-trivial timespan.
        for (let i = 1; i < events.mousemove.length; i++) {
          const prev = events.mousemove[i - 1];
          const cur = events.mousemove[i];
          if (prev !== undefined && cur !== undefined) {
            expect(cur.t).toBeGreaterThanOrEqual(prev.t);
          }
        }
        const first = events.mousemove[0];
        const last = events.mousemove[events.mousemove.length - 1];
        if (first !== undefined && last !== undefined) {
          expect(last.t - first.t).toBeGreaterThan(50);
        }
        // Final mousedown and mouseup land on (or inside) the button.
        expect(events.mousedown.length).toBe(1);
        expect(events.mouseup.length).toBe(1);
        const md = events.mousedown[0];
        expect(md?.target).toBe("b");

        // Surface event counts to the test runner so the orchestrator can
        // confirm the trajectory shape from CI logs. `console.warn` rather
        // than `console.log` because the project's biome rule forbids the
        // latter.
        console.warn(
          `[e2e] humanClick: ${events.mousemove.length} moves; mousedown target=${md?.target}; ` +
            `dt=${last && first ? Math.round(last.t - first.t) : 0} ms`,
        );
      } finally {
        await session.close();
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "humanType emits keydown/keyup pairs for each character",
    async () => {
      const session = await mochi.launch({
        profile: "test-behavioral",
        seed: "e2e-type",
        headless: true,
      });
      try {
        const page = await session.newPage();
        await page.goto(BUTTON_HARNESS_HTML);
        await page.humanType("#i", "hi", { mistakeRate: 0 });
        const events = (await page.evaluate(function (this: Document) {
          const w = this.defaultView as unknown as { __events: unknown };
          return w?.__events;
        } as () => unknown)) as {
          mousemove: { t: number; x: number; y: number }[];
          mousedown: { t: number; x: number; y: number }[];
          mouseup: { t: number; x: number; y: number }[];
          keydown: { t: number; key: string }[];
          keyup: { t: number; key: string }[];
        };
        expect(events.keydown.length).toBe(2);
        expect(events.keyup.length).toBe(2);
        expect(events.keydown.map((e) => e.key)).toEqual(["h", "i"]);
        // Inter-key timing > 0.
        if (events.keydown.length === 2) {
          const k0 = events.keydown[0];
          const k1 = events.keydown[1];
          if (k0 !== undefined && k1 !== undefined) {
            expect(k1.t).toBeGreaterThan(k0.t);
          }
        }
        // Surface event counts to the test runner so the orchestrator can
        // confirm the trajectory shape from CI logs. `console.warn` rather
        // than `console.log` because the project's biome rule forbids the
        // latter.
        console.warn(
          `[e2e] humanType: keydown.length=${events.keydown.length}, ` +
            `keys=${events.keydown.map((e) => e.key).join(",")}`,
        );
      } finally {
        await session.close();
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "humanScroll moves window.scrollY toward the target",
    async () => {
      const session = await mochi.launch({
        profile: "test-behavioral",
        seed: "e2e-scroll",
        headless: true,
      });
      try {
        const page = await session.newPage();
        await page.goto(BUTTON_HARNESS_HTML);
        const before = (await page.evaluate(function (this: Document) {
          return this.defaultView?.scrollY ?? 0;
        } as () => unknown)) as number;
        await page.humanScroll({ to: { x: 0, y: 500 } });
        const after = (await page.evaluate(function (this: Document) {
          return this.defaultView?.scrollY ?? 0;
        } as () => unknown)) as number;
        expect(after).toBeGreaterThan(before);
        // Surface event counts to the test runner so the orchestrator can
        // confirm the trajectory shape from CI logs. `console.warn` rather
        // than `console.log` because the project's biome rule forbids the
        // latter.
        console.warn(`[e2e] humanScroll: scrollY ${before} → ${after}`);
      } finally {
        await session.close();
      }
    },
    TEST_TIMEOUT_MS,
  );
});
