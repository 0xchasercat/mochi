/**
 * Cross-package contract: pin the EXACT Chromium argv that mochi emits for
 * `LaunchOptions.hermetic ∈ {false, true}`. Per task 0256, the production
 * default flag set was trimmed against patchright's
 * `chromiumSwitchesPatch.ts:20-34` removal list (passive command-line bot-
 * tells: `--disable-component-update`, `--disable-default-apps`,
 * `--disable-background-networking`, `--disable-sync`) and a slimmer
 * `--disable-features=` token. The dropped flags re-appear under
 * `hermetic: true` for harness / CI / capture flows.
 *
 * This test exists so future regressions are LOUD: anyone who silently
 * re-introduces a patchright-removed flag, swaps the production
 * `--disable-features=` token for the older fingerprintable-subset list,
 * or deletes the hermetic escape hatch, fails the suite.
 *
 * The test asserts the literal `string[]` argv produced by the pure
 * `buildChromiumArgs` builder. We do NOT spawn Chromium — argv composition
 * is the contract; runtime behaviour is covered by the harness E2E gate.
 *
 * Sources cited:
 *   - patchright `chromiumSwitchesPatch.ts:20-34` (their trim list).
 *   - puppeteer-real-browser `lib/cjs/index.js:57-58` (drops
 *     `--disable-component-update` for the same reason).
 *   - PLAN.md §8.6 (decision ledger).
 *
 * @see tasks/0256-default-chromium-flags-audit.md
 * @see packages/core/src/proc.ts (DEFAULT_CHROMIUM_FLAGS, HERMETIC_ONLY_CHROMIUM_FLAGS)
 */

import { describe, expect, it } from "bun:test";
import {
  buildChromiumArgs,
  DEFAULT_CHROMIUM_FLAGS,
  HERMETIC_ONLY_CHROMIUM_FLAGS,
  type SpawnConfig,
} from "../../packages/core/src/proc";

const FAKE_BINARY = "/usr/bin/chromium-stub";
const FAKE_UDD = "/tmp/mochi-flagset-udd";

function baseCfg(overrides: Partial<SpawnConfig> = {}): SpawnConfig {
  return { binary: FAKE_BINARY, headless: false, ...overrides };
}

// =============================================================================
// Pinned flag set — production (hermetic: false / unset).
//
// EVERY string in this array is asserted to be in the spawned argv, in this
// exact order, when no overrides are present. Adding / removing / reordering
// requires updating PLAN.md §8.6 in the same PR (the test fails otherwise).
// =============================================================================

const EXPECTED_PRODUCTION_FLAGS: readonly string[] = [
  `--user-data-dir=${FAKE_UDD}`,
  "--remote-debugging-pipe",
  "--no-default-browser-check",
  "--no-first-run",
  "--no-service-autorun",
  "--password-store=basic",
  "--use-mock-keychain",
  "--disable-features=Translate,AcceptCHFrame,IsolateOrigins,site-per-process",
  "--enable-features=NetworkService,NetworkServiceInProcess",
];

// =============================================================================
// Pinned flag set — hermetic (hermetic: true).
//
// Same as production PLUS the patchright-trim flags re-applied verbatim,
// inserted right after the production defaults. The relative order is
// load-bearing for argv-greppers but not for Chromium itself (Chromium
// merges multiple `--disable-features=` tokens into a union).
// =============================================================================

const EXPECTED_HERMETIC_FLAGS: readonly string[] = [
  `--user-data-dir=${FAKE_UDD}`,
  "--remote-debugging-pipe",
  "--no-default-browser-check",
  "--no-first-run",
  "--no-service-autorun",
  "--password-store=basic",
  "--use-mock-keychain",
  "--disable-features=Translate,AcceptCHFrame,IsolateOrigins,site-per-process",
  "--enable-features=NetworkService,NetworkServiceInProcess",
  // Hermetic-only block (patchright-trim flags + noise-reduction extras):
  "--disable-default-apps",
  "--disable-component-update",
  "--disable-background-networking",
  "--disable-sync",
  "--disable-features=OptimizationHints,MediaRouter,InterestFeedContentSuggestions,CalculateNativeWinOcclusion",
];

