/**
 * Pure-JS-string runtime helper: `__mochi_define__`.
 *
 * Emits the JS source for a tiny helper that wraps `Object.defineProperty`
 * with the descriptor shape mochi uses for every spoofed property:
 *
 *   - `configurable: false` so page code cannot re-define our overrides
 *     (PLAN.md §5.3 — "Every override uses Object.defineProperty with
 *     configurable: false so page code can't unwrap us by re-defining").
 *   - `enumerable` matched to the original native descriptor so that
 *     `for…in` enumeration and `Object.keys` shape stays Chrome-natural.
 *   - Accessor (`get`) form by default — most spoofed Navigator/Screen
 *     surface is accessor-style natively. A separate helper is provided
 *     for value-style props if a future module needs it.
 *
 * The helper captures the *original* `Object.defineProperty` and
 * `Object.getOwnPropertyDescriptor` references inside the IIFE closure so
 * page scripts running later can't observe a swapped-out
 * `Object.defineProperty` to detect us.
 *
 * @see PLAN.md §5.3, §8.4
 * @see tasks/0030-inject-engine-v0.md
 */

/**
 * Emit the helper source. The returned string is concatenated into the IIFE
 * by `build.ts`. After this snippet runs, the helper is available on the
 * IIFE-local scope as `__mochi_define__` and `__mochi_define_value__`.
 */
export function emitDefinePropertyHelper(): string {
  return `
// ---- defineProperty helper -------------------------------------------------
// Captured natives — used by every spoof module. We grab references inside
// the IIFE so page-script overrides of these globals can't trip us.
var __mochi_defineProperty__ = Object.defineProperty;
var __mochi_getOwnPropertyDescriptor__ = Object.getOwnPropertyDescriptor;
var __mochi_getPrototypeOf__ = Object.getPrototypeOf;

/**
 * Replace an accessor property with a spoofed getter while preserving the
 * original descriptor's enumerability. \`configurable\` is forced to false so
 * page script can't redefine — see PLAN.md §5.3.
 *
 * The created getter is registered with the toString cloak (after that
 * helper is installed) so \`getter.toString()\` returns native shape — see
 * PLAN.md §5.3. The string key is used as the registered "native name" so
 * fingerprint libraries that stringify the descriptor's getter see the
 * expected accessor.
 *
 * Silently no-ops on non-existent or non-configurable target descriptors so
 * we never throw a TypeError that page code could detect.
 */
function __mochi_define__(target, key, value) {
  try {
    var d = __mochi_getOwnPropertyDescriptor__(target, key);
    if (d === undefined) {
      // Walk the prototype chain to find the descriptor's natural shape.
      var p = __mochi_getPrototypeOf__(target);
      while (p !== null && p !== undefined) {
        var pd = __mochi_getOwnPropertyDescriptor__(p, key);
        if (pd !== undefined) { d = pd; break; }
        p = __mochi_getPrototypeOf__(p);
      }
    }
    var enumerable = d !== undefined ? !!d.enumerable : true;
    var getter = function() { return value; };
    // Register the getter with the toString cloak if available. The cloak
    // installs \`__mochi_register_native__\` immediately after this helper
    // is emitted, so by the time spoof modules call \`__mochi_define__\` it
    // is in scope. The native name is the property key (Chrome's native
    // accessors stringify as \`function get propName() { [native code] }\`
    // but stock fingerprint libraries match on \`[native code]\` substring,
    // so we standardize on \`function key() { [native code] }\`).
    if (typeof __mochi_register_native__ === "function") {
      __mochi_register_native__(getter, "get " + String(key));
    }
    __mochi_defineProperty__(target, key, {
      configurable: false,
      enumerable: enumerable,
      get: getter,
    });
  } catch (_e) {
    // Swallow — never let our injection throw to page script. PLAN.md §5.3.
  }
}

/**
 * Like \`__mochi_define__\` but for value-style properties (e.g. when we want
 * the descriptor to be \`{ value, writable: false }\` rather than an accessor).
 * Currently unused in v0.3 modules but kept for future modules.
 */
function __mochi_define_value__(target, key, value) {
  try {
    var d = __mochi_getOwnPropertyDescriptor__(target, key);
    var enumerable = d !== undefined ? !!d.enumerable : true;
    __mochi_defineProperty__(target, key, {
      configurable: false,
      enumerable: enumerable,
      writable: false,
      value: value,
    });
  } catch (_e) {}
}
`;
}
