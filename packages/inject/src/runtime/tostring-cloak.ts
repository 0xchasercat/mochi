/**
 * Pure-JS-string runtime helper: `Function.prototype.toString` cloak.
 *
 * Every function we replace must answer `.toString()` with the exact native
 * shape Chrome would emit:
 *
 *   `function ${name}() { [native code] }`
 *
 * Otherwise fingerprint libraries (FPJS, creep.js, sannysoft) detect us by
 * stringifying our overrides and seeing real JS source.
 *
 * Implementation: a single `Function.prototype.toString` proxy that consults
 * a per-spoofed-fn map keyed on the spoofed function reference. Falls
 * through to the *original* `Function.prototype.toString` for everything
 * else — including for the proxy's own toString (Chrome reports
 * `function toString() { [native code] }` for the native one, and that's
 * what users will see when they query our installed proxy too).
 *
 * @see PLAN.md §5.3, tasks/0030 §"toString cloaking"
 */

/**
 * Emit the cloak helper source. Exposes:
 *   - `__mochi_register_native__(fn, name)` — register fn so its toString
 *     returns the native-shape string for `name`.
 *   - implicit: replaces `Function.prototype.toString` once.
 */
export function emitToStringCloak(): string {
  return `
// ---- toString cloak --------------------------------------------------------
// Captured native references — saved BEFORE we install the proxy. PLAN.md §5.3.
var __mochi_originalFnToString__ = Function.prototype.toString;
var __mochi_call__ = Function.prototype.call;
var __mochi_apply__ = Function.prototype.apply;
// Map<Function, string nativeName>. Populated by spoof modules via
// __mochi_register_native__(fn, "navigator.userAgent" or "getParameter").
var __mochi_nativeMap__ = new WeakMap();

function __mochi_register_native__(fn, name) {
  try {
    __mochi_nativeMap__.set(fn, name);
  } catch (_e) {}
}

/**
 * The proxy that replaces \`Function.prototype.toString\`. For registered
 * functions, returns the native-shape string. Otherwise calls the original
 * to keep all other behaviour identical (anonymous fns, arrow fns, builtin
 * native fns we didn't touch, user-defined named functions, etc.).
 *
 * Note: we re-read \`__mochi_nativeMap__\` from the IIFE-local closure rather
 * than from any global — page script can shadow globals but cannot reach
 * into our closure.
 */
function __mochi_fnToString__() {
  // \`this\` is the function being stringified.
  if (this !== undefined && this !== null) {
    var registered = __mochi_nativeMap__.get(this);
    if (registered !== undefined) {
      return "function " + registered + "() { [native code] }";
    }
  }
  // Fall through. Use Function.prototype.call.call (apply form) so we don't
  // recurse if a misbehaving page swapped Function.prototype.toString again.
  return __mochi_call__.call(__mochi_originalFnToString__, this);
}

// Register the proxy itself so that .toString() on our proxy returns the
// native shape (Chrome shows "function toString() { [native code] }" for
// the real one). This makes our proxy indistinguishable from the original
// at the toString-of-toString level.
__mochi_register_native__(__mochi_fnToString__, "toString");

// Install. Critical: configurable:true matches Chrome's native descriptor
// for Function.prototype.toString — fingerprint libraries DO check
// configurable on this slot. enumerable:false also matches native.
try {
  __mochi_defineProperty__(Function.prototype, "toString", {
    configurable: true,
    enumerable: false,
    writable: true,
    value: __mochi_fnToString__,
  });
} catch (_e) {}
`;
}
