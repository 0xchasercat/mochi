/**
 * Recipe: Warm-session replay.
 *
 * Capture cookies + localStorage from a real warmed-up session, persist both
 * to disk, re-hydrate on subsequent runs to defeat IP-class scoring on
 * re-visit. Two modes — pass `--resume` to enter the replay path.
 *
 * Order of operations matters:
 *   1. mochi.launch
 *   2. session.cookies.load (BEFORE any goto — Storage.setCookies is root-target)
 *   3. session.newPage + page.goto(ORIGIN)
 *   4. page.localStorage.set (origin must be non-opaque, so navigate first)
 *   5. page.goto(`${ORIGIN}/protected-route`)
 *
 * @see https://mochijs.com/docs/guides/recipe-warm-session-replay
 */

import { existsSync } from "node:fs";
import { mochi } from "@mochi.js/core";

interface WarmState {
  localStorage: Record<string, string>;
  capturedAt: string;
}

const COOKIES = "./state/example-cookies.json";
const STORAGE = "./state/example-storage.json";
const TARGET_ORIGIN = process.env.TARGET_ORIGIN ?? "https://app.example.com";

async function captureWarmState(): Promise<void> {
  const session = await mochi.launch({
    profile: "mac-m4-chrome-stable",
    seed: "warm-capture-001",
  });
  try {
    const page = await session.newPage();
    await page.goto(`${TARGET_ORIGIN}/login`);
    // ...interactive login (humanType / humanClick / MFA)...
    await page.waitFor("[data-testid=dashboard]", { timeout: 60_000 });
    // Idle long enough that site-side trackers debounce-write their state.
    // 60s is the cheap floor; longer is better.
    await new Promise((r) => setTimeout(r, 60_000));

    await session.cookies.save(COOKIES, { pattern: /\.example\.com$/ });
    const ls = await page.localStorage.get();
    const state: WarmState = { localStorage: ls, capturedAt: new Date().toISOString() };
    await Bun.write(STORAGE, JSON.stringify(state, null, 2));
    console.log(`captured: ${Object.keys(ls).length} localStorage keys`);
  } finally {
    await session.close();
  }
}

async function rehydrateAndRun(): Promise<void> {
  const session = await mochi.launch({
    profile: "mac-m4-chrome-stable",
    seed: "warm-replay-001",
    ...(process.env.PROXY_URL !== undefined ? { proxy: process.env.PROXY_URL } : {}),
  });
  try {
    // Cookies BEFORE navigation — Storage.setCookies is on the root browser
    // target, no tab needed. Same `pattern` as the save call.
    if (existsSync(COOKIES)) {
      await session.cookies.load(COOKIES, { pattern: /\.example\.com$/ });
    }

    const page = await session.newPage();
    // Navigate to the origin first, THEN write localStorage. DOMStorage
    // requires a non-opaque origin; about:blank rejects.
    await page.goto(TARGET_ORIGIN);

    if (existsSync(STORAGE)) {
      const state = JSON.parse(await Bun.file(STORAGE).text()) as WarmState;
      await page.localStorage.set(state.localStorage, { origin: TARGET_ORIGIN });
    }

    // Now navigate to the protected route — already warm.
    await page.goto(`${TARGET_ORIGIN}/dashboard`);
    const greeting = await page.text("[data-testid=user-greeting]");
    console.log("greeting:", greeting);
  } finally {
    await session.close();
  }
}

// Mode flag via Bun.argv. `--resume` enters the replay path; default is capture.
if (Bun.argv.includes("--resume")) {
  await rehydrateAndRun();
} else {
  await captureWarmState();
}
