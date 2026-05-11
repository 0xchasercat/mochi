/**
 * Unit tests for `buildChromiumArgs` — the pure arg-vector builder shared
 * between `spawnChromium` and the launcher's flag-plumbing tests. We do NOT
 * spawn a real Chromium here; the goal is to lock the flag set against
 * regressions, particularly the matrix-derived `--lang=<locale>` flag that
 * closes the I-5 leak between Chromium's network-layer `Accept-Language`
 * header and the JS-layer `navigator.language(s)` spoof.
 *
 * The flag is sourced from `MatrixV1.locale` (the canonical primary BCP-47
 * string) and MUST come from the matrix, never from the host OS.
 *
 * @see packages/core/src/proc.ts
 * @see PLAN.md §8.6 (DEFAULT_CHROMIUM_FLAGS), §2 I-5
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  buildChromiumArgs,
  DEFAULT_CHROMIUM_FLAGS,
  diagnoseEarlyExitTail,
  HERMETIC_ONLY_CHROMIUM_FLAGS,
  type SpawnConfig,
} from "../proc";

const FAKE_BINARY = "/usr/bin/chromium-stub";
const FAKE_UDD = "/tmp/mochi-test-udd";

function baseCfg(overrides: Partial<SpawnConfig> = {}): SpawnConfig {
  return { binary: FAKE_BINARY, headless: false, ...overrides };
}

describe("buildChromiumArgs / baseline", () => {
  it("includes every DEFAULT_CHROMIUM_FLAGS entry verbatim", () => {
    const args = buildChromiumArgs(baseCfg(), FAKE_UDD, process.env.MOCHI_EXTRA_ARGS);
    for (const flag of DEFAULT_CHROMIUM_FLAGS) {
      expect(args).toContain(flag);
    }
  });

  it("puts --user-data-dir first so user-supplied args cannot override it", () => {
    const args = buildChromiumArgs(baseCfg(), FAKE_UDD, process.env.MOCHI_EXTRA_ARGS);
    expect(args[0]).toBe(`--user-data-dir=${FAKE_UDD}`);
  });

  it("does NOT include --headless=new when headless is false", () => {
    const args = buildChromiumArgs(
      baseCfg({ headless: false }),
      FAKE_UDD,
      process.env.MOCHI_EXTRA_ARGS,
    );
    expect(args).not.toContain("--headless=new");
  });

  it("includes --headless=new when headless is true", () => {
    const args = buildChromiumArgs(
      baseCfg({ headless: true }),
      FAKE_UDD,
      process.env.MOCHI_EXTRA_ARGS,
    );
    expect(args).toContain("--headless=new");
  });

  it("appends --proxy-server when proxy is set", () => {
    const args = buildChromiumArgs(
      baseCfg({ proxy: "http://proxy.example:8080" }),
      FAKE_UDD,
      process.env.MOCHI_EXTRA_ARGS,
    );
    expect(args).toContain("--proxy-server=http://proxy.example:8080");
  });

  it("does NOT include --proxy-server when proxy is empty / undefined", () => {
    const args = buildChromiumArgs(baseCfg({ proxy: "" }), FAKE_UDD, process.env.MOCHI_EXTRA_ARGS);
    expect(args.some((a) => a.startsWith("--proxy-server"))).toBe(false);
  });
});

describe("buildChromiumArgs / --lang  (— matrix.locale → Accept-Language)", () => {
  it("appends --lang=<value> when locale is set", () => {
    const args = buildChromiumArgs(
      baseCfg({ locale: "en-US" }),
      FAKE_UDD,
      process.env.MOCHI_EXTRA_ARGS,
    );
    expect(args).toContain("--lang=en-US");
  });

  it("preserves the BCP-47 hyphen / region casing exactly as supplied", () => {
    // Chromium accepts the BCP-47 form verbatim; we MUST NOT lowercase the
    // region tag (e.g. "en-US" vs "en-us") because Chromium's `Accept-Language`
    // derivation respects the exact casing of the value.
    const args = buildChromiumArgs(
      baseCfg({ locale: "pt-BR" }),
      FAKE_UDD,
      process.env.MOCHI_EXTRA_ARGS,
    );
    expect(args).toContain("--lang=pt-BR");
    expect(args).not.toContain("--lang=pt-br");
  });

  it("does NOT include --lang when locale is undefined", () => {
    const args = buildChromiumArgs(baseCfg(), FAKE_UDD, process.env.MOCHI_EXTRA_ARGS);
    expect(args.some((a) => a.startsWith("--lang"))).toBe(false);
  });

  it("does NOT include --lang when locale is the empty string", () => {
    const args = buildChromiumArgs(baseCfg({ locale: "" }), FAKE_UDD, process.env.MOCHI_EXTRA_ARGS);
    expect(args.some((a) => a.startsWith("--lang"))).toBe(false);
  });

  it("does NOT silently fall back to host locale (we are not udc)", () => {
    // udc's `__init__.py:359-369` falls back to `locale.getdefaultlocale()`;
    // mochi explicitly does NOT — locale must come from the matrix or it is
    // omitted (so a missing matrix.locale shows up as a profile-data bug
    // rather than masquerading as host-locale leakage).
    const args = buildChromiumArgs(baseCfg(), FAKE_UDD, process.env.MOCHI_EXTRA_ARGS);
    expect(args.some((a) => a.startsWith("--lang="))).toBe(false);
  });

  it("places --lang BEFORE extraArgs so a user override wins last-occurrence", () => {
    const args = buildChromiumArgs(
      baseCfg({ locale: "en-US", extraArgs: ["--lang=fr-FR"] }),
      FAKE_UDD,
      undefined,
    );
    const matrixIdx = args.indexOf("--lang=en-US");
    const overrideIdx = args.indexOf("--lang=fr-FR");
    expect(matrixIdx).toBeGreaterThanOrEqual(0);
    expect(overrideIdx).toBeGreaterThan(matrixIdx);
  });

  it("emits --lang under --headless=new (flag is honored in modern headless)", () => {
    // Chromium's `--lang` drives `ICU::Locale::Default` and the I/O thread's
    // request-context Accept-Language; both run regardless of headless mode.
    // We assert co-presence — the spawn path emits both flags together.
    const args = buildChromiumArgs(
      baseCfg({ locale: "en-US", headless: true }),
      FAKE_UDD,
      process.env.MOCHI_EXTRA_ARGS,
    );
    expect(args).toContain("--headless=new");
    expect(args).toContain("--lang=en-US");
  });
});

describe("buildChromiumArgs / MOCHI_EXTRA_ARGS env var", () => {
  let prev: string | undefined;
  beforeEach(() => {
    prev = process.env.MOCHI_EXTRA_ARGS;
  });
  afterEach(() => {
    if (prev === undefined) delete process.env.MOCHI_EXTRA_ARGS;
    else process.env.MOCHI_EXTRA_ARGS = prev;
  });

  it("appends whitespace-separated env args after locale + extraArgs", () => {
    process.env.MOCHI_EXTRA_ARGS = "--no-sandbox  --disable-gpu";
    const args = buildChromiumArgs(
      baseCfg({ locale: "en-US" }),
      FAKE_UDD,
      process.env.MOCHI_EXTRA_ARGS,
    );
    expect(args).toContain("--no-sandbox");
    expect(args).toContain("--disable-gpu");
    // env extras come last, after the matrix-derived --lang.
    const langIdx = args.indexOf("--lang=en-US");
    const noSandboxIdx = args.indexOf("--no-sandbox");
    expect(noSandboxIdx).toBeGreaterThan(langIdx);
  });

  it("ignores MOCHI_EXTRA_ARGS when set to empty / whitespace-only", () => {
    process.env.MOCHI_EXTRA_ARGS = "   ";
    const args = buildChromiumArgs(baseCfg(), FAKE_UDD, process.env.MOCHI_EXTRA_ARGS);
    expect(args.some((a) => a === "")).toBe(false);
  });
});

// =============================================================================
// Task 0252 (window-size + start-maximized scrub) — keeps its own describe
// block. Uses the same FAKE_UDD const as the locale tests above; the helper
// `baseCfg` from line 22 satisfies all configs needed below (no second helper).
// =============================================================================

describe("buildChromiumArgs — task 0252 (window-size + start-maximized scrub)", () => {
  it("emits --window-size=<W>,<H> when windowSize is well-formed", () => {
    const args = buildChromiumArgs(
      baseCfg({ windowSize: { width: 1728, height: 1117 } }),
      FAKE_UDD,
      undefined,
    );
    expect(args).toContain("--window-size=1728,1117");
  });

  it("omits --window-size when windowSize is undefined (matrix-canonical, no fallback)", () => {
    const args = buildChromiumArgs(baseCfg(), FAKE_UDD, undefined);
    expect(args.some((a) => a.startsWith("--window-size="))).toBe(false);
  });

  it("omits --window-size when dimensions are non-integer / non-positive / NaN", () => {
    for (const ws of [
      { width: 0, height: 1117 },
      { width: 1728, height: 0 },
      { width: -1, height: 1117 },
      { width: 1728.5, height: 1117 },
      { width: Number.NaN, height: 1117 },
      { width: Number.POSITIVE_INFINITY, height: 1117 },
    ] as const) {
      const args = buildChromiumArgs(baseCfg({ windowSize: ws }), FAKE_UDD, undefined);
      expect(args.some((a) => a.startsWith("--window-size="))).toBe(false);
    }
  });

  it("strips --start-maximized from extraArgs (task 0252 #3 — UDC adds it; mochi must not)", () => {
    const args = buildChromiumArgs(
      baseCfg({ extraArgs: ["--start-maximized", "--no-sandbox"] }),
      FAKE_UDD,
      undefined,
    );
    expect(args).not.toContain("--start-maximized");
    expect(args).toContain("--no-sandbox");
  });

  it("strips --start-maximized=<value> form from extraArgs", () => {
    const args = buildChromiumArgs(
      baseCfg({ extraArgs: ["--start-maximized=1", "--lang=en-US"] }),
      FAKE_UDD,
      undefined,
    );
    expect(args.some((a) => a.startsWith("--start-maximized"))).toBe(false);
    expect(args).toContain("--lang=en-US");
  });

  it("strips --start-maximized from MOCHI_EXTRA_ARGS env split", () => {
    const args = buildChromiumArgs(baseCfg(), FAKE_UDD, "--start-maximized --no-sandbox --foo=bar");
    expect(args).not.toContain("--start-maximized");
    expect(args).toContain("--no-sandbox");
    expect(args).toContain("--foo=bar");
  });

  it("appends --headless=new when headless is true", () => {
    const args = buildChromiumArgs(baseCfg({ headless: true }), FAKE_UDD, undefined);
    expect(args).toContain("--headless=new");
  });

  it("places --user-data-dir as the first arg", () => {
    const args = buildChromiumArgs(baseCfg(), FAKE_UDD, undefined);
    expect(args[0]).toBe(`--user-data-dir=${FAKE_UDD}`);
  });

  it("emits --proxy-server when proxy is set", () => {
    const args = buildChromiumArgs(
      baseCfg({ proxy: "http://127.0.0.1:8080" }),
      FAKE_UDD,
      undefined,
    );
    expect(args).toContain("--proxy-server=http://127.0.0.1:8080");
  });

  it("does NOT include --start-maximized in the default flag set", () => {
    // Defensive: if anyone ever adds it to DEFAULT_CHROMIUM_FLAGS, this fails.
    const args = buildChromiumArgs(baseCfg(), FAKE_UDD, undefined);
    expect(args.some((a) => a.startsWith("--start-maximized"))).toBe(false);
  });
});

// =============================================================================
// Task 0256 (default Chromium flags audit + hermetic-mode knob)
//
// Verifies the production / hermetic split. Production drops passive
// command-line bot-tells (`--disable-component-update`,
// `--disable-default-apps`, `--disable-background-networking`,
// `--disable-sync`) per patchright `chromiumSwitchesPatch.ts:20-34`;
// hermetic re-applies them for harness / CI / capture flows.
// =============================================================================

describe("buildChromiumArgs — task 0256 (hermetic-mode knob)", () => {
  it("does NOT emit any HERMETIC_ONLY_CHROMIUM_FLAGS entry when hermetic is unset", () => {
    const args = buildChromiumArgs(baseCfg(), FAKE_UDD, undefined);
    for (const flag of HERMETIC_ONLY_CHROMIUM_FLAGS) {
      expect(args).not.toContain(flag);
    }
  });

  it("does NOT emit any HERMETIC_ONLY_CHROMIUM_FLAGS entry when hermetic is false", () => {
    const args = buildChromiumArgs(baseCfg({ hermetic: false }), FAKE_UDD, undefined);
    for (const flag of HERMETIC_ONLY_CHROMIUM_FLAGS) {
      expect(args).not.toContain(flag);
    }
  });

  it("emits every HERMETIC_ONLY_CHROMIUM_FLAGS entry when hermetic is true", () => {
    const args = buildChromiumArgs(baseCfg({ hermetic: true }), FAKE_UDD, undefined);
    for (const flag of HERMETIC_ONLY_CHROMIUM_FLAGS) {
      expect(args).toContain(flag);
    }
  });

  it("preserves DEFAULT_CHROMIUM_FLAGS in hermetic mode (additive, not replacement)", () => {
    const args = buildChromiumArgs(baseCfg({ hermetic: true }), FAKE_UDD, undefined);
    for (const flag of DEFAULT_CHROMIUM_FLAGS) {
      expect(args).toContain(flag);
    }
  });

  it("DEFAULT_CHROMIUM_FLAGS does not contain any patchright-trim cmdline tell", () => {
    // Belt + braces: the production default must not regress on the audit.
    expect(DEFAULT_CHROMIUM_FLAGS).not.toContain("--disable-component-update");
    expect(DEFAULT_CHROMIUM_FLAGS).not.toContain("--disable-default-apps");
    expect(DEFAULT_CHROMIUM_FLAGS).not.toContain("--disable-background-networking");
    expect(DEFAULT_CHROMIUM_FLAGS).not.toContain("--disable-sync");
  });

  it("DEFAULT_CHROMIUM_FLAGS does not contain --no-sandbox or AutomationControlled", () => {
    // Per PLAN.md §8.6 — both are explicitly out of defaults.
    expect(DEFAULT_CHROMIUM_FLAGS).not.toContain("--no-sandbox");
    expect(DEFAULT_CHROMIUM_FLAGS).not.toContain("--disable-blink-features=AutomationControlled");
    expect(HERMETIC_ONLY_CHROMIUM_FLAGS).not.toContain("--no-sandbox");
    expect(HERMETIC_ONLY_CHROMIUM_FLAGS).not.toContain(
      "--disable-blink-features=AutomationControlled",
    );
  });

  it("hermetic flags are appended AFTER defaults but before --headless / extras", () => {
    const args = buildChromiumArgs(
      baseCfg({ hermetic: true, headless: true, extraArgs: ["--foo"] }),
      FAKE_UDD,
      undefined,
    );
    const lastDefaultIdx = args.indexOf("--enable-features=NetworkService,NetworkServiceInProcess");
    const firstHermeticIdx = args.indexOf("--disable-default-apps");
    const headlessIdx = args.indexOf("--headless=new");
    const extrasIdx = args.indexOf("--foo");
    expect(firstHermeticIdx).toBeGreaterThan(lastDefaultIdx);
    expect(headlessIdx).toBeGreaterThan(firstHermeticIdx);
    expect(extrasIdx).toBeGreaterThan(headlessIdx);
  });
});

/**
 * Diagnostic-tail classifier — Locks the two patterns we currently
 * surface (root-sandbox refusal and missing shared libs) against regressions
 * without spawning a real Chromium.
 */
