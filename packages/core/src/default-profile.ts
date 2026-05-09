/**
 * Auto-pick the host-OS-matching profile when `LaunchOptions.profile` is
 * omitted. The function below is the pure decision table the
 * launcher consults; tests stub `(platform, arch)` and assert the mapping
 * without spinning a Chromium.
 *
 * ## Why
 *
 * Task 0271 documents the strategic thesis: spoofing Windows from a Linux
 * server is the wrong default. Linux is a real-user signal, not a bot
 * signal. WAFs trained on real traffic do not penalize Linux UAs because
 * Linux desktops are massively overrepresented in high-LTV segments
 * (developers, engineers, researchers). The signal was always
 * `HeadlessChrome`, never Linux.
 *
 * Lifting host-OS-matching from "user types `profile: 'linux-chrome-stable'`
 * by hand" into a default removes the entire class of "user accidentally
 * spoofed Windows from a Linux DC and looked weird to the WAF" failures —
 * the same argument that drove `detectLinuxServerEnv` for headless mode in
 *
 *
 * ## Mapping
 *
 * The host pairs `(process.platform, process.arch)` we currently support:
 *
 *   - `linux/x64`     → `linux-chrome-stable`
 *   - `darwin/arm64`  → `mac-m4-chrome-stable`
 *   - `darwin/x64`    → `mac-chrome-stable`
 *   - `win32/x64`     → `windows-chrome-stable`
 *
 * Everything else (linux/arm64, freebsd, alpine-musl detection, win32/arm64,
 * etc.) returns `null` — the launcher then throws with a precise diagnostic
 * listing the six explicit profile IDs and a pointer to the
 * choose-your-profile guide. We never silently fall back to a placeholder.
 *
 * ## Caveat — darwin/x64
 *
 * The current profile catalog (`packages/profiles/data/`) ships
 * `mac-chrome-stable` as a darwin/arm64 capture (its `os.arch === "arm64"`
 * in `profile.json`). The mapping above still routes darwin/x64 to
 * `mac-chrome-stable`; users on Intel Macs
 * who want a strict arch match should pass `profile` explicitly until an
 * `mac-intel-chrome-stable` capture lands.
 *
 */

import type { ProfileId } from "./launch";

/**
 * Pure decision table: given the current host's `(process.platform,
 * process.arch)` pair, return the profile id that best matches the host
 * OS axis. Returns `null` for unsupported hosts so the launcher can throw
 * with a precise diagnostic.
 *
 * No I/O, no logging — call sites can introspect the value cheaply (e.g.
 * `console.log(mochi.defaultProfileForHost())`).
 */
export function defaultProfileForHost(): ProfileId | null {
  return resolveDefaultProfileForHost(process.platform, process.arch);
}

/**
 * Internal pure resolver, exposed so the unit tests can drive the table
 * without stubbing global `process`. Mirrors the precedence-table style of
 * `resolveHeadlessMode`.
 *
 * @internal
 */
export function resolveDefaultProfileForHost(
  platform: NodeJS.Platform,
  arch: string,
): ProfileId | null {
  if (platform === "linux" && arch === "x64") return "linux-chrome-stable";
  if (platform === "darwin" && arch === "arm64") return "mac-m4-chrome-stable";
  if (platform === "darwin" && arch === "x64") return "mac-chrome-stable";
  if (platform === "win32" && arch === "x64") return "windows-chrome-stable";
  return null;
}

/**
 * The six real-device profile IDs that `defaultProfileForHost` can return,
 * surfaced by the launcher's failure-mode diagnostic. Order matches the
 * brief verbatim so the user-facing message is stable.
 *
 * @internal
 */
export const EXPLICIT_PROFILE_IDS = [
  "mac-m4-chrome-stable",
  "mac-chrome-stable",
  "mac-chrome-beta",
  "windows-chrome-stable",
  "linux-chrome-stable",
  "mac-brave-stable",
] as const satisfies readonly ProfileId[];

/**
 * Build the precise diagnostic emitted when `profile` is omitted on an
 * unsupported host. Format pinned — keep stable so docs +
 * LLM-context blocks stay correct.
 *
 * @internal
 */
export function unsupportedHostMessage(platform: NodeJS.Platform, arch: string): string {
  const list = EXPLICIT_PROFILE_IDS.map((id) => `  - ${id}`).join("\n");
  return (
    `[mochi] launch: no profile supplied and no host-matching default for ` +
    `platform=${platform} arch=${arch}. Pick one explicitly:\n${list}\n` +
    `See https://mochijs.com/docs/guides/choose-your-profile for the decision aid.`
  );
}
