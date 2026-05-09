/**
 * Recipe: Headful vs headless.
 *
 * Flag-based: `MOCHI_HEADLESS=off bun run index.ts` shows the visible browser;
 * default is `headlessMode: "new"` (modern Chromium headless, full rendering,
 * GPU compositor — near-byte-identical to headful for fingerprinting and the
 * right default on a server).
 *
 * Trade-offs (tightly summarised):
 *   "new"     — production default on servers. Full rendering, GPU compositor.
 *   "legacy"  — old `--headless` code path. No GPU compositor. Detectable.
 *               Only kept for parity with old tooling. Don't pick this.
 *   "off"     — real headful. Requires X11 / Wayland display server, or
 *               `xvfb-run`. Slower spawn (~500ms more), more memory. Use for
 *               debugging, screencast, visual-regression testing.
 *
 * @see https://mochijs.com/docs/guides/recipe-headful-vs-headless
 */

import { mochi } from "@mochi.js/core";

const env = mochi.detectLinuxServerEnv();
console.log(`linux-server probe: ${env.rationale}`);

// Decision: env var beats env-aware default. Explicit `headlessMode` beats
// both the legacy `headless: boolean` knob and the env default.
//
//   MOCHI_HEADLESS=off  → real headful (requires DISPLAY or xvfb-run)
//   MOCHI_HEADLESS=new  → modern Chromium headless
//   MOCHI_HEADLESS=legacy → old --headless (don't pick this)
//   (unset)             → env-aware: "new" on Linux + no DISPLAY, else "off"
function pickHeadlessMode(): "new" | "legacy" | "off" | undefined {
  const raw = process.env.MOCHI_HEADLESS;
  if (raw === "new" || raw === "legacy" || raw === "off") return raw;
  return undefined; // let mochi pick from env
}

const mode = pickHeadlessMode();
const session = await mochi.launch({
  profile: "mac-m4-chrome-stable",
  seed: "headful-debug-001",
  ...(mode !== undefined ? { headlessMode: mode } : {}),
});

try {
  console.log(
    `running with headlessMode=${mode ?? "(env-default)"} on profile=${session.profile.id}`,
  );
  if (session.profile.behavior !== undefined) {
    console.log(
      `behavior: tremor=${session.profile.behavior.tremor} wpm=${session.profile.behavior.wpm}`,
    );
  }

  const page = await session.newPage();
  await page.goto("https://example.com/", { waitUntil: "domcontentloaded" });

  // In headful mode you can pause here and poke the page in DevTools (open
  // via the menu bar — mochi doesn't auto-open it). Useful for selectors that
  // disappear on hover.

  await page.waitFor("h1", { state: "visible", timeout: 30_000 });
  const png = await page.screenshot({ fullPage: true });
  await Bun.write("./out/page.png", png);
  console.log(`captured ${png.length} bytes`);
} finally {
  await session.close();
}
