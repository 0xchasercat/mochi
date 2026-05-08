/**
 * Unit tests for `buildChromiumArgs` — the pure arg-vector builder shared
 * between `spawnChromium` and the launcher's flag-plumbing tests. We do NOT
 * spawn a real Chromium here; the goal is to lock the flag set against
 * regressions, particularly the matrix-derived `--lang=<locale>` flag that
 * closes the I-5 leak between Chromium's network-layer `Accept-Language`
 * header and the JS-layer `navigator.language(s)` spoof (task 0251).
 *
 * The flag is sourced from `MatrixV1.locale` (the canonical primary BCP-47
 * string) and MUST come from the matrix, never from the host OS.
 *
 * @see packages/core/src/proc.ts
 * @see PLAN.md §8.6 (DEFAULT_CHROMIUM_FLAGS), §2 I-5
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { buildChromiumArgs, DEFAULT_CHROMIUM_FLAGS, type SpawnConfig } from "../proc";

const FAKE_BINARY = "/usr/bin/chromium-stub";
const FAKE_UDD = "/tmp/mochi-test-udd";

function baseCfg(overrides: Partial<SpawnConfig> = {}): SpawnConfig {
  return { binary: FAKE_BINARY, headless: false, ...overrides };
}

describe("buildChromiumArgs / baseline", () => {
  it("includes every DEFAULT_CHROMIUM_FLAGS entry verbatim", () => {
    const args = buildChromiumArgs(baseCfg(), FAKE_UDD);
    for (const flag of DEFAULT_CHROMIUM_FLAGS) {
      expect(args).toContain(flag);
    }
  });

  it("puts --user-data-dir first so user-supplied args cannot override it", () => {
    const args = buildChromiumArgs(baseCfg(), FAKE_UDD);
    expect(args[0]).toBe(`--user-data-dir=${FAKE_UDD}`);
  });

  it("does NOT include --headless=new when headless is false", () => {
    const args = buildChromiumArgs(baseCfg({ headless: false }), FAKE_UDD);
    expect(args).not.toContain("--headless=new");
  });

  it("includes --headless=new when headless is true", () => {
    const args = buildChromiumArgs(baseCfg({ headless: true }), FAKE_UDD);
    expect(args).toContain("--headless=new");
  });

  it("appends --proxy-server when proxy is set", () => {
    const args = buildChromiumArgs(baseCfg({ proxy: "http://proxy.example:8080" }), FAKE_UDD);
    expect(args).toContain("--proxy-server=http://proxy.example:8080");
  });

  it("does NOT include --proxy-server when proxy is empty / undefined", () => {
    const args = buildChromiumArgs(baseCfg({ proxy: "" }), FAKE_UDD);
    expect(args.some((a) => a.startsWith("--proxy-server"))).toBe(false);
  });
});

describe("buildChromiumArgs / --lang (task 0251 — matrix.locale → Accept-Language)", () => {
  it("appends --lang=<value> when locale is set", () => {
    const args = buildChromiumArgs(baseCfg({ locale: "en-US" }), FAKE_UDD);
    expect(args).toContain("--lang=en-US");
  });

  it("preserves the BCP-47 hyphen / region casing exactly as supplied", () => {
    // Chromium accepts the BCP-47 form verbatim; we MUST NOT lowercase the
    // region tag (e.g. "en-US" vs "en-us") because Chromium's `Accept-Language`
    // derivation respects the exact casing of the value.
    const args = buildChromiumArgs(baseCfg({ locale: "pt-BR" }), FAKE_UDD);
    expect(args).toContain("--lang=pt-BR");
    expect(args).not.toContain("--lang=pt-br");
  });

  it("does NOT include --lang when locale is undefined", () => {
    const args = buildChromiumArgs(baseCfg(), FAKE_UDD);
    expect(args.some((a) => a.startsWith("--lang"))).toBe(false);
  });

  it("does NOT include --lang when locale is the empty string", () => {
    const args = buildChromiumArgs(baseCfg({ locale: "" }), FAKE_UDD);
    expect(args.some((a) => a.startsWith("--lang"))).toBe(false);
  });

  it("does NOT silently fall back to host locale (we are not udc)", () => {
    // udc's `__init__.py:359-369` falls back to `locale.getdefaultlocale()`;
    // mochi explicitly does NOT — locale must come from the matrix or it is
    // omitted (so a missing matrix.locale shows up as a profile-data bug
    // rather than masquerading as host-locale leakage).
    const args = buildChromiumArgs(baseCfg(), FAKE_UDD);
    expect(args.some((a) => a.startsWith("--lang="))).toBe(false);
  });

  it("places --lang BEFORE extraArgs so a user override wins last-occurrence", () => {
    const args = buildChromiumArgs(
      baseCfg({ locale: "en-US", extraArgs: ["--lang=fr-FR"] }),
      FAKE_UDD,
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
    const args = buildChromiumArgs(baseCfg({ locale: "en-US", headless: true }), FAKE_UDD);
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
    const args = buildChromiumArgs(baseCfg({ locale: "en-US" }), FAKE_UDD);
    expect(args).toContain("--no-sandbox");
    expect(args).toContain("--disable-gpu");
    // env extras come last, after the matrix-derived --lang.
    const langIdx = args.indexOf("--lang=en-US");
    const noSandboxIdx = args.indexOf("--no-sandbox");
    expect(noSandboxIdx).toBeGreaterThan(langIdx);
  });

  it("ignores MOCHI_EXTRA_ARGS when set to empty / whitespace-only", () => {
    process.env.MOCHI_EXTRA_ARGS = "   ";
    const args = buildChromiumArgs(baseCfg(), FAKE_UDD);
    expect(args.some((a) => a === "")).toBe(false);
  });
});
