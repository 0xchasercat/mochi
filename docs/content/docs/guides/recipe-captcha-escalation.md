---
title: "Recipe: Captcha escalation patterns"
description: When onEscalation fires — improve the stealth posture, swap profile / proxy, or hand off to a solver.
order: 26
category: guides
lastUpdated: 2026-05-09
---

## Scenario

Your Turnstile flow worked yesterday and now it's escalating to image-challenge on every run. The `onEscalation` callback fired with `"image-challenge"` once, then `"managed"` ten minutes later. You have to decide: is the stealth posture broken (in which case clicking through a CAPTCHA won't help — the next page will just re-challenge), or is the site genuinely picky and a solver hand-off is the right move? This recipe is the decision tree, with concrete code for each branch.

The escalation reasons mochi reports come from `@mochi.js/challenges`'s `installTurnstileAutoClick`. They are: `"image-challenge"`, `"managed"`, `"timeout"`. Each one tells you something specific about *where in the funnel* Cloudflare lost trust.

## Complete code listing

```ts
import { mochi } from "@mochi.js/core";

interface EscalationContext {
  reason: "image-challenge" | "managed" | "timeout";
  attempt: number;
  startedAt: number;
}

async function attemptWithEscalation(attempt: number): Promise<"ok" | "give-up"> {
  let triggered: EscalationContext | undefined;

  const session = await mochi.launch({
    profile: attempt < 2 ? "mac-m4-chrome-stable" : "windows-chrome-stable",
    seed: `escalation-attempt-${attempt}`,
    proxy: process.env.PROXY_URL,
    geoConsistency: "privacy-fallback",
    challenges: {
      turnstile: {
        autoClick: true,
        timeout: 30_000,
        onEscalation: (reason) => {
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
        // Click landed but response token never appeared. Often a network blip.
        // Retry with a longer timeout and the same seed (deterministic replay).
        return attempt < 1 ? "ok" /* caller retries */ : "give-up";

      case "image-challenge":
        // Cloudflare wants a CAPTCHA solve. Two options:
        //   1. Improve stealth posture (new seed, new profile, fresh proxy IP)
        //      — works if the trust loss was about *this* session.
        //   2. Hand off to a third-party solver — works if the site has classified
        //      the *fingerprint class* as suspect, in which case posture changes
        //      won't help.
        // Heuristic: try posture improvement once, then escalate to solver.
        return attempt < 2 ? "ok" : "give-up";

      case "managed":
        // Cloudflare already classified you as a bot before the widget rendered.
        // The widget cannot save this session — it's a "you've already lost"
        // screen. Re-launch from scratch with a different fingerprint class
        // (different profile family) and a different exit IP. If both retries
        // also hit "managed", the site has likely flagged the IP range.
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
  // Hand off to a solver here, or page a human, or queue for retry-later.
  console.error("escalation chain exhausted — manual / solver hand-off required");
  process.exit(1);
}
```

## What's happening here

