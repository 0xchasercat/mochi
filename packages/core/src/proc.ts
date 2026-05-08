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
 * The chromium flags PLAN.md §8.6 mandates we always pass. Order does not
 * matter; Chromium accepts late-arriving overrides for most flags but we
 * never override these.
 */
export const DEFAULT_CHROMIUM_FLAGS: readonly string[] = [
  "--remote-debugging-pipe",
  "--no-default-browser-check",
  "--no-first-run",
  "--no-service-autorun",
  "--password-store=basic",
  "--use-mock-keychain",
  "--disable-default-apps",
  "--disable-component-update",
  // Single comma-joined --disable-features flag (Chromium accepts comma list).
  "--disable-features=Translate,OptimizationHints,MediaRouter,AcceptCHFrame,InterestFeedContentSuggestions,CalculateNativeWinOcclusion,IsolateOrigins,site-per-process",
  "--enable-features=NetworkService,NetworkServiceInProcess",
  "--disable-background-networking",
  "--disable-sync",
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
  /** Run headless via Chromium's modern `--headless=new` flag. */
  headless: boolean;
  /** Optional proxy server, e.g. "http://host:port" or "socks5://host:port". */
  proxy?: string;
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
}

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
export function buildChromiumArgs(cfg: SpawnConfig, userDataDir: string): string[] {
  const args: string[] = [`--user-data-dir=${userDataDir}`, ...DEFAULT_CHROMIUM_FLAGS];
  if (cfg.headless) {
    // Modern headless mode (matches stable Chrome behavior more closely than
    // legacy --headless). The `=new` is critical — old `--headless` is
    // detectable.
    args.push("--headless=new");
  }
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
  if (cfg.extraArgs !== undefined && cfg.extraArgs.length > 0) {
    args.push(...cfg.extraArgs);
  }
  // Whitespace-separated extra args from the environment. Same effect as
  // `LaunchOptions.args` but settable from outside the calling code — load-
  // bearing for CI environments that need `--no-sandbox` (Linux user-namespace
  // sandbox doesn't work in unprivileged containers / GH Actions runners) and
  // for ad-hoc local debugging without touching test fixtures. Production code
  // SHOULD NOT set this — `--no-sandbox` is a fingerprint leak in real-user
  // contexts. PLAN.md §8.6 explicitly omits it from DEFAULT_CHROMIUM_FLAGS.
  const envExtra = process.env.MOCHI_EXTRA_ARGS;
  if (typeof envExtra === "string" && envExtra.trim().length > 0) {
    args.push(...envExtra.trim().split(/\s+/));
  }
  return args;
}

/**
 * Spawn Chromium with `--remote-debugging-pipe` and the standard flag set.
 *
 * Pipe FD convention (Chromium CDP pipe spec, matches Puppeteer / Playwright):
 *   - FD 3 in the *child* is the read end. The parent writes commands to it.
 *   - FD 4 in the *child* is the write end. The parent reads responses from it.
 *
 * Note: task brief 0011 has the FD direction labels reversed; we follow
 * Chromium's actual convention here so the protocol works. Either way Bun's
 * `stdio: ["pipe", "pipe", "pipe", "pipe", "pipe"]` allocates two extra pipes
 * and gives us back numeric FDs at `proc.stdio[3]` and `proc.stdio[4]`.
 */
export async function spawnChromium(cfg: SpawnConfig): Promise<ChromiumProcess> {
  const userDataDir = await mkdtemp(join(tmpdir(), "mochi-"));

  const args = buildChromiumArgs(cfg, userDataDir);

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

  // Drain stderr so Chromium doesn't block writing diagnostics. We don't read
  // it (yet); piping to /dev/null keeps the buffer empty.
  void drainToVoid(proc.stderr);
  void drainToVoid(proc.stdout);

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
