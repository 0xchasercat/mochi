/**
 * Spoof module: `navigator.*`.
 *
 * Reads from the matrix:
 *   - `matrix.userAgent`                          → navigator.userAgent
 *   - `matrix.uaCh["navigator-platform"]`         → navigator.platform
 *   - `matrix.uaCh["navigator-vendor"]`           → navigator.vendor
 *   - `matrix.uaCh["navigator-appVersion"]`       → navigator.appVersion
 *   - `matrix.uaCh["navigator-appCodeName"]`      → navigator.appCodeName
 *   - `matrix.uaCh["navigator-product"]`          → navigator.product
 *   - `matrix.uaCh["navigator-cookieEnabled"]`    → navigator.cookieEnabled  (string "true"/"false")
 *   - `matrix.uaCh["navigator-maxTouchPoints"]`   → navigator.maxTouchPoints (string "0")
 *   - `matrix.uaCh["navigator-webdriver"]`        → navigator.webdriver      (string "true"/"false")
 *   - `matrix.device.cores`                       → navigator.hardwareConcurrency
 *   - `matrix.device.memoryGB`                    → navigator.deviceMemory
 *   - `matrix.locale`                             → navigator.language
 *   - `matrix.languages`                          → navigator.languages
 *
 * The uaCh bag stores values as strings (PLAN.md §6.1 — open-keyed string
 * map). Where the spoofed property is logically a boolean or number, this
 * module parses the string at build time. If a key is missing, that
 * particular property override is skipped — the bare browser value remains
 * (PLAN.md I-5: never invent values).
 *
 * @see tasks/0030-inject-engine-v0.md §"navigator.ts"
 * @see PLAN.md §5.3
 */

import type { MatrixV1 } from "@mochi.js/consistency";

/**
 * Build the navigator-spoof JS snippet for this matrix. The returned source
 * runs inside the master IIFE *after* the runtime helpers are installed.
 */
export function emitNavigatorModule(matrix: MatrixV1): string {
  const ua = matrix.uaCh;
  const lines: string[] = [];

  // navigator.userAgent — always present (top-level matrix slot).
  lines.push(line("userAgent", JSON.stringify(matrix.userAgent)));

  // navigator.appVersion — UA without leading "Mozilla/" (R-026).
  const appVersion = ua["navigator-appVersion"];
  if (typeof appVersion === "string") {
    lines.push(line("appVersion", JSON.stringify(appVersion)));
  }

  // navigator.platform — "MacIntel"/"Win32"/"Linux x86_64" (R-017).
  const platform = ua["navigator-platform"];
  if (typeof platform === "string") {
    lines.push(line("platform", JSON.stringify(platform)));
  }

  // navigator.vendor — "Google Inc." for chromium-family (R-018).
  const vendor = ua["navigator-vendor"];
  if (typeof vendor === "string") {
    lines.push(line("vendor", JSON.stringify(vendor)));
  }

  // navigator.appCodeName — "Mozilla" universally (R-027).
  const appCodeName = ua["navigator-appCodeName"];
  if (typeof appCodeName === "string") {
    lines.push(line("appCodeName", JSON.stringify(appCodeName)));
  }

  // navigator.product — "Gecko" universally (R-028).
  const product = ua["navigator-product"];
  if (typeof product === "string") {
    lines.push(line("product", JSON.stringify(product)));
  }

  // navigator.cookieEnabled — boolean (R-030).
  const cookieEnabled = ua["navigator-cookieEnabled"];
  if (typeof cookieEnabled === "string") {
    const b = cookieEnabled === "true";
    lines.push(line("cookieEnabled", b ? "true" : "false"));
  }

  // navigator.maxTouchPoints — number (R-020).
  const maxTouchPoints = ua["navigator-maxTouchPoints"];
  if (typeof maxTouchPoints === "string") {
    const n = Number.parseInt(maxTouchPoints, 10);
    if (Number.isFinite(n)) {
      lines.push(line("maxTouchPoints", String(n)));
    }
  }

  // navigator.webdriver — boolean (R-022). Always returns false on real Chrome.
  const webdriver = ua["navigator-webdriver"];
  if (typeof webdriver === "string") {
    const b = webdriver === "true";
    lines.push(line("webdriver", b ? "true" : "false"));
  }

  // navigator.hardwareConcurrency — number (R-008). Use device.cores.
  lines.push(line("hardwareConcurrency", String(matrix.device.cores)));

  // navigator.deviceMemory — number (R-009). Capped at 8.
  lines.push(line("deviceMemory", String(matrix.device.memoryGB)));

  // navigator.language — string (R-015).
  lines.push(line("language", JSON.stringify(matrix.locale)));

  // navigator.languages — frozen array (R-016). Use a fresh frozen Array
  // each call so page code can't mutate it; matches Chrome's behaviour
  // (Chrome returns an array reference but the slot is a getter so each
  // access returns a fresh array; we mimic that).
  const langsLiteral = `Object.freeze([${matrix.languages
    .map((l) => JSON.stringify(l))
    .join(",")}])`;
  lines.push(line("languages", langsLiteral));

  return `
// ---- navigator spoof -------------------------------------------------------
(function() {
  var __nav__ = navigator;
  var __navProto__ = __mochi_getPrototypeOf__(__nav__);
${lines.join("\n")}
})();
`;
}

/**
 * Helper: emit one defineProperty call against `__nav__` AND its prototype,
 * mirroring Chrome's slot layout (most navigator properties live on the
 * Navigator.prototype, but page script reads them from the instance — so
 * defining only the prototype is safe and matches native shape).
 *
 * We define on the prototype because navigator's own descriptor is
 * empty for these properties — they're all inherited. Defining on the
 * instance directly creates a "shadowing" own property that fingerprint
 * libraries can detect via `Object.getOwnPropertyNames(navigator)`.
 *
 * Caveat: `__mochi_define__` already walks the prototype chain to find the
 * descriptor's enumerability, so passing `__navProto__` keeps the slot on
 * the prototype where it belongs.
 */
function line(prop: string, valueExpr: string): string {
  return `  __mochi_define__(__navProto__, ${JSON.stringify(prop)}, ${valueExpr});`;
}