- **Three reasons, three branches.** `"timeout"` is a transport-layer issue (token didn't propagate). `"image-challenge"` is "the widget itself wants more work". `"managed"` is "you've been classified before the widget mattered". The right response is different for each.
- **Posture improvement before solver hand-off.** Solvers cost money per request (2captcha, anti-captcha, capmonster — all charge per solve). Trying a fresh seed + a different profile family is free; if your stealth posture is the actual problem (e.g. a `--no-sandbox` flag, a JA4 mismatch, a missing matrix override), the solver won't save you on the next page anyway. Run posture improvement first.
- **Profile family rotation.** The recipe flips from `mac-m4-chrome-stable` to `windows-chrome-stable` on attempt 2. That's a different UA-CH platform, a different `display.{width, height}`. If the site fingerprinted the macOS shape on attempt 0, the Windows shape is genuinely a different identity.
- **`geoConsistency: "privacy-fallback"`** — keeps you safe if the proxy's exit IP doesn't match the macOS-PT or Windows-ET timezone the matrix would otherwise pick. The matrix overrides to UTC + en-US (Tor / Brave shape) rather than failing loudly. See [recipe-residential-proxy](/docs/guides/recipe-residential-proxy).
- **Deterministic seeds across attempts.** `seed: \`escalation-attempt-${attempt}\`` makes each retry reproducible. When you debug a flaky escalation, replaying with the same seed gives you the same trajectory, the same scroll cadence, the same per-key timing — so you can isolate whether the variability was on the site's side or yours.

## Things that go wrong

- **Solving Turnstile when the real problem is `--no-sandbox` leaking.** mochi auto-adds `--no-sandbox` under root + Linux. If your CI runner is rootful, the flag goes on the command line; some fingerprinters check `process.argv` via the timing-attack channel and treat its presence as a bot signal (PLAN.md §8.6). Either run rootless, set up a SUID `chrome-sandbox` and pass `allowRootWithSandbox: true`, or accept the small posture cost.
- **Treating `"timeout"` as `"image-challenge"`.** They're different. A `"timeout"` is "click landed, response didn't propagate" — usually a transient network issue. Bumping `timeout` to 45 s before retrying is much cheaper than calling a solver.
- **Hand-off to a solver without a sitekey.** 2captcha-style APIs need the Turnstile sitekey AND the page URL. Read the sitekey from the iframe `src` (`data-sitekey="..."` or the URL query). If you're inside `onEscalation`, you have the page reference — `page.querySelectorPiercing('[data-sitekey]')` then `handle.getAttribute("data-sitekey")`.
- **Looping forever on `"managed"`.** That reason means Cloudflare's heuristics already lost trust *before* the widget rendered. Retrying with the same (profile, IP) will reproduce the same classification. Cap the retry count and rotate one of (seed, profile, proxy).
- **Calling `session.close()` from inside `onEscalation`.** The callback runs on the auto-click poll loop; closing the session mid-callback creates a use-after-close race. Set a flag, return from the callback, and close in the `finally`.
- **Mistaking the v0.2 scope.** mochi's auto-click is **visible-checkbox only**. Image / audio / managed variants are deliberately not auto-solved — clicking blindly is detectable. v0.3+ may ship a first-party solver hook surface; until then `onEscalation` is the official hand-off seam. See [Limits → Turnstile auto-click](/docs/reference/limits).

## See also

- [`guides/recipe-cloudflare-turnstile`](/docs/guides/recipe-cloudflare-turnstile) — the happy-path Turnstile recipe.
- [`guides/turnstile`](/docs/guides/turnstile) — full `TurnstileOptions` reference.
- [`guides/recipe-fingerprint-validation`](/docs/guides/recipe-fingerprint-validation) — verify your stealth posture before retrying.
- [`guides/recipe-residential-proxy`](/docs/guides/recipe-residential-proxy) — proxy + geo posture, often the actual fix.
- [`reference/limits`](/docs/reference/limits) — Turnstile scope, the architectural ceiling for auto-solve.
- [`api/challenges`](/docs/api/challenges) — `TurnstileEscalationReason`.

<!-- llm-context:start
Page purpose: cookbook recipe — patterns for the Turnstile onEscalation
callback. Decides between "improve stealth posture" (free, fast) and
"hand off to a solver" (paid, slower) based on which escalation reason fired.

Key API symbols + signatures (verified against packages/challenges/src/install.ts +
packages/core/src/launch.ts as of 2026-05-09):
  challenges.turnstile.onEscalation: (reason: "image-challenge" | "managed" | "timeout") => void
  challenges.turnstile.timeout: number  // ms; default 30_000
  challenges.turnstile.autoClick: boolean
  TurnstileEscalationReason = "image-challenge" | "managed" | "timeout"
  page.querySelectorPiercing(selector): Promise<ElementHandle | null>
  ElementHandle.getAttribute(name): Promise<string | null>

Decision tree the recipe encodes:
  "timeout"           → bump timeout, retry once with same seed (replay)
  "image-challenge"   → posture improvement (new seed → new profile family) before solver hand-off
  "managed"           → rotate (profile family, exit IP); after retries, fail-fast or solver

Common LLM hallucinations + corrections:
  - WRONG: assuming mochi auto-solves image / audio variants  → CORRECT: visible-checkbox only; v0.3+ for solver hooks
  - WRONG: `onEscalation` returning a token to "fix" the widget  → there is no return-value contract; set state, react in caller
  - WRONG: closing the session inside `onEscalation`           → unsafe (callback runs on poll loop); set a flag, close in finally
  - WRONG: `reason: "captcha"` / `reason: "challenge"`          → the exact strings are "image-challenge", "managed", "timeout"
  - WRONG: calling `solver(token)` synchronously inside callback  → callback can be async, but blocking the poll stalls detection of new widgets

Escalation reason semantics:
  "timeout"          — click landed; response token didn't appear within `timeout` ms.
  "image-challenge"  — iframe src matches /challenge.html (Cloudflare wants a real CAPTCHA solve).
  "managed"          — iframe src matches /managed.html (Cloudflare already classified visitor as bot before the widget mattered).

Cross-references on mochijs.com:
  - https://mochijs.com/docs/guides/recipe-cloudflare-turnstile
  - https://mochijs.com/docs/guides/turnstile
  - https://mochijs.com/docs/guides/recipe-fingerprint-validation
  - https://mochijs.com/docs/guides/recipe-residential-proxy
  - https://mochijs.com/docs/reference/limits
  - https://mochijs.com/docs/api/challenges
  - https://mochijs.com/docs/concepts/stealth-philosophy
llm-context:end -->
