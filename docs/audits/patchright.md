# Audit: patchright

**Date:** 2026-05-08
**Lib version audited:** patchright (driver) `9d44599`, README current 2026-05-08
**Auditor:** mochi audit agent (task 0201)

## Summary

patchright is a fork-by-AST-rewrite of `playwright-core`: ts-morph patches in
`driver_patches/*Patch.ts` plus a flat `patchright.patch` produce a drop-in
`patchright-{nodejs,python}` package. Like mochi it is Chromium-only and never
patches the binary (`I-1`-compatible). Its core thesis — never send
`Runtime.enable`, avoid named `Page.createIsolatedWorld`, route binding/init
work through `DOM.resolveNode` + `Runtime.callFunctionOn` — is identical to
mochi PLAN.md §8.2/§8.3. The structural twin is real: same forbidden-method
list, same auto-attach + `Runtime.runIfWaitingForDebugger` flow, same toString
cloak philosophy. The functional gap shows up in *delivery, scope, and
defensive depth*: patchright owns Playwright's full surface (routes, locators,
shadow DOM, frames, workers), so leak coverage is broader, but it inherits
Playwright's domain footprint (`Log.enable`, `Page.enable`,
`Network.setRequestInterception` / `Fetch.enable` always-on as the init-script
delivery vector) where mochi keeps the stricter §8.2 perimeter. Patchright
ships zero fingerprint-spoofing layer; mochi's relational matrix is the
opposite axis of the same problem.

## They have / we don't

Ranked HIGH / MED / LOW impact, source-cited.

- [HIGH] **Closed-shadow-root piercing locator** — `framesPatch.ts:868-1012`
  (`_customFindElementsByParsed`). Recursively walks `node.shadowRoots[]` from
  `DOM.describeNode({ depth:-1, pierce:true })`, recognises
  `shadowRootType === "closed"`, then `DOM.resolveNode`s each closed root into
  the utility context. mochi has no shadow-DOM locator path (`page.ts` does
  `DOM.querySelector` against the root document only). Cloudflare Turnstile's
  iframe lives behind a closed shadow root on many integrations — task 0220
  (turnstile-auto-click) blocks at the locator layer without this. Patchright
  README explicitly advertises the feature including XPath in closed shadow.

- [HIGH] **Init-script delivery via `Fetch.fulfillRequest` body injection +
  CSP rewriter** — `crNetworkManagerPatch.ts:166-453` (`RouteImpl._fixCSP`,
  `_injectIntoHead`, `fulfill`). Patchright bypasses
  `Page.addScriptToEvaluateOnNewDocument` for user init scripts entirely:
  intercepts the document response, fixes any CSP `script-src` / `style-src`
  in headers AND `<meta http-equiv>` tags (full HTML-entity decode + nonce
  extraction + re-encode), then injects a `<script class="${initScriptTag}"
  id="${randomHex}">` at end-of-head before the first non-comment `<script>`.
  The script self-removes its DOM node on first execution; patchright then
  walks the DOM after `load` and `DOM.removeNode`s leftover tags
  (`crPagePatch.ts:308-325`). This sidesteps the
  `addScriptToEvaluateOnNewDocument` source-attribution leak (Vanilla CDP
  probe). mochi PLAN.md §8.4 calls `addScriptToEvaluateOnNewDocument`
  the *sole* injection mechanism — same vector patchright explicitly
  abandoned. Their README §"Init Script Shenanigans" admits the new path is
  detectable by timing attacks but no antibot exploits that today; mochi sits
  in the older, also-detectable posture.

- [HIGH] **Worker / ServiceWorker bootstrap via `Runtime.evaluate("globalThis",
  { serialization:"idOnly" })`** — `crServiceWorkerPatch.ts:32-43`,
  `crPagePatch.ts:404-417`. Extracts the worker contextId by parsing
  `objectId.split(".")[1]` of an idOnly-serialised `globalThis`, registers a
  local `CRExecutionContext`, and uses `Runtime.callFunctionOn` against that
  contextId from then on — never `Runtime.enable`. mochi v0.1.0 auto-attaches
  workers (`session.ts:483`) and delivers inject via
  `Runtime.evaluate({ expression: payload.code })` against the paused worker
  session (`session.ts:530`), which works but is coarser. The idOnly trick
  gives a stable contextId for every later `callFunctionOn` against worker
  state.

