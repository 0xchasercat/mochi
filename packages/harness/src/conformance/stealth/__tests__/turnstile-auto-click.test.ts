/**
 * Stealth conformance — Layer 2 (online) — Turnstile auto-click.
 *
 * Drives `mochi.launch({ challenges: { turnstile: { autoClick: true } } })`
 * against Cloudflare's public Turnstile demo
 * (https://demo.turnstile.workers.dev/) and asserts that a response token
 * appears within 20 seconds.
 *
 * Gating: `MOCHI_E2E=1` AND `MOCHI_ONLINE=1`. Without the gates the test
 * is `describe.skip`'d so unit / contract suites stay green offline.
 *
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { resolve } from "node:path";
import { mochi, type Session } from "@mochi.js/core";
import { loadProfile } from "../../../run";
import { CONFORMANCE_PROFILE, CONFORMANCE_SEED, ONLINE_ENABLED, sleep, withPage } from "../helpers";

const SUITE_TIMEOUT_MS = 120_000;
const TEST_TIMEOUT_MS = 60_000;

/** Public Cloudflare Turnstile demo. Free tier, no API key required. */
const TURNSTILE_DEMO_URL = "https://demo.turnstile.workers.dev/";

/**
 * Re-implement `launchSharedSession()` here with the `challenges` flag set.
 * The base helper deliberately doesn't expose a knob for the launch options
 * because every other conformance test wants the same baseline.
 */
async function launchTurnstileSession(): Promise<Session> {
  const profile = await loadProfile(`packages/profiles/data/${CONFORMANCE_PROFILE}`);
  const binary = process.env.MOCHI_CHROMIUM_PATH;
  const proxy = process.env.MOCHI_PROXY;
  const launchOpts: Parameters<typeof mochi.launch>[0] = {
    profile,
    seed: CONFORMANCE_SEED,
    headless: true,
    challenges: {
      turnstile: {
        autoClick: true,
        timeout: 25_000,
      },
    },
  };
  if (binary !== undefined && binary.length > 0) {
    (launchOpts as { binary?: string }).binary = binary;
  }
  if (proxy !== undefined && proxy.length > 0) {
    (launchOpts as { proxy?: string }).proxy = proxy;
  }
  return mochi.launch(launchOpts);
}

const describeOrSkip = ONLINE_ENABLED ? describe : describe.skip;

describeOrSkip(
  `challenges conformance / Turnstile auto-click — demo.turnstile.workers.dev (profile=${CONFORMANCE_PROFILE})`,
  () => {
    let session: Session;

    beforeAll(async () => {
      session = await launchTurnstileSession();
    }, SUITE_TIMEOUT_MS);

    afterAll(async () => {
      if (session !== undefined) {
        await session.close();
      }
    }, SUITE_TIMEOUT_MS);

    it(
      "auto-clicks the visible-checkbox widget and a cf-turnstile-response token appears within 20s",
      async () => {
        await withPage(session, async (page) => {
          await page.goto(TURNSTILE_DEMO_URL, { waitUntil: "load", timeout: 30_000 });
          // Poll for the token. The widget is visible-checkbox; the auto-
          // click layer runs in the background and fills cf-turnstile-response
          // on success.
          const deadline = Date.now() + 20_000;
          let token: string | null = null;
          while (Date.now() < deadline) {
            token = await page.evaluate(function (this: Document) {
              const els = this.querySelectorAll(
                'input[name="cf-turnstile-response"], textarea[name="cf-turnstile-response"]',
              );
              for (let i = 0; i < els.length; i++) {
                const el = els[i] as HTMLInputElement | HTMLTextAreaElement;
                if (typeof el.value === "string" && el.value.length > 0) return el.value;
              }
              return null;
            });
            if (token !== null && token.length > 0) break;
            await sleep(500);
          }
          expect(token).not.toBeNull();
          expect(typeof token === "string" && token.length > 0).toBe(true);
        });
      },
      TEST_TIMEOUT_MS,
    );

    /**
     * Closed-shadow variant. Loads the local
     * `tests/fixtures/closed-shadow.html` fixture which embeds a Turnstile
     * iframe inside a `{ mode: "closed" }` shadow root. We don't expect a
     * solved token here (the iframe `src` is a smoke marker — it can't
     * actually run Turnstile's challenge engine without a sitekey + the
     * referrer Cloudflare allowlists); we DO expect the host-side
     * `Page.querySelectorPiercing` to surface the iframe, and the
     * Turnstile detector's piercing pass to schedule a click against it
     * (which will get caught by the post-click timeout — that's fine, the
     * point of the variant is to prove detection works through closed
     * shadows).
     */
    it(
      "querySelectorPiercing surfaces a Turnstile iframe behind a CLOSED shadow root",
      async () => {
        const fixtureUrl = `file://${resolve(process.cwd(), "tests/fixtures/closed-shadow.html")}`;
        await withPage(session, async (page) => {
          await page.goto(fixtureUrl, { waitUntil: "domcontentloaded", timeout: 15_000 });
          // The non-piercing path returns null (closed shadow opaque from
          // page JS) — same assertion as the contract test, but against
          // real Chromium.
          const sansPiercing = await page.evaluate(function (this: Document) {
            return this.querySelectorAll("iframe").length;
          });
          expect(sansPiercing).toBe(0);
          // The piercing locator finds the iframe.
          const handle = await page.querySelectorPiercing(
            'iframe[src*="challenges.cloudflare.com/turnstile"]',
          );
          expect(handle).not.toBeNull();
          const src = await handle?.getAttribute("src");
          expect(src).toContain("challenges.cloudflare.com/turnstile");
        });
      },
      TEST_TIMEOUT_MS,
    );
  },
);