describe("chromium flags contract / production (hermetic: false / unset)", () => {
  it("emits exactly the pinned production flag set when hermetic is false", () => {
    const args = buildChromiumArgs(baseCfg({ hermetic: false }), FAKE_UDD, undefined);
    expect(args).toEqual([...EXPECTED_PRODUCTION_FLAGS]);
  });

  it("emits exactly the pinned production flag set when hermetic is unset", () => {
    // Default behaviour — identical to hermetic: false.
    const args = buildChromiumArgs(baseCfg(), FAKE_UDD, undefined);
    expect(args).toEqual([...EXPECTED_PRODUCTION_FLAGS]);
  });

  it("does NOT emit any patchright-trim flag in production mode", () => {
    // These four flags are passive command-line bot-tells per
    // `docs/audits/patchright.md` MED finding (chromiumSwitchesPatch.ts:20-34).
    // PRB drops `--disable-component-update` for the same reason.
    const args = buildChromiumArgs(baseCfg(), FAKE_UDD, undefined);
    expect(args).not.toContain("--disable-component-update");
    expect(args).not.toContain("--disable-default-apps");
    expect(args).not.toContain("--disable-background-networking");
    expect(args).not.toContain("--disable-sync");
  });

  it("does NOT emit the hermetic --disable-features extras in production mode", () => {
    // The hermetic `--disable-features=` token suppresses
    // OptimizationHints,MediaRouter,InterestFeedContentSuggestions,
    // CalculateNativeWinOcclusion. Real users want those features ON so
    // the network surface looks normal.
    const args = buildChromiumArgs(baseCfg(), FAKE_UDD, undefined);
    expect(
      args.some(
        (a) =>
          a.startsWith("--disable-features=") &&
          (a.includes("OptimizationHints") ||
            a.includes("MediaRouter") ||
            a.includes("InterestFeedContentSuggestions") ||
            a.includes("CalculateNativeWinOcclusion")),
      ),
    ).toBe(false);
  });

  it("never emits --enable-unsafe-swiftshader (patchright strips Playwright's leak)", () => {
    // patchright `chromiumPatch.ts:21-27` strips this. Mochi must not emit
    // it either — produces a distinct GL fingerprint under headless.
    const args = buildChromiumArgs(
      baseCfg({ headless: true, hermetic: true }),
      FAKE_UDD,
      undefined,
    );
    expect(args).not.toContain("--enable-unsafe-swiftshader");
  });

  it("never emits legacy --headless without =new (sannysoft trivially detects)", () => {
    const args = buildChromiumArgs(baseCfg({ headless: true }), FAKE_UDD, undefined);
    // Either no --headless at all, or `--headless=new` exactly. Bare
    // `--headless` is the bot-tell.
    expect(args).not.toContain("--headless");
    expect(args).toContain("--headless=new");
  });

  it("never emits --no-sandbox in defaults (CI uses MOCHI_EXTRA_ARGS env)", () => {
    // PLAN.md §8.6: `--no-sandbox` is a real-user fingerprint leak. The
    // CI-only path is `MOCHI_EXTRA_ARGS=--no-sandbox` env passthrough; it
    // must NEVER appear in DEFAULT_CHROMIUM_FLAGS or HERMETIC_ONLY_CHROMIUM_FLAGS.
    expect([...DEFAULT_CHROMIUM_FLAGS, ...HERMETIC_ONLY_CHROMIUM_FLAGS]).not.toContain(
      "--no-sandbox",
    );
  });

  it("never emits --disable-blink-features=AutomationControlled (we patch from JS via R-022)", () => {
    // PLAN.md §8.6: explicit rejection. We patch `navigator.webdriver` from
    // JS instead. patchright DOES add this flag back (`chromiumSwitchesPatch.ts`)
    // but mochi's posture per audit is to NOT introduce a flag-level tell.
    expect([...DEFAULT_CHROMIUM_FLAGS, ...HERMETIC_ONLY_CHROMIUM_FLAGS]).not.toContain(
      "--disable-blink-features=AutomationControlled",
    );
  });
});

