/**
 * Spoof module: `MouseEvent.prototype.screenX` / `screenY`.
 *
 * Closes a relational-consistency leak (PLAN.md I-5) on CDP-dispatched
 * mouse events. When `Input.dispatchMouseEvent` synthesizes a click, the
 * `screenX`/`screenY` slots come from the dispatch params and DO NOT
 * include the browser window's screen offset — sites reading
 * `event.screenX` see e.g. `0` or a viewport-relative value rather than
 * the screen-relative coord a real OS-level mouse event would carry.
 *
 * Real-user mouse events satisfy:
 *   `event.screenX === event.clientX + window.screenX`
 *   `event.screenY === event.clientY + window.screenY`
 *
 * We patch the prototype getters to return that derived value so dispatched
 * events match what real input devices emit. The replacement getters are
 * registered with the toString cloak so `Object.getOwnPropertyDescriptor(
 * MouseEvent.prototype, "screenX").get.toString()` returns the native shape
 * `function get screenX() { [native code] }`.
 *
 * Source-cited reference: puppeteer-real-browser
 * `lib/cjs/module/pageController.js:48-58`. Origin:
 * `TheFalloutOf76/CDP-bug-MouseEvent-.screenX-.screenY-patcher`.
 *
 * No matrix inputs — the patch is a relational identity, not a value spoof.
 *
 * @see PLAN.md §5.3, §8.4
 */

export function emitMouseEventScreenModule(): string {
  return `
// ---- MouseEvent.screenX / screenY prototype patch -------------------------
(function() {
  if (typeof MouseEvent === "undefined" || !MouseEvent.prototype) return;
  var proto = MouseEvent.prototype;

  // Capture original descriptors so we can mirror enumerable/configurable.
  // Chrome's native: { configurable: true, enumerable: true, get: native }.
  var dx = __mochi_getOwnPropertyDescriptor__(proto, "screenX");
  var dy = __mochi_getOwnPropertyDescriptor__(proto, "screenY");
  var configurableX = dx !== undefined ? !!dx.configurable : true;
  var enumerableX   = dx !== undefined ? !!dx.enumerable   : true;
  var configurableY = dy !== undefined ? !!dy.configurable : true;
  var enumerableY   = dy !== undefined ? !!dy.enumerable   : true;

  function screenX() {
    var cx = this !== undefined && this !== null ? this.clientX : 0;
    var wx = typeof window !== "undefined" && typeof window.screenX === "number"
      ? window.screenX : 0;
    return cx + wx;
  }
  function screenY() {
    var cy = this !== undefined && this !== null ? this.clientY : 0;
    var wy = typeof window !== "undefined" && typeof window.screenY === "number"
      ? window.screenY : 0;
    return cy + wy;
  }
  __mochi_register_native__(screenX, "get screenX");
  __mochi_register_native__(screenY, "get screenY");

  try {
    __mochi_defineProperty__(proto, "screenX", {
      configurable: configurableX, enumerable: enumerableX, get: screenX,
    });
  } catch (_e) {}
  try {
    __mochi_defineProperty__(proto, "screenY", {
      configurable: configurableY, enumerable: enumerableY, get: screenY,
    });
  } catch (_e) {}
})();
`;
}
