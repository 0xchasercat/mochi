/**
 * Chromium process lifecycle.
 *
 * Owns spawn (Bun.spawn with pipe-mode FDs 3+4), stdio bookkeeping, graceful
 * shutdown (SIGTERM → 2s grace → SIGKILL), and ephemeral user-data-dir cleanup.
 *
 * @see PLAN.md §8.5 / §8.6
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PipeReader, PipeWriter } from "./cdp/transport";

/**
 * The chromium flags PLAN.md §8.6 mandates we always pass in PRODUCTION
 * (non-hermetic) mode. Trimmed against patchright's
 * `chromiumSwitchesPatch.ts:20-34` removal list: every flag
 * here passes two tests — (a) it isn't a passive command-line bot-tell that
 * patchright explicitly drops, AND (b) we have a concrete production reason
 * to keep it (CDP transport, UI suppression that matters in headed mode,
 * keychain/keyring, or load-bearing for inject reach).
 *
 * Flags moved to {@link HERMETIC_ONLY_CHROMIUM_FLAGS} (re-applied when
 * `LaunchOptions.hermetic === true`):
 *   - `--disable-component-update`  — patchright drops; cmdline tell.
 *   - `--disable-default-apps`      — patchright drops; cmdline tell.
 *   - `--disable-background-networking` — patchright drops; updater-traffic suppressor.
 *   - `--disable-sync`              — patchright drops; cmdline tell.
 *   - `--disable-features` extras   — `OptimizationHints,MediaRouter,
 *     InterestFeedContentSuggestions,CalculateNativeWinOcclusion` are
 *     network/noise suppressors valid only for hermetic harness/CI runs;
 *     real users want the natural network surface so the production list
 *     keeps just the load-bearing entries.
 *
 * Production `--disable-features=` keepers + rationale:
 *   - `Translate`            — suppresses the translate-prompt UI bar that
 *                              would surface in headed mode.
 *   - `AcceptCHFrame`        — keeps UA-CH negotiation off the frame path
 *                              so our `Sec-CH-UA` headers (R-007) stay the
 *                              single source of truth.
 *   - `IsolateOrigins,site-per-process` — load-bearing for inject reach:
 *                              mochi doesn't yet resolve cross-origin OOPIF
 *                              contexts, so disabling site isolation keeps
 *                              cross-origin frames in the same renderer
 *                              process where `addScriptToEvaluateOnNewDocument`
 *                              actually runs.
 *
 * Order does not matter; Chromium accepts late-arriving overrides for most
 * flags but we never override these.
 *
 * @see PLAN.md §8.6 (decision ledger).
 * @see docs/audits/patchright.md MED finding (chromiumSwitchesPatch.ts:20-34).
 * @see docs/audits/puppeteer-real-browser.md LOW finding (lib/cjs/index.js:57-58).
 */
export const DEFAULT_CHROMIUM_FLAGS: readonly string[] = [
  "--remote-debugging-pipe",
  "--no-default-browser-check",
  "--no-first-run",
  "--no-service-autorun",
  "--password-store=basic",
  "--use-mock-keychain",
  "--disable-features=Translate,AcceptCHFrame,IsolateOrigins,site-per-process",
  "--enable-features=NetworkService,NetworkServiceInProcess",
];

