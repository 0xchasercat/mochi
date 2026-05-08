# @mochi.js/harness

## 0.1.0

### Minor Changes

- c38d7aa: Phase 0.5 — `@mochi.js/harness` MVP + `mochi harness` subcommand.

  - **`@mochi.js/harness`** ships the five public functions (`capture`, `normalize`, `diff`, `categorize`, `report`) and the `runHarnessAgainstProfile` orchestrator. Drives a Mochi-spoofed session through `tests/fixtures/probe-page.html`, normalizes per-session entropy on both the captured manifest and the committed baseline, structurally diffs the two, and categorizes each divergence as `guid-class` | `intentional` | `material`. PR gate: `counts.material === 0` (PLAN.md §13.6).
  - **`mochi harness <profile-id>`** + **`mochi harness all`** runs the harness from the CLI. Without `--out`, prints verdict + counts. With `--out <dir>`, writes `report.json` + `report.html` for each profile.
  - Per-profile **`expected-divergences.json`** ships at `packages/profiles/data/<id>/expected-divergences.json`. Glob paths are categorized as `intentional`. Every entry has a human-readable `comment` — phase-0.7-deferred surfaces (audio bytes, canvas hash, full WebGL extensions, full font lists, MediaDevices, SpeechSynthesis voices, etc.) are pre-populated for `mac-m4-chrome-stable`.
  - Root **`bun harness:smoke`** / **`bun harness:full`** / **`bun harness:diff <id>`** scripts replace the v0.0 echo placeholders.
  - `pr-fast.yml` gains a soft-fail `bun harness:smoke` step. Hard-fail flips on at the end of phase 0.7.

- f0c1a8a: Task 0150 — humanize conformance suite + supporting Page surface.

  - **`@mochi.js/harness`** gains a new conformance suite under
    `src/conformance/humanize/__tests__/` — a mochi-native port of
    CloakHQ/CloakBrowser's `tests/test_humanize_unit.mjs` +
    `tests/test_human_visual.mjs`. Seven test files cover config
    resolution, Bezier math, mouse trajectory (E2E), keystroke timing,
    fill clearing (E2E), patching integrity, and (online,
    `MOCHI_ONLINE=1`) the `deviceandbrowserinfo.com` bot-detection form.
    Run via `bun run conformance:humanize` (offline) or
    `bun run conformance:humanize:online`.
  - **`@mochi.js/core`** ships three Page-surface additions:
    - `Page.humanMove(x, y, opts?)` — animate the cursor to (x, y)
      along a Bezier trajectory without dispatching a click. Same
      underlying synth as `humanClick` minus the press/release.
    - `Page.cursorPosition()` — read the tracked cursor (x, y) so
      sequences of `humanMove`/`humanClick` chain realistically.
    - `Page.humanType("", selector)` — clearing semantics.
      Emits Backspace × `value.length` with realistic key timing
      instead of being a no-op as it was before.
  - Companion correctness fix: `Input.dispatchKeyEvent` now carries
    the proper `code` + `windowsVirtualKeyCode` for control keys
    (Backspace/Enter/Tab/Escape/Delete) so Chromium fires the
    edit-action handler, not just the JS keydown event. Printable
    letters/digits/space also get plausible `KeyA`/`Digit0`/`Space`
    codes for layout-aware page code.
  - Root scripts + CI gates wired:
    - `bun run conformance:humanize` is a PR-fast hard-fail step.
    - `bun run conformance:humanize` is a release-pre-publish gate.
  - Initial cursor position now defaults to the matrix's
    `display.width/2, display.height/2` (PLAN.md I-5) instead of (0, 0)
    — a real human's pointer is never at the viewport origin.

