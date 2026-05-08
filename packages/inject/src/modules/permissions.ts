/**
 * Spoof module: `Permissions.prototype.query({name})`.
 *
 * Reads from the matrix:
 *   - `matrix.uaCh["permissions-defaults"]` (R-036) — JSON map of
 *     `<name>` → `"granted" | "prompt" | "denied"`.
 *
 * Replaces `Permissions.prototype.query` with a wrapper that returns a
 * Promise resolving to a `PermissionStatus`-shape object whose `state`
 * property comes from the matrix map. Names not in the map fall through
 * to the original (preserves Chrome's "unsupported permission" behaviour).
 *
 * The returned `PermissionStatus` exposes `.state`, `.name`, and
 * `.onchange = null` to satisfy the probe-page surface.
 *
 * @see PLAN.md §9.5
 * @see tasks/0070-consistency-rules-full.md (permissions)
 */

import type { MatrixV1 } from "@mochi.js/consistency";

function tryParse<T>(s: unknown): T | null {
  if (typeof s !== "string" || s.length === 0) return null;
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
}

export function emitPermissionsModule(matrix: MatrixV1): string {
  const defaults = tryParse<Record<string, string>>(matrix.uaCh["permissions-defaults"]) ?? {};
  if (Object.keys(defaults).length === 0) {
    return `
// ---- permissions spoof (skipped — no matrix.uaCh["permissions-defaults"]) -
`;
  }

  const defaultsLiteral = JSON.stringify(defaults);

  return `
// ---- permissions spoof -----------------------------------------------------
(function() {
  if (typeof navigator === "undefined") return;
  var perms = navigator.permissions;
  if (perms === undefined || perms === null) return;
  if (typeof Permissions === "undefined") return;
  var proto = Permissions.prototype;
  if (proto === undefined || proto === null) return;
  var orig = proto.query;
  if (typeof orig !== "function") return;

  var SPOOF_DEFAULTS = ${defaultsLiteral};

  function makeStatus(name, state) {
    // PermissionStatus is an EventTarget — we don't recreate the full
    // prototype, but the probe-page only reads .state. Add .name +
    // .onchange = null so anti-bot heuristics that check for those see
    // them.
    var status = Object.create(null);
    Object.defineProperty(status, "state", {
      configurable: true, enumerable: true, get: function() { return state; },
    });
    Object.defineProperty(status, "name", {
      configurable: true, enumerable: true, get: function() { return name; },
    });
    status.onchange = null;
    status.addEventListener = function() {};
    status.removeEventListener = function() {};
    status.dispatchEvent = function() { return true; };
    return status;
  }

  function query(descriptor) {
    try {
      var name = descriptor && descriptor.name;
      if (typeof name === "string" && Object.prototype.hasOwnProperty.call(SPOOF_DEFAULTS, name)) {
        return Promise.resolve(makeStatus(name, SPOOF_DEFAULTS[name]));
      }
    } catch (_e) {}
    // Fall through to native — preserves "unsupported permission" rejection.
    return __mochi_apply__.call(orig, this, [descriptor]);
  }
  __mochi_register_native__(query, "query");

  try {
    __mochi_defineProperty__(proto, "query", {
      configurable: true, enumerable: false, writable: true, value: query,
    });
  } catch (_e) {}
})();
`;
}