/**
 * Flags re-applied on top of {@link DEFAULT_CHROMIUM_FLAGS} when
 * `LaunchOptions.hermetic === true`. The harness fixture matrix, CI runs,
 * and capture flows pair `bypassInject: true` with `hermetic: true` so
 * baseline collection isn't perturbed by updater traffic, default-apps
 * auto-install, sync, or feed prefetches.
 *
 * Production users (the non-hermetic default) get a clean production flag
 * set: no obvious cmdline tells, normal-looking updater + sync traffic.
 *
 * Each entry here was either explicitly removed by patchright as a passive
 * bot-tell (`--disable-component-update`, `--disable-default-apps`,
 * `--disable-background-networking`, `--disable-sync`) or is a noise-
 * reduction `--disable-features=` token whose suppression is desirable for
 * hermetic determinism but undesirable for production stealth.
 *
 * The hermetic `--disable-features=` token is appended SEPARATELY from the
 * production one — Chromium merges multiple `--disable-features=` flags on
 * the command line into a union, so the final disabled set is
 * `{Translate,AcceptCHFrame,IsolateOrigins,site-per-process} ∪
 *  {OptimizationHints,MediaRouter,InterestFeedContentSuggestions,
 *   CalculateNativeWinOcclusion}`. Keeping them separate makes the
 * production-only subset legible and avoids fingerprintable list-order
 * coincidence with Playwright defaults.
 */
export const HERMETIC_ONLY_CHROMIUM_FLAGS: readonly string[] = [
  "--disable-default-apps",
  "--disable-component-update",
  "--disable-background-networking",
  "--disable-sync",
  "--disable-features=OptimizationHints,MediaRouter,InterestFeedContentSuggestions,CalculateNativeWinOcclusion",
];

const SIGTERM_GRACE_MS = 2000;

/**
 * Public knobs surfaced through `LaunchOptions`. Held here so `launch.ts` can
 * pass a small immutable record into `spawnChromium` without leaking the full
 * options shape.
 */
export interface SpawnConfig {
  binary: string;
  /** User-supplied extra flags appended after the defaults. Null to skip. */
  extraArgs?: readonly string[];
  /**
   * Legacy boolean knob. `true` → emit `--headless=new`. Retained for
   * backward compatibility with v0.1 callers. New code should set
   * {@link headlessMode} instead — it carries strictly more information
   * (`"new" | "legacy" | "off"`) and supersedes this field when both are set.
   */
  headless: boolean;
  /**
   * Headless dispatch mode. Takes precedence over {@link headless} when set.
   *
   *   - `"new"`    → emit `--headless=new` (modern headless: full rendering,
   *                  near-byte-identical to headful for fingerprinting).
   *   - `"legacy"` → emit bare `--headless` (legacy headless code path; more
   *                  detectable but useful for parity with older tooling).
   *   - `"off"`    → emit no headless flag (run headful — requires a display
   *                  server / xvfb).
   *
   * Resolution at the launch layer:
   *
   *   1. If the caller passes `headlessMode` explicitly, it wins.
   *   2. Else if the caller passes the legacy `headless: true | false`, it
   *      maps to `"new"` / `"off"` respectively.
   *   3. Else the launcher inspects the live env: Linux without DISPLAY /
   *      WAYLAND_DISPLAY → `"new"`; everywhere else → `"off"`.
   *
   * @see tasks/0258 (Linux server env auto-detection)
   * @see docs/getting-started/linux-server.md
   */
  headlessMode?: "new" | "legacy" | "off";
  /** Optional proxy server, e.g. "http://host:port" or "socks5://host:port". */
  proxy?: string;
  /**
   * Opt out of mochi's "auto-add `--no-sandbox` when running as root on Linux"
   * fallback. Chromium refuses to launch as root with the user-namespace
   * sandbox enabled; mochi normally injects `--no-sandbox` (with a warning)
   * so the launch succeeds. Set to `true` if you have a working
   * `chrome-sandbox` SUID helper and want to keep the sandbox under root —
   * the launch will then crash with the original `EPIPE` if the SUID setup
   * is wrong. PLAN.md §8.6 + `docs/quickstart.md` "Linux gotcha — Chromium
   * and root".
   */
  allowRootWithSandbox?: boolean;
  /**
   * Primary BCP-47 locale for the spawned Chromium. Passed as `--lang=<value>`
   * so Chromium's network stack derives an `Accept-Language` header that
   * agrees with the JS-layer `navigator.language(s)` spoof. Without this,
   * Chromium falls back to the host OS locale (or `en-US,en;q=0.9`), which a
   * site can cross-reference against `navigator.languages` to detect the
   * mismatch — direct PLAN.md I-5 violation.
   *
   * Sourced from `MatrixV1.locale` (the canonical primary BCP-47 string,
   * e.g. `"en-US"`). Multi-locale `Accept-Language` q-weighting is derived
   * by Chromium itself from this single primary; the broader list is
   * surfaced separately via the JS-side `navigator.languages` spoof.
   *
   * Honored under `--headless=new` — the flag drives `ICU::Locale::Default`
   * and `IOThread::Globals::system_request_context_->set_accept_language()`,
   * both of which run regardless of headless mode.
   *
   * Source-cited from undetected-chromedriver `__init__.py:359-369` (which
   * falls back to `locale.getdefaultlocale()` → `en-US`); we deliberately
   * do NOT fall back to host locale — locale must come from the matrix.
   */
  locale?: string;
  /**
   * Outer window geometry to pin via `--window-size=<width>,<height>`. When
   * supplied, Chromium's OS-level outer-window dimensions match the spoofed
   * `screen.*` so `window.outerWidth/outerHeight` (read at the OS level
   * under `--headless=new`) don't expose the default 800×600 leak that
   * `fingerprint-scan.com` flags. Both dimensions must be finite positive
   * integers; otherwise the flag is omitted. Sourced from
   * `matrix.display.{width,height}` by `launch.ts` — the matrix is canonical.
   *
   * @see UDC `__init__.py:410-411`, UDC issue #2242,
   */
  windowSize?: { width: number; height: number };
  /**
   * When `true`, re-apply {@link HERMETIC_ONLY_CHROMIUM_FLAGS} on top of
   * {@link DEFAULT_CHROMIUM_FLAGS}. Used by the harness, CI, and
   * `mochi capture` flows where update-checks, sync traffic, default-apps
   * auto-install, and feed prefetches would inject non-determinism.
   *
   * Defaults to `false` (production posture). Production users get the
   * cleaner flag set without obvious command-line bot-tells.
   *
   * Sourced from `LaunchOptions.hermetic` (see `launch.ts`). Pairs with
   * `bypassInject: true` for capture flows but is independent — a hermetic
   * launch with full inject is the harness's fingerprint-conformance run.
   *
   * @see task 0256, PLAN.md §8.6.
   */
  hermetic?: boolean;
}

