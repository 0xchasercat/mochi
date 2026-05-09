/**
 * `@mochi.js/core` — the Bun-native browser automation framework.
 *
 * Phase 0.1: pipe-mode CDP transport + minimal Session/Page lands here. The
 * spoofing pipeline (consistency + inject) wires in phases 0.2 → 0.3; the
 * behavioral surface (humanClick/Type/Scroll) lands in phase 0.8. See PLAN.md
 * §14 for the full roadmap.
 *
 * @see https://github.com/0xchasercat/mochi
 */

export { ChromiumNotFoundError } from "./binary";
export { ForbiddenCdpMethodError } from "./cdp/forbidden";
export {
  BrowserCrashedError,
  type CdpEventHandler,
  CdpRemoteError,
  CdpTimeoutError,
  type SendOptions,
  type Unsubscribe,
} from "./cdp/router";
// WebSocket-mode CDP transport (used by `mochi.connect`). The pipe-mode
// transport in `./cdp/transport.ts` remains the load-bearing path for
// `mochi.launch`.
export {
  ConnectionLostError,
  type ConnectWebSocketCdpOptions,
  connectWebSocketCdp,
  type WebSocketCdpAdapter,
} from "./cdp/transport-ws";
// `mochi.connect` — attach to a Chromium mochi did NOT spawn (BrowserBase,
// dockerised Chromium, user-managed patched Chrome, re-attach). Mirrors
// `puppeteer.connect`'s shape; supports `profile: null` for no-spoof mode.
export { type ConnectOptions, connect } from "./connect";
// Auto-pick host-OS-matching profile when `LaunchOptions.profile` is omitted
//  (— paired with the strategic thesis in task 0271).
export {
  defaultProfileForHost,
  EXPLICIT_PROFILE_IDS,
  resolveDefaultProfileForHost,
} from "./default-profile";
// Error surface.
export { NotImplementedError } from "./errors";
// Exit-IP / TZ / locale reconciliation (task 0262, PLAN.md §9).
export {
  type GeoConsistencyMode,
  GeoMismatchError,
  type GeoReconcileResult,
  localeRegion,
  reconcileGeoConsistency,
  tzOffsetMinutes,
} from "./geo-consistency";
export { type ExitGeo, type ProbeOptions, probeExitGeo } from "./geo-probe";
// Public surface — exported here so users only need `@mochi.js/core`.
export {
  type ChallengeLaunchOptions,
  type LaunchOptions,
  launch,
  type Mochi,
  mochi,
  type ProfileId,
  type ProxyConfig,
  resolveHeadlessMode,
} from "./launch";
// Linux-server environment detection. Pure helpers for users who want to
// introspect what mochi inferred (and override `headlessMode` from there).
// Task 0258 — `mochi.detectLinuxServerEnv()` calls `probeLinuxServerEnv`.
export {
  detectLinuxServerEnv,
  type LinuxServerEnv,
  type LinuxServerProbes,
  probeLinuxServerEnv,
  snapshotProbes,
} from "./linux-server";
export {
  ALL_BROWSER_PERMISSIONS,
  type BrowserPermission,
  type Cookie,
  type DomStorage,
  type DomStorageOptions,
  type GotoOptions,
  type GrantAllPermissionsOptions,
  type HumanClickOptions,
  type HumanMoveOptions,
  type HumanScrollOptions,
  type HumanTypeOptions,
  Page,
  type PageInit,
  type ScreenshotOptions,
  type WaitForOptions,
  type WaitState,
  type WaitUntil,
} from "./page";
export { ElementHandle, type ElementHandleInit } from "./page/element-handle";
// Proxy URL parsing — exported so tests + downstream tools can normalize
// proxy strings without going through `launch()`.
export { type ParsedProxy, parseProxyUrl } from "./proxy-auth";
export {
  COOKIE_JAR_FORMAT_VERSION,
  type CookieJar,
  type CookieJarFile,
  type CookieJarOptions,
  Session,
  type SessionInit,
  type StorageSnapshot,
} from "./session";
export { VERSION } from "./version";
