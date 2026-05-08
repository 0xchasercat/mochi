# Audit: puppeteer-real-browser

**Date:** 2026-05-08
**Lib version audited:** v1.4.4 @ `510939f` (`https://github.com/zfcsoftware/puppeteer-real-browser`)
**Auditor:** mochi audit agent (task 0200)

## Summary

`puppeteer-real-browser` is a thin (~250 LoC across `lib/cjs/index.js`, `lib/cjs/module/pageController.js`, `lib/cjs/module/turnstile.js`) Node.js wrapper that launches stock Chrome via `chrome-launcher` and connects with `rebrowser-puppeteer-core` (a `puppeteer-core` fork with stealth patches at the framework layer). Stealth posture is inherited from three external pieces: (1) `rebrowser-patches` (suppresses `Runtime.enable`, renames utility world `__puppeteer_utility_world__` → `util`, rewrites `pptr:` sourceURLs); (2) `--disable-features=...,AutomationControlled` merged into `chrome-launcher`'s defaults (`lib/cjs/index.js:55`); (3) Linux Xvfb for headed-on-server (`lib/cjs/index.js:28-32`). The lib itself adds one inject-time patch (`MouseEvent.screenX/Y`, `pageController.js:48-58`), wires `ghost-cursor`, and runs a polling Turnstile clicker. Repo is **archived** as of v1.4.4 (`README.md:1-2`); reportedly broken by the Aug-2025 Cloudflare update (`#303`). Node-only, Puppeteer-only, real-Chrome-binary — none of which mochi targets (I-3 Bun-only, I-4 Chromium-for-Testing, CDP-pipe direct, no Puppeteer dep).

## They have / we don't

- [HIGH] **`MouseEvent.screenX`/`screenY` patch** — `lib/cjs/module/pageController.js:48-58`. `evaluateOnNewDocument` redefines `MouseEvent.prototype.screenX/screenY` getters as `clientX + window.screenX` / `clientY + window.screenY`. Origin: `TheFalloutOf76/CDP-bug-MouseEvent-.screenX-.screenY-patcher`. Real cause: when CDP `Input.dispatchMouseEvent` synthesises events the `screenX/screenY` slots are wrong (often 0 or outside the visible region), and any site reading `event.screenX` for clickjacking/bot heuristics sees an obvious tell. mochi has no equivalent — `packages/inject/src/modules/` has no `MouseEvent` patch, and `packages/behavioral/src/mouse.ts` synthesises trajectories but does not fix the dispatched event's `screenX`. This is a real, mochi-applicable JS-layer defense that costs ~10 LoC and complements I-5 (relational consistency: spoofed `window.screenX` must agree with reported `event.screenX`).

- [HIGH] **Suppression of `Runtime.enable`** — `rebrowser-patches` (transitive via `rebrowser-puppeteer-core@^23.3.1`, `package.json:32`). Patches Puppeteer's framework code so that page-target sessions never issue `Runtime.enable`; instead it uses `Runtime.addBinding` (default), `Page.createIsolatedWorld`, or an `enable→disable` toggle to discover execution-context IDs. mochi already plans this as the primary CDP invariant — `PLAN.md:489` lists `Runtime.enable` first in the §8.2 hard-deny list and §8.3 documents the `DOM.resolveNode → callFunctionOn` workaround. Verify in code: `packages/core/src/cdp/` (no grep hit on `Runtime.enable` other than in negative tests). **mochi already satisfies this**, so this is sanity-check parity, not a gap. Listed here only because PRB inherits it for free from rebrowser; without rebrowser it would be a regression. Severity HIGH means *any future regression* is HIGH; current state is parity.