/**
 * Flags we deliberately strip from any user-supplied extra args. UDC ships
 * with `--start-maximized`; mochi must not — it produces host-OS-dependent
 * geometry that drifts from the matrix's `display.*` spoof and re-introduces
 * the same outer-window mismatch `--window-size` is here to close.
 *
 * Applied to `extraArgs` and to the `MOCHI_EXTRA_ARGS` env split so users /
 * CI cannot accidentally re-introduce non-determinism.
 *
 * @see task 0252 success criterion #3.
 */
const FORBIDDEN_FLAG_PREFIXES: readonly string[] = ["--start-maximized"];

/**
 * The handle returned by {@link spawnChromium}. Owns the user-data-dir, the
 * subprocess, and the BunFile FD wrappers used by the CDP transport.
 */
export interface ChromiumProcess {
  /** Absolute path to the ephemeral user-data-dir. Removed on close(). */
  readonly userDataDir: string;
  /** OS process id for diagnostics. */
  readonly pid: number;
  /** Resolves to the exit code once the child terminates (normal or signaled). */
  readonly exited: Promise<number>;
  /** Pipe reader for the CDP transport (browser → us; FD 4). */
  readonly reader: PipeReader;
  /** Pipe writer for the CDP transport (us → browser; FD 3). */
  readonly writer: PipeWriter;
  /**
   * Graceful shutdown: SIGTERM, 2s grace, SIGKILL, then `rm -rf` the
   * user-data-dir. Idempotent; safe to call multiple times.
   */
  close(): Promise<void>;
}

