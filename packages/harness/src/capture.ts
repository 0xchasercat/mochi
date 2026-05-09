/**
 * capture.ts — drive a Mochi `Session` through the canonical probe-page
 * fixture and return the captured probe payload.
 *
 * Mirrors the capture-side flow in `packages/cli/src/capture/index.ts`,
 * but runs against an *already-launched* `Session` (typically with the
 * full inject pipeline active, i.e. NOT `bypassInject:true`). The
 * resulting payload is the Mochi-spoofed probe output — the harness diffs
 * it against the bare-Chromium baseline captured by `mochi capture`.
 *
 * @see PLAN.md §13.2 (capture pipeline)
 */

import { existsSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import type { Session } from "@mochi.js/core";
import type { JsonValue } from "./generated/diff-report";
import type { ProbeManifestV1 } from "./generated/probe-manifest";

/**
 * Aggregated probe-page output. Shape-compatible with Peekaboo's
 * `ProbeManifestV1` superset, but the local probe-page fixture produces
 * a flatter shape (no `manifestVersion`, no `capture.*` block) — every
 * probe family appears as a top-level key. The harness diffs this exact
 * shape, so we keep it as `Record<string, JsonValue>` rather than
 * forcing a manifestVersion stamp.
 */
export type CapturedProbeManifest = Record<string, JsonValue>;

/**
 * Options accepted by {@link capture}.
 */
export interface CaptureOptions {
  /**
   * URL to navigate to. Defaults to the file:// URL of the canonical
   * `tests/fixtures/probe-page.html` resolved from the repo root.
   */
  readonly fixtureUrl?: string;
  /**
   * Probe-completion polling timeout in ms. Default: 30 000.
   */
  readonly probeTimeoutMs?: number;
  /**
   * Override start directory for the repo-root walk that locates the
   * fixture. Tests may set this; production callers leave it `undefined`.
   */
  readonly cwd?: string;
}

const DEFAULT_PROBE_TIMEOUT_MS = 30_000;
const PROBE_POLL_INTERVAL_MS = 100;

/**
 * Drive `session` to the probe-page fixture, wait for `__probesReady`,
 * read `#probes`, and return the parsed JSON payload.
 *
 * The session is NOT closed by this function — callers are responsible
 * for the session lifecycle (mirrors the `mochi capture` flow).
 */
export async function capture(
  session: Session,
  opts: CaptureOptions = {},
): Promise<CapturedProbeManifest> {
  const fixtureUrl = opts.fixtureUrl ?? defaultFixtureUrl(opts.cwd);
  const timeoutMs = opts.probeTimeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS;

  const page = await session.newPage();
  try {
    await page.goto(fixtureUrl, { waitUntil: "load" });

    // Poll the sentinel.
    const deadline = Date.now() + timeoutMs;
    let ready = false;
    while (Date.now() < deadline) {
      const flag = await page.evaluate<boolean>(() => {
        return (globalThis as { __probesReady?: boolean }).__probesReady === true;
      });
      if (flag === true) {
        ready = true;
        break;
      }
      await sleep(PROBE_POLL_INTERVAL_MS);
    }
    if (!ready) {
      throw new Error(
        `[mochi harness] probe-page sentinel did not fire within ${timeoutMs}ms (url: ${fixtureUrl})`,
      );
    }

    const text = await page.text("#probes");
    if (text === null || text.length === 0) {
      throw new Error("[mochi harness] #probes element produced no textContent");
    }
    return JSON.parse(text) as CapturedProbeManifest;
  } finally {
    await page.close();
  }
}

// ---- fixture resolution -----------------------------------------------------

/**
 * Resolve the canonical `tests/fixtures/probe-page.html` to a `file://`
 * URL by walking up from `cwd`. Mirrors the helper in
 * `packages/cli/src/capture/probe-page.ts` so the harness and the
 * capture tool always agree on the same fixture location.
 */
export function defaultFixtureUrl(start?: string): string {
  const fallback = process.env.MOCHI_PROBE_PAGE;
  if (fallback !== undefined && fallback.length > 0 && existsSync(fallback)) {
    return pathToFileUrl(fallback);
  }
  const found = findProbePage(start ?? process.cwd());
  if (found === null) {
    throw new Error(
      "[mochi harness] could not locate tests/fixtures/probe-page.html walking up from " +
        `${start ?? process.cwd()}. Set MOCHI_PROBE_PAGE to its absolute path, or run from inside the mochi monorepo.`,
    );
  }
  return pathToFileUrl(found);
}

function findProbePage(start: string): string | null {
  let dir = isAbsolute(start) ? start : join(process.cwd(), start);
  for (let i = 0; i < 32; i++) {
    const candidate = join(dir, "tests", "fixtures", "probe-page.html");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
  return null;
}

function pathToFileUrl(absolutePath: string): string {
  const normalized = absolutePath.replace(/\\/g, "/");
  const encoded = normalized
    .split("/")
    .map((seg) => encodeURIComponent(seg).replace(/'/g, "%27"))
    .join("/");
  return normalized.startsWith("/") ? `file://${encoded}` : `file:///${encoded}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---- type alias re-export ---------------------------------------------------

export type { ProbeManifestV1 };
