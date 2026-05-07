/**
 * paths.ts — platform mapping + on-disk layout for `mochi browsers`.
 *
 * The install root defaults to `~/.mochi/browsers/`. Each binary unpacks into
 * `<root>/<channel>-<version>-<platform>/` with the per-platform binary path
 * computed by {@link binaryPathInExtractDir}. The directory naming is the unit
 * of idempotency: re-running `install` for the same `(channel,version,platform)`
 * triple is a no-op.
 *
 * Platform mapping is the canonical source of truth for `process.platform +
 * process.arch → CfT platform string`. CfT does not currently ship Linux-arm64
 * (verified 2026-05-08 against the public registry); we error out clearly
 * rather than silently mapping it to `linux64` which would corrupt fingerprints
 * downstream.
 *
 * @see PLAN.md §5.8 — mochi browsers install
 * @see tasks/0010-mochi-browsers-install.md
 */
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Platforms shipped by Chromium-for-Testing. Exhaustively enumerated so
 * downstream code can switch over the union and let the compiler enforce
 * coverage.
 *
 * Source: https://googlechromelabs.github.io/chrome-for-testing/known-good-versions-with-downloads.json
 * (verified 2026-05-08).
 */
export const CFT_PLATFORMS = ["mac-arm64", "mac-x64", "linux64", "win64"] as const;
export type CftPlatform = (typeof CFT_PLATFORMS)[number];

export const CHANNELS = ["stable", "beta"] as const;
export type Channel = (typeof CHANNELS)[number];

/**
 * Map a Node-style `<process.platform>-<process.arch>` to a CfT platform
 * string. Returns `null` for unsupported combinations (notably `linux-arm64`
 * and `win32-ia32`); callers should surface a friendly error pointing the user
 * at a manual `--platform` override or BYO binary.
 *
 * Mapping table:
 *   darwin-arm64 → mac-arm64
 *   darwin-x64   → mac-x64
 *   linux-x64    → linux64
 *   win32-x64    → win64
 *   linux-arm64  → null  (CfT does not publish a Linux-arm64 build)
 */
export function detectPlatform(
  nodePlatform: NodeJS.Platform = process.platform,
  nodeArch: NodeJS.Architecture = process.arch,
): CftPlatform | null {
  if (nodePlatform === "darwin" && nodeArch === "arm64") return "mac-arm64";
  if (nodePlatform === "darwin" && nodeArch === "x64") return "mac-x64";
  if (nodePlatform === "linux" && nodeArch === "x64") return "linux64";
  if (nodePlatform === "win32" && nodeArch === "x64") return "win64";
  return null;
}

/**
 * Type-narrowing helper for input validation.
 */
export function isCftPlatform(value: string): value is CftPlatform {
  return (CFT_PLATFORMS as readonly string[]).includes(value);
}

export function isChannel(value: string): value is Channel {
  return (CHANNELS as readonly string[]).includes(value);
}

/**
 * The default install root. Honors `MOCHI_BROWSERS_ROOT` so tests and CI can
 * point at a temp dir without polluting the user's home dir.
 */
export function defaultInstallRoot(): string {
  const override = process.env.MOCHI_BROWSERS_ROOT;
  if (override && override.length > 0) return override;
  return join(homedir(), ".mochi", "browsers");
}

/**
 * The install directory for one specific `(channel,version,platform)` triple.
 * Two installs of the same channel + version on different platforms coexist
 * peacefully under the same root.
 */
export function installDir(
  root: string,
  channel: Channel,
  version: string,
  platform: CftPlatform,
): string {
  return join(root, `${channel}-${version}-${platform}`);
}

/**
 * Path to the `chrome` executable inside an extracted CfT archive. The archive
 * layout is platform-dependent and stable across versions:
 *
 *   mac-arm64 → chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing
 *   mac-x64   → chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing
 *   linux64   → chrome-linux64/chrome
 *   win64     → chrome-win64/chrome.exe
 *
 * Verified by inspecting CfT zips for v131.0.6778.85 (2026-05-08).
 */
export function binaryPathInExtractDir(extractDir: string, platform: CftPlatform): string {
  switch (platform) {
    case "mac-arm64":
      return join(
        extractDir,
        "chrome-mac-arm64",
        "Google Chrome for Testing.app",
        "Contents",
        "MacOS",
        "Google Chrome for Testing",
      );
    case "mac-x64":
      return join(
        extractDir,
        "chrome-mac-x64",
        "Google Chrome for Testing.app",
        "Contents",
        "MacOS",
        "Google Chrome for Testing",
      );
    case "linux64":
      return join(extractDir, "chrome-linux64", "chrome");
    case "win64":
      return join(extractDir, "chrome-win64", "chrome.exe");
  }
}

/**
 * Convenience: the binary path for a fully-specified install. Stable across
 * the lifetime of an install — `mochi browsers path` uses this exact mapping.
 */
export function binaryPathFor(
  root: string,
  channel: Channel,
  version: string,
  platform: CftPlatform,
): string {
  return binaryPathInExtractDir(installDir(root, channel, version, platform), platform);
}
