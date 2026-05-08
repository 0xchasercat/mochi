# Audit: nodriver

**Date:** 2026-05-08
**Lib version audited:** github.com/ultrafunkamsterdam/nodriver @ `65562fa` (2025-11-09)
**Auditor:** mochi audit agent (task 0202)

## Summary

nodriver is the official Python successor to `undetected-chromedriver`. It drops Selenium/WebDriver entirely and talks CDP over a **WebSocket** (not pipe) by spawning stock Chrome with `--remote-debugging-port` and connecting via the `websockets` library. It is async (`asyncio`), AGPL-licensed, and ships a single `Browser`/`Tab`/`Element` object hierarchy. **There is essentially no JS injection layer**: the project's stealth thesis is "don't use WebDriver, don't ship CDC keys, and the stock browser will do" — i.e. its undetectability claim derives from removing Selenium taint, not from actively spoofing fingerprint surfaces. The only injection in the entire library is an `attachShadow` open-mode hack gated behind an `expert=True` flag which the code itself warns is *more* detectable (`nodriver/core/tab.py:224-241`). There is no consistency engine, no Matrix concept, no profile presets, no behavioral synthesizer, and no CDP-method allow-list. mochi's stealth posture is structurally several layers deeper.

## They have / we don't

Ranked HIGH / MED / LOW impact.