describe("diagnoseEarlyExitTail", () => {
  it("returns the empty string when no known pattern matches", () => {
    expect(diagnoseEarlyExitTail("some unrelated stderr noise")).toBe("");
    expect(diagnoseEarlyExitTail("")).toBe("");
  });

  it("emits the root-sandbox hint for the canonical Chromium message", () => {
    const tail =
      "[1234:1234:0508/120000.000:ERROR:zygote_host_impl_linux.cc(90)] " +
      "Running as root without --no-sandbox is not supported. See " +
      "https://crbug.com/638180.";
    const hint = diagnoseEarlyExitTail(tail);
    expect(hint).toContain("Chromium refuses to start as root");
    expect(hint).toContain("Run as a non-root user");
    expect(hint).toContain("chrome-sandbox");
    expect(hint).toContain("--no-sandbox");
  });

  it("emits the missing-lib hint with the offending .so name", () => {
    const tail =
      "chrome: error while loading shared libraries: libnss3.so: " +
      "cannot open shared object file: No such file or directory";
    const hint = diagnoseEarlyExitTail(tail);
    expect(hint).toContain("libnss3.so");
    expect(hint).toContain("Chromium failed to load a system library");
    expect(hint).toContain("mochi browsers install");
    expect(hint).toContain("https://mochijs.com/docs/getting-started/install");
  });

  it("prefers the root-sandbox hint when both patterns are present (root surfaces first)", () => {
    // Defensive: a misconfigured rootful container could plausibly hit both;
    // surface the root one because that's the load-bearing fix.
    const tail =
      "Running as root without --no-sandbox is not supported.\n" +
      "error while loading shared libraries: libnss3.so: cannot open ...";
    const hint = diagnoseEarlyExitTail(tail);
    expect(hint).toContain("Chromium refuses to start as root");
    expect(hint).not.toContain("libnss3.so");
  });

  it("emits the AppArmor user-namespace hint for the canonical 'No usable sandbox' message (issue #52)", () => {
    // The exact stderr emitted by Chromium on Kubuntu 25.10 — captured
    // verbatim in the issue report.
    const tail =
      "[759176:759176:0511/132845.681682:FATAL:content/browser/zygote_host/" +
      "zygote_host_impl_linux.cc:128] No usable sandbox! If you are running on " +
      "Ubuntu 23.10+ or another Linux distro that has disabled unprivileged user " +
      "namespaces with AppArmor, see ...";
    const hint = diagnoseEarlyExitTail(tail);
    expect(hint).toContain("user-namespace sandbox cannot initialize");
    expect(hint).toContain("apparmor_restrict_unprivileged_userns");
    expect(hint).toContain("Install an AppArmor profile");
    expect(hint).toContain("--no-sandbox");
  });
});