- [MED] **Utility-world name + sourceURL rewrite** — rebrowser-patches (transitive). Renames `__puppeteer_utility_world__<version>` → `util` and rewrites `//# sourceURL=pptr:...` → `app.js`. Detectable via `error.stack` grep. mochi avoids the underlying problem entirely by not using Puppeteer (`PLAN.md:88` decision #6: "fresh public API"), and by injecting via `Page.addScriptToEvaluateOnNewDocument` with `worldName: ""` (main world, `PLAN.md:502-503`). **No work needed**, but worth a contract test that mochi's payload bundles never emit `//# sourceURL=` strings or any literal containing `puppeteer`/`pptr`/`__playwright`. Today the inject bundler emits no sourceURL but there's no test forbidding it.

- [MED] **AutomationControlled disable-feature** — `lib/cjs/index.js:54-55` mutates `chrome-launcher`'s default `--disable-features=` list to append `AutomationControlled`. This is the C++-side analogue of patching `navigator.webdriver` — when the feature is off, `navigator.webdriver` is `false` natively and the `Sec-CH-UA` reduced-set behaviour doesn't kick in. mochi takes the opposite approach (`PLAN.md:531`: "We do **not** pass `--disable-blink-features=AutomationControlled`; we patch `navigator.webdriver` from JS instead"). The trade-off: the flag is itself a tell when `chrome://version` is queryable from a sibling tab, but on most surfaces it produces a more consistent native picture. **Not a gap to close** — it's a deliberate divergence per PLAN §8.6. Worth re-litigating only if the harness shows R-022 (navigator.webdriver) under-spoofs vs a flag-disabled real Chrome. Track as an open question.

- [LOW] **`disable-component-update` removal** — `lib/cjs/index.js:57-58`. PRB removes the flag from `chrome-launcher`'s defaults so updater traffic looks normal. mochi *adds* it (`packages/core/src/proc.ts:28`) for hermetic harness runs. Real divergence: PRB optimises for production stealth, mochi for reproducibility. Candidate: a `LaunchOptions.hermetic` knob, default `true` for harness, `false` for user `mochi.launch`.

- [LOW] **Xvfb auto-start on Linux** — `lib/cjs/index.js:26-39`. Spawns `Xvfb -screen 0 1920x1080x24 -ac` so headed Chrome runs unattended on a server, avoiding `--headless=new`'s codepath differences (extension API stubs, GPU compositor mode) some detectors catch. mochi defaults to `--headless=new` (`packages/core/src/proc.ts`). Out of mochi core scope (system-level `xvfb` dep), but a `docs/recipes/xvfb-linux.md` paragraph closes the gap.

- [LOW] **Turnstile click-by-coordinates** — `lib/cjs/module/turnstile.js:8-42`. Polls every 1s, finds `[name="cf-turnstile-response"]` or any childless `<div>` between 290-310 px wide, and clicks the centre-left (`x + 30, y + h/2`). Convenience, not stealth — see "Notable: convenience features".

## We have / they don't (sanity check)

mochi covers a substantially larger surface area than puppeteer-real-browser does at the JS-injection layer. Cross-checked against `packages/inject/src/modules/` and `packages/consistency/src/rules/`:

- **Relational consistency engine** — 40 rules R-001..R-040 (`packages/consistency/src/rules/index.ts:43-51`), DAG-validated, seed-deterministic. PRB has no consistency layer; it relies on whatever real Chrome happens to report. mochi's `webgl.unmasked*` (R-001/R-002), `audio.sampleRate` (R-004), `userAgent` build variance (R-006), `Sec-CH-UA` (R-007), `deviceMemory` (R-009), `hardwareConcurrency` (R-008), `fonts.list` (R-010), `screen.*` (R-010..R-012), timezone/locale (R-013/R-014/R-019), `permissions.query` (R-035), `mediaDevices` (R-034), `screen.orientation` (R-037), `matchMedia` (R-038) are matrix-derived. PRB has none of these — its `navigator.webdriver` is whatever Chrome reports with AutomationControlled disabled.
- **Bot-globals scrub** — `packages/inject/src/modules/bot-globals.ts:24-54` deletes 25 sentinel keys (CDC `cdc_adoQpoasnfa76pfcZLmcfl_*`, `_phantom`, `__nightmare`, `domAutomation*`, `__webdriver_*`, etc.). PRB has nothing equivalent — it assumes a clean Chrome binary will be clean.
- **WebGPU spoof** — `packages/inject/src/modules/webgpu.ts` (166 LoC) + `R-032`/`R-033` (`packages/consistency/src/rules/webgpu.ts:23,41`). PRB does not touch WebGPU.
- **`window.chrome` shape shim** — `packages/inject/src/modules/window-chrome.ts:1-153` defensively installs `chrome.app/csi/loadTimes` and intentionally leaves `chrome.runtime` undefined for non-extension contexts. PRB does not.
- **`Plugins`/`MimeTypes` array spoofing** — `packages/inject/src/modules/plugins.ts` (242 LoC). PRB has no plugin spoofing.
- **CDP transport hardening** — pipe-mode (`PLAN.md:480-484`), no TCP debug port, no `Page.createIsolatedWorld`, no `Runtime.enable`, no `includeCommandLineAPI: true`. PRB uses `puppeteer.connect({ browserURL: 'http://127.0.0.1:${chrome.port}' })` (`lib/cjs/index.js:86-89`) — i.e. opens a localhost TCP debug port that is discoverable by sibling-tab `chrome://inspect` and by port scans. This is a documented mochi advantage.
- **Behavioral engine** — `packages/behavioral/src/{bezier,fitts,gauss,mouse,scroll,keys,qwerty,prng}.ts`. PRB delegates to `ghost-cursor` for mouse only; no scroll/keystroke models.

## Bench scoring

PRB's `test/cjs/test.js` runs four assertions and asserts pass/fail without recording numeric scores:

- bot.incolumitas.com: not measured by PRB.
- creepjs (abrahamjuliot.github.io/creepjs): not measured by PRB.
- fingerprint.com /web-scraping: not measured by PRB.
- browserleaks.com: not measured by PRB.

PRB's only quantitative claims (`README.md:189-192`) are the four pass/fail checks: DrissionPage detector, Brotector (kaliiiiiiiiii.github.io/brotector), Cloudflare WAF (nopecha.com/demo/cloudflare), Cloudflare Turnstile (turnstile.zeroclover.io). Issue `#303` (closed Aug 2025) reports the WAF check broke after a Cloudflare update; `#314` (open Jan 2026) reports the Turnstile clicker enters an infinite loop in Docker even with a residential proxy. There is no published comparison against the four reference test sites.

## Recommended adoption

1. **Port the `MouseEvent.screenX`/`screenY` patch** as a new inject module `packages/inject/src/modules/mouse-event-screen.ts`. ~15 LoC; reads `matrix.screen.{availLeft,availTop}` (or just `window.screenX/screenY`); installs prototype getters. New rule R-041 (or fold into R-029 screen relations) for relational locking. Maps to a Phase B task brief: `0210-inject-mouseevent-screen.md`.
2. **Add a contract test forbidding `pptr`/`puppeteer`/`playwright` substrings in the inject bundle output**. `tests/contract/inject-no-framework-leak.contract.test.ts`. Closes the rebrowser-class leak preventatively even though mochi never imported Puppeteer. ~20 LoC.
3. **Document an Xvfb headed-on-Linux recipe** in `docs/recipes/xvfb-linux.md` and surface it from `mochi.launch({ headless: false })` error messages on Linux. Convenience parity with PRB; no core code changes. ~150 words of doc.
4. **Re-evaluate `--disable-component-update` for non-harness launches**. Add `LaunchOptions.hermetic?: boolean` (default `true`); when `false`, drop `--disable-component-update` and `--disable-sync` from `DEFAULT_CHROMIUM_FLAGS` (`packages/core/src/proc.ts:20-34`). One-line task brief; controlled by harness fixture matrix.
5. **Audit gap: WebRTC IP**. PRB doesn't address it either, but a glance at issue `#314` (CF infinite loop on Docker + residential proxy) suggests detectors are now combining IP-class signals with fingerprint signals. Already a known limit (`PLAN.md:584`); re-prioritise for v0.3.

## Out of scope (requires C++ patches per I-1)

- **`AutomationControlled`-feature equivalence** at the binary layer. PRB toggles the disable-feature; mochi's I-4 (stock Chromium-for-Testing) means we use the binary as-shipped. We can patch `navigator.webdriver` from JS (R-022) but cannot suppress every downstream effect of the feature being on (e.g. `Sec-CH-UA` reduced-set behaviour at the network layer). Document as a known asymmetry in `docs/limits.md`.
- **Real `Runtime.enable` suppression at the framework code path**. mochi avoids the call entirely (PLAN §8.2), which is the architectural fix; rebrowser's binding-mode workaround is a Puppeteer-specific kludge we don't need to port.

## Notable: convenience features

- **Turnstile checkbox clicker** — `lib/cjs/module/turnstile.js:1-61`. Polls every 1s; if a `[name="cf-turnstile-response"]` element exists, clicks 30 px right of its parent's left edge at vertical centre. Fallback: scans all `<div>`s with `width ∈ (290, 310]` and no children. Belongs in `@mochi.js/challenges` (task 0220), not core stealth. Be aware the heuristic produces false positives on any 300 px wide leaf div (issue `#314`'s "Cloudflare infinite loop" appears related).
- **`ghost-cursor` integration** — `lib/cjs/module/pageController.js:62-64` exposes `page.realCursor` and `page.realClick`. Bezier + Fitts overshoot. mochi's behavioral package already covers this with a richer model (`packages/behavioral/src/{mouse,bezier,fitts}.ts`). No port needed; cite as feature parity.
- **Proxy auth pre-wired** — `lib/cjs/module/pageController.js:39`. mochi already has `packages/core/src/proxy-auth.ts`.
- **`puppeteer-extra` plugin compatibility** — `lib/cjs/index.js:76-84`. Out of scope for mochi (no Puppeteer dep).
- **`disableXvfb` ergonomic toggle** — minor; map to Phase B recipe (rec #3).
