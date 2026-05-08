# 0140: stealth conformance suite (port CloakBrowser tests/test_stealth.py)

**Package:** `harness` (with cascading fixes in `inject` and `consistency` per surfaced bugs)
**Phase:** `0.5.x` (a higher-bar gate than the local Probe Manifest harness)
**Estimated size:** L
**Dependencies:** 0001, 0011, 0020, 0030, 0040 (capture+probe-page), 0050+0051 (harness MVP), 0070 (full JS rules — 100% Zero-Diff)

## Goal

Port [CloakHQ/CloakBrowser/tests/test_stealth.py](https://raw.githubusercontent.com/CloakHQ/CloakBrowser/main/tests/test_stealth.py) to a mochi-native Bun-TS conformance suite under `packages/harness/src/conformance/stealth/`. After this lands, the v1.0 release is gated on:

1. The existing `bun harness:diff mac-m4-chrome-stable` (100% Zero-Diff against captured baseline) — already passing
2. **NEW:** `bun conformance:stealth` (offline assertions, every PR) — must pass
3. **NEW:** `MOCHI_ONLINE=1 bun conformance:stealth:online` (live bot-detection sites) — gated; must pass with documented expected-failures only

CloakBrowser uses a forked Chromium with C++ patches; mochi uses stock Chromium with JS-only spoofing per architectural invariant I-1. Therefore some CloakBrowser tests will fail against mochi. The agent's job is to **triage each failure**:
- (a) **JS-fixable** → fix mochi's inject/consistency layer, port the test as PASSING
- (b) **C++-only** → document the failure in `docs/limits.md` with rationale, port the test as a documented expected-failure (still in the suite, but skipped/expected-fail with comment citing the limit)

The honesty contract (PLAN.md I-8) demands every expected-failure be named, not silently skipped. The same discipline as `expected-divergences.json` for the harness.

## Success criteria

### Source porting

- [ ] Vendor `tests/fixtures/cloakbrowser/test_stealth.py` (verbatim copy from upstream) so future syncs are clear. Add a `# VENDORED VERBATIM from CloakHQ/CloakBrowser@<sha>` header comment.
- [ ] Port each test to a Bun:test in `packages/harness/src/conformance/stealth/__tests__/`:
  - `webdriver-detection.test.ts` ← `class TestWebDriverDetection` (6 offline tests)
  - `bot-detection-sites.test.ts` ← `class TestBotDetectionSites` (5 online tests, gated by `MOCHI_ONLINE=1`)
- [ ] Each ported test preserves the original assertion semantics. Comments cite the original Python line numbers + the upstream sha.

### Layer 1 — offline assertions (always-on PR gate)

The 6 offline tests, with my best-guess prediction of each one's mochi behavior. Agent verifies empirically and either passes or surfaces the gap:

| Original test | Assertion | Predicted mochi outcome | If FAIL → triage |
|---|---|---|---|
| `test_navigator_webdriver_false` | `navigator.webdriver === false` | PASS — `bot-globals` from 0030 + clean Chromium | JS-fixable: extend bot-globals |
| `test_no_headless_chrome_ua` | UA lacks `HeadlessChrome`, has `Chrome/` | PASS — R-004 rebuilds clean UA | JS-fixable: R-004 chain |
| `test_window_chrome_exists` | `typeof window.chrome === 'object'` | UNCERTAIN — may fail; we may not currently spoof `window.chrome` | JS-fixable: add `window.chrome` spoof module |
| `test_plugins_present` | `navigator.plugins.length >= 5` | LIKELY FAIL — we may have 0 plugins | JS-fixable: add curated plugin list per profile |
| `test_languages_present` | `navigator.languages.length >= 1` | PASS — R-016 sets languages | n/a |
| `test_cdp_not_detected` | no `cdc_*`/`__webdriver*` globals on window | PASS — bot-globals strips | JS-fixable: extend bot-globals |

For each FAIL the agent encounters, fix it AT THE SOURCE in `@mochi.js/inject` or `@mochi.js/consistency`. The 30-rule Zero-Diff harness gate (from 0070) must continue to pass after every fix — re-run `bun harness:diff mac-m4-chrome-stable` to confirm no regression.

### Layer 2 — online bot-detection sites (network-gated)

The 5 online tests. ALL gated by `MOCHI_ONLINE=1`:

| Site | Original assertion | Triage note |
|---|---|---|
| `bot.sannysoft.com` | 0 failures across ~25 checks | Most are JS-fixable; agent runs locally, lists each that fails, fixes or documents |
| `bot.incolumitas.com` | ≤ 1 known-acceptable (WEBDRIVER, connectionRTT) | WEBDRIVER is a spec false-positive across all stealth tools; connectionRTT depends on network not browser. KNOWN_ACCEPTABLE allowed per the original. |
| `browserscan.net/bot-detection` | 0 abnormal | Most JS-fixable |
| `deviceandbrowserinfo.com/are_you_a_bot` | `isBot === false` AND specific checks all false | Most JS-fixable; particularly `hasInconsistentChromeObject` may need our `window.chrome` spoof to be consistent |
| `demo.fingerprint.com/web-scraping` | not blocked + sees flight data | LIKELY HARDEST — fingerprint.com uses IP-class + behavioral + cohort scoring, not just fingerprint match. May fail from a datacenter IP / fresh session. Document as "requires good IP + warm session" if it fails. |

For each online site:
- Agent runs the test locally with their network
- If FAIL: investigate (curl-side debug, capture the page state, identify the specific assertion that broke)
- If JS-fixable: fix it
- If not JS-fixable (e.g., fingerprint.com IP-class blocking): mark as expected-failure with `it.todo` or `it.skipIf(...)` carrying a comment that links to `docs/limits.md`

### Wiring

- [ ] Root `package.json` adds:
  - `"conformance:stealth": "bun test packages/harness/src/conformance/stealth/__tests__/webdriver-detection.test.ts"`
  - `"conformance:stealth:online": "MOCHI_ONLINE=1 bun test packages/harness/src/conformance/stealth/__tests__/"`
- [ ] `.github/workflows/pr-fast.yml` adds a step `bun run conformance:stealth` after the existing `bun run harness:smoke`. **Hard-fail** at v0.5.x+ since we now have the gate to call this load-bearing.
- [ ] `.github/workflows/release.yml`: BEFORE `changesets/action@v1` runs publish, gate on `bun run conformance:stealth` AND `MOCHI_ONLINE=1 bun run conformance:stealth:online`. Both must pass. This is the v1.0 release block per orchestrator directive.
- [ ] `bun conformance:stealth` is the canonical PR-fast gate alongside `bun harness:smoke`.

### Documentation discipline

- [ ] For each test that fails AND the failure is C++-only / not JS-fixable: add an entry to `docs/limits.md` with:
  - The specific assertion that fails
  - Why it's not JS-achievable (e.g., requires Chromium source patch X)
  - The CloakBrowser test name + line reference
  - Whether mochi could ever work around it (proxy config? behavioral warmup?)
- [ ] For each test that NOW PASSES because the agent fixed mochi's spoofing: a brief note in the changeset describing the fix.

### Tests for the conformance suite itself

- [ ] Each ported test is its own Bun `it()` so failures are itemized.
- [ ] Use the existing `mochi.launch` / `Session` / `Page` API — same way real users will invoke mochi. No special test-only paths.
- [ ] Spawn one Session per `describe` block (mirroring CloakBrowser's `@pytest.fixture(scope="module") browser`).
- [ ] Use `mac-m4-chrome-stable` profile. Future: parameterize over the catalog.

### Other

- [ ] Pin the upstream CloakBrowser sha in a `tests/fixtures/cloakbrowser/SOURCE.md` so re-syncs are tractable.
- [ ] All gates green: typecheck, lint, test, test:contract, harness:smoke, conformance:stealth.
- [ ] Changeset: `@mochi.js/harness` minor (new conformance subpackage) + cascading minor on `@mochi.js/inject` / `@mochi.js/consistency` if the agent fixes spoofing bugs.

## Out of scope

- **Humanization conformance** — task 0150 (test_humanize_unit + test_human_visual).
- **Cross-engine spoofing** (Safari, Firefox) — v2.
- **Fingerprint.com paid product API** — only the open `/web-scraping` demo.
- **Behavioral conformance against bot-detection ML** — task 0150's territory.
- **CloakBrowser's other test files** (test_launch, test_proxy, test_geoip, etc.) — those test their own infra, not stealth assertions.
- **Custom forking of Chromium-for-Testing** — I-1 forbids C++ work.

## Implementation notes

- File layout under `packages/harness/src/conformance/stealth/`:
  - `__tests__/webdriver-detection.test.ts` — Layer 1 (6 offline tests)
  - `__tests__/bot-detection-sites.test.ts` — Layer 2 (5 online tests)
  - `helpers.ts` — shared session-fixture pattern + result extractors
  - `expected-failures.ts` — typed list of `MOCHI_ONLINE` tests that we expect to fail with rationale comments
- Vendoring path: `tests/fixtures/cloakbrowser/test_stealth.py` (verbatim Python source for reference). Add `tests/fixtures/cloakbrowser/SOURCE.md` with: upstream sha, copy date, commit URL.
- For the live online tests: respect the upstream's `time.sleep(N)` patterns — they're load-bearing for sites that take time to score the session. Use `Bun.sleep` or `await new Promise(r => setTimeout(r, N))`.
- Flaky online tests are real — when an online site is down or slow, the test should distinguish "network failure" (skip) from "real fingerprint failure" (fail). Implement a small retry+backoff (max 3 attempts) before declaring a real failure.
- For the agent's triage workflow: when an offline test fails, FIRST verify the failure isn't a flaky one-off (re-run 3x). Only then dive into the inject/consistency fix.
- Bot-globals (from 0030) currently strips a list including `cdc_adoQpoasnfa76pfcZLmcfl_*`. CloakBrowser's test checks for ANY `cdc_` prefix. If the agent finds new globals (e.g., `__nightmare`, `domAutomation`), extend the bot-globals list.
- For `window.chrome` spoof: real Chrome exposes `window.chrome = { runtime: {...}, app: {...}, csi: ..., loadTimes: ... }`. A minimal spoof would set `window.chrome = { runtime: undefined }` for headless or a richer fake for headed. Agent decides based on what assertion `test_window_chrome_exists` actually requires (just `typeof === 'object'`, so a `{}` is enough).
- For plugin spoof: real Chrome 147+ has `[Chrome PDF Plugin, Chrome PDF Viewer, Native Client, ...]` with 5 entries. Agent ports a curated plugin list per OS. PluginArray + Plugin objects need a custom prototype to look like native.

## Validation

```sh
bun typecheck
bun lint
bun test
bun test:contract --pkg=harness

# Layer 1 — offline (must pass):
MOCHI_E2E=1 MOCHI_CHROMIUM_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  bun run conformance:stealth

# Layer 2 — online (must pass; documented expected-failures allowed):
MOCHI_ONLINE=1 MOCHI_E2E=1 MOCHI_CHROMIUM_PATH="..." \
  bun run conformance:stealth:online

# Existing harness must still pass — no regression:
MOCHI_E2E=1 bun harness:diff mac-m4-chrome-stable
```

When everything's green AND `docs/limits.md` honestly catalogs the JS-only ceiling: `bun work submit 0140 --draft`.

## Touch list (rough)

- `packages/harness/src/conformance/stealth/{helpers,expected-failures}.ts` (new)
- `packages/harness/src/conformance/stealth/__tests__/{webdriver-detection,bot-detection-sites}.test.ts` (new)
- `packages/harness/src/index.ts` (re-export the conformance namespace)
- `tests/fixtures/cloakbrowser/{test_stealth.py,SOURCE.md}` (vendored verbatim + provenance)
- `package.json` (root): add `conformance:stealth` + `conformance:stealth:online` scripts
- `.github/workflows/pr-fast.yml`: hard-fail step
- `.github/workflows/release.yml`: pre-publish gate
- `docs/limits.md`: itemize each C++-only assertion that mochi can't pass + rationale
- `packages/inject/src/modules/{plugins,window-chrome}.ts` (new — likely; created by the triage process)
- `packages/inject/src/modules/bot-globals.ts` (extend per CloakBrowser's check)
- `.changeset/stealth-conformance.md` (new)
