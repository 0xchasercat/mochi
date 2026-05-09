/**
 * Recipe: Validate the fingerprint posture.
 *
 * Point a session at creepjs and read the trust score programmatically. Fail
 * loud if the posture regressed; useful for gating a CI scrape on a clean
 * fingerprint result before pointing at a real target.
 *
 * NOTE: creepjs renders results asynchronously. We wait for the score
 * container to become visible, then sleep ~10s for the per-probe results
 * to populate, before reading.
 *
 * @see https://mochijs.com/docs/guides/recipe-fingerprint-validation
 */

import { mochi } from "@mochi.js/core";

interface CreepReport {
  fingerprint: string | null;
  trustScore: string | null;
  lies: number | null;
  bot: string | null;
}

const session = await mochi.launch({
  profile: "mac-m4-chrome-stable",
  seed: "fp-validate-001",
});

try {
  const page = await session.newPage();
  await page.goto("https://abrahamjuliot.github.io/creepjs/", {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });

  // creepjs renders into stable selectors. Wait for the trust-score container
  // to become visible — that's the first paint of the score block.
  await page.waitFor(".trust-score-container", { state: "visible", timeout: 30_000 });
  // Each probe (canvas / webgl / audio / etc.) resolves on its own clock; the
  // composite score updates over ~5–15s. Pin a generous wait.
  await new Promise((r) => setTimeout(r, 10_000));

  // page.evaluate is ZERO-arg in mochi. Close over selectors as inline
  // literals; the return type must be JSON-serializable.
  const report = await page.evaluate((): CreepReport => {
    const text = (sel: string): string | null =>
      (document.querySelector(sel) as HTMLElement | null)?.textContent?.trim() ?? null;
    const num = (s: string | null): number | null => {
      if (s === null) return null;
      const m = s.match(/\d+/);
      return m === null ? null : Number(m[0]);
    };
    return {
      fingerprint: text(".fingerprint-section .fingerprint"),
      trustScore: text(".trust-score-container .unblurred"),
      lies: num(text(".lies-section h2")),
      bot: text(".bot-section h2"),
    };
  });

  console.log("creepjs:", JSON.stringify(report, null, 2));
  await Bun.write("./out/creepjs.png", await page.screenshot({ fullPage: true }));

  // Programmatic gate — fail the run if posture regresses. Pin the threshold
  // empirically against your profile's known-good baseline.
  const MAX_LIES = Number(process.env.MAX_LIES ?? "5");
  if (report.lies !== null && report.lies > MAX_LIES) {
    console.error(`creepjs reports ${report.lies} lies (threshold=${MAX_LIES}) — failing CI`);
    process.exit(1);
  }
  console.log("posture clean — proceeding");
} finally {
  await session.close();
}
