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
 * @see tasks/0220-turnstile-auto-click.md §"Tests"
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
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
  },
);
