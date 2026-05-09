/**
 * Recipe: Captcha escalation patterns.
 *
 * Pure escalation routing example. Show all `TurnstileEscalationReason`
 * cases with the trade-off "improve stealth posture vs. hand off to solver".
 *
 * Heuristic: try posture improvement once (free, fast) before paying for a
 * solver request. Solvers cost money per solve and won't save you if the
 * actual problem is a fingerprint leak the next page will re-detect.
 *
 * @see https://mochijs.com/docs/guides/recipe-captcha-escalation
 */

import type { TurnstileEscalationReason } from "@mochi.js/challenges";
import { mochi } from "@mochi.js/core";

interface EscalationContext {
  reason: TurnstileEscalationReason;
  attempt: number;
  startedAt: number;
}

async function attemptWithEscalation(attempt: number): Promise<"ok" | "give-up"> {
  let triggered: EscalationContext | undefined;

  // Profile family rotation: macOS shape on 0/1, Windows shape on 2.
  // Different `wreqPreset`, different UA-CH platform, different `display.*`.
  const session = await mochi.launch({
    profile: attempt < 2 ? "mac-m4-chrome-stable" : "windows-chrome-stable",
    seed: `escalation-attempt-${attempt}`,
    ...(process.env.PROXY_URL !== undefined ? { proxy: process.env.PROXY_URL } : {}),
    geoConsistency: "privacy-fallback",
    challenges: {
      turnstile: {
        autoClick: true,
        timeout: 30_000,
        onEscalation: (reason) => {
          // Set state and react in the caller. NEVER close the session here —
          // the auto-click poll loop is mid-tick.
          triggered = { reason, attempt, startedAt: Date.now() };
        },
      },
    },
  });

  try {
    const page = await session.newPage();
    await page.goto("https://protected.example/", { waitUntil: "domcontentloaded" });
    await page.waitFor("[data-testid=content]", { state: "visible", timeout: 45_000 });
    return "ok";
  } catch {
    if (triggered === undefined) return "give-up";

    switch (triggered.reason) {
      case "timeout":
        // Click landed; response token never propagated. Often a network
        // blip. Bumping `timeout` to 45s before retrying is much cheaper
        // than calling a solver. Same seed = deterministic replay.
        return attempt < 1 ? "ok" : "give-up";

      case "image-challenge":
        // CAPTCHA solve required. Two trade-offs:
        //   - improve stealth posture (free) — rotate seed + profile family,
        //     fresh proxy IP. Works if trust loss was about THIS session.
        //   - hand off to a solver (paid) — works if the site classified the
        //     fingerprint *class* as suspect; posture changes won't help.
        // Heuristic: posture improvement first, solver after that fails.
        return attempt < 2 ? "ok" : "give-up";

      case "managed":
        // Cloudflare already classified you as a bot before the widget
        // rendered. Clicking won't save the session. Re-launch with a
        // different fingerprint class + different exit IP. If both retries
        // also hit "managed", the IP range is likely flagged.
        return attempt < 2 ? "ok" : "give-up";
    }
  } finally {
    await session.close();
  }
}

let result: "ok" | "give-up" = "give-up";
for (let attempt = 0; attempt < 3; attempt++) {
  result = await attemptWithEscalation(attempt);
  if (result === "ok") break;
  console.warn(`attempt ${attempt} failed; retrying with adjusted posture`);
}

if (result === "give-up") {
  // Hand-off seam: solver call, page a human, queue for retry-later.
  console.error("escalation chain exhausted — manual / solver hand-off required");
  process.exit(1);
}
