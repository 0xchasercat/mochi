/**
 * Stealth conformance — Layer 1 (offline) — `TestMouseEventScreenCoords`.
 *
 * Validates the R-041 lock end-to-end against real Chromium: when a
 * CDP-dispatched `Input.dispatchMouseEvent` synthesizes a click, the
 * captured `event.screenX` / `event.screenY` MUST satisfy the relational
 * identity:
 *
 *   `event.screenX === event.clientX + window.screenX`
 *   `event.screenY === event.clientY + window.screenY`
 *
 * Without the inject patch, `Input.dispatchMouseEvent` stuffs `screenX/Y`
 * with zeros (the dispatch params we don't supply), exposing a tell to
 * sites that read `event.screenX` for clickjacking/bot heuristics. Our
 * `mouse-event-screen` inject module patches the prototype getters so
 * synthesized events match real-input semantics.
 *
 * Profile: `mac-m4-chrome-stable`. Gated by `MOCHI_E2E=1`.
 *
 * Source: PRB `lib/cjs/module/pageController.js:48-58` (origin
 * `TheFalloutOf76/CDP-bug-MouseEvent-.screenX-.screenY-patcher`).
 *
 * @see PLAN.md §5.3, §8.4 (R-041)
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

const TEST_TIMEOUT_MS = 30_000;
const SUITE_TIMEOUT_MS = 60_000;

/**
 * Self-contained data: URL with a click target spanning a known
 * (clientX, clientY) range and a click listener that captures the dispatched
 * event's screenX/Y. Same-frame data:URL — no network, hermetic.
 */
const PAGE_HTML = `<!doctype html><html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0">
<div id="t" style="position:absolute;left:100px;top:100px;width:200px;height:200px;background:#0af"></div>
<script>
  window.__captured = null;
  document.getElementById("t").addEventListener("click", function(e) {
    window.__captured = {
      clientX: e.clientX,
      clientY: e.clientY,
      screenX: e.screenX,
      screenY: e.screenY,
      windowScreenX: window.screenX,
      windowScreenY: window.screenY
    };
  });
</script>
</body></html>`;

const PAGE_URL = `data:text/html;charset=utf-8,${encodeURIComponent(PAGE_HTML)}`;

const describeOrSkip = E2E_ENABLED ? describe : describe.skip;

describeOrSkip(
  `stealth conformance / Layer 1 — MouseEvent screen coords (profile=${CONFORMANCE_PROFILE})`,
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
     * The R-041 identity: dispatched click event's screenX/Y matches the
     * formula `clientX + window.screenX` / `clientY + window.screenY`.
     */
    it(
      "Input.dispatchMouseEvent captured event satisfies clientXY + window.screenXY",
      async () => {
        await withRetries(async () => {
          await withPage(session, async (page) => {
            await page.goto(PAGE_URL, { waitUntil: "load" });
            // humanClick walks a Bezier path and dispatches via
            // Input.dispatchMouseEvent under the hood — exactly the path
            // the inject patch is meant to repair.
            await page.humanClick("#t");
            // Poll for the listener to fire.
            const captured = await page.evaluate<{
              clientX: number;
              clientY: number;
              screenX: number;
              screenY: number;
              windowScreenX: number;
              windowScreenY: number;
            } | null>(() => {
              return (globalThis as { __captured?: unknown }).__captured as never;
            });
            expect(captured).not.toBeNull();
            if (captured === null) return;
            expect(captured.screenX).toBe(captured.clientX + captured.windowScreenX);
            expect(captured.screenY).toBe(captured.clientY + captured.windowScreenY);
          });
        });
      },
      TEST_TIMEOUT_MS,
    );

    /**
     * Cross-check: a synthesized `new MouseEvent({clientX, clientY})` reads
     * back the same identity. This isolates the prototype patch from the
     * dispatch path — if this fails but the dispatch test passes, the
     * prototype getters aren't installed.
     */
    it(
      "synthesized MouseEvent prototype getter satisfies the same identity",
      async () => {
        await withRetries(async () => {
          await withPage(session, async (page) => {
            await page.goto(PAGE_URL, { waitUntil: "load" });
            const result = await evalExpr<{
              screenX: number;
              clientX: number;
              wsx: number;
              eq: boolean;
            }>(
              page,
              `(function() {
                var ev = new MouseEvent("test", { clientX: 123, clientY: 456 });
                return {
                  screenX: ev.screenX,
                  clientX: ev.clientX,
                  wsx: window.screenX,
                  eq: ev.screenX === (ev.clientX + window.screenX)
                };
              })()`,
            );
            expect(result.eq).toBe(true);
            expect(result.screenX).toBe(result.clientX + result.wsx);
          });
        });
      },
      TEST_TIMEOUT_MS,
    );

    /**
     * Descriptor cloak: getter must answer `.toString()` with the native
     * shape Chrome would emit, and the descriptor's enumerable/configurable
     * must mirror Chrome's `{configurable: true, enumerable: true}` so
     * fingerprinters that introspect the descriptor see no tell.
     */
    it(
      "descriptor + getter.toString are cloaked to native shape",
      async () => {
        await withRetries(async () => {
          await withPage(session, async (page) => {
            await page.goto(PAGE_URL, { waitUntil: "load" });
            const shape = await evalExpr<{
              configurable: boolean | undefined;
              enumerable: boolean | undefined;
              getterToString: string;
            }>(
              page,
              `(function() {
                var d = Object.getOwnPropertyDescriptor(MouseEvent.prototype, "screenX");
                return {
                  configurable: d && d.configurable,
                  enumerable: d && d.enumerable,
                  getterToString: d && d.get ? Function.prototype.toString.call(d.get) : ""
                };
              })()`,
            );
            expect(shape.configurable).toBe(true);
            expect(shape.enumerable).toBe(true);
            expect(shape.getterToString).toContain("[native code]");
          });
        });
      },
      TEST_TIMEOUT_MS,
    );
  },
);