- [MED] **Per-binding `Runtime.addBinding` with `executionContextId`** —
  `crPagePatch.ts:264-285` (`_initBinding`). Re-issues `addBinding` for every
  newly-observed contextId so bindings reach frames, isolated worlds, and
  workers uniformly. mochi has no `exposeBinding` analogue today — when v0.2
  adds Turnstile clicker / human-binding callbacks, this is the wire pattern.

- [MED] **Always-on `Fetch.enable` with network-id dedupe** —
  `crNetworkManagerPatch.ts:18-20, 82-85, 127`. `_alreadyTrackedNetworkIds:
  Set<string>` prevents double-handling. mochi keeps `Fetch.enable` strictly
  off-by-default per §8.2 (only on for proxy-auth, `proxy-auth.ts`), so we
  don't need the dedupe today — but we do if we adopt body-injection (see
  HIGH #2).

- [MED] **OPTIONS-preflight bypass under always-on interception** —
  `crNetworkManagerPatch.ts:104-110`. Continues immediately when
  `isInterceptedOptionsPreflight` and no user route exists. Pattern relevant
  with body-injection adoption.

- [MED] **Buffered dialog-event replay** — `crPagePatch.ts:117-121, 161-171`.
  Buffers `Page.javascriptDialogOpening` between `_initialize` and
  `_addRendererListeners`, replays on first ready. mochi has no dialog
  surface today (`page.ts` no `dialog` event); this is the race window when
  we add it.

- [MED] **`Emulation.setFocusEmulationEnabled` is opt-out** —
  `crPagePatch.ts:206-218`. Playwright stock unconditionally enables focus
  emulation; patchright lets users opt out via `focusControl: false`. mochi
  v0.1.0 sends nothing of the sort, so we're cleaner — but we lack the
  `focusEmulation: true` *option* for tests that want determinism.

- [MED] **Default-args trim list** — `chromiumSwitchesPatch.ts:20-34`.
  Patchright removes from Playwright defaults: `--enable-automation`,
  `--disable-popup-blocking`, `--disable-component-update`,
  `--disable-default-apps`, `--disable-extensions`,
  `--disable-client-side-phishing-detection`,
  `--disable-component-extensions-with-background-pages`,
  `--allow-pre-commit-input`, `--disable-ipc-flooding-protection`,
  `--metrics-recording-only`, `--unsafely-disable-devtools-self-xss-warnings`,
  `--disable-back-forward-cache`, plus a long
  `--disable-features=ImprovedCookieControls,LazyFrameLoading,GlobalMediaControls,
  DestroyProfileOnBrowserClose,…,PlzDedicatedWorker` block. Adds back
  `--disable-blink-features=AutomationControlled`. mochi PLAN.md §8.6
  currently passes `--disable-component-update`, `--disable-default-apps`,
  `--disable-features=…,Translate,…,IsolateOrigins,site-per-process,…`. The
  divergence is partly intentional (we patch `navigator.webdriver` from JS
  per §8.6 and refuse `--disable-blink-features=AutomationControlled`), but
  `--disable-component-update` and `--disable-default-apps` are passive
  command-line tells worth re-auditing. Issue #167
  (`--disable-blink-features=AutomationControlled don't work on new
  versions`) confirms this single flag matters in 2026 builds.

- [MED] **`--enable-unsafe-swiftshader` removal** — `chromiumPatch.ts:21-27`.
  Strips Playwright's headless SwiftShader fallback that produces a distinct
  GL fingerprint. Issue #33 (`hasInconsistentGPUFeatures`, Intel Arc A380) is
  in this family. mochi PLAN.md §8.6 doesn't list this flag; verify nothing
  downstream pulls it in.

- [MED] **Always-`--headless=new`** — `chromiumPatch.ts:16-19`. Forces new
  headless even when env unset. mochi inherits user choice; verify our
  default flag set lands new headless and never legacy (sannysoft trivially
  detects legacy headless).

