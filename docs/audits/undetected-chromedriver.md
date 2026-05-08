# Audit: undetected-chromedriver

**Date:** 2026-05-08
**Lib version audited:** 3.5.5 (`undetected-chromedriver` HEAD `757ed6a`, last ucd-relevant commit `c50b6a2` "Refactor: Update for Python 3.13+ compatibility"; the project announced "no longer supported" via issue #2287)
**Auditor:** mochi audit agent (task 0203)

## Summary

undetected-chromedriver (udc) is a Python wrapper around Selenium 4 that drives **chromedriver** (W3C WebDriver), not raw CDP. Its headline trick is a binary patch of the chromedriver executable to remove the `cdc_$wdc_$cdc_*` JS sentinels Selenium injects into every page (`patcher.py:366-394`). A second cluster of work lives in `__init__.py` ChromeOptions setup: a small fixed flag set, a `Default/Preferences` mutation to suppress the tab-restore nag, a language detection step, and (only when `headless=True`) a runtime CDP injection that strips "Headless" from the UA and shims `window.chrome` / `navigator.permissions`. Almost everything else is Selenium plumbing. Mochi runs stock Chromium-for-Testing over the CDP pipe (PLAN.md §8.1), so the WebDriver-tier patches have **no equivalent surface in mochi** — there's no chromedriver binary, no `cdc_*` injection, no W3C session. The audit therefore inverts the usual ratio: most udc work is "out of scope (intentional difference)"; a small but real residue of fingerprint-level tricks does cross the boundary.

## They have / we don't

- [MED] **`Default/Preferences.exit_type` rewrite**: `__init__.py:424-440` opens the freshly-spawned profile's `Default/Preferences` JSON, sets `profile.exit_type = None`, rewrites the file. Suppresses Chrome's "Restore previous session?" infobar that appears on the *second* launch of a re-used profile and which would otherwise momentarily obscure the page (and look bot-like to a human-vision check). mochi always uses an ephemeral `mkdtemp("mochi-")` user-data-dir (`packages/core/src/proc.ts:88`), so the nag can only fire if a user opts into a persistent profile — we have no profile-warming pass at all yet.
- [MED] **`--lang=<locale>` flag set from host locale**: `__init__.py:359-369` reads `locale.getdefaultlocale()`, falls back to `en-US`, and passes `--lang=<value>`. mochi's `DEFAULT_CHROMIUM_FLAGS` (`packages/core/src/proc.ts:20-34`) does **not** set `--lang`; locale spoofing is done at the JS layer via `navigator.language(s)` (`packages/inject/src/modules/navigator.ts`). The Accept-Language header sent by Chrome's network stack is therefore *not* aligned with the matrix's locale unless the user passes a custom flag, which is a relational-consistency leak (PLAN.md I-5: native `Accept-Language` says one thing, JS `navigator.language` says another).
- [MED] **`--window-size=1920,1080` + `--start-maximized`**: `__init__.py:410-411`. udc forces a deterministic window geometry on every spawn. mochi sets neither flag; on `--headless=new` the window defaults to 800x600 (issue #2242 in udc/nodriver flagged exactly this — `fingerprint-scan.com` reports the 800x600 outer dimensions even when `screen.width/height` are spoofed). Mochi's `screen.ts` inject module spoofs `screen.width/height/availWidth/availHeight` from the matrix, but the *outer* `window.outerWidth/outerHeight` returned by Chromium for a CDP-pipe headless target reflect the real OS-level window, which is the 800x600 default. Need a `--window-size` flag derived from `matrix.display.width/height`.
- [LOW] **`--no-default-browser-check` + `--no-first-run` already in mochi defaults**; udc adds these explicitly under a `suppress_welcome` toggle (`__init__.py:393-394`). Cross-checked: identical in `proc.ts:23-24`. No action.
- [LOW] **Headless UA scrub**: `__init__.py:519-527` does a runtime `Network.setUserAgentOverride` to strip the literal substring `"Headless"` from `navigator.userAgent`. mochi's UA comes from `matrix.userAgent` and is by construction a non-headless UA (PLAN.md §6.1; `packages/inject/src/modules/navigator.ts:40`), so the substring should never appear. **N/A** — flagged here for completeness because `--headless=new` *does* still set the underlying browser UA to a Headless variant; mochi overrides it at the JS layer, but if any future code path reads UA before `Page.addScriptToEvaluateOnNewDocument` fires (e.g. early `Network` events), the literal still leaks. Worth a unit test.
- [LOW] **`--password-store=basic` + `--use-mock-keychain`**: present in both. `proc.ts:25-26`. No action.

## We have / they don't (sanity check)

- mochi has a **deterministic, profile-locked fingerprint matrix** with 30+ relational rules (`packages/consistency/src/rules/*`); udc has zero — anything beyond the sentinel-key delete and the four `--headless` JS shims is left to the user.
- mochi has **`--remote-debugging-pipe`** (no localhost listener); udc uses `--remote-debugging-port=<random>` (`__init__.py:292-293`), which is detectable by `chrome://inspect` side channels (PLAN.md §8.1).
- mochi suppresses **`Runtime.enable`, `Page.createIsolatedWorld`, `Runtime.evaluate{includeCommandLineAPI:true}`** (PLAN.md §8.2 hard list); udc's whole architecture *requires* `Runtime.enable` because chromedriver issues it on every session.
- mochi **never names the injected world** (`worldName: ""`, PLAN.md §8.4); chromedriver creates a named isolated world for `executeScript` per W3C spec.
- mochi spoofs WebGL, audio, canvas, fonts, client-hints, network-info, screen, timing, media-devices, plugins, permissions, webgpu (`packages/inject/src/modules/*`); udc spoofs `window.chrome`, `navigator.permissions.query`, `Function.prototype.toString`, `maxTouchPoints`, `connection.rtt` — and only when `headless=True` (`__init__.py:491-631`).

## Bench scoring (if their docs / issues report against any)

- bot.incolumitas.com: not measured by udc maintainers; community reports (issue search "incolumitas") return empty. udc's design predates bot.incolumitas's anti-debugger trap.
- creepjs: not measured.
- fingerprint.com /web-scraping: not measured by maintainers; sporadic community reports of partial bypass with manual extra options.
- browserleaks.com: not measured.
- fingerprint-scan.com: issue #2242 (open) confirms udc/nodriver leak the 800x600 outer-window geometry under `--headless=new` despite a `--window-size` override.

## Recommended adoption

1. **Add `--lang=<matrix.locale>` to `DEFAULT_CHROMIUM_FLAGS` (or a per-launch derived flag)** — one line in `proc.ts`, removes a relational-consistency leak between Chrome's `Accept-Language` header and JS `navigator.language(s)`. Map to a new consistency rule (`R-XXX [matrix.locale] → cli-flag.lang`). Cite: udc `__init__.py:359-369`.
2. **Add `--window-size=<matrix.display.width>,<matrix.display.height>`** when matrix has display rule resolved — closes the 800x600 leak in `--headless=new`. Cite: udc `__init__.py:410` and udc issue #2242.
3. **Profile-warming hook for `Default/Preferences.exit_type`** — only relevant once mochi supports persistent profiles (post v0.1.0). Cite: udc `__init__.py:424-440`.
4. **Contract test that `navigator.userAgent` never contains `"Headless"` in `--headless=new`** — defensive; covers the edge case where early-network UA reads bypass our `addScriptToEvaluateOnNewDocument` patch. Cite: udc `__init__.py:519-527`.

(Stop at 4 — the residue past these is genuinely WebDriver-specific.)

## Out of scope (intentional difference)

This is the long section, as predicted. udc is structurally a chromedriver wrapper; mochi is a CDP-pipe engine. The following do not apply:

- **`patcher.py:354-394` — chromedriver binary patch**: replaces the `{window.cdc_*; …}` injection block in the chromedriver ELF/PE with a no-op `console.log("undetected chromedriver 1337!")`. Mochi has no chromedriver binary; the `cdc_*` symbols never exist in our process tree. We *do* defensively `delete window.cdc_adoQpoasnfa76pfcZLmcfl_*` and 23 other Selenium/Phantom/Nightmare globals (`packages/inject/src/modules/bot-globals.ts:24-54`) in case a hostile extension or a misconfigured user injects them. That's the appropriate equivalent.
- **`patcher.py:233-264` — chromedriver version detection / download / unzip**: udc must fetch a chromedriver matching the host Chrome major version (`fetch_release_number`, `parse_exe_version`). mochi resolves a stock Chromium binary via `@mochi.js/cli`'s `resolveChromiumBinary` (`packages/core/src/binary.ts:51-60`) — no driver, no version-matching dance. `version_main` in udc is *driver-version coupling*, not the profile-version-detection pattern we'd care about for matrix selection.
- **`__init__.py:64-486` — Selenium `WebDriver` subclass**: `Chrome(WebDriver)` overrides `start_session`, `quit`, `__getattribute__`, `reconnect`, `tab_new`, `find_elements_recursive`. All of this is W3C `/session/...` HTTP plumbing. Mochi's `Session` (PLAN.md §7) talks JSON-RPC over the pipe.
- **`__init__.py:287-290, 474-481, reactor.py` — `enable_cdp_events` + Reactor**: re-exposes chromedriver's `goog:loggingPrefs` channel. Mochi has direct CDP event subscription (PLAN.md §8.3 — `Page.frameAttached`, `Page.frameNavigated`, `Target.setAutoAttach`) without the Selenium round-trip.
- **`cdp.py:14-113` — DevTools HTTP-+-WS shim**: hits `http://127.0.0.1:<port>/json/list`, opens a WebSocket per command. Mochi explicitly forbids the TCP DevTools listener (PLAN.md §8.1: "No TCP fallback in v1. Remote-debugging-over-TCP creates a localhost listener that's discoverable by side-channel attacks").
- **`__init__.py:395-396, 412 — `--no-sandbox`** **and `--test-type`**: udc *defaults* to `--no-sandbox` because it's commonly run as root. PLAN.md §8.6 explicitly rejects this: `--no-sandbox` is a fingerprint leak (`navigator.webdriver` is the obvious one but the flag also flips internal `chrome://flags` state visible to e.g. `chrome.runtime`). `--test-type` similarly removes the "you are using an unsupported command-line flag" infobar but flips a sentinel that anti-bots check. Both are deliberate omissions in mochi.
- **`__init__.py:491-631` — headless-mode JS shims**: only fire under `headless=True`. They `Object.defineProperty(window, "navigator", {value: new Proxy(...)})`, shim `window.chrome` (the `app`/`runtime` enums), shim `navigator.permissions.query`, monkey-patch `Function.prototype.toString`. Mochi covers all four:
  - `window.chrome` shim — `packages/inject/src/modules/window-chrome.ts`
  - `navigator.permissions.query` — `packages/inject/src/modules/permissions.ts`
  - `Function.prototype.toString` "native code" preservation — handled per-property inside each spoof module.
  - `maxTouchPoints`, `connection.rtt` — `navigator.ts`, `network-info.ts`.
  Adopting udc's specific implementation would be a regression (their `Object.defineProperty(window, "navigator", {value: new Proxy(...)})` is itself detectable: real Chrome's `Object.getOwnPropertyDescriptor(window, "navigator")` returns a *getter*, not a `value` slot).
- **`reactor.py`, `webelement.py`, `dprocess.py`** — Selenium element wrappers and a Windows `DETACHED_PROCESS` spawn helper. No mochi equivalent needed.
- **`patcher.py:317-351` — `force_kill_instances` (pidof / taskkill)**: forces shutdown of running chromedriver processes that hold a lock on the binary about to be patched. N/A — we don't patch binaries.

## Notable: convenience features

- **`reconnect()`** — stop/start chromedriver service mid-session, useful if a "heavy detection method" stalls the page (`__init__.py:705-719`). Mochi's analogue would be a per-`Session.recreate()` flow; not currently exposed. Low value (the underlying issue — chromedriver's session lifecycle being detectable — doesn't apply to us) but the *pattern* of "atomic session reset for stuck pages" could be a `@mochi.js/challenges` primitive.
- **`tab_new(url)`** comment at `__init__.py:686-703`: "this opens a url in a new tab. apparently, that passes all tests directly!" — folk wisdom that opening the target page in a *fresh* tab (not the initial blank tab) defeats some anti-bots. No mochi feature; trivially expressed by the caller via `Page.create({ url })`. Document if useful.
- **Suppression of the welcome/first-run nag screens** (`suppress_welcome=True` default at `__init__.py:393-394`): `--no-default-browser-check`, `--no-first-run`. Already in mochi defaults.