/**
 * Build the full Chromium arg vector for a given spawn config + user-data-dir.
 *
 * Pure / synchronous so the launcher can unit-test the flag set without
 * spawning a real process. Order of pushes is documented in line — the only
 * load-bearing ordering is `--lang` BEFORE `extraArgs` so a deliberate
 * user-supplied `--lang=<override>` in `args` wins (Chromium honors last
 * occurrence on the command line for this flag).
 */
export async function spawnChromium(cfg: SpawnConfig): Promise<ChromiumProcess> {
  const userDataDir = await mkdtemp(join(tmpdir(), "mochi-"));
  const envExtra = process.env.MOCHI_EXTRA_ARGS;
  const args = buildChromiumArgs(cfg, userDataDir, envExtra);

  // Linux + uid 0 (root) + no `--no-sandbox` anywhere → Chromium will refuse
  // to start with the user-namespace sandbox. We auto-inject `--no-sandbox`
  // (with a one-line warning naming the fingerprint trade-off) instead of
  // letting `spawnChromium` crash with `EPIPE`. Users who explicitly want
  // the sandbox under root can either run as a non-root user, `chmod 4755`
  // the chrome-sandbox SUID helper, or pass their own `--no-sandbox` (which
  // we'd see in args and skip this branch).
  //
  // We DO NOT add `--no-sandbox` to DEFAULT_CHROMIUM_FLAGS (PLAN.md §8.6
  // explicitly omits it as a fingerprint leak). This is a runtime fallback,
  // not a default — only fires under the specific environment that would
  // otherwise crash. The fingerprint-leak risk is documented in
  // docs/quickstart.md "Linux gotcha — Chromium and root".
  if (
    process.platform === "linux" &&
    process.getuid?.() === 0 &&
    !args.some((a) => a === "--no-sandbox" || a.startsWith("--no-sandbox=")) &&
    !cfg.allowRootWithSandbox
  ) {
    console.warn(
      "[mochi] Detected root + Linux + missing --no-sandbox. " +
        "Auto-adding --no-sandbox so Chromium can launch. " +
        "This is a fingerprint leak per PLAN.md §8.6 — run as non-root or " +
        "use the chrome-sandbox SUID helper for stealth-critical workloads. " +
        "See docs/quickstart.md 'Linux gotcha — Chromium and root'. " +
        "Pass `allowRootWithSandbox: true` to mochi.launch() to opt out of this fallback.",
    );
    args.push("--no-sandbox");
  }

  const proc = Bun.spawn([cfg.binary, ...args], {
    // stdin, stdout, stderr, then two extra pipes for CDP framing.
    stdio: ["pipe", "pipe", "pipe", "pipe", "pipe"],
    // Chromium needs a real CWD for crash dumps etc; user-data-dir is fine.
    cwd: userDataDir,
  });

  const writeFd = proc.stdio[3];
  const readFd = proc.stdio[4];
  if (typeof writeFd !== "number" || typeof readFd !== "number") {
    proc.kill();
    await rm(userDataDir, { recursive: true, force: true }).catch(() => {});
    throw new Error(
      "[mochi] Bun.spawn did not return numeric FDs at stdio[3]/stdio[4]; cannot establish CDP pipe.",
    );
  }

  // Drain stderr so Chromium doesn't block writing diagnostics. We capture
  // the tail (last ~4KB) so the early-exit diagnostic below has something
  // human-readable to surface — e.g. Chromium's own
  // "Running as root without --no-sandbox is not supported" message.
  const stderrTail: string[] = [];
  void drainToText(proc.stderr, stderrTail);
  void drainToVoid(proc.stdout);

  // Diagnose early process death: Chromium that dies within ~750ms of spawn
  // is almost always failing on a startup precondition (sandbox refusal under
  // root, missing libs, malformed flags). We watch `proc.exited` race with
  // a short timer and surface a clearer error than the eventual EPIPE on the
  // first CDP write. See docs/quickstart.md "Linux gotcha — Chromium and root".
  const earlyExitCode = await Promise.race([
    proc.exited.then((c) => ({ kind: "exited" as const, code: c })),
    new Promise<{ kind: "alive" }>((resolve) => setTimeout(() => resolve({ kind: "alive" }), 750)),
  ]);
  if (earlyExitCode.kind === "exited") {
    await rm(userDataDir, { recursive: true, force: true }).catch(() => {});
    const tail = stderrTail.join("").trim().split("\n").slice(-12).join("\n");
    throw new Error(
      `[mochi] Chromium exited (code ${earlyExitCode.code}) within 750ms of spawn — ` +
        "the CDP pipe never opened. Most likely a startup precondition failure " +
        "(sandbox refusal, missing libs, malformed flags).\n\n" +
        `Stderr tail:\n${tail || "(empty)"}` +
        diagnoseEarlyExitTail(tail),
    );
  }

  // Build PipeReader/PipeWriter wrappers around the raw FDs.
  const writer: PipeWriter = (() => {
    const sink = Bun.file(writeFd).writer();
    return {
      write: (chunk) => sink.write(chunk),
      flush: () => sink.flush(),
      end: () => sink.end(),
    };
  })();

  const reader: PipeReader = {
    getReader: () => Bun.file(readFd).stream().getReader(),
  };

  let closing = false;
  const close = async (): Promise<void> => {
    if (closing) {
      // Wait until the in-flight close finishes.
      await proc.exited.catch(() => 0);
      return;
    }
    closing = true;
    // Try to flush+end the writer first so Chromium's read side sees EOF.
    try {
      await writer.end?.();
    } catch {
      // ignore
    }
    // SIGTERM, then 2s grace, then SIGKILL.
    try {
      proc.kill("SIGTERM");
    } catch {
      // process may have already exited
    }
    const timer = setTimeout(() => {
      try {
        proc.kill("SIGKILL");
      } catch {
        // ignore
      }
    }, SIGTERM_GRACE_MS);
    try {
      await proc.exited;
    } finally {
      clearTimeout(timer);
    }
    // Best-effort user-data-dir cleanup. Failures are non-fatal but logged.
    await rm(userDataDir, { recursive: true, force: true }).catch((err: unknown) => {
      console.warn(`[mochi] failed to remove user-data-dir ${userDataDir}:`, err);
    });
  };

  return {
    userDataDir,
    pid: proc.pid,
    exited: proc.exited,
    reader,
    writer,
    close,
  };
}

