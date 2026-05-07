/**
 * Spoof module: `WebGLRenderingContext.prototype.getParameter` +
 * `WebGL2RenderingContext.prototype.getParameter`.
 *
 * Replaces the prototype's `getParameter` with a wrapper that:
 *   - returns the matrix value for `UNMASKED_VENDOR_WEBGL` (37445),
 *     `UNMASKED_RENDERER_WEBGL` (37446), `MAX_TEXTURE_SIZE` (3379),
 *     and `MAX_COLOR_ATTACHMENTS` (36063, WebGL2 only).
 *   - falls through to the original `getParameter` for all other queries.
 *
 * The `WEBGL_debug_renderer_info` extension's masked constants (37445/37446)
 * are queried via `getParameter` directly on the context — Chrome returns
 * the unmasked vendor/renderer regardless of whether the extension was
 * obtained, in headless / non-strict mode. The matrix's
 * `gpu.webglUnmaskedVendor/Renderer` are the spoofed values.
 *
 * Caveats:
 *   - `WebGL2RenderingContext.prototype.getParameter` is a separate slot
 *     (it overrides the WebGL1 inherited method in some Chrome builds; in
 *     others it shares — we patch both defensively).
 *   - We don't currently spoof the `WEBGL_debug_renderer_info` extension's
 *     `getParameter` path (that's the same path; both routes call the
 *     proto's getParameter which we've patched).
 *
 * @see tasks/0030-inject-engine-v0.md §"webgl.ts"
 */

import type { MatrixV1 } from "@mochi.js/consistency";

/** GLenum constants we care about. Hard-coded to avoid Chrome dependence. */
const UNMASKED_VENDOR_WEBGL = 0x9245; // 37445
const UNMASKED_RENDERER_WEBGL = 0x9246; // 37446
const MAX_TEXTURE_SIZE = 0x0d33; // 3379
const MAX_COLOR_ATTACHMENTS = 0x8cdf; // 36063 (WebGL2)

export function emitWebglModule(matrix: MatrixV1): string {
  const vendor = JSON.stringify(matrix.gpu.webglUnmaskedVendor);
  const renderer = JSON.stringify(matrix.gpu.webglUnmaskedRenderer);
  const maxTex = String(matrix.gpu.webglMaxTextureSize);
  const maxAttach = String(matrix.gpu.webglMaxColorAttachments);

  return `
// ---- WebGL spoof -----------------------------------------------------------
(function() {
  var UNMASKED_VENDOR_WEBGL = ${UNMASKED_VENDOR_WEBGL};
  var UNMASKED_RENDERER_WEBGL = ${UNMASKED_RENDERER_WEBGL};
  var MAX_TEXTURE_SIZE = ${MAX_TEXTURE_SIZE};
  var MAX_COLOR_ATTACHMENTS = ${MAX_COLOR_ATTACHMENTS};
  var SPOOF_VENDOR = ${vendor};
  var SPOOF_RENDERER = ${renderer};
  var SPOOF_MAX_TEX = ${maxTex};
  var SPOOF_MAX_ATTACH = ${maxAttach};

  /**
   * Patch one prototype's getParameter slot. The wrapper preserves
   * \`this\` and forwards to the original for non-spoofed pnames.
   */
  function patch(proto, isWebgl2) {
    if (proto === undefined || proto === null) return;
    var orig = proto.getParameter;
    if (typeof orig !== "function") return;

    function getParameter(pname) {
      if (pname === UNMASKED_VENDOR_WEBGL) return SPOOF_VENDOR;
      if (pname === UNMASKED_RENDERER_WEBGL) return SPOOF_RENDERER;
      if (pname === MAX_TEXTURE_SIZE) return SPOOF_MAX_TEX;
      if (isWebgl2 && pname === MAX_COLOR_ATTACHMENTS) return SPOOF_MAX_ATTACH;
      // Use Function.prototype.call.call (apply form) on the captured original
      // to defend against any later page-side mutation of orig.call.
      return __mochi_apply__.call(orig, this, [pname]);
    }
    __mochi_register_native__(getParameter, "getParameter");

    // Replace the proto slot. configurable:true matches Chrome native.
    try {
      __mochi_defineProperty__(proto, "getParameter", {
        configurable: true,
        enumerable: false,
        writable: true,
        value: getParameter,
      });
    } catch (_e) {}
  }

  if (typeof WebGLRenderingContext !== "undefined") {
    patch(WebGLRenderingContext.prototype, false);
  }
  if (typeof WebGL2RenderingContext !== "undefined") {
    patch(WebGL2RenderingContext.prototype, true);
  }
})();
`;
}