- 74443f7: Phase 0.5.x — stealth conformance suite (port of CloakBrowser
  `tests/test_stealth.py`).

  - **`@mochi.js/harness`** gains a new `conformance/stealth/` subtree. Layer 1
    (`webdriver-detection.test.ts`) runs as the load-bearing PR-fast gate
    alongside `bun harness:smoke` — six offline assertions ported verbatim
    from CloakBrowser's `TestWebDriverDetection`:
    `navigator.webdriver===false`, no `HeadlessChrome` UA, `typeof window.chrome === "object"`,
    `navigator.plugins.length >= 5`, `navigator.languages.length >= 1`,
    no `cdc_*` / `__webdriver*` window keys. Layer 2
    (`bot-detection-sites.test.ts`) runs gated by `MOCHI_ONLINE=1` against
    bot.sannysoft, bot.incolumitas, browserscan, deviceandbrowserinfo, and
    demo.fingerprint.com/web-scraping. Three online tests carry typed
    expected-failure entries (incolumitas anti-debugger trap, sannysoft
    MQ_SCREEN, fingerprint.com IP-class blocking) — see `docs/limits.md`.
  - **`@mochi.js/inject`** gains two CloakBrowser-surfaced defensive shim
    modules: `window-chrome.ts` (mirrors Chrome's `window.chrome` shape with
    `loadTimes`/`csi`/`app` only when the underlying browser doesn't already
    expose it; `runtime` is intentionally undefined for non-extension
    contexts) and `plugins.ts` (curated 5-plugin PluginArray + 2-mimetype
    MimeTypeArray, matching the `mac-m4-chrome-stable` baseline; only
    installed when the underlying browser reports an empty list). Both
    shims no-op on real Chrome.app where the surfaces are native, so the
    existing harness Zero-Diff gate is unchanged at runtime.
  - New scripts: `bun conformance:stealth` (Layer 1, PR-fast) and
    `bun conformance:stealth:online` (Layer 2, network-gated). Wired into
    `.github/workflows/pr-fast.yml` (Layer 1 hard-fail) and
    `.github/workflows/release.yml` (both layers gate publish).
  - Vendored upstream source: `tests/fixtures/cloakbrowser/test_stealth.py`
    (sha-pinned to `13b1b98b6840b68316e43fd46f43ffa7f50fd967`).

### Patch Changes

- 4f09750: Initial v0.0.1 claim release with placeholder exports. Surface lands incrementally per PLAN.md §14.
- ff75595: Land proxy authentication for HTTP / HTTPS / SOCKS5 / SOCKS4 proxies, wire
  the live `conformance:stealth:online` gate to a residential proxy via the
  `HTTP_PROXY` repo secret, and harden the `bot.incolumitas.com` test against
  goto soft-fail timeouts.

  - **`@mochi.js/core`** ships a new `proxy-auth.ts` that attaches a CDP
    `Fetch.authRequired` listener on session start when credentials are
    present, answering proxy auth challenges with `Fetch.continueWithAuth`.
    No extension, no `Runtime.enable`, no `Page.createIsolatedWorld` —
    PLAN.md §8.2 invariants preserved (`Fetch.enable` is not on the
    forbidden list and produces no page-observable signals). The handler is
    wired with empty `patterns` so regular request flow is unaffected; a
    defensive `Fetch.requestPaused` handler short-circuits via
    `Fetch.continueRequest` if Chromium ever pauses a request despite the
    empty pattern set. `Fetch.disable` runs on session close.

    `parseProxyUrl(url)` is exported and handles the four protocols, with
    and without auth, percent-encoded credentials, IPv6 hosts, and missing
    ports (defaults: HTTP=80, HTTPS=443, SOCKS5/4=1080).
    `LaunchOptions.proxy` accepts both the string form
    (`http://user:pass@host:port`) and the `ProxyConfig` record shape; both
    feed the same auth path. Credentials are forwarded to the network FFI
    too, so `Session.fetch` shares the same authenticated egress as the
    browser.

  - **`@mochi.js/harness`** — `launchSharedSession()` now reads
    `MOCHI_PROXY` and feeds it to `mochi.launch({ proxy })` when set.
    Empty / unset = unproxied (fork PRs without secrets still run cleanly).
    The `bot.incolumitas.com` test short-circuits to its registered
    expected-failure when `bestEffortGoto` reports `navigated: false`,
    preventing the 12s sleep + 30s evaluate + worker-injection cascade
    from eating the 90s test budget.

  - **CI** — both `release.yml` (existing Layer 2 step) and `pr-fast.yml`
    (newly added Layer 2 step, gated `if: github.event_name == 'pull_request'`)
    now pass `MOCHI_PROXY: ${{ secrets.HTTP_PROXY }}` so the live runs
    egress from a residential IP. The secret value is never echoed.

- Updated dependencies [3fefd93]
- Updated dependencies [e97c732]
- Updated dependencies [5ea34c6]
- Updated dependencies [29e1bb2]
- Updated dependencies [f0c1a8a]
- Updated dependencies [4f09750]
- Updated dependencies [e7cc610]
- Updated dependencies [ff75595]
  - @mochi.js/behavioral@0.1.0
  - @mochi.js/consistency@0.1.0
  - @mochi.js/core@0.1.0
  - @mochi.js/profiles@0.0.2
