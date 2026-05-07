/**
 * Spoof module: `Intl.DateTimeFormat().resolvedOptions().timeZone` and
 * `Date.prototype.getTimezoneOffset` / related timezone-derived APIs.
 *
 * Reads from the matrix:
 *   - `matrix.timezone` (R-014) — IANA timezone identifier
 *
 * v0.3 strategy:
 *   - Replace `Intl.DateTimeFormat.prototype.resolvedOptions` with a wrapper
 *     that overrides `timeZone` on the returned options object. Other
 *     fields pass through.
 *   - Don't spoof `performance.now()` precision (PLAN.md §9.6 — Chrome's
 *     natural 100µs coarsening is what we want for same-engine v1).
 *   - Don't override `Date.prototype.getTimezoneOffset` — when Chrome is
 *     launched with `TZ=<iana>` (or via the system clock), the Date object
 *     already produces correct offsets. Inject-layer spoofing of
 *     getTimezoneOffset would conflict with the page's own Date math. The
 *     core launch path is responsible for setting `TZ` if requested
 *     (deferred to phase 0.7 / harness work; documented in docs/limits.md).
 *
 * @see tasks/0030-inject-engine-v0.md §"timing.ts"
 */

import type { MatrixV1 } from "@mochi.js/consistency";

export function emitTimingModule(matrix: MatrixV1): string {
  const tz = JSON.stringify(matrix.timezone);

  return `
// ---- timing spoof (timezone) -----------------------------------------------
(function() {
  if (typeof Intl === "undefined" || typeof Intl.DateTimeFormat !== "function") return;
  var SPOOF_TZ = ${tz};
  var proto = Intl.DateTimeFormat.prototype;
  var origResolved = proto.resolvedOptions;
  if (typeof origResolved !== "function") return;

  function resolvedOptions() {
    var opts = __mochi_apply__.call(origResolved, this, []);
    if (opts !== null && opts !== undefined && typeof opts === "object") {
      try { opts.timeZone = SPOOF_TZ; } catch (_e) {}
    }
    return opts;
  }
  __mochi_register_native__(resolvedOptions, "resolvedOptions");

  try {
    __mochi_defineProperty__(proto, "resolvedOptions", {
      configurable: true,
      enumerable: false,
      writable: true,
      value: resolvedOptions,
    });
  } catch (_e) {}
})();
`;
}
