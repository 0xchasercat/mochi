---
title: "Recipe: Validate the fingerprint posture"
description: Point a session at creepjs / FPJS demo / browserleaks and read the diff programmatically before trusting the stealth posture.
order: 27
category: guides
lastUpdated: 2026-05-09
---

## Scenario

You've got a session running. Before you point it at a real target, you want to know: does it actually look like a `mac-m4-chrome-stable` device? Or is the inject pipeline leaking, the JA4 mismatched, the timezone wrong? Site-side fingerprint probes give you a real-world second opinion. The big three are creepjs (`abrahamjuliot.github.io/creepjs/`), FingerprintJS demo (`fingerprint.com/demo/`), and browserleaks (`browserleaks.com/javascript`). Each one publishes a different score / class — reading them in-band saves you from the slow loop of "navigate, eyeball, edit, restart".

mochi's `Page.evaluate` runs your assertion in the page's main world via `Runtime.callFunctionOn`. That's the only function that goes back into the page; pull the on-screen score out into a JSON-serializable record and assert against it. For a fully offline, stricter check there's the harness — point it at the local probe-page fixture and diff against the profile's `baseline.manifest.json`. See [`concepts/probe-manifest`](/docs/concepts/probe-manifest).

## Complete code listing

```ts
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

  // creepjs renders results into elements with stable text content. Wait for
  // the trust-score block to render fully (the score appears after each probe
  // resolves — give it ~10s).
  await page.waitFor(".trust-score-container", { state: "visible", timeout: 30_000 });
  await new Promise((r) => setTimeout(r, 10_000));

  // evaluate is zero-arg — close over selectors as literals inside the fn.
  const report = await page.evaluate((): CreepReport => {
    const text = (sel: string) =>
      (document.querySelector(sel) as HTMLElement | null)?.textContent?.trim() ?? null;
    const num = (s: string | null) =>
      s === null ? null : Number((s.match(/\d+/) ?? [null])[0] ?? null);
    return {
      fingerprint: text(".fingerprint-section .fingerprint"),
      trustScore: text(".trust-score-container .unblurred"),
      lies: num(text(".lies-section h2")),
      bot: text(".bot-section h2"),
    };
  });

  console.log("creepjs:", JSON.stringify(report, null, 2));
  await Bun.write("./out/creepjs.png", await page.screenshot({ fullPage: true }));

  // Hard assertions — fail loudly if posture regresses.
  if (report.lies !== null && report.lies > 5) {
    throw new Error(`creepjs reports ${report.lies} lies — too many; check inject pipeline`);
  }
} finally {
  await session.close();
}
```

## What's happening here

- **`page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 })`** — fingerprint pages are JS-heavy. DCL gets you to the point where the probe scripts are loaded; the actual scoring takes another 5–15 s. `"load"` waits for every subresource and is unnecessarily strict here.
- **`page.waitFor(".trust-score-container", { state: "visible" })`** — visible state checks `getComputedStyle().visibility`, `display`, and the bounding rect's `width × height`. Attached-but-hidden elements don't pass.
- **`page.evaluate(() => ...)`** — the function takes zero arguments (v0.1+). Close over your selectors as inline literals; passing args returns `undefined` because v0.1 evaluate doesn't forward them. The return type must be JSON-serializable: primitives, arrays, plain objects. DOM nodes / functions / `undefined` are dropped or coerced.
- **`Bun.write("./out/creepjs.png", await page.screenshot({ fullPage: true }))`** — full-page PNG via `Page.captureScreenshot` + `Emulation.setDeviceMetricsOverride`. The screenshot is a `Uint8Array` ready to write directly. Useful as a CI artifact when you need to debug a regression.
- **Hard assertions on the score.** This is the load-bearing piece — if creepjs reports 12 lies and you ship anyway, you've turned a useful probe into a piece of theatre. Pin a threshold, fail the run, gate your scrape behind a clean fingerprint.

## Things that go wrong

