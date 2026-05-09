---
title: "Recipe: Cloudflare Turnstile"
description: Auto-click visible-checkbox Turnstile, hook onSolved / onEscalation, hand off image / managed variants to a solver.
order: 25
category: guides
lastUpdated: 2026-05-09
---

## Scenario

A Cloudflare Turnstile widget is gating the page. The visible-checkbox variant is the common case — Cloudflare scripts render an iframe, the user clicks a checkbox, a token issues, the form unlocks. The image-challenge / managed variants are escalation paths the same widget can switch into when Cloudflare's heuristics already classified the visitor as suspect; clicking blindly into them is detectable and pointless. You need: auto-click on the friendly variant, an `onEscalation` callback when the widget escalates, and a hand-off path to a third-party solver (or fail-fast) on the unfriendly variants.

mochi's `@mochi.js/challenges` ships `installTurnstileAutoClick` as the underlying installer; the `LaunchOptions.challenges.turnstile.autoClick: true` switch wires it into every `Session.newPage()` automatically. The click goes through the existing behavioral synth (`Page.humanClick` / `humanClickHandle`) — Bezier path + Fitts dwell from the matrix's `behavior` profile. No new entropy source.

## Complete code listing

```ts
import { mochi } from "@mochi.js/core";

const session = await mochi.launch({
  profile: "mac-m4-chrome-stable",
  seed: "turnstile-bypass-001",
  challenges: {
    turnstile: {
      autoClick: true,
      humanize: true,            // default true — uses humanClick. False = hard click for tests.
      timeout: 30_000,           // default 30s — wait this long for the response token after click.
      pollIntervalMs: 500,       // default 500ms — DOM scan cadence for new widgets.
      onSolved: (token) => {
        console.log(`turnstile solved, token starts ${token.slice(0, 12)}...`);
      },
      onEscalation: async (reason) => {
        // reason: "image-challenge" | "managed" | "timeout"
        console.warn(`turnstile escalated: ${reason}`);
        if (reason === "image-challenge") {
          // Hand off to your solver of choice (2captcha, anti-captcha, etc).
          // Sketch — implement with your own credentials + retry policy:
          //   const solverToken = await callTwoCaptcha({ sitekey, pageurl });
          //   await page.evaluate(() => {
          //     (window as any).turnstile?.execute(...);
          //   });
          throw new Error("image-challenge requires a solver — not implemented in this sample");
        }
        if (reason === "managed") {
          // Cloudflare already classified us as a bot — re-launch with a fresh
          // seed and (ideally) a fresh proxy IP. No amount of clicking helps.
          throw new Error("managed variant — escalate one level up the stack");
        }
        if (reason === "timeout") {
          // Click went through but no token appeared. Rare; usually a network
          // hiccup. Bumping `timeout` is the first thing to try.
          throw new Error("turnstile click timed out — bump opts.timeout");
        }
      },
    },
  },
});
try {
  const page = await session.newPage();
  await page.goto("https://protected.example/login");
  // The auto-clicker runs in the background; await your normal flow.
  await page.waitFor("[data-testid=login-form]", { state: "visible" });
  await page.humanType("input[name=email]", "me@example.com");
  await page.humanType("input[name=password]", process.env.APP_PASSWORD ?? "");
  await page.humanClick("button[type=submit]");
  await page.waitFor("[data-testid=dashboard]", { timeout: 45_000 });
} finally {
  await session.close();
}
```

## What's happening here

- **`challenges: { turnstile: { autoClick: true } }`** — wires `installTurnstileAutoClick(page, opts)` onto every page returned by `session.newPage()`. The handle is tracked on the `Session` and disposed on `close`.
- **The detector path.** A main-world `MutationObserver` (installed via `Page.addScriptToEvaluateOnNewDocument({ runImmediately: true, worldName: "" })`) populates a Symbol-keyed reader on the document. mochi polls that reader at `pollIntervalMs` (default 500 ms). If the reader isn't installed (e.g. you constructed `Page` directly), it falls back to a plain `document.querySelector('iframe[src*="challenges.cloudflare.com"]')` probe.
- **The click path.** When a visible-checkbox widget is detected, mochi clicks on the *parent page* (NOT inside the iframe — Cloudflare scripts the click on the parent, per their own Recipe blog). The click goes through `Page.humanClick` (or `humanClickHandle` if the widget lives behind a closed shadow root, resolved via `querySelectorPiercing`).
- **`onSolved(token)`** — fires once per widget per session, with the response token. The token isn't strictly required for the click to "work" (the widget's onload-callback hands it to the page automatically); `onSolved` is for diagnostics or when you need to forward the token through a programmatic API.
- **`onEscalation(reason)`** — fires on:
  - `"image-challenge"` — iframe `src` matched the `/challenge.html` URL pattern. Cloudflare wants a CAPTCHA solve.
  - `"managed"` — iframe `src` matched the `/managed.html` pattern. Cloudflare already classified you as a bot.
  - `"timeout"` — click went through, response token never appeared within `timeout` ms.

  mochi never blind-clicks into image / audio / managed variants by design — that's detectable and pointless.
