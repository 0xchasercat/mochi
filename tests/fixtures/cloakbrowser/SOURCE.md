<<<<<<< HEAD
# Vendored CloakBrowser test sources

These files are verbatim copies, kept for reference and conformance porting.
Do not edit; they're snapshots used as the source of truth for the
`@mochi.js/harness` conformance suites under
`packages/harness/src/conformance/`.

# stealth sources (from task 0140)
- test_stealth_v2.mjs: CloakHQ/CloakBrowser@<sha>

# humanize sources
- test_humanize_unit.mjs: CloakHQ/CloakBrowser@13b1b98b6840b68316e43fd46f43ffa7f50fd967 — copied 2026-05-08
- test_human_visual.mjs: CloakHQ/CloakBrowser@13b1b98b6840b68316e43fd46f43ffa7f50fd967 — copied 2026-05-08
=======
# CloakBrowser test_stealth.py — vendored

**Upstream:** [CloakHQ/CloakBrowser](https://github.com/CloakHQ/CloakBrowser)
**Source path:** `tests/test_stealth.py`
**Source URL:** https://raw.githubusercontent.com/CloakHQ/CloakBrowser/main/tests/test_stealth.py
**Pinned commit:** `13b1b98b6840b68316e43fd46f43ffa7f50fd967`
**Permalink:** https://github.com/CloakHQ/CloakBrowser/blob/13b1b98b6840b68316e43fd46f43ffa7f50fd967/tests/test_stealth.py
**Copied verbatim:** 2026-05-08

## Why vendored

mochi's stealth conformance suite ports CloakBrowser's `test_stealth.py` —
their gold-standard stealth assertion set — into Bun:test under
`packages/harness/src/conformance/stealth/__tests__/`. We keep the original
Python source in this directory so re-syncs are tractable: a future
maintainer can `git diff` the upstream against this pin and decide whether
to re-port any updated assertions.

## Scope ported

- `class TestWebDriverDetection` (6 offline tests) → `webdriver-detection.test.ts`
- `class TestBotDetectionSites` (5 online tests, gated) → `bot-detection-sites.test.ts`
  - `test_recaptcha_v3` is intentionally NOT ported — it is an interactive scoring API
    that requires proper UA + behavioral warmup; out-of-scope for v0.5.x stealth
    conformance per task brief.
- `class TestIssueRegressions` is NOT ported — those test CloakBrowser's own
  `add_init_script` / immediate-goto wiring, not stealth assertions per se.

## License

CloakBrowser is licensed under the same terms as the upstream repo. Verify
the upstream LICENSE before redistribution.
>>>>>>> db40daa (chore(repo): vendor CloakBrowser test_stealth.py with sha pin)
