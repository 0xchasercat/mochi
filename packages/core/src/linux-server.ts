/**
 * Linux-server environment detection.
 *
 * The "common deployment env" failure mode for `mochi.launch()`: a fresh
 * Ubuntu / Debian server, no DISPLAY, no Wayland — Chromium spawns but cannot
 * render and either hangs or crashes on the first paint. The fix is to drive
 * Chromium through `--headless=new` (the modern headless that ships full
 * rendering and is near-byte-identical to headful for fingerprinting; the
 * legacy `--headless` is a separate, more-detectable code path).
 *
 * This module exposes:
 *
 *   - {@link detectLinuxServerEnv} — pure function. Given a snapshot of
 *     `(platform, env, container probes)`, returns a record describing what
 *     mochi inferred (Linux-without-display? root? containerised?). Pure /
 *     synchronous so callers can stub the inputs and unit-test without
 *     touching `process.*`.
 *   - {@link DEFAULT_LINUX_SERVER_PROBES} — convenience that snapshots the
 *     real `process.platform`, `process.env.DISPLAY`,
 *     `process.env.WAYLAND_DISPLAY`, `process.getuid?.()`, and the container
 *     filesystem probes (`/.dockerenv`, `/proc/1/cgroup`). Calls
 *     {@link detectLinuxServerEnv} with that snapshot and returns the result.
 *
 * Detection rules:
 *
 *   1. `platform === "linux"` AND no `DISPLAY` AND no `WAYLAND_DISPLAY`
 *      → `serverNoDisplay = true`. This is the load-bearing signal for
 *      auto-defaulting `headlessMode` to `"new"`.
 *   2. `getuid?.() === 0` → `root = true`. Orthogonal to #1; drives the
 *      existing auto-`--no-sandbox` path in `proc.ts` (kept verbatim — this
 *      module does not own that decision).
 *   3. `/.dockerenv` exists OR `/proc/1/cgroup` mentions
 *      `docker | containerd | kubepods` → `container = true`. Tertiary
 *      signal; surfaced for diagnostics only (a container with DISPLAY set
 *      is still a "with display" environment).
 *
 * @see tasks/0259 (Linux first-run experience)
 * @see tasks/0258 (Linux server env auto-detection)
 * @see docs/getting-started/linux-server.md
 */

import { existsSync, readFileSync } from "node:fs";

/**
 * Snapshot of the runtime probes that {@link detectLinuxServerEnv} consumes.
 * Defined as a record (not direct `process.*` reads) so unit tests can stub
 * each axis independently.
 */
export interface LinuxServerProbes {
  /** `process.platform`. */
  platform: NodeJS.Platform;
  /** Value of `process.env.DISPLAY` (X11 display server). */
  display: string | undefined;
  /** Value of `process.env.WAYLAND_DISPLAY` (Wayland display server). */
  waylandDisplay: string | undefined;
  /** UID, or `undefined` on platforms without a getuid (Windows). */
  uid: number | undefined;
  /** `true` when `/.dockerenv` exists. */
  hasDockerEnvFile: boolean;
  /**
   * Contents of `/proc/1/cgroup`, or `undefined` if absent / unreadable.
   * Container detection scans this for `docker | containerd | kubepods`.
   */
  cgroup: string | undefined;
}

/**
 * Result returned by {@link detectLinuxServerEnv}. Structured so callers
 * (the launcher, the diagnostic helper, an end-user calling
 * `mochi.detectLinuxServerEnv()` directly) can introspect each axis without
 * re-running the probes.
 */
export interface LinuxServerEnv {
  /** `true` iff Linux + no DISPLAY + no WAYLAND_DISPLAY. */
  serverNoDisplay: boolean;
  /** `true` iff the process is running as uid 0 on Linux. */
  root: boolean;
  /** `true` iff a container indicator (`/.dockerenv` or cgroup mention) hit. */
  container: boolean;
  /** Human-readable rationale string. Intended for `console.debug`. */
  rationale: string;
}

/**
 * Pure, synchronous classifier. Given a `LinuxServerProbes` snapshot, returns
 * a `LinuxServerEnv` summary. No I/O, no global reads — every input is on the
 * `probes` argument. Exposed for unit tests AND for users who want to drive
 * the classification with their own probes (e.g. a CI matrix that wants to
 * pretend it's running under DISPLAY=:0 to validate a code path).
 */
export function detectLinuxServerEnv(probes: LinuxServerProbes): LinuxServerEnv {
  const isLinux = probes.platform === "linux";
  const hasDisplay =
    (probes.display !== undefined && probes.display.length > 0) ||
    (probes.waylandDisplay !== undefined && probes.waylandDisplay.length > 0);
  const serverNoDisplay = isLinux && !hasDisplay;
  const root = isLinux && probes.uid === 0;
  const container =
    probes.hasDockerEnvFile ||
    (probes.cgroup !== undefined && /docker|containerd|kubepods/.test(probes.cgroup));

  const parts: string[] = [];
  parts.push(`platform=${probes.platform}`);
  parts.push(`display=${probes.display ?? "(unset)"}`);
  parts.push(`waylandDisplay=${probes.waylandDisplay ?? "(unset)"}`);
  parts.push(`uid=${probes.uid ?? "(none)"}`);
  parts.push(`container=${container}`);
  parts.push(`serverNoDisplay=${serverNoDisplay}`);
  const rationale = parts.join(" ");

  return { serverNoDisplay, root, container, rationale };
}

/**
 * Snapshot the live process state and run {@link detectLinuxServerEnv}
 * against it. The convenience entry point used by {@link launch} and the
 * inspection helper exposed on the public surface (`mochi.detectLinuxServerEnv()`).
 *
 * Filesystem probes (`/.dockerenv`, `/proc/1/cgroup`) are guarded with
 * `existsSync` + a try/catch so the call is safe on macOS / Windows / sandboxed
 * environments where the paths don't exist.
 */
export function probeLinuxServerEnv(): LinuxServerEnv {
  return detectLinuxServerEnv(snapshotProbes());
}

/**
 * Build a {@link LinuxServerProbes} record from the live `process.*` and
 * filesystem state. Exported so callers debugging an environment-detection
 * issue can inspect the raw inputs the classifier saw.
 */
export function snapshotProbes(): LinuxServerProbes {
  const platform = process.platform;
  const display = process.env.DISPLAY;
  const waylandDisplay = process.env.WAYLAND_DISPLAY;
  const uid = typeof process.getuid === "function" ? process.getuid() : undefined;
  const hasDockerEnvFile = safeExists("/.dockerenv");
  const cgroup = safeReadText("/proc/1/cgroup");
  return { platform, display, waylandDisplay, uid, hasDockerEnvFile, cgroup };
}

function safeExists(path: string): boolean {
  try {
    return existsSync(path);
  } catch {
    return false;
  }
}

function safeReadText(path: string): string | undefined {
  try {
    if (!existsSync(path)) return undefined;
    return readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
}