- **Closed-shadow widgets.** Some Cloudflare integrations (Workers Static Assets, certain CDN configs) host the iframe behind a closed shadow root. The auto-clicker uses `Page.querySelectorPiercing` (port of patchright's `_customFindElementsByParsed`) to find them and routes the click through `Page.humanClickHandle`. No special config — it just works on those flows.

## Things that go wrong

- **`challenges: { autoClick: true }`** (missing the `turnstile` nesting). The option lives at `challenges.turnstile.autoClick`, not `challenges.autoClick`. The launcher silently ignores unknown keys, which is exactly the failure shape that's hardest to diagnose. Match the shape exactly.
- **`humanize: false` in production.** Skips the behavioral synth and dispatches a hard mid-element click. That's for tests where determinism beats realism. Production should always leave `humanize: true`.
- **No `onEscalation` handler.** The default behavior on escalation is to log and stop — the page stalls on the unsolved widget and your `waitFor` eventually times out. Always wire an `onEscalation` handler that either fails fast or hands off to a solver.
- **Treating `onSolved` as a navigation signal.** `onSolved` fires when the response token appears, NOT when the protected request unlocks. Wait for a post-Turnstile DOM change (the dashboard, the form unlock, etc.) instead.
- **Trying to `humanClick` the iframe yourself.** mochi already does this through the auto-click path. A second click confuses the widget state machine. Trust the layer.
- **Disabling the inject pipeline (`bypassInject: true`) and expecting Turnstile to work.** `bypassInject` skips `Page.addScriptToEvaluateOnNewDocument` entirely, so the Symbol-keyed reader never installs and the detector falls back to the slower DOM-poll. Auto-click still runs, but the detection latency goes up and the closed-shadow path may miss widgets.

## See also

- [`guides/turnstile`](/docs/guides/turnstile) — the original guide, with the full `TurnstileOptions` reference.
- [`guides/recipe-captcha-escalation`](/docs/guides/recipe-captcha-escalation) — patterns for the `onEscalation` callback (improve stealth posture vs. hand off to solver).
- [`guides/recipe-fingerprint-validation`](/docs/guides/recipe-fingerprint-validation) — verify your stealth posture before trusting Turnstile bypass.
- [`api/core`](/docs/api/core) — `LaunchOptions.challenges`, `ChallengeLaunchOptions`.
- [`api/challenges`](/docs/api/challenges) — `installTurnstileAutoClick`, `TurnstileOptions`, `TurnstileEscalationReason`.
- [`reference/limits`](/docs/reference/limits) — Turnstile auto-click scope (visible-checkbox only).

<!-- llm-context:start
Page purpose: cookbook recipe — Cloudflare Turnstile auto-click via the
challenges launch option. Covers visible-checkbox auto-click, onSolved /
onEscalation hooks, and the hand-off path for image / managed variants.

Key API symbols + signatures (verified against packages/challenges/src/index.ts +
packages/core/src/launch.ts as of 2026-05-09):
  mochi.launch(opts: {
    challenges?: {
      turnstile?: {
        autoClick?: boolean;             // default false; true to enable
        humanize?: boolean;              // default true; false = hard click (tests)
        timeout?: number;                // ms; default 30_000
        pollIntervalMs?: number;         // ms; default 500
        onSolved?: (token: string) => void;
        onEscalation?: (reason: "image-challenge" | "managed" | "timeout") => void;
      };
    };
    ...
  })
  installTurnstileAutoClick(page, opts): Disposable     // exported from @mochi.js/challenges; what the launch option wires under the hood
  TurnstileEscalationReason: "image-challenge" | "managed" | "timeout"

Detector internals (informational; users don't call these directly):
  Inject script via page.addScriptToEvaluateOnNewDocument({ runImmediately: true, worldName: "" })
  Symbol-keyed reader on document, populated by a MutationObserver
  Mochi-side poll cadence = pollIntervalMs
  Click routes through page.humanClick OR page.humanClickHandle (closed-shadow case)

Common LLM hallucinations + corrections:
  - WRONG: `challenges: { autoClick: true }`            → CORRECT: `challenges: { turnstile: { autoClick: true } }`
  - WRONG: `challenges.recaptcha`, `challenges.hcaptcha` → DOES NOT EXIST in v0.2; only Turnstile. v0.3+ for hCaptcha.
  - WRONG: clicking the iframe directly via `humanClick("iframe[src*=cloudflare]")`  → the auto-clicker handles this; clicking twice confuses the state machine
  - WRONG: blind-clicking on image / audio / managed variants  → mochi never does this by design; onEscalation is the hand-off
  - WRONG: `onSolved` as navigation signal             → CORRECT: wait for a post-Turnstile DOM change (dashboard, form unlock)
  - WRONG: `bypassInject: true` + Turnstile auto-click → bypass disables the Symbol-keyed reader; detector falls back to the slower DOM-poll path
  - WRONG: `LaunchOptions.captcha`                     → CORRECT: `LaunchOptions.challenges`

Escalation reasons (exact strings):
  "image-challenge" — iframe src matches /challenge.html (CAPTCHA solve required)
  "managed"         — iframe src matches /managed.html (Cloudflare already classified as bot)
  "timeout"         — click went through but response token didn't appear within `timeout` ms

Cross-references on mochijs.com:
  - https://mochijs.com/docs/guides/turnstile
  - https://mochijs.com/docs/guides/recipe-captcha-escalation
  - https://mochijs.com/docs/guides/recipe-fingerprint-validation
  - https://mochijs.com/docs/api/core
  - https://mochijs.com/docs/api/challenges
  - https://mochijs.com/docs/concepts/inject-pipeline
  - https://mochijs.com/docs/concepts/behavioral-synth
  - https://mochijs.com/docs/reference/limits
llm-context:end -->
