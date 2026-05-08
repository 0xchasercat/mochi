# Phase B Synthesis: competitor audit → v0.2 task briefs

**Date:** 2026-05-09
**Inputs:** `docs/audits/{patchright,puppeteer-real-browser,nodriver,undetected-chromedriver}.md`
**Auditor / synthesizer:** orchestrator (Phase B of the audit pipeline)

## Executive summary

The four audits validate mochi's structural posture: every peer is *behind* on at least 2 of {relational consistency, behavioral synthesis, JA4 TLS, probe-manifest measurable diff, Bun runtime}. The honest gaps cluster into three buckets:

1. **Real adoption candidates** (this doc, queued as `tasks/0250…0258`). Specific, surgically-portable fixes that close concrete leaks.
2. **Deliberate divergences** (already documented in PLAN §8.6 / `docs/limits.md`). Examples: `--disable-blink-features=AutomationControlled` (we patch `navigator.webdriver` from JS instead), `--no-sandbox` (we refuse it; udc defaults to it), pinned Chromium-for-Testing vs. real-Chrome (PRB).
3. **Out of scope** (requires C++ patches → I-1 forbids). Examples: WebAudio binary-pipeline rewrite, GPU-feature-set forcing, V8 debugger-flag suppression on bot.incolumitas.com.

Bottom-line per I-8: **mochi v0.1 sits structurally ahead of nodriver and udc on every measurable axis**, in **rough parity with patchright on CDP discipline + ahead on fingerprint depth**, and **at parity-or-ahead with PRB** (which is now archived as of v1.4.4). The findings below are incremental tightenings, not catch-up.

## Cross-cutting findings (highest signal)

| # | Finding | Sources | Priority | Brief |
|---|---|---|---|---|
| A | `MouseEvent.screenX/Y` getter patch — CDP-dispatched mouse events have wrong screen coords (relative to viewport, not screen). I-5 relational leak | PRB HIGH | **HIGH** / S | `0250` |
| B | `--lang=<matrix.locale>` Chromium flag missing — `Accept-Language` header doesn't agree with JS `navigator.language(s)` | UDC MED | **HIGH** / XS | `0251` |
| C | `--window-size=<matrix.display.W>,<matrix.display.H>` flag missing — `--headless=new` defaults to 800×600 outer geometry; `fingerprint-scan.com` flags this even when `screen.*` is spoofed | UDC MED + UDC issue #2242 | **HIGH** / XS | `0252` |
| D | Closed-shadow-root piercing locator (`Page.querySelectorPiercing`) — Cloudflare Turnstile iframe lives behind closed shadow root in many integrations; task 0220 silently fails on those | Patchright HIGH | **HIGH** / M | `0253` |
| E | Worker context bootstrap via `Runtime.evaluate("globalThis", { serialization: "idOnly" })` — extract worker contextId pre-`runIfWaitingForDebugger`, use `callFunctionOn` thereafter; tightens worker race window | Patchright HIGH | MED / S | `0254` |
| F | Defensive contract test: `navigator.userAgent` never contains `"Headless"` substring at any phase, including early-network reads before inject fires | UDC LOW + nodriver LOW | MED / XS | `0255` |
| G | Default Chromium flags audit — re-evaluate `--disable-component-update`, `--disable-default-apps`, `--disable-features=…IsolateOrigins,site-per-process` for active tells; patchright trims aggressively, mochi inherits Playwright-style block | Patchright MED + PRB LOW | MED / S | `0256` |
| H | DX convenience: `Session.cookies.{save,load}`, `Page.localStorage.{get,set}`, `Page.grantAllPermissions()` — three additive APIs around existing CDP domains | nodriver LOW × 3 | LOW / M | `0257` |
| I | Init-script delivery via `Fetch.fulfillRequest` body injection + CSP rewriter — bypasses `addScriptToEvaluateOnNewDocument` source-attribution leak. Big architectural pivot (always-on `Fetch.enable`, PLAN §8.4 amendment) | Patchright HIGH | HIGH / L | **deferred to v0.3** |
| J | `exposeBinding` API + per-context `Runtime.addBinding` — when v0.2+ adds a public binding API for Turnstile callbacks etc., follow patchright's `_initBinding` pattern | Patchright MED | MED / M | `0258` (queued, no rush) |

## Deliberate divergences (no work)

- `--disable-blink-features=AutomationControlled` — patchright/PRB enable; mochi refuses (PLAN §8.6). We patch `navigator.webdriver` via R-022. Re-litigate only if harness shows R-022 underspoofs vs. flag-disabled real Chrome.
- `--no-sandbox` — udc defaults; mochi refuses (fingerprint leak). CI uses `MOCHI_EXTRA_ARGS=--no-sandbox` only because GH runners can't run user-namespace sandboxing — explicitly out of `DEFAULT_CHROMIUM_FLAGS`.
- Real-Chrome (PRB) vs. CfT (mochi I-4) — narrow surfaces differ (e.g. AutomationControlled blink feature presence). Documented in `docs/limits.md`.
- `Console.enable` — patchright + mochi both refuse. Cost: no `page.on('console')` API. Aligned by virtue of not having shipped the feature.

## Out of scope (C++ patches — I-1)

- WebAudio binary-pipeline modification (patchright issue #81) — pure-JS unfixable.
- `hasInconsistentGPUFeatures` / Intel Arc / SwiftShader cross-feature consistency (patchright issue #33, marked `wontfix`).
- V8 debugger-flag detection on bot.incolumitas.com / deviceandbrowserinfo.com — already documented in `docs/limits.md`. Same ceiling for every CDP-driven framework.
- Service-worker `hardwareConcurrency` race — `Emulation.setHardwareConcurrencyOverride` doesn't apply to SW; SW reading before our `Runtime.evaluate` lands sees real values.

## Notable convenience features (worth a future skim, not v0.2 critical)

- patchright `assistantMode` — first-party automation that wants to BE detected. `mochi.launch({ assistantMode: true })` skips R-022 + adds `--enable-automation`. ~10 LOC.
- patchright `focusControl` — opt-in `Emulation.setFocusEmulationEnabled` for test determinism. ~5 LOC.
- nodriver `tab.find(text, best_match=true)` — text search with shortest-match heuristic. DX touch for `page.findByText`.
- PRB Xvfb auto-start on Linux — system-level dep, defer to a `docs/recipes/xvfb-linux.md` page.

## Negative references (don't adopt)

- nodriver's `verify_cf` OpenCV template-matching against bundled English-only PNG — fragile, locale-dependent, slow, and the click trajectory it generates is straight-line. Task `0220` (already shipped) explicitly does **not** copy this; uses DOM heuristics + behavioral synth instead. Documented in `packages/challenges/README.md`.
- nodriver's `expert=True` mode (forces shadow-roots open + disables site-isolation) — the lib's own warning says it makes you more detectable. Worth a `docs/limits.md` "do not do this" reference.

## Sequencing

Dispatch order for v0.2 batch (one per `bun work create`):

1. **Wave 1 (parallel, all small):** `0250`, `0251`, `0252`, `0255`. Three flag/inject changes + one contract test. ~30-90min each.
2. **Wave 2 (parallel after wave 1):** `0253` (medium — closed-shadow locator), `0254` (small — worker idOnly bootstrap), `0256` (small — flags audit).
3. **Wave 3 (sequential, optional):** `0257` (DX cluster), `0258` (binding API).
4. **v0.3+:** `0260` (init-script via Fetch.fulfillRequest — architectural pivot).

Each brief is self-contained and references the source-cited audit excerpt for context. The Phase B contract is: agents read the brief → port the specific change → ship a draft PR. No re-research required.
