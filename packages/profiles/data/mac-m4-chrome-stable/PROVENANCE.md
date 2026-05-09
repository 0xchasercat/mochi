# PROVENANCE — mac-m4-chrome-stable

Captured by `mochi capture`. PLAN.md §12.2 — every profile in `main`
must carry verifiable provenance.

| field | value |
|---|---|
| profile id | `mac-m4-chrome-stable` |
| capturer | unknown |
| machine | unknown |
| browser version | 147 |
| mochi cli version | 0.0.1 |
| captured at (UTC) | 2026-05-08T02:02:42.379Z |

## Hand-corrections

- 2026-05-08, `uaCh.sec-ch-ua-model` corrected from `"\"Mac\""`
  to `"\"\""` (empty quoted string). Real Chrome 147 desktop reports
  `model: ""` from `getHighEntropyValues`; the v0.4 capture incorrectly
  stamped the `device.model` fallback ("Mac") into the uaCh slot. The
  capture-time derivation (`packages/cli/src/capture/derive-profile.ts`,
  `buildUaCh`) was fixed in the same task so future captures preserve the
  real (empty) value verbatim.

- 2026-05-08, headless-mode-leak corrections in
  `baseline.manifest.json` + `profile.json`. The original capture ran
  against `--headless=new` Chromium-for-Testing, which emits several
  artifacts NOT present in real user-Chrome on the same hardware:

  | field | raw capture | corrected (real user-Chrome on M4 Max) |
  |---|---|---|
  | `navigator.userAgent` | `…HeadlessChrome/147.0.0.0…` | `…Chrome/147.0.7727.138…` |
  | `navigator.appVersion` | (HeadlessChrome variant) | (Chrome variant) |
  | `navigator.deviceMemory` | `32` | `8` (Chrome's spec cap) |
  | `bot.webdriver` | `true` | `false` |
  | `bot.webdriverType` | `"headless"` | `"normal"` |
  | `bot.headlessChrome` | `true` | `false` |

  Rationale: `baseline.manifest.json` is the harness's diff target —
  what we expect a clean Mochi-spoofed session to produce. The raw
  captured headless leaks are not what real users see, so spoofing
  TO them would be wrong. Corrected baseline = correct spoofing target.

  **Future captures should run in headed mode** (or with a flag that
  suppresses the headless markers) to avoid re-introducing the leaks.
  See `tests/fixtures/probe-page.html` and `mochi capture` for the
  capture-time options.

