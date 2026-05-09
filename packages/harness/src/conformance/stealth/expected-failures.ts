/**
 * Typed list of conformance tests that mochi's JS-only stealth ceiling
 * cannot make pass. Every entry MUST be cross-referenced in
 * `docs/limits.md` and cite the upstream CloakBrowser line.
 *
 * The honesty contract (PLAN.md I-8): an expected failure is named, not
 * silently skipped. Tests in this list are still `it()` blocks — they
 * either run with `it.skipIf(...)` and a comment, or run as `it.todo`
 * with a rationale that the suite reporter surfaces.
 *
 * The Layer 1 (offline) tests are NOT expected to fail under a JS-only
 * spoof — every CloakBrowser webdriver-detection assertion is reproducible
 * by mochi's inject layer. The expected-failure set is exclusively a
 * Layer 2 (online) phenomenon, where ML-scored / IP-class / cohort sites
 * fail for reasons unrelated to fingerprint match.
 *
 * @see docs/limits.md (the canonical entries)
 */

/** Why a test is expected to fail under a JS-only stealth ceiling. */
export interface ExpectedFailure {
  /** Stable id for cross-references. Mirrors the test's `it()` name. */
  readonly id: string;
  /** Original CloakBrowser test name (e.g. `test_fingerprintjs`). */
  readonly upstreamTest: string;
  /** Upstream line range in `tests/fixtures/cloakbrowser/test_stealth.py`. */
  readonly upstreamLines: readonly [number, number];
  /** One-sentence rationale for why JS-only can't fix this. */
  readonly rationale: string;
  /** docs/limits.md anchor (section heading). */
  readonly limitsAnchor: string;
  /**
   * If true, the test is `skipIf(true)` outright — we never run it because
   * we know it will fail. If false, the test runs and is allowed to
   * throw the rationale instead of asserting. Use `false` for online
   * tests that occasionally pass when the IP / cohort happens to be
   * favorable, so we surface a "now passing" upgrade signal in CI logs.
   */
  readonly hardSkip: boolean;
}

export const EXPECTED_FAILURES: readonly ExpectedFailure[] = [
  {
    id: "fingerprintjs-web-scraping-not-blocked",
    upstreamTest: "test_fingerprintjs",
    upstreamLines: [180, 199],
    rationale:
      "demo.fingerprint.com uses IP-class + cohort scoring + behavioral entropy in addition to fingerprint match — a fresh datacenter session with zero behavioral history is blocked even when every JS surface matches a real Chrome. JS-only stealth cannot pass this without a residential IP and warm session history.",
    limitsAnchor: "demo.fingerprint.com /web-scraping — requires residential IP + warm session",
    hardSkip: false,
  },
  {
    id: "incolumitas-anti-debugger-trap",
    upstreamTest: "test_bot_incolumitas",
    upstreamLines: [115, 136],
    rationale:
      "bot.incolumitas.com ships an anti-debugger / infinite-loop trap that prevents the `load` event from ever firing under any CDP-controlled browser (the trap detects the debugger flag, not our specific spoofing). The page's scoring routine still runs and writes to the body, but mochi's worker-injection pipeline races the trap and the underlying Chromium process hangs. This is C++-only fixable (would require either a CDP-detection bypass at the Chromium source level or a Chromium build that disables the debugger-detection codepath).",
    limitsAnchor: "bot.incolumitas.com — anti-debugger CDP trap",
    hardSkip: false,
  },
  {
    id: "sannysoft-mq-screen",
    upstreamTest: "test_bot_sannysoft",
    upstreamLines: [89, 113],
    rationale:
      "sannysoft's MQ_SCREEN row checks that `matchMedia('(device-width: <screen.width>px)')` matches against the actual viewport. Headless Chrome's default 800x600 viewport vs the captured screen.width:800 baseline matches dimensionally, but sannysoft's specific MQ string format may diverge. Real-world sites don't fingerprint this (it's a sannysoft-specific probe). The other 56/57 sannysoft probes pass cleanly. Documented but not gated.",
    limitsAnchor: "bot.sannysoft.com MQ_SCREEN — sannysoft-specific MQ test mismatch",
    hardSkip: false,
  },
  {
    id: "deviceandbrowserinfo-worker-injection-hang",
    upstreamTest: "test_device_and_browser_info",
    upstreamLines: [157, 177],
    rationale:
      "deviceandbrowserinfo.com/are_you_a_bot ships heavy fingerprint workers that the inject pipeline tries to attach to. The page-side trap detects the CDP debugger and intentionally hangs the worker initialization, which races mochi's `Runtime.evaluate` against the worker target. The page's `domcontentloaded` event eventually fires but `page.evaluate` against the partial DOM also times out behind the same trap. Like incolumitas, this is C++-only fixable — would require either disabling the V8 debugger flag at Chromium source or using a non-CDP automation channel.",
    limitsAnchor: "deviceandbrowserinfo.com — worker-injection / anti-debugger hang",
    hardSkip: false,
  },
] as const;

/**
 * Look up an expected-failure entry by id.
 */
export function findExpectedFailure(id: string): ExpectedFailure | undefined {
  return EXPECTED_FAILURES.find((e) => e.id === id);
}
