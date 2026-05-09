/**
 * Stealth conformance — Layer 1 (offline-ish) — `Accept-Language` ↔ `--lang`.
 *
 * Closes PLAN.md I-5 leak between Chromium's network-layer `Accept-Language`
 * header (derived from the `--lang` flag) and the JS-layer `navigator.language(s)`
 * spoof (driven by `matrix.locale` / `matrix.languages`).
 *
 * We assert two surfaces:
 *   1. JS layer — `navigator.language === matrix.locale`. This already passes
 *      on `main` thanks to the inject-layer `R-015` rule; the assertion is
 *      kept here so the test fails closed if the inject layer regresses.
 *   2. Network layer — the `Accept-Language` request header captured via
 *      `Network.requestWillBeSent`. With task 0251's `--lang=<matrix.locale>`
 *      patch, Chromium derives the header's primary tag from the matrix.
 *      Without the patch, the header falls back to `en-US,en;q=0.9` (or the
 *      host OS locale), failing this assertion any time the matrix locale
 *      differs from `en-US`.
 *
 * Gated by `MOCHI_E2E=1`. Profile: `mac-m4-chrome-stable` (`locale: "en-US"`).
 *
 * The Accept-Language header is captured from a real outbound HTTP request
 * to a small ephemeral `Bun.serve` instance bound to `127.0.0.1:0` — no
 * network egress, hermetic.
 *
 * @see PLAN.md §2 I-5 (relational consistency or nothing)
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
  `stealth conformance / Layer 1 — Accept-Language ↔ --lang (profile=${CONFORMANCE_PROFILE})`,
  () => {
    let session: Session;
    let server: { stop: () => void; url: string; lastAcceptLanguage: () => string | null };

    beforeAll(async () => {
      session = await launchSharedSession();
      server = startEphemeralServer();
    }, SUITE_TIMEOUT_MS);

    afterAll(async () => {
      try {
        server?.stop();
      } catch {
        // best effort
      }
      if (session !== undefined) {
        await session.close();
      }
    }, SUITE_TIMEOUT_MS);

    /**
     * JS layer — direct `navigator.language` read. This must equal
     * `matrix.locale` (the canonical primary BCP-47 string).
     */
    it(
      "navigator.language === matrix.locale (JS-layer spoof, R-015)",
      async () => {
        await withRetries(async () => {
          await withPage(session, async (page) => {
            await page.goto("about:blank");
            const language = await evalExpr<string>(page, "navigator.language");
            expect(language).toBe(session.profile.locale);
          });
        });
      },
      TEST_TIMEOUT_MS,
    );

    /**
     * Network layer — the `Accept-Language` header observed on an outbound
     * request must agree with `matrix.locale`. Chromium derives the
     * header from `--lang` (which task 0251 plumbs from the matrix); a
     * regression here means `--lang` is no longer being passed and the
     * I-5 leak is back.
     *
     * We accept any header whose comma-split first tag (case-insensitive)
     * equals `matrix.locale` — Chromium emits values like
     * `en-US,en;q=0.9` and we only assert the primary, since multi-locale
     * q-weighting is out of scope for v0.2 (PLAN.md task 0251 §"Out of
     * scope").
     */
    it(
      "Accept-Language primary tag matches matrix.locale (network-layer)",
      async () => {
        await withRetries(async () => {
          await withPage(session, async (page) => {
            await page.goto(server.url);
            const observed = server.lastAcceptLanguage();
            expect(observed).not.toBeNull();
            const primary = (observed as string).split(",")[0]?.trim() ?? "";
            expect(primary.toLowerCase()).toBe(session.profile.locale.toLowerCase());
          });
        });
      },
      TEST_TIMEOUT_MS,
    );
  },
);

/**
 * Spin up a `Bun.serve` listener on an ephemeral port that records the
 * `Accept-Language` header of the most recent request. Hermetic — no
 * network egress, exits with the test process.
 */
function startEphemeralServer(): {
  stop: () => void;
  url: string;
  lastAcceptLanguage: () => string | null;
} {
  let lastAcceptLanguage: string | null = null;
  // biome-ignore lint/suspicious/noExplicitAny: Bun.serve's typing is environment-dependent
  const srv = (Bun as any).serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch(req: Request): Response {
      lastAcceptLanguage = req.headers.get("accept-language");
      return new Response(
        '<!doctype html><html lang="x-test"><body><p id="probe">ok</p></body></html>',
        { status: 200, headers: { "content-type": "text/html; charset=utf-8" } },
      );
    },
  }) as { port: number; hostname: string; stop: () => void };
  return {
    stop: () => srv.stop(),
    url: `http://${srv.hostname}:${srv.port}/`,
    lastAcceptLanguage: () => lastAcceptLanguage,
  };
}