/**
 * Pure builder for the Chromium argv used by {@link spawnChromium}. Extracted
 * so tests can assert flag composition (window-size, headless, forbidden-flag
 * scrub, env extras) without spawning a real binary.
 *
 * @param cfg        — the {@link SpawnConfig} the caller passed.
 * @param userDataDir — absolute path to the ephemeral profile dir.
 * @param envExtra   — value of `MOCHI_EXTRA_ARGS` (pass `process.env.MOCHI_EXTRA_ARGS`
 *                    in production; tests pass a string or `undefined`).
 */
export function buildChromiumArgs(
  cfg: SpawnConfig,
  userDataDir: string,
  envExtra: string | undefined,
): string[] {
  const args: string[] = [`--user-data-dir=${userDataDir}`, ...DEFAULT_CHROMIUM_FLAGS];
  // Hermetic harness/CI escape hatch: re-apply the trim-list flags Chromium
  // would otherwise leak as passive bot-tells. Inserted directly after the
  // production defaults so the relative order is `defaults → hermetic-extras
  // → headless → proxy → lang → window-size → extras → env-extras` — i.e. a
  // user-supplied `--disable-features=…` in `extraArgs` still wins by virtue
  // of Chromium's last-occurrence semantics for repeated `--disable-features`
  // tokens (which are merged, not overwritten — but ordering matters for
  // tooling that greps argv).
  if (cfg.hermetic === true) {
    args.push(...HERMETIC_ONLY_CHROMIUM_FLAGS);
  }
  // Headless dispatch.
  //
  // `headlessMode` supersedes the legacy `headless: boolean` knob
  // when both are set. When `headlessMode` is unset, fall back to the v0.1
  // mapping (`headless: true → "new"`, `false → "off"`). The launcher in
  // `launch.ts` is responsible for the env-aware default ("new" on Linux
  // server, "off" on dev workstation with DISPLAY); by the time we reach
  // here, `headlessMode` is the resolved decision.
  //
  // `--headless=new` is the modern code path (full rendering, near-byte-
  // identical to headful for fingerprinting). The bare `--headless` is the
  // legacy mode — separate, more-detectable code path; we expose it for
  // parity-with-older-tooling needs but never default to it. Source-cited
  // from Chromium HeadlessShell `--headless=new` migration notes (Chromium
  // M118+).
  const mode = cfg.headlessMode ?? (cfg.headless ? "new" : "off");
  if (mode === "new") {
    args.push("--headless=new");
  } else if (mode === "legacy") {
    args.push("--headless");
  }
  // mode === "off" → no headless flag.
  if (cfg.proxy !== undefined && cfg.proxy.length > 0) {
    args.push(`--proxy-server=${cfg.proxy}`);
  }
  // Matrix-derived primary locale — feeds Chromium's `Accept-Language`
  // header so the network surface matches the JS-layer `navigator.language`
  // spoof (PLAN.md I-5). Pushed BEFORE `extraArgs` so a user-supplied
  // override in `args` can win on the command line if absolutely needed —
  // Chromium honors the last-occurrence on the line for `--lang`.
  if (cfg.locale !== undefined && cfg.locale.length > 0) {
    args.push(`--lang=${cfg.locale}`);
  }
  // `--window-size=<W>,<H>` — pin the OS-level outer window so
  // `window.outerWidth/outerHeight` match `matrix.display.*` instead of
  // Chromium's headless 800×600 default. The matrix is canonical: when
  // `display.{width,height}` is missing or non-finite we omit the flag
  // rather than fall back to a hardcoded value (a hardcoded value would
  // mismatch a profile that legitimately uses different dimensions).
  if (cfg.windowSize !== undefined) {
    const { width, height } = cfg.windowSize;
    if (
      Number.isFinite(width) &&
      Number.isFinite(height) &&
      Number.isInteger(width) &&
      Number.isInteger(height) &&
      width > 0 &&
      height > 0
    ) {
      args.push(`--window-size=${width},${height}`);
    }
  }
  if (cfg.extraArgs !== undefined && cfg.extraArgs.length > 0) {
    args.push(...stripForbiddenFlags(cfg.extraArgs));
  }
  // Whitespace-separated extra args from the environment. Same effect as
  // `LaunchOptions.args` but settable from outside the calling code — load-
  // bearing for CI environments that need `--no-sandbox` (Linux user-namespace
  // sandbox doesn't work in unprivileged containers / GH Actions runners) and
  // for ad-hoc local debugging without touching test fixtures. Production code
  // SHOULD NOT set this — `--no-sandbox` is a fingerprint leak in real-user
  // contexts. PLAN.md §8.6 explicitly omits it from DEFAULT_CHROMIUM_FLAGS.
  if (typeof envExtra === "string" && envExtra.trim().length > 0) {
    args.push(...stripForbiddenFlags(envExtra.trim().split(/\s+/)));
  }
  return args;
}