- [LOW] **Init-script `(()=>{ … })()` wrapping** — `pagePatch.ts:140-141`.
  mochi already wraps in a single IIFE (`packages/inject/src/build.ts:88`)
  — covered.

- [LOW] **Clock init-script delivery via wrapped IIFE + `evaluateExpression("")`
  warm** — `clockPatch.ts:26-50`. Forward-relevant if we add time-travel.

- [LOW] **Cross-origin iframe contextId via `DOM.getFrameOwner` →
  `DOM.describeNode` → `DOM.resolveNode`** — `framesPatch.ts:155-172,
  187-219`. Resolves iframe `contentDocument.backendNodeId` then parses
  contextId from objectId. mochi has no iframe-context resolution beyond
  what auto-inject provides; cross-origin `evaluate` is a known gap.

- [LOW] **`dispatchEvent` JSHandle scope-aware retry** —
  `framesPatch.ts:97-115`. Retries main-vs-utility on
  `"JSHandles can be evaluated only in the context they were created!"`.
  Moot until mochi gains `evaluateHandle` (`docs/limits.md` v0.1 entry).

## We have / they don't (sanity check)

- mochi has the **deterministic relational fingerprint matrix**
  (`@mochi.js/consistency` + ~40 rules across `packages/consistency/src/rules/
  {gpu,userAgent,navigator,screen,locale,webgpu,extras}.ts`) keyed off
  `(profile, seed)`. Patchright has zero spoofing layer — README and issues
  confirm WebGL renderer/vendor are NOT patched (#170 sannysoft red rows;
  #1, #36, #45, #203, #268, #312 CreepJS detection; #312 canvas pixel
  suspicion).
- mochi has a **mechanical `Runtime.enable` interceptor at the CDP transport**
  (`packages/core/src/cdp/forbidden.ts`). Patchright relies on AST patches to
  scrub call sites; nothing prevents a future Playwright merge from
  re-introducing them.
- mochi has **`@mochi.js/net` + `@mochi.js/net-rs`** (Rust+wreq FFI) for OOB
  HTTP that matches the profile's TLS/H2. Patchright has nothing equivalent.
- mochi has **`@mochi.js/behavioral`** (Bezier/Fitts/Gaussian + keystroke
  digraph). Patchright has nothing — `page.click()` dispatches via stock
  `Input.dispatchMouseEvent` with no humanisation.
- mochi has **per-profile audio + canvas precomputed fixtures** (PLAN.md
  §9.3-9.4, task 0071). Patchright has neither.
- mochi has the **harness gate** (`@mochi.js/harness`, Probe Manifest diff).
  Patchright has Playwright tests against itself.

## Bench scoring (per their docs / issues)

README §Stealth claims green checks across the board (community-reported,
not measured by mochi). Counter-evidence in the issue tracker:
- bot.incolumitas.com: ✅ README. (Mochi treats the anti-debugger trap as
  expected-failure per `docs/limits.md` — patchright trips identically.)
- creepjs: ✅ README, contradicted by issues #1, #36, #45, #170, #203,
  #268, #312 (multiple users report partial CreepJS detection — WebGL,
  canvas, audio); #81 explicitly calls out WebAudio binary-pipeline
  modification.
- bot.sannysoft.com: ✅ README, contradicted by issue #170 (closed
  2026-04) — WebGL Renderer + Vendor red rows. Mochi closes via
  `inject/modules/webgl.ts` + R-001/R-002/R-024/R-025.
- fingerprint.com: ✅ README. (Mochi treats the demo as expected-failure
  per `docs/limits.md` — IP/cohort gating, not pure JS.)
- browserleaks.com: not measured.
- Cloudflare/Datadome/Akamai/Kasada: ✅ README, contradicted by #41
  (addInitScript detected by Cloudflare), #76 (x.com Cloudflare blocks),
  #96 (Kasada `wontfix fp-hard`), #103 (turboscribe headless),
  #108 (Akamai closed `invalid`), #115 (hcaptcha regression).

## Recommended adoption (≤5, impact-to-effort)

