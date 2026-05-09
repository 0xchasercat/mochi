/**
 * Recipe: Cloudflare Turnstile.
 *
 * Auto-click the visible-checkbox Turnstile variant via
 * `LaunchOptions.challenges.turnstile.autoClick: true`. Wire `onSolved` and
 * `onEscalation` callbacks; route image / managed variants to a placeholder
 * `solve2Captcha(reason)` (TODO: replace with a real solver hand-off).
 *
 * mochi's auto-click is **visible-checkbox only** by design. Image / audio /
 * managed variants surface through `onEscalation`; never blind-click them.
 *
 * @see https://mochijs.com/docs/guides/recipe-cloudflare-turnstile
 */

import type { TurnstileEscalationReason } from "@mochi.js/challenges";
import { mochi } from "@mochi.js/core";

// TODO: replace with a real solver call (2captcha, anti-captcha, capmonster).
async function solve2Captcha(reason: TurnstileEscalationReason): Promise<void> {
  console.warn(`[stub] would hand off to 2captcha for reason=${reason}`);
}

const session = await mochi.launch({
  profile: "mac-m4-chrome-stable",
  seed: "turnstile-bypass-001",
  challenges: {
    turnstile: {
      autoClick: true,
      humanize: true, // default true — Bezier+Fitts via humanClick
      timeout: 30_000, // default 30s — wait this long for the token
      pollIntervalMs: 500, // default 500ms — DOM scan cadence
      onSolved: (token) => {
        console.log(`turnstile solved, token starts ${token.slice(0, 12)}…`);
      },
      onEscalation: (reason) => {
        // reason: "image-challenge" | "managed" | "timeout"
        console.warn(`turnstile escalated: ${reason}`);
        // Don't close the session from inside the callback — the auto-click
        // poll loop is mid-tick. Fire-and-forget the solver hand-off.
        // TODO: wire your solver of choice; capture sitekey from the iframe
        // via `page.querySelectorPiercing('[data-sitekey]')` if needed.
        void solve2Captcha(reason);
      },
    },
  },
});

try {
  const page = await session.newPage();
  await page.goto("https://protected.example/login");

  // The auto-clicker runs in the background. Drive your normal flow.
  await page.waitFor("[data-testid=login-form]", { state: "visible" });
  await page.humanType("input[name=email]", process.env.APP_EMAIL ?? "me@example.com");
  await page.humanType("input[name=password]", process.env.APP_PASSWORD ?? "", {
    mistakeRate: 0,
  });
  await page.humanClick("button[type=submit]");

  // Wait for a post-Turnstile DOM change — onSolved is NOT a navigation signal.
  await page.waitFor("[data-testid=dashboard]", { timeout: 45_000 });
  console.log("dashboard reached");
} finally {
  await session.close();
}
