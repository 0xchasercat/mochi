/**
 * Spoof module: `screen.orientation` and `window.matchMedia(spec)` answers.
 *
 * Reads from the matrix:
 *   - `matrix.uaCh["screen-orientation"]` (R-038) — JSON `{type, angle}`
 *   - `matrix.uaCh["media-queries"]`      (R-039) — JSON map of feature →
 *     answer
 *   - `matrix.uaCh["storage-estimate"]`   (R-040) — JSON `{quota, usage}`.
 *     Optional: when present, also overrides
 *     `navigator.storage.estimate()`.
 *
 * `screen.orientation`: Chrome exposes a `ScreenOrientation` instance with
 * `.type` and `.angle` accessor properties, plus event-target methods. We
 * only override `.type` and `.angle` — that's what fingerprint probes read.
 *
 * `window.matchMedia(spec)`: wrap so that for each tracked feature, the
 * returned `MediaQueryList` reports `matches` according to the matrix's
 * curated answer. Unknown specs fall through to native.
 *
 * @see tasks/0070-consistency-rules-full.md (screen-orientation)
 */

import type { MatrixV1 } from "@mochi.js/consistency";

interface OrientationShape {
  readonly type?: string;
  readonly angle?: number;
}

function tryParse<T>(s: unknown): T | null {
  if (typeof s !== "string" || s.length === 0) return null;
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
}

export function emitScreenOrientationModule(matrix: MatrixV1): string {
  const orientation = tryParse<OrientationShape>(matrix.uaCh["screen-orientation"]);
  const mediaQueries =
    tryParse<Record<string, string | boolean>>(matrix.uaCh["media-queries"]) ?? {};
  const storageEstimate = tryParse<{ quota?: number; usage?: number }>(
    matrix.uaCh["storage-estimate"],
  );

  const orientationLiteral = orientation
    ? JSON.stringify({
        type: typeof orientation.type === "string" ? orientation.type : "landscape-primary",
        angle: typeof orientation.angle === "number" ? orientation.angle : 0,
      })
    : "null";

  const mediaQueriesLiteral = JSON.stringify(mediaQueries);

  const storageEstimateLiteral = storageEstimate
    ? JSON.stringify({
        quota: typeof storageEstimate.quota === "number" ? storageEstimate.quota : 0,
        usage: typeof storageEstimate.usage === "number" ? storageEstimate.usage : 0,
      })
    : "null";

  return `
// ---- screen.orientation + matchMedia + storage.estimate spoof -------------
(function() {
  // -- screen.orientation -------------------------------------------------
  try {
    var SPOOF_ORIENTATION = ${orientationLiteral};
    if (typeof screen !== "undefined" && SPOOF_ORIENTATION !== null) {
      var orientation = screen.orientation;
      if (orientation !== undefined && orientation !== null) {
        __mochi_define__(orientation, "type", SPOOF_ORIENTATION.type);
        __mochi_define__(orientation, "angle", SPOOF_ORIENTATION.angle);
      }
    }
  } catch (_e) {}

  // -- matchMedia answers --------------------------------------------------
  try {
    if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
      var SPOOF_MQ = ${mediaQueriesLiteral};
      var origMatchMedia = window.matchMedia;

      function matchMedia(spec) {
        try {
          if (typeof spec !== "string") return __mochi_apply__.call(origMatchMedia, this, [spec]);
          var s = spec.replace(/^\\(|\\)$/g, "").trim();
          // Forms:  "feature: value"  |  "feature"  |  "min-resolution: <n>dpi"
          var colon = s.indexOf(":");
          var feature, queryValue;
          if (colon === -1) {
            feature = s.trim();
            queryValue = null;
          } else {
            feature = s.slice(0, colon).trim();
            queryValue = s.slice(colon + 1).trim();
          }
          if (Object.prototype.hasOwnProperty.call(SPOOF_MQ, feature)) {
            var spoof = SPOOF_MQ[feature];
            var matches;
            if (queryValue === null) {
              // Boolean form: "(feature)" matches when spoof is truthy.
              matches = spoof === true;
            } else if (feature === "min-resolution") {
              // "min-resolution: <N>dpi" matches when query <= spoof's dpi.
              var qN = parseFloat(queryValue);
              var sN = parseFloat(String(spoof));
              matches = !isNaN(qN) && !isNaN(sN) && sN >= qN;
            } else {
              matches = String(spoof) === queryValue;
            }
            // Build a MediaQueryList-shape stand-in. The probe page reads
            // .matches and .media; the rest are EventTarget no-ops.
            var mql = Object.create(null);
            __mochi_defineProperty__(mql, "matches", {
              configurable: true, enumerable: true, get: function() { return matches; },
            });
            __mochi_defineProperty__(mql, "media", {
              configurable: true, enumerable: true, get: function() { return spec; },
            });
            mql.onchange = null;
            mql.addEventListener = function() {};
            mql.removeEventListener = function() {};
            mql.addListener = function() {};
            mql.removeListener = function() {};
            mql.dispatchEvent = function() { return true; };
            return mql;
          }
        } catch (_e) {}
        return __mochi_apply__.call(origMatchMedia, this, [spec]);
      }
      __mochi_register_native__(matchMedia, "matchMedia");

      try {
        __mochi_defineProperty__(window, "matchMedia", {
          configurable: true, enumerable: true, writable: true, value: matchMedia,
        });
      } catch (_e) {}
    }
  } catch (_e) {}

  // -- storage.estimate ----------------------------------------------------
  try {
    var SPOOF_SE = ${storageEstimateLiteral};
    if (SPOOF_SE !== null && typeof navigator !== "undefined" && navigator.storage) {
      var storage = navigator.storage;
      if (typeof storage.estimate === "function") {
        function estimate() {
          return Promise.resolve({ quota: SPOOF_SE.quota, usage: SPOOF_SE.usage });
        }
        __mochi_register_native__(estimate, "estimate");
        try {
          var sproto = __mochi_getPrototypeOf__(storage);
          var starget = sproto !== null && sproto !== undefined && typeof sproto.estimate === "function"
            ? sproto
            : storage;
          __mochi_defineProperty__(starget, "estimate", {
            configurable: true, enumerable: false, writable: true, value: estimate,
          });
        } catch (_e) {}
      }
    }
  } catch (_e) {}
})();
`;
}