1. **Closed-shadow-root locator path** — port `_customFindElementsByParsed`
   (`framesPatch.ts:868-1012`) into a new `Page.querySelectorPiercing` API
   on `packages/core/src/page.ts` using
   `DOM.describeNode({ depth:-1, pierce:true })` + recursive shadow walk +
   per-shadow `DOM.resolveNode`. Required for task 0220. **HIGH / M**.
2. **Init-script delivery via `Fetch.fulfillRequest` body injection (with
   CSP rewrite)** — port `RouteImpl._fixCSP` + `_injectIntoHead` + `fulfill`
   (`crNetworkManagerPatch.ts:166-453`). Closes the
   `addScriptToEvaluateOnNewDocument` source-attribution leak. Big
   architectural pivot — touches `@mochi.js/core` + adds always-on
   `Fetch.enable` with the dedupe set; requires PLAN.md §8.4 amendment.
   **HIGH / L**. New `packages/core/src/cdp/init-injector.ts`.
3. **Worker context bootstrap via idOnly `globalThis`** — port
   `crServiceWorkerPatch.ts:32-43`. After auto-attach, pre-`runIfWaiting`,
   `Runtime.evaluate("globalThis", { serialization:"idOnly" })`, parse
   contextId, use `callFunctionOn` against it. Tightens worker race window
   per `docs/limits.md` "Worker context injection" entry. **MED / S**.
   Map: `packages/core/src/session.ts:516`.
4. **Default-args audit and trim** — re-evaluate every flag in PLAN.md §8.6
   against patchright's removed list. Drop `--disable-component-update`,
   `--disable-default-apps`; verify no stability regression. **MED / S**.
   Map: `packages/core/src/launch.ts` flags array; PLAN.md §8.6 amendment.
5. **Page-binding installation pattern (forward, for `exposeBinding`)** —
   when v0.2 adds the public binding API, follow `_initBinding`
   (`crPagePatch.ts:264-285`): re-issue `Runtime.addBinding` with
   `executionContextId` for every observed contextId, including auto-attached
   workers. **MED / M**. Map: future `packages/core/src/binding.ts`.

## Out of scope (requires C++ patches per I-1)

- **Hardware spoofing in service workers** — issue #168.
  `Emulation.setHardwareConcurrencyOverride` doesn't apply to SW. Mochi v0.7
  inject covers SW navigator from JS, but a SW reading `hardwareConcurrency`
  before our `Runtime.evaluate` lands sees real values — `docs/limits.md`
  §"Worker context injection has a smaller stealth ceiling".
- **`hasInconsistentGPUFeatures` (issue #33)** — Intel Arc / SwiftShader
  cross-feature consistency. Patchright marked `wontfix`.
- **Debugger-flag detection on bot.incolumitas.com / deviceandbrowserinfo.com**
  — already documented in `docs/limits.md`. Same ceiling for patchright.
- **WebAudio binary-pipeline detection (issue #81)** — solved at JS layer
  only by precomputed bytes (mochi task 0071); patchright has no analogue.

## Notable: convenience features

- **`assistantMode` flag** — opt-in retains `--enable-automation` for
  first-party automation contexts that want to BE detected. Map to
  `mochi.launch({ assistantMode: true })`.
- **`focusControl: false` browser-context option** — opt out of
  `Emulation.setFocusEmulationEnabled`. Map to
  `launch({ focusEmulation: false })`.
- **Console API delivery disabled** — patchright README §"Console.enable
  Leak" calls this out: `console.log` from the page does not surface to the
  Node side; the price for never sending `Console.enable`. Mochi v0.1.0 also
  never sends `Console.enable` and has no `page.on('console')` API; aligned
  by virtue of not having shipped the feature. When we do, follow the same
  posture: drop the API or buffer page-side and read on demand via
  `Runtime.callFunctionOn`.
- **`docs/limits.md`-style honesty section** — patchright README's "Init
  Script Shenanigans" admits the timing-attack surface even though no
  antibot exploits it. Mirrors mochi's I-8 posture.
- **No Turnstile clicker, no Cloudflare bypass, no profile warming, no
  cookie persistence** — out of patchright's scope. These live in
  `@mochi.js/challenges` (task 0220).