- **`page.evaluate(fn, arg1, arg2)`.** v0.1+ `evaluate` is zero-arg. Passing args returns `undefined`. The function must take no parameters; close over external state via inline literals or pre-resolve into globals (carefully — globals propagate across pages).
- **`page.screenshot({ path: "./out.png" })`.** There is no `path` option. `screenshot` returns bytes (`Uint8Array` by default; `string` when `encoding: "base64"`). Write yourself with `Bun.write`.
- **Asserting against a non-stable selector.** creepjs / FPJS / browserleaks change their DOM with every release. Pin to attributes that are part of the API surface (`data-testid` if present), and treat your assertion as best-effort — if the structure changes, you'll need to update the selector. The harness ([`concepts/probe-manifest`](/docs/concepts/probe-manifest)) is a more durable alternative.
- **Comparing scores across runs without controlling the seed.** `seed` controls the matrix; same seed = same matrix = same expected score. Different seeds = legitimately different display dimensions and language ordering. Pin the seed when comparing.
- **Trusting one probe.** creepjs is great at detecting webdriver leaks. FingerprintJS demo is great at the ID-stability axis. browserleaks is great at low-level details (WebGL, Canvas, AudioContext). If three probes disagree, the truth is "this site uses a different combination of signals than any of those probes". Run all three and look for failures common across them.
- **`bypassInject: true` on a fingerprint check.** That's the *capture* shape — the browser reports its bare CfT fingerprint. Never run a stealth posture check with bypass on; you're measuring CfT, not mochi.

## See also

- [`guides/conformance-suite`](/docs/guides/conformance-suite) — the in-tree conformance runner (offline harness path).
- [`guides/capture-a-profile`](/docs/guides/capture-a-profile) — captures the baseline a posture check diffs against.
- [`concepts/probe-manifest`](/docs/concepts/probe-manifest) — the harness's structured diff.
- [`concepts/inject-pipeline`](/docs/concepts/inject-pipeline) — what the inject is actually doing under the hood.
- [`concepts/stealth-philosophy`](/docs/concepts/stealth-philosophy) — invariant I-8, why the harness is the source of truth.
- [`api/core`](/docs/api/core) — `Page.evaluate`, `Page.screenshot`, `Page.waitFor`.

<!-- llm-context:start
Page purpose: cookbook recipe — pointing a mochi session at a third-party
fingerprint probe (creepjs, FingerprintJS demo, browserleaks) and reading
the on-screen score programmatically via Page.evaluate.

Key API symbols + signatures (verified against packages/core/src/page.ts as of 2026-05-09):
  page.goto(url: string, opts?: { waitUntil?: "load" | "domcontentloaded" | "networkidle"; timeout?: number }): Promise<void>
  page.waitFor(selector: string, opts?: { state?: "attached" | "visible" | "hidden"; timeout?: number }): Promise<void>
  page.evaluate<T>(fn: () => T | Promise<T>): Promise<T>     // ZERO-ARG; returns JSON-serializable T
  page.screenshot(opts?): Promise<Uint8Array>                // also has overload for { encoding: "base64" } → string
  page.text(selector: string): Promise<string | null>
  Bun.write(path: string, bytes: Uint8Array | string): Promise<number>

Common LLM hallucinations + corrections:
  - WRONG: `page.evaluate(fn, ...args)`            → CORRECT: zero-arg only; close over inputs
  - WRONG: `page.screenshot({ path: "./out.png" })` → CORRECT: returns bytes; `await Bun.write(path, bytes)`
  - WRONG: `page.evaluate(() => document.body)`     → CORRECT: DOM nodes don't serialize; return primitives or { ...textContents }
  - WRONG: `page.waitForFunction(fn)`               → CORRECT: `page.waitFor(selector, { state })`; mochi has no waitForFunction
  - WRONG: `page.evaluateHandle(fn)`                → CORRECT: doesn't exist; use `page.querySelectorPiercing(sel)` for handles
  - WRONG: `page.goto(url, "domcontentloaded")`     → CORRECT: opts is an object: `{ waitUntil: "domcontentloaded" }`
  - WRONG: relying on a probe site's score with a noisy seed  → CORRECT: pin seed for reproducible comparisons

Probe sites that work reliably with mochi (informational):
  https://abrahamjuliot.github.io/creepjs/    (lies count, trust score, bot section)
  https://fingerprint.com/demo/                (visitorId, confidence)
  https://browserleaks.com/javascript          (WebGL, Canvas, Audio, fonts, timezone)
  https://bot.sannysoft.com/                   (webdriver, headless, plugins, languages)

Cross-references on mochijs.com:
  - https://mochijs.com/docs/guides/conformance-suite
  - https://mochijs.com/docs/guides/capture-a-profile
  - https://mochijs.com/docs/concepts/probe-manifest
  - https://mochijs.com/docs/concepts/inject-pipeline
  - https://mochijs.com/docs/concepts/stealth-philosophy
  - https://mochijs.com/docs/api/core
  - https://mochijs.com/docs/reference/limits
llm-context:end -->