- [LOW] **Headless UA scrub.** `tab.py:203-222` — on first navigation the `_prepare_headless` hook reads `navigator.userAgent`, strips `"Headless"`, and re-applies via `Network.setUserAgentOverride`. mochi never runs headless-new in v0.1 baselines, but if we later add a headless preset the same scrub is missing. Trivially additive to `packages/inject/src/modules/navigator.ts`. Severity LOW because mochi defaults to headed Chromium-for-Testing.
- [LOW] **Cookie pickle save/load with regex pattern filter.** `browser.py:791-878` — `Browser.cookies.save(file, pattern=".*")` / `.load(...)` writes a pickle of the `Storage.getCookies` output and restores it on a later run. mochi has `Session.cookies` getter but no first-class persisted-jar abstraction; would map cleanly to a future `@mochi.js/profiles` sidecar or a `Session.cookies.export()/import()` helper. Severity LOW (convenience, not stealth).
- [LOW] **localStorage seeding.** `tab.py:1493-1544` — `tab.get_local_storage()` / `tab.set_local_storage(dict)` use `DOMStorage.getDOMStorageItems` and `DOMStorage.setDOMStorageItem`. mochi's `Page` API does not expose Storage-domain helpers in v0.1; sites that gate on a "returning visitor" localStorage flag have to be hand-driven via `page.evaluate`. Convenience-only.
- [LOW] **`Browser.grant_all_permissions()`.** `browser.py:473-506` — broadcasts every `Browser.permissionDescriptor` value via `Browser.grantPermissions`. mochi exposes per-permission spoofing via `inject/permissions.ts` (R-036) at the JS layer; nodriver does it at the CDP layer which is orthogonal. Useful for "no permission prompts ever" workflows. LOW.
- [LOW] **Cloudflare checkbox click via OpenCV template match.** `tab.py:1629-1757` — `verify_cf()` screenshots the viewport, runs `cv2.matchTemplate` against a bundled `cf_template.png`, and clicks the centroid. Fragile (English-only template, breaks under any UI tweak), and the README itself notes detection issues (issue #31). Already in mochi's roadmap as task `0220-turnstile-auto-click`; nodriver's implementation is a useful negative reference point — we should *not* copy the OpenCV approach, since template-matching breaks on any visual A/B and the click trajectory it generates is straight-line. **Adopt the goal, not the method.**
- [LOW] **`bypass_insecure_connection_warning()`.** `tab.py:1759-1767` — types `"thisisunsafe"` into the body to dismiss Chrome's cert warning. Pure convenience; mochi can replicate in user-space.

## We have / they don't (sanity check)

This is where the audit's real signal lives. nodriver simply does not ship the surfaces below; mochi does.

- **`Runtime.enable` avoidance.** mochi's CDP wrapper has a hard runtime assertion that refuses `Runtime.enable` (PLAN.md §8.2). nodriver does the opposite — `connection.py:368-419` lazily calls `domain_mod.enable()` for every domain a handler is registered against, including `cdp.runtime`. Any consumer that registers a `Runtime.consoleAPICalled` handler causes nodriver to send `Runtime.enable` on the root target. This is the *exact* leak the project's marketing claims to avoid; the documentation conflates "no chromedriver" with "no Runtime.enable" but the code does not.
- **`Page.addScriptToEvaluateOnNewDocument` with `runImmediately:true` + main-world (empty `worldName`).** mochi (PLAN.md §8.4) does both. nodriver only calls `add_script_to_evaluate_on_new_document` once, in `_prepare_expert` (`tab.py:230`), without `run_immediately` or any `world_name` argument — i.e. default behavior, which fires after page-script start and is detectable.
- **Relational consistency engine.** mochi ships ~40 rules (`packages/consistency/src/rules/*` — R-001…R-040) deriving the entire navigator/screen/UA-CH/WebGL/WebGPU/audio surface from a single `(profile, seed)` pair. nodriver has zero rules. `Config(lang="en-US")` is the closest thing to a fingerprint preset, and it only sets a single browser flag.
- **Navigator surface spoofing (R-008…R-040 range).** mochi spoofs `deviceMemory` (R-008), `hardwareConcurrency` (R-009), `languages` (R-016), `platform` (R-017), `webdriver` (R-018), `vendor`/`appVersion`/`product`/`cookieEnabled`/`maxTouchPoints` (R-026…R-030), media-devices shape (R-034), permissions defaults (R-036), Network Information API (R-037), screen orientation (R-038), media-queries (R-039), storage estimate (R-040). nodriver does **none** of these. A bare nodriver session reports raw Chrome-for-Testing values, which trivially mismatches any "real-device" baseline a probe expects.
- **UA-CH / `sec-ch-ua` family.** mochi consistency rules R-005…R-007, R-031 derive the full `sec-ch-ua`, `sec-ch-ua-platform`, `sec-ch-ua-platform-version`, and full-version-list. nodriver has nothing for client hints.
- **WebGL / WebGPU vendor+renderer rewrite.** mochi R-001…R-003, R-024, R-025, R-032, R-033 + `inject/webgl.ts`, `inject/webgpu.ts`. nodriver: nothing.
- **Canvas / audio fingerprint.** mochi ships precomputed hash blobs per profile; nodriver passthrough.
- **Bot-globals scrub.** mochi `inject/bot-globals.ts` deletes the CDC sentinel keys (`cdc_adoQpoasnfa76pfcZLmcfl_*` etc.) defensively. nodriver doesn't need to delete them because it never starts chromedriver — but the scrub is still a defense in depth (a hostile extension can inject them) that nodriver lacks.
- **Behavioral synthesis.** mochi `@mochi.js/behavioral` does cubic Bezier + Fitts's Law (`MT = a + b·log2(D/W+1)`) + lognormal keystroke timing + overshoot/correction (PLAN.md §11). nodriver's `tab.mouse_move` (`tab.py:1769-1792`) is a literal linear interpolation between (0,0) and (x,y) with `steps=10` — the comment in the source even says *"probably the worst waay of calculating this"*. Keystrokes (`element.py:708-722`) are a tight loop of `Input.dispatchKeyEvent("char")` with no delay between keys. Mouse `mouse_drag` (same file:1854-1920) is also linear-interp.
- **Pipe transport + isolated-process-per-session.** mochi uses `--remote-debugging-pipe` (PLAN.md §8.1) which isn't reachable via `chrome://inspect` or `127.0.0.1` port scans. nodriver uses TCP on a random port (`browser.py:586`, `config.py:198`) with `--remote-allow-origins=*` — itself a side-channel/CSRF surface.
- **`--no-sandbox` discipline.** PLAN.md §8.6 calls out `--no-sandbox` as a leak. nodriver auto-disables sandbox when running as root (`config.py:106-108`) and exposes `sandbox=False` as a public knob. Its default is `sandbox=True`, but the codepath is willing.
- **Network FFI / wire-fingerprint impersonation.** mochi has `@mochi.js/net-rs` wrapping `wreq` with profile-keyed presets. nodriver has none — `urllib.request` is the only HTTP client (`browser.py:912-935`).
- **`docs/limits.md` honesty doc.** mochi tracks every known gap. nodriver does not.

## Bench scoring

- bot.incolumitas.com — not measured publicly by the project; issue #31 reports detection on `mouse_click`.
- creepjs.dev — not measured.
- fingerprint.com /web-scraping — not measured.
- browserleaks.com — README claims it works against "most anti-bot solutions" but provides no scores. The closed issue #5 reports headless mode trivially detected via the `HeadlessChrome` UA token until manually scrubbed.

## Recommended adoption

Up to 5 candidates, ranked impact-to-effort.

1. **Headless UA scrub helper** — port `_prepare_headless` (`tab.py:203-222`) into a future mochi headless preset. Trivial; one consistency rule + an inject hook. (LOW priority — gated on whether v0.2 ships a headless profile at all.)
2. **`Session.cookies.save(path)` / `.load(path)` convenience** — file-backed jar persistence keyed off `Storage.getCookies` / `Storage.setCookies`. Drop the pickle (use JSON), keep the regex filter idea. Maps to a small additive surface on `@mochi.js/core`.
3. **`Page.localStorage.get()` / `.set(dict)`** — thin wrappers around `DOMStorage.getDOMStorageItems` / `setDOMStorageItem`. Useful for "returning visitor" warming.
4. **`Page.grantAllPermissions()`** — wraps `Browser.grantPermissions` with the full descriptor list. Pairs naturally with our R-036 permissions rule.
5. **Negative reference: do not adopt OpenCV-template Cloudflare clicker.** Task `0220-turnstile-auto-click` should keep its existing approach (DOM/iframe heuristics + behavioral path); call out nodriver's `verify_cf` in the brief as the failure mode to avoid.

## Out of scope (requires C++ patches per I-1)

- None. nodriver is pure Python + CDP and has no Chromium-binary patches; nothing in this audit requires C++ work.

## Notable: convenience features

- `tab.find(text, best_match=True)` — text search with shortest-match heuristic (`tab.py:243-298`). Already present implicitly in mochi via selector engine + `waitFor`, but the "shortest match wins" idea is a nice DX touch for `page.findByText`.
- `tab.xpath(selector, timeout=2.5)` — XPath query. Convenience, not stealth.
- `tab.add_handler(SomeEvent, callback)` — generic CDP event subscription. mochi has `page.on(...)` per the public API surface in PLAN.md §5.1; sanity-check parity in v0.2.
- `Browser.start(expert=True)` — disables site-isolation-trials and forces shadow-roots open. **Anti-pattern**: the lib's own warning says it makes you more detectable. Worth a one-liner in `docs/limits.md` as a "don't do this" reference.
- `create_from_undetected_chromedriver(driver)` — migration helper from the older lib. Not relevant to mochi.

---

**Bottom line.** nodriver's contribution to the stealth-tooling space is *removing* Selenium/chromedriver, not *adding* fingerprint depth. mochi v0.1.0 is structurally ahead on every axis except a few small DX conveniences (cookie persistence, localStorage seeding, headless-UA scrub) which are easy ports. The gap nodriver would close on us is essentially zero on detection, marginal on DX. Per I-8: nodriver does *not* do anything better than mochi at the stealth layer; calling that out plainly is the honest read.
