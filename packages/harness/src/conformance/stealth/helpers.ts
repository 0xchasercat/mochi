/**
 * Shared helpers for the stealth conformance suite.
 *
 * Mirrors CloakBrowser's `tests/test_stealth.py` `@pytest.fixture(scope="module")
 * browser` pattern: one Mochi `Session` per `describe` block, one fresh
 * `Page` per `it`. Centralizes:
 *   - `launchSharedSession()` — builds a real `mochi.launch` against
 *     `mac-m4-chrome-stable`, honoring `MOCHI_CHROMIUM_PATH`.
 *   - `withPage(session, fn)` — page lifecycle wrapper that closes the
 *     page on test exit (mirroring CloakBrowser's `page` fixture).
 *   - `evalInPage(page, expr)` — Python-style expression eval, since
 *     CloakBrowser writes `page.evaluate("navigator.webdriver")` whereas
 *     mochi's `page.evaluate(fn)` takes a function. We wrap as
 *     `() => (expr)` for parity with the upstream shape.
 *   - `evalFn(page, fn)` — direct function-form eval, for the multiline
 *     CloakBrowser tests (e.g. `test_cdp_not_detected`).
 *   - `withRetries(fn, n)` — flake guard (the brief calls for 3x re-run
 *     before triaging an offline failure).
 *
 * @see tests/fixtures/cloakbrowser/test_stealth.py
 */

import { existsSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { defaultProfileForHost, mochi, type Page, type Session } from "@mochi.js/core";
import { loadProfile } from "../../run";

/**
 * Default profile id for the conformance suite — host-OS-matched.
 *
 * CI runs on Linux x86_64; local dev runs on Mac (M4 / Intel) or Windows.
 * Loading a profile whose OS doesn't match the runtime is detectable: the
 * spoofed UA / canvas / audio / WebGL all say "Mac" while the underlying
 * Chromium binary's TLS handshake, font list, and platform-specific media
 * device IDs say "Linux". Cloudflare Turnstile catches that mismatch and
 * refuses to issue a token, which had been silently masked pre-0.8 by a
 * placeholder that always returned Linux regardless of the requested id.
 *
 * `defaultProfileForHost()` consults the same decision table that
 * `mochi.launch({ profile: undefined })` uses, so dev + CI are aligned.
 * Falls back to `mac-m4-chrome-stable` for unsupported hosts (the prior
 * hardcoded value) so nothing breaks for exotic platforms.
 */
export const CONFORMANCE_PROFILE = defaultProfileForHost() ?? "mac-m4-chrome-stable";

/** Default seed — stable per (profile, conformance-run). */
export const CONFORMANCE_SEED = "stealth-conformance";

/**
 * Required env to run the conformance suite. Mirrors the existing harness
 * E2E gate's gating: tests are `describe.skip` unless `MOCHI_E2E=1`.
 */
export const E2E_ENABLED = process.env.MOCHI_E2E === "1";

/**
 * Network-gated — only when `MOCHI_ONLINE=1` AND `MOCHI_E2E=1`.
 */
export const ONLINE_ENABLED = E2E_ENABLED && process.env.MOCHI_ONLINE === "1";

/**
 * Launch a Mochi `Session` for the conformance profile with full inject
 * pipeline active. Honors:
 *   - `MOCHI_CHROMIUM_PATH` — same env the rest of the harness reads.
 *   - `MOCHI_PROXY` — proxy URL passed straight to `mochi.launch({ proxy })`.
 *     The string form auto-parses, so credentials in the URL
 *     (`http://user:pass@host:port` or `socks5://...`) flow through to
 *     the CDP `Fetch.authRequired` handler. Empty / unset = no proxy.
 *
 * Runs headless by default.
 */
export async function launchSharedSession(): Promise<Session> {
  const profile = await loadProfile(profileDir(CONFORMANCE_PROFILE));
  const binary = process.env.MOCHI_CHROMIUM_PATH;
  const proxy = process.env.MOCHI_PROXY;
  const launchOpts: Parameters<typeof mochi.launch>[0] = {
    profile,
    seed: CONFORMANCE_SEED,
    headless: true,
    // Conformance runs are hermetic: re-apply the harness-only flags so
    // updater/sync traffic doesn't pollute the stealth surface or destabilise
    // reruns. Production `mochi.launch()` callers get the cleaner default
    // flag set (no command-line bot-tells).
    hermetic: true,
  };
  if (binary !== undefined && binary.length > 0) {
    (launchOpts as { binary?: string }).binary = binary;
  }
  // Empty-string check is load-bearing — fork PRs / dev envs without the
  // secret get an empty value here, and the test must still run unproxied.
  if (proxy !== undefined && proxy.length > 0) {
    (launchOpts as { proxy?: string }).proxy = proxy;
  }
  return mochi.launch(launchOpts);
}

/**
 * Page lifecycle wrapper. Mirrors CloakBrowser's `page` fixture.
 *
 * Usage:
 *   ```ts
 *   await withPage(session, async (page) => {
 *     await page.goto("about:blank");
 *     expect(await evalExpr(page, "navigator.webdriver")).toBe(false);
 *   });
 *   ```
 */
export async function withPage<T>(session: Session, fn: (page: Page) => Promise<T>): Promise<T> {
  const page = await session.newPage();
  try {
    return await fn(page);
  } finally {
    await page.close().catch(() => {
      // Page close errors during teardown are not actionable here — the
      // session-level close in afterAll() will surface them if relevant.
    });
  }
}

/**
 * Evaluate a JS *expression* in the page (CloakBrowser's
 * `page.evaluate("navigator.webdriver")` shape) by wrapping it in a
 * `() => (expr)` call — mochi's `page.evaluate(fn)` only accepts a
 * function with no args.
 *
 * Returns the JSON-serialized result.
 */
export async function evalExpr<T>(page: Page, expr: string): Promise<T> {
  // We use the Function constructor to build a function from the textual
  // expression. The function is then `.toString()`-ed by mochi's
  // `page.evaluate` and shipped via `Runtime.callFunctionOn`. This keeps
  // the suite's source readable AND preserves CloakBrowser's literal
  // assertion semantics.
  //
  // NB: the evaluator runs in the page's main world, so `expr` resolves
  // against the page's globals (window/navigator/document/etc.) — exactly
  // like Python's `page.evaluate("...")`.
  const fnSrc = `function() { return (${expr}); }`;
  // biome-ignore lint/suspicious/noExplicitAny: function type is opaque to TS here
  const fn = new Function(`return ${fnSrc}`)() as () => any;
  return page.evaluate<T>(fn);
}

/**
 * Run an asynchronous test up to `attempts` times (default 3) before
 * declaring real failure. The brief's flake-guard: a one-off failure on
 * an offline test is re-tried before we triage it as a real bug.
 *
 * The function should `throw` (or `expect().toBe()` should throw) on
 * failure; resolved values are returned from the last successful attempt.
 */
export async function withRetries<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      // Exponential backoff: 250ms, 500ms, 1000ms.
      if (i < attempts - 1) {
        await sleep(250 * 2 ** i);
      }
    }
  }
  throw lastErr instanceof Error
    ? lastErr
    : new Error(`[stealth conformance] retried ${attempts}x — ${String(lastErr)}`);
}

/** Bun-friendly sleep. */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---- profile dir resolution -------------------------------------------------

function profileDir(id: string): string {
  const root = findRepoRoot(process.cwd());
  if (root === null) {
    throw new Error(
      `[stealth conformance] could not locate the mochi repo root from ${process.cwd()}.`,
    );
  }
  return join(root, "packages", "profiles", "data", id);
}

function findRepoRoot(start: string): string | null {
  let dir = isAbsolute(start) ? start : join(process.cwd(), start);
  for (let i = 0; i < 32; i++) {
    if (existsSync(join(dir, "scripts", "mochi-work.ts"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
  return null;
}
