---
"@mochi.js/core": minor
"@mochi.js/behavioral": patch
---

Add `mochi.connect()` for attaching to existing CDP browsers + `profile: null` for no-spoof mode.

**`mochi.connect(opts)`** — new top-level entry point that mirrors `puppeteer.connect`'s shape. Attaches to a Chromium that's already running and exposing a CDP browser endpoint over a WebSocket — BrowserBase / Browserless / your own gateway, dockerised Chromium, your own patched Chrome, or a re-attach to a previously-launched browser. Pass `wsEndpoint` directly or `browserURL` (mochi GETs `${browserURL}/json/version` to discover the WS URL). Includes `headers` for proxied / authenticated gateways. `session.close()` disconnects the WebSocket without killing the browser, matching `puppeteer.connect`'s convention. New `WebSocketCdpAdapter` + `connectWebSocketCdp()` in `packages/core/src/cdp/transport-ws.ts`; the existing pipe-mode `CdpTransport` is untouched. Lifecycle errors surface as a new `ConnectionLostError`.

**`profile: null`** — new third state for `LaunchOptions.profile` and `ConnectOptions.profile`. Skips every fingerprint override: no `deriveMatrix`, no inject payload build, no `Page.addScriptToEvaluateOnNewDocument`, no `Network.setUserAgentOverride`, no `Emulation.setTimezoneOverride`, no locale / viewport CDP calls. The user gets mochi's API surface (humanClick, session.fetch, screenshot, cookie jar, the lifecycle ergonomics) without any spoof layered on top. Composes with both entry points: `mochi.launch({ profile: null })` for a fresh stock Chromium mochi just drives, `mochi.connect({ wsEndpoint, profile: null })` for the remote / patched browser case, or `mochi.connect({ wsEndpoint, profile: "id", seed: "..." })` to layer mochi's full spoof onto a remote browser. `Session.profile` is now `MatrixV1 | null`; `Session.owned` distinguishes launched (owned) from connected (borrowed) sessions.

**`@mochi.js/behavioral`**: exports a new `DEFAULT_BEHAVIOR` constant (`{ hand: "right", tremor: 0.18, wpm: 60, scrollStyle: "smooth" }`) — the conservative-default behavioral profile mochi uses as the no-spoof fallback for `humanClick` / `humanType` / `humanScroll` when a session was launched with `profile: null` and there's no matrix-derived `behavior` block.

**Type widening (additive)**: `LaunchOptions.profile` widens from `ProfileId | ProfileV1 | undefined` to `ProfileId | ProfileV1 | null | undefined`. No breaking change — existing `undefined` (auto-pick) and `string` / `ProfileV1` callers work unchanged.

Tests: `tests/contract/connect-ws-transport.contract.test.ts` (Bun.serve mock CDP server, end-to-end `Browser.getVersion` round-trip + lifecycle assertions), `tests/contract/launch-no-profile.contract.test.ts` (verifies no spoof CDP overrides on the wire under `profile: null`), `packages/core/src/__tests__/connect.test.ts` (validation), `packages/core/src/__tests__/no-spoof-behavior.test.ts`, `packages/behavioral/src/__tests__/default-behavior.test.ts`.

Docs: `docs/content/docs/api/core.md` (new `mochi.connect`, `ConnectOptions`, `ConnectionLostError`, `Session.owned`, no-spoof-mode subsection); `docs/content/docs/guides/connect-existing-chrome.md` (new — usage examples for direct WS, `browserURL` discovery, no-spoof, power-user spoof-on-top).
