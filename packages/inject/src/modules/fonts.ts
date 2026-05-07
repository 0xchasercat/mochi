/**
 * Spoof module: font enumeration.
 *
 * Reads from the matrix:
 *   - `matrix.fonts.list` (R-013) — curated baseline list per OS.
 *
 * v0.3 surface:
 *   - Override `document.fonts` iteration so that `Array.from(document.fonts)`
 *     and `for…of (document.fonts)` enumerate exactly the matrix list.
 *   - Override `document.fonts.size` to match.
 *   - Override `document.fonts.check(spec)` to return true iff the family
 *     parsed from `spec` is in the matrix list.
 *
 * Limitations (documented in docs/limits.md):
 *   - We don't actually load any FontFace; CSS rendering with these
 *     families still uses whatever Chromium has on disk. Probes that
 *     measure rendered glyph bbox / canvas-rendered fonts will see the
 *     real font outlines, not the spoofed list. Phase 0.7 lands canvas
 *     spoofing which closes the loop.
 *   - We don't override the experimental `queryLocalFonts()` API.
 *
 * @see tasks/0030-inject-engine-v0.md §"fonts.ts"
 * @see docs/limits.md §"v0.3 inject limits"
 */

import type { MatrixV1 } from "@mochi.js/consistency";

export function emitFontsModule(matrix: MatrixV1): string {
  // Build a literal of synthetic FontFace-shape entries. Each carries the
  // family + weight/style defaults the FontFaceSet APIs query.
  const entries = matrix.fonts.list.map((family) => ({
    family,
    style: "normal",
    weight: "400",
    stretch: "100%",
    unicodeRange: "U+0-10FFFF",
    variant: "normal",
    featureSettings: "normal",
    display: "auto",
    status: "loaded",
  }));
  const entriesLiteral = JSON.stringify(entries);
  const familySetLiteral = JSON.stringify(matrix.fonts.list);

  return `
// ---- fonts spoof -----------------------------------------------------------
(function() {
  if (typeof document === "undefined") return;
  var fonts = document.fonts;
  if (fonts === undefined || fonts === null) return;

  var SPOOF_ENTRIES = ${entriesLiteral};
  var SPOOF_FAMILIES = ${familySetLiteral};
  // Lowercase set for case-insensitive family matching.
  var SPOOF_FAMILIES_LC = {};
  for (var i = 0; i < SPOOF_FAMILIES.length; i++) {
    SPOOF_FAMILIES_LC[String(SPOOF_FAMILIES[i]).toLowerCase()] = true;
  }

  // Build FontFace-shape stand-ins. We don't construct real FontFace
  // instances (the constructor takes a font URL we don't have); a plain
  // object with the right keys is enough for fingerprint enumeration.
  function buildFakeFonts() {
    var out = [];
    for (var i = 0; i < SPOOF_ENTRIES.length; i++) {
      var e = SPOOF_ENTRIES[i];
      // Prefer the real FontFace prototype if available, but with our data.
      var f = Object.create(typeof FontFace !== "undefined" ? FontFace.prototype : Object.prototype);
      for (var k in e) {
        if (Object.prototype.hasOwnProperty.call(e, k)) {
          try {
            __mochi_defineProperty__(f, k, {
              configurable: true, enumerable: true, get: (function(v) { return function() { return v; }; })(e[k]),
            });
          } catch (_err) {}
        }
      }
      out.push(f);
    }
    return out;
  }

  var fakeList = buildFakeFonts();

  // Replace [Symbol.iterator] on the FontFaceSet so for…of enumerates ours.
  function fontIterator() {
    var idx = 0;
    return {
      next: function() {
        if (idx < fakeList.length) {
          return { value: fakeList[idx++], done: false };
        }
        return { value: undefined, done: true };
      },
      // Iterators in JS must themselves be iterable.
      // (Function.prototype[Symbol.iterator] won't help; we add one.)
    };
  }

  // FontFaceSet has [Symbol.iterator], values(), keys(), entries(), forEach,
  // size, check(), load(). v0.3 covers the enumeration surface plus check;
  // load() falls through to native (it's about loading remote fonts, not
  // fingerprinting).
  try {
    var iterFn = function() {
      var it = fontIterator();
      // Make the iterator iterable (per JS spec it should be self-iterable).
      it[Symbol.iterator] = function() { return it; };
      return it;
    };
    __mochi_register_native__(iterFn, "[Symbol.iterator]");
    __mochi_defineProperty__(fonts, Symbol.iterator, {
      configurable: true, enumerable: false, writable: true, value: iterFn,
    });
  } catch (_e) {}

  // size getter.
  try {
    __mochi_defineProperty__(fonts, "size", {
      configurable: true,
      enumerable: true,
      get: function() { return fakeList.length; },
    });
  } catch (_e) {}

  // forEach — emit each fake entry once.
  function forEach(cb, thisArg) {
    if (typeof cb !== "function") return;
    for (var i = 0; i < fakeList.length; i++) {
      cb.call(thisArg, fakeList[i], fakeList[i], fonts);
    }
  }
  __mochi_register_native__(forEach, "forEach");
  try {
    __mochi_defineProperty__(fonts, "forEach", {
      configurable: true, enumerable: false, writable: true, value: forEach,
    });
  } catch (_e) {}

  // check(spec) — parses the family from a CSS font shorthand and answers
  // true iff that family appears in the spoofed list. Heuristic: take the
  // last non-numeric, non-keyword token as the family. Good enough for
  // common probe shapes like "12px Arial" or "16px 'Comic Sans MS'".
  var origCheck = fonts.check;
  function check(spec, _text) {
    try {
      if (typeof spec !== "string") return false;
      // Strip quoted family if present.
      var m = spec.match(/['"]([^'"]+)['"]\\s*$/);
      var family;
      if (m !== null) {
        family = m[1];
      } else {
        // Last whitespace-separated token.
        var toks = spec.split(/\\s+/);
        family = toks.length > 0 ? toks[toks.length - 1] : "";
      }
      return !!SPOOF_FAMILIES_LC[String(family).toLowerCase()];
    } catch (_e) {
      // Fall back to native if our parser failed.
      if (typeof origCheck === "function") {
        return __mochi_apply__.call(origCheck, fonts, [spec, _text]);
      }
      return false;
    }
  }
  __mochi_register_native__(check, "check");
  try {
    __mochi_defineProperty__(fonts, "check", {
      configurable: true, enumerable: false, writable: true, value: check,
    });
  } catch (_e) {}
})();
`;
}
