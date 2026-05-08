/**
 * Spoof module: `window.chrome` shim.
 *
 * Real Chrome (headed and `--headless=new`) exposes `window.chrome` as
 * an object with `loadTimes`, `csi`, `app` — and, for extension contexts,
 * `runtime`. Stock Chromium-for-Testing builds may or may not expose
 * `window.chrome` depending on flag set; CloakBrowser's
 * `test_window_chrome_exists` (line 47) and `test_device_and_browser_info`
 * (line 158, `hasInconsistentChromeObject`) both check for this.
 *
 * The shim is **defensive** — we install it only when `window.chrome` is
 * absent or non-object. If the underlying browser already exposes a real
 * `window.chrome` (the common case on real Chrome.app), we leave it alone
 * so the existing Probe Manifest Zero-Diff gate doesn't regress.
 *
 * The shim mirrors Chrome's actual non-extension shape:
 *   - `chrome.app` — `{ isInstalled: false, getDetails(), getIsInstalled(), … }`
 *     stripped to the no-op stubs Chrome reports for non-installed-app pages.
 *   - `chrome.csi()` — returns a benign timing object.
 *   - `chrome.loadTimes()` — returns a benign timings object.
 *   - `chrome.runtime` — INTENTIONALLY undefined for non-extension contexts.
 *     CloakBrowser's `bot.detection` test (`hasInconsistentChromeObject`)
 *     and `chromeRuntime` probe both consider `chrome.runtime` truthy as
 *     suspicious unless an actual extension API is present, since real
 *     Chrome only exposes runtime to extension callers.
 *
 * Reads no matrix slots — `window.chrome` is profile-invariant for
 * Chromium-family browsers. The matrix's `engine === "chromium"` is the
 * gating condition (other engines would not have `window.chrome`).
 *
 * @see CloakBrowser tests/test_stealth.py:47-50,158
 * @see tasks/0140-stealth-conformance.md §"window.chrome spoof"
 */

import type { MatrixV1 } from "@mochi.js/consistency";

/**
 * Emit the `window.chrome` shim. The IIFE checks if `window.chrome` is
 * already an object and returns early if so — we never overwrite a
 * native `window.chrome`.
 */
export function emitWindowChromeModule(matrix: MatrixV1): string {
  if (matrix.engine !== "chromium") {
    // No shim for non-Chromium engines (the v1 catalog is Chromium-only,
    // so this path is currently unreachable, but guarding it keeps the
    // module forward-compatible with the v2 cross-engine roadmap).
    return `\n// ---- window.chrome spoof (skipped — non-chromium engine) ------------------\n`;
  }

  return `
// ---- window.chrome spoof ---------------------------------------------------
(function() {
  if (typeof window === "undefined") return;
  // If the underlying browser already exposes window.chrome as an object,
  // do not overwrite it — real Chrome.app's native shape is richer than
  // any synthesized shim and overwriting would regress the harness diff.
  var existing = window.chrome;
  if (existing !== undefined && existing !== null && typeof existing === "object") {
    return;
  }

  // Build the no-op shape that Chromium-for-Testing produces in non-
  // extension contexts. Functions are registered with the toString cloak
  // so .toString() reports native shape.
  function makeAppApi() {
    function isInstalled() { return false; }
    __mochi_register_native__(isInstalled, "isInstalled");
    function getDetails() { return null; }
    __mochi_register_native__(getDetails, "getDetails");
    function getIsInstalled() { return false; }
    __mochi_register_native__(getIsInstalled, "getIsInstalled");
    function installState(cb) {
      // Real Chrome answers "not_installed" via the callback.
      try { if (typeof cb === "function") cb("not_installed"); } catch (_e) {}
    }
    __mochi_register_native__(installState, "installState");
    function runningState() { return "cannot_run"; }
    __mochi_register_native__(runningState, "runningState");
    var app = Object.create(null);
    app.isInstalled = false;
    app.InstallState = Object.freeze({
      DISABLED: "disabled",
      INSTALLED: "installed",
      NOT_INSTALLED: "not_installed",
    });
    app.RunningState = Object.freeze({
      CANNOT_RUN: "cannot_run",
      READY_TO_RUN: "ready_to_run",
      RUNNING: "running",
    });
    app.getDetails = getDetails;
    app.getIsInstalled = getIsInstalled;
    app.installState = installState;
    app.runningState = runningState;
    return app;
  }

  function csi() {
    // Approximate Chrome's csi() shape — a benign timing snapshot.
    return {
      onloadT: 0,
      pageT: 0,
      startE: 0,
      tran: 15,
    };
  }
  __mochi_register_native__(csi, "csi");

  function loadTimes() {
    // Approximate Chrome's loadTimes() shape. Values are filled with zeros
    // — the assertion in CloakBrowser is on object-shape, not field
    // values; sites that scrutinize the timings further would also
    // need the harness-baseline-driven values, which is a v2 concern.
    return {
      requestTime: 0,
      startLoadTime: 0,
      commitLoadTime: 0,
      finishDocumentLoadTime: 0,
      finishLoadTime: 0,
      firstPaintTime: 0,
      firstPaintAfterLoadTime: 0,
      navigationType: "Other",
      wasFetchedViaSpdy: false,
      wasNpnNegotiated: false,
      npnNegotiatedProtocol: "unknown",
      wasAlternateProtocolAvailable: false,
      connectionInfo: "unknown",
    };
  }
  __mochi_register_native__(loadTimes, "loadTimes");

  var chromeShim = Object.create(null);
  chromeShim.app = makeAppApi();
  chromeShim.csi = csi;
  chromeShim.loadTimes = loadTimes;
  // chrome.runtime is intentionally undefined for non-extension contexts.
  // CloakBrowser's hasInconsistentChromeObject + chromeRuntime probes both
  // expect runtime to be falsy unless extension messaging is active.

  try {
    __mochi_defineProperty__(window, "chrome", {
      configurable: true,
      enumerable: true,
      writable: true,
      value: chromeShim,
    });
  } catch (_e) {
    // Non-configurable native window.chrome — nothing to do; the existing
    // value is what page script will see.
  }
})();
`;
}