/**
 * Heuristic-classify a stderr tail from a Chromium that died within 750ms of
 * spawn and emit a remediation hint. Two patterns matter today:
 *
 *   1. "Running as root without --no-sandbox is not supported" — the user-
 *      namespace sandbox refusal under root. Fixes: non-root, SUID helper,
 *      or `--no-sandbox` (with the documented fingerprint cost).
 *   2. "error while loading shared libraries: <name>.so" — fresh Linux server
 *      without the Chromium runtime deps. Fix: apt-install the canonical dep
 *      list (full bytes live in `@mochi.js/cli/src/lib/linux-deps.ts` — we
 *      keep just a short pointer here because @mochi.js/core cannot depend on
 *      @mochi.js/cli without inverting the package graph).
 *
 * Returns the empty string when no pattern matches, in which case the caller
 * surfaces only the raw stderr tail. Exported for unit tests so we can lock
 * the regexes against regressions without spawning Chromium.
 *
 */
export function diagnoseEarlyExitTail(tail: string): string {
  if (/running.*root.*without.*--no-sandbox|--no-sandbox.*required/i.test(tail)) {
    return (
      "\n\nChromium refuses to start as root with the user-namespace sandbox enabled.\n" +
      "Fixes (preferred → workaround):\n" +
      "  1. Run as a non-root user.\n" +
      "  2. `chmod 4755 chrome-sandbox` on the SUID helper next to the CfT binary.\n" +
      "  3. Pass args: ['--no-sandbox'] to mochi.launch() — fingerprint leak (PLAN §8.6),\n" +
      "     OK for testing, not for stealth-critical production."
    );
  }
  const libMatch = /error while loading shared libraries:\s+([^\s:]+)/i.exec(tail);
  if (libMatch !== null) {
    const lib = libMatch[1] ?? "(unknown .so)";
    return (
      `\n\nChromium failed to load a system library: '${lib}'.\n` +
      "Chromium-for-Testing ships only the binary; on a fresh Linux server the\n" +
      "system libs Chromium links against are not preinstalled. Install the\n" +
      "canonical dep list with apt:\n\n" +
      "  bunx mochi browsers install   # re-run; the install command prints the\n" +
      "                                # exact apt line for your system.\n\n" +
      "Or install directly — full list at\n" +
      "  https://mochijs.com/docs/getting-started/install#linux-runtime-dependencies"
    );
  }
  return "";
}