describe("chromium flags contract / hermetic (hermetic: true)", () => {
  it("emits exactly the pinned hermetic flag set", () => {
    const args = buildChromiumArgs(baseCfg({ hermetic: true }), FAKE_UDD, undefined);
    expect(args).toEqual([...EXPECTED_HERMETIC_FLAGS]);
  });

  it("re-applies every HERMETIC_ONLY_CHROMIUM_FLAGS entry verbatim", () => {
    const args = buildChromiumArgs(baseCfg({ hermetic: true }), FAKE_UDD, undefined);
    for (const flag of HERMETIC_ONLY_CHROMIUM_FLAGS) {
      expect(args).toContain(flag);
    }
  });

  it("re-applies the patchright-trim flags so harness baselines stay deterministic", () => {
    const args = buildChromiumArgs(baseCfg({ hermetic: true }), FAKE_UDD, undefined);
    expect(args).toContain("--disable-component-update");
    expect(args).toContain("--disable-default-apps");
    expect(args).toContain("--disable-background-networking");
    expect(args).toContain("--disable-sync");
  });

  it("places hermetic flags AFTER the production defaults but BEFORE headless/proxy/lang", () => {
    const args = buildChromiumArgs(
      baseCfg({ hermetic: true, headless: true, locale: "en-US" }),
      FAKE_UDD,
      undefined,
    );
    const lastDefaultIdx = args.indexOf("--enable-features=NetworkService,NetworkServiceInProcess");
    const firstHermeticIdx = args.indexOf("--disable-default-apps");
    const headlessIdx = args.indexOf("--headless=new");
    const langIdx = args.indexOf("--lang=en-US");
    expect(lastDefaultIdx).toBeGreaterThan(0);
    expect(firstHermeticIdx).toBeGreaterThan(lastDefaultIdx);
    expect(headlessIdx).toBeGreaterThan(firstHermeticIdx);
    expect(langIdx).toBeGreaterThan(headlessIdx);
  });

  it("composes cleanly with --headless=new, --proxy-server, --lang, --window-size", () => {
    const args = buildChromiumArgs(
      baseCfg({
        hermetic: true,
        headless: true,
        proxy: "http://127.0.0.1:9999",
        locale: "ja-JP",
        windowSize: { width: 1440, height: 900 },
      }),
      FAKE_UDD,
      undefined,
    );
    expect(args).toContain("--headless=new");
    expect(args).toContain("--proxy-server=http://127.0.0.1:9999");
    expect(args).toContain("--lang=ja-JP");
    expect(args).toContain("--window-size=1440,900");
    // Hermetic block intact:
    expect(args).toContain("--disable-component-update");
  });
});

describe("chromium flags contract / invariants", () => {
  it("DEFAULT_CHROMIUM_FLAGS and HERMETIC_ONLY_CHROMIUM_FLAGS are disjoint", () => {
    // Belt + braces: a flag must not appear in both lists, otherwise
    // hermetic mode would emit a duplicate.
    const overlap = DEFAULT_CHROMIUM_FLAGS.filter((flag) =>
      HERMETIC_ONLY_CHROMIUM_FLAGS.includes(flag),
    );
    expect(overlap).toEqual([]);
  });

  it("DEFAULT_CHROMIUM_FLAGS contains the load-bearing inject-reach + UA-CH alignment tokens", () => {
    // `IsolateOrigins,site-per-process` — disabled so cross-origin frames
    // stay in the same renderer process (mochi has no OOPIF context
    // resolution today; addScriptToEvaluateOnNewDocument needs same-process
    // reach to land).
    // `AcceptCHFrame` — disabled so UA-CH frame negotiation can't override
    // our matrix-derived `Sec-CH-UA` headers (R-007 single source of truth).
    const features = DEFAULT_CHROMIUM_FLAGS.find((f) => f.startsWith("--disable-features="));
    expect(features).toBeDefined();
    expect(features).toContain("IsolateOrigins");
    expect(features).toContain("site-per-process");
    expect(features).toContain("AcceptCHFrame");
    expect(features).toContain("Translate");
  });
});
