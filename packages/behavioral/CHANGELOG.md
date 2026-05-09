# @mochi.js/behavioral

## 0.1.6

### Patch Changes

- c8e2055: Add `mochi.connect()` for attaching to existing CDP browsers + `profile: null` for no-spoof mode.

  **`mochi.connect(opts)`** — new top-level entry point that mirrors `puppeteer.connect`'s shape. Attaches to a Chromium that's already running and exposing a CDP browser endpoint over a WebSocket — BrowserBase / Browserless / your own gateway, dockerised Chromium, your own patched Chrome, or a re-attach to a previously-launched browser. Pass `wsEndpoint` directly or `browserURL` (mochi GETs `${browserURL}/json/version` to discover the WS URL). Includes `headers` for proxied / authenticated gateways. `session.close()` disconnects the WebSocket without killing the browser, matching `puppeteer.connect`'s convention. New `WebSocketCdpAdapter` + `connectWebSocketCdp()` in `packages/core/src/cdp/transport-ws.ts`; the existing pipe-mode `CdpTransport` is untouched. Lifecycle errors surface as a new `ConnectionLostError`.

  **`profile: null`** — new third state for `LaunchOptions.profile` and `ConnectOptions.profile`. Skips every fingerprint override: no `deriveMatrix`, no inject payload build, no `Page.addScriptToEvaluateOnNewDocument`, no `Network.setUserAgentOverride`, no `Emulation.setTimezoneOverride`, no locale / viewport CDP calls. The user gets mochi's API surface (humanClick, session.fetch, screenshot, cookie jar, the lifecycle ergonomics) without any spoof layered on top. Composes with both entry points: `mochi.launch({ profile: null })` for a fresh stock Chromium mochi just drives, `mochi.connect({ wsEndpoint, profile: null })` for the remote / patched browser case, or `mochi.connect({ wsEndpoint, profile: "id", seed: "..." })` to layer mochi's full spoof onto a remote browser. `Session.profile` is now `MatrixV1 | null`; `Session.owned` distinguishes launched (owned) from connected (borrowed) sessions.

  **`@mochi.js/behavioral`**: exports a new `DEFAULT_BEHAVIOR` constant (`{ hand: "right", tremor: 0.18, wpm: 60, scrollStyle: "smooth" }`) — the conservative-default behavioral profile mochi uses as the no-spoof fallback for `humanClick` / `humanType` / `humanScroll` when a session was launched with `profile: null` and there's no matrix-derived `behavior` block.

  **Type widening (additive)**: `LaunchOptions.profile` widens from `ProfileId | ProfileV1 | undefined` to `ProfileId | ProfileV1 | null | undefined`. No breaking change — existing `undefined` (auto-pick) and `string` / `ProfileV1` callers work unchanged.

  Tests: `tests/contract/connect-ws-transport.contract.test.ts` (Bun.serve mock CDP server, end-to-end `Browser.getVersion` round-trip + lifecycle assertions), `tests/contract/launch-no-profile.contract.test.ts` (verifies no spoof CDP overrides on the wire under `profile: null`), `packages/core/src/__tests__/connect.test.ts` (validation), `packages/core/src/__tests__/no-spoof-behavior.test.ts`, `packages/behavioral/src/__tests__/default-behavior.test.ts`.

  Docs: `docs/content/docs/api/core.md` (new `mochi.connect`, `ConnectOptions`, `ConnectionLostError`, `Session.owned`, no-spoof-mode subsection); `docs/content/docs/guides/connect-existing-chrome.md` (new — usage examples for direct WS, `browserURL` discovery, no-spoof, power-user spoof-on-top).

## 0.1.5

### Patch Changes

- Updated dependencies [22b2a02]
  - @mochi.js/consistency@0.1.4

## 0.1.4

### Patch Changes

- Updated dependencies [d79b782]
  - @mochi.js/consistency@0.1.3

## 0.1.3

### Patch Changes

- Updated dependencies [92b8a57]
  - @mochi.js/consistency@0.1.2

## 0.1.2

### Patch Changes

- Updated dependencies [1231131]
  - @mochi.js/consistency@0.1.1

## 0.1.1

### Patch Changes

- 7073097: Hot-fix v0.1.0's broken `workspace:*` references in published package.json
  files. v0.1.0 leaked the Bun workspace protocol verbatim into published
  tarballs because `changeset publish` (which wraps `npm publish`) does NOT
  rewrite `workspace:*` to concrete semver ranges — that's a pnpm/yarn
  courtesy npm doesn't replicate. As a result, `bun add @mochi.js/core@0.1.0`
  fails with `Workspace dependency not found` for every internal dep
  (behavioral, consistency, inject, net), and the same for the 6 other
  packages with internal deps.

  The fix adds `scripts/rewrite-workspace-deps.ts` as a publish-time
  pre-hook in the root `release` script. Pre-publish, every `workspace:*`
  in `packages/<name>/package.json` is rewritten to `^<sibling-version>`
  resolved from the local workspace map. Bun's workspace links during
  dev still resolve via the `name` field, so concrete versions on disk
  between cycles don't break local development.

  Verified by `bun pack`-ing the affected packages locally and inspecting
  the resulting tarball's `package.json` deps before pushing v0.1.1.

  `@mochi.js/consistency` and `@mochi.js/net-rs` are leaf packages with no
  internal deps; they ship at v0.1.0/0.1.0 already and don't need a bump.

## 0.1.0

### Minor Changes

- 3fefd93: Land the phase 0.8 behavioral engine.

  `@mochi.js/behavioral` ships pure-data synthesizers for human-shaped input:
  mouse trajectories (cubic Bezier with overshoot+correction, Fitts's-Law
  duration, autocorrelated Gaussian jitter), keystroke timing (lognormal
  digraph delays, Gaussian press duration, QWERTY-adjacent mistake injection),
  and inertial scroll (exponential friction decay, 60Hz frame cap). Every
  synth function accepts `seed?: string` and produces byte-identical output
  for the same `(opts, seed)` pair, verified by a determinism suite (10
  iterations × 4 surfaces).

  `@mochi.js/core.Page.humanClick` / `humanType` / `humanScroll` graduate from
  `NotImplementedError` placeholders to real implementations that consume the
  behavioral synth arrays and dispatch them as `Input.dispatchMouseEvent` /
  `Input.dispatchKeyEvent`. The behavior parameters come from
  `MatrixV1.profile.behavior` (PLAN.md I-5) and may be overridden per call.

  `@mochi.js/consistency` promotes its xoshiro256\*\* PRNG and SHA-256 seed
  derivation to a public sub-export (`@mochi.js/consistency/prng`) so the
  behavioral package can share the same primitive — preserving the
  "single deterministic universe per `(profile, seed)`" invariant.

### Patch Changes

- 4f09750: Initial v0.0.1 claim release with placeholder exports. Surface lands incrementally per PLAN.md §14.
- Updated dependencies [3fefd93]
- Updated dependencies [29e1bb2]
- Updated dependencies [4f09750]
  - @mochi.js/consistency@0.1.0