/**
 * Drop any flag in `args` whose prefix matches {@link FORBIDDEN_FLAG_PREFIXES}.
 * Match is `=` / boundary-aware so `--start-maximized` and
 * `--start-maximized=1` both go, but `--start-maximized-foo` (hypothetical)
 * would not. Preserves order of surviving args.
 */
function stripForbiddenFlags(args: readonly string[]): string[] {
  return args.filter((arg) => {
    for (const prefix of FORBIDDEN_FLAG_PREFIXES) {
      if (arg === prefix) return false;
      if (arg.startsWith(`${prefix}=`)) return false;
    }
    return true;
  });
}

/** Read-and-discard a ReadableStream so Chromium's pipe buffers don't fill. */
async function drainToVoid(stream: ReadableStream<Uint8Array> | null): Promise<void> {
  if (stream === null) return;
  const reader = stream.getReader();
  try {
    while (true) {
      const { done } = await reader.read();
      if (done) return;
    }
  } catch {
    // ignore — stream errored or was cancelled
  } finally {
    reader.releaseLock();
  }
}

/**
 * Read a ReadableStream and append decoded chunks to `tail`, capping the
 * accumulated buffer to ~4KB so a chatty Chromium can't blow memory. Used
 * by `spawnChromium`'s early-exit diagnostic to recover the last few lines
 * of stderr from a process that died within 750ms of spawn.
 */
async function drainToText(
  stream: ReadableStream<Uint8Array> | null,
  tail: string[],
): Promise<void> {
  if (stream === null) return;
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let bufferedLen = 0;
  const cap = 4096;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return;
      if (value !== undefined) {
        const text = decoder.decode(value, { stream: true });
        tail.push(text);
        bufferedLen += text.length;
        // Trim from the front when over cap so we always keep the *tail*.
        while (bufferedLen > cap && tail.length > 1) {
          const dropped = tail.shift();
          bufferedLen -= dropped !== undefined ? dropped.length : 0;
        }
      }
    }
  } catch {
    // ignore — stream errored or was cancelled
  } finally {
    reader.releaseLock();
  }
}
