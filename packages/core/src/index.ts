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
} from "./launch";
export {
  type Cookie,
  type GotoOptions,
  type HumanClickOptions,
  type HumanMoveOptions,
  type HumanScrollOptions,
  type HumanTypeOptions,
  Page,
  type PageInit,
  type WaitForOptions,
  type WaitState,
  type WaitUntil,
} from "./page";
export { ElementHandle, type ElementHandleInit } from "./page/element-handle";
// Proxy URL parsing — exported so tests + downstream tools can normalize
// proxy strings without going through `launch()`.
export { type ParsedProxy, parseProxyUrl } from "./proxy-auth";
export { Session, type SessionInit, type StorageSnapshot } from "./session";
export { VERSION } from "./version";
