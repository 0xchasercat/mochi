/**
 * GPU lookup tables — small static maps that translate primitive GPU
 * identifiers (vendor + renderer) into derived WebGL parameters.
 *
 * v0.2 covers the v1 catalog profiles (Apple M-series, Intel Iris Xe,
 * AMD Radeon, NVIDIA RTX, Adreno mobile placeholder). Real device-specific
 * data for the full catalog lands in phase 0.7.
 *
 * @see PLAN.md §9.5 / tasks/0020 R-001..R-003, R-024, R-025
 */

/**
 * Coarse vendor classification used for table keys. Anything we don't
 * recognize maps to `"other"`, which the rule layer surfaces as the
 * conservative "Google Inc." fallback Chrome historically emits.
 */
export type GpuVendorKey = "apple" | "intel" | "amd" | "nvidia" | "qualcomm" | "other";

/**
 * Classify a `gpu.vendor` string. We're tolerant of casing and the
 * "Google Inc. (X)" disclosure-extension wrapping that Chrome uses.
 */
export function classifyGpuVendor(vendor: string): GpuVendorKey {
  const v = vendor.toLowerCase();
  if (v.includes("apple")) return "apple";
  if (v.includes("intel")) return "intel";
  if (v.includes("amd") || v.includes("ati") || v.includes("radeon")) return "amd";
  if (v.includes("nvidia") || v.includes("geforce")) return "nvidia";
  if (v.includes("qualcomm") || v.includes("adreno")) return "qualcomm";
  return "other";
}

/**
 * Compose the WEBGL_debug_renderer_info `UNMASKED_VENDOR_WEBGL` string the
 * way Chrome reports it. Chrome wraps the underlying vendor in
 * `"Google Inc. (<vendor>)"` on most platforms.
 */
export function deriveWebglUnmaskedVendor(vendor: string, _renderer: string): string {
  // Direct passthrough when the input already includes "Google Inc.".
  if (vendor.toLowerCase().startsWith("google inc.")) return vendor;
  return `Google Inc. (${vendor})`;
}

/**
 * Compose the WEBGL_debug_renderer_info `UNMASKED_RENDERER_WEBGL` string.
 * Chrome wraps the renderer with the ANGLE backend name on macOS/Windows.
 *
 * The profile may supply the renderer in either of three shapes:
 *   1. fully wrapped — `"ANGLE (Apple, ANGLE Metal Renderer: Apple M4 Max, Unspecified Version)"`
 *   2. half-wrapped — `"ANGLE Metal Renderer: Apple M4 Max"` (Chromium-internal form)
 *   3. raw — `"Apple M2"` / `"Intel Iris Xe Graphics"` (vendor doc form)
 *
 * Chrome's WebGL `getParameter(UNMASKED_RENDERER_WEBGL)` always emits form 1.
 * v0.7: detect form 1 via the literal `"ANGLE ("` prefix (with paren) and
 * pass through; otherwise wrap. Form 2 ("ANGLE Metal Renderer: ...") is
 * pulled into the Apple wrapper since the inner string IS the renderer
 * Chrome reports inside the wrap.
 */
export function deriveWebglUnmaskedRenderer(vendor: string, renderer: string): string {
  // Already wrapped form (`"ANGLE ("`) — pass through verbatim. Note we
  // require the open paren so half-wrapped `"ANGLE Metal Renderer: …"`
  // strings still hit the wrap branch below. v0.5 used a substring check
  // that conflated the two forms; the harness gate flipped it.
  if (renderer.startsWith("ANGLE (")) return renderer;
  const vendorKey = classifyGpuVendor(vendor);
  switch (vendorKey) {
    case "apple": {
      // Strip a leading `"ANGLE Metal Renderer: "` (form 2) so we don't
      // double-prefix the wrapped output.
      const inner = renderer.replace(/^ANGLE Metal Renderer: */i, "");
      return `ANGLE (Apple, ANGLE Metal Renderer: ${inner}, Unspecified Version)`;
    }
    case "intel":
      return `ANGLE (Intel, ${renderer}, OpenGL 4.1)`;
    case "amd":
      return `ANGLE (AMD, ${renderer}, OpenGL 4.1)`;
    case "nvidia":
      return `ANGLE (NVIDIA, ${renderer}, OpenGL 4.1)`;
    case "qualcomm":
      return `ANGLE (Qualcomm, Adreno (TM) ${renderer}, OpenGL 3.2)`;
    default:
      return `ANGLE (${renderer})`;
  }
}

/**
 * `MAX_TEXTURE_SIZE` lookup. Modern desktop GPUs report 16384 almost
 * universally; older / mobile parts vary. Conservative fallback: 16384.
 */
export function lookupMaxTextureSize(renderer: string): number {
  const r = renderer.toLowerCase();
  if (r.includes("apple m") || r.includes("apple a")) return 16384;
  if (r.includes("iris xe") || r.includes("uhd graphics")) return 16384;
  if (r.includes("intel hd graphics 4")) return 8192;
  if (r.includes("radeon rx 5") || r.includes("radeon rx 6") || r.includes("radeon rx 7"))
    return 16384;
  if (r.includes("geforce rtx") || r.includes("geforce gtx 1") || r.includes("geforce gtx 16"))
    return 16384;
  if (r.includes("adreno 6") || r.includes("adreno 7")) return 16384;
  if (r.includes("adreno 5")) return 8192;
  return 16384;
}

/**
 * `MAX_COLOR_ATTACHMENTS`. WebGL 2 minimum is 4; modern desktop reports 8.
 * Mobile typically reports 4.
 */
export function lookupMaxColorAttachments(renderer: string): number {
  const r = renderer.toLowerCase();
  if (r.includes("adreno") || r.includes("mali")) return 4;
  return 8;
}

/**
 * Curated WebGL extension list per vendor class. v0.2 ships a baseline
 * subset — the full per-device list is captured at probe time in phase 0.7.
 * The order matches what Chrome reports in `getSupportedExtensions()` (the
 * order itself is a fingerprint surface).
 */
export const WEBGL_EXTENSIONS_BY_VENDOR: Readonly<Record<GpuVendorKey, readonly string[]>> = {
  apple: [
    "ANGLE_instanced_arrays",
    "EXT_blend_minmax",
    "EXT_color_buffer_half_float",
    "EXT_float_blend",
    "EXT_frag_depth",
    "EXT_shader_texture_lod",
    "EXT_texture_compression_bptc",
    "EXT_texture_compression_rgtc",
    "EXT_texture_filter_anisotropic",
    "EXT_sRGB",
    "OES_element_index_uint",
    "OES_fbo_render_mipmap",
    "OES_standard_derivatives",
    "OES_texture_float",
    "OES_texture_float_linear",
    "OES_texture_half_float",
    "OES_texture_half_float_linear",
    "OES_vertex_array_object",
    "WEBGL_color_buffer_float",
    "WEBGL_compressed_texture_astc",
    "WEBGL_compressed_texture_etc",
    "WEBGL_compressed_texture_etc1",
    "WEBGL_compressed_texture_s3tc",
    "WEBGL_debug_renderer_info",
    "WEBGL_debug_shaders",
    "WEBGL_depth_texture",
    "WEBGL_draw_buffers",
    "WEBGL_lose_context",
    "WEBGL_multi_draw",
  ],
  intel: [
    "ANGLE_instanced_arrays",
    "EXT_blend_minmax",
    "EXT_color_buffer_half_float",
    "EXT_float_blend",
    "EXT_frag_depth",
    "EXT_shader_texture_lod",
    "EXT_texture_compression_bptc",
    "EXT_texture_compression_rgtc",
    "EXT_texture_filter_anisotropic",
    "EXT_sRGB",
    "OES_element_index_uint",
    "OES_fbo_render_mipmap",
    "OES_standard_derivatives",
    "OES_texture_float",
    "OES_texture_float_linear",
    "OES_texture_half_float",
    "OES_texture_half_float_linear",
    "OES_vertex_array_object",
    "WEBGL_color_buffer_float",
    "WEBGL_compressed_texture_s3tc",
    "WEBGL_compressed_texture_s3tc_srgb",
    "WEBGL_debug_renderer_info",
    "WEBGL_debug_shaders",
    "WEBGL_depth_texture",
    "WEBGL_draw_buffers",
    "WEBGL_lose_context",
    "WEBGL_multi_draw",
  ],
  amd: [
    "ANGLE_instanced_arrays",
    "EXT_blend_minmax",
    "EXT_color_buffer_half_float",
    "EXT_float_blend",
    "EXT_frag_depth",
    "EXT_shader_texture_lod",
    "EXT_texture_compression_bptc",
    "EXT_texture_compression_rgtc",
    "EXT_texture_filter_anisotropic",
    "EXT_sRGB",
    "OES_element_index_uint",
    "OES_fbo_render_mipmap",
    "OES_standard_derivatives",
    "OES_texture_float",
    "OES_texture_float_linear",
    "OES_texture_half_float",
    "OES_texture_half_float_linear",
    "OES_vertex_array_object",
    "WEBGL_color_buffer_float",
    "WEBGL_compressed_texture_s3tc",
    "WEBGL_compressed_texture_s3tc_srgb",
    "WEBGL_debug_renderer_info",
    "WEBGL_debug_shaders",
    "WEBGL_depth_texture",
    "WEBGL_draw_buffers",
    "WEBGL_lose_context",
    "WEBGL_multi_draw",
  ],
  nvidia: [
    "ANGLE_instanced_arrays",
    "EXT_blend_minmax",
    "EXT_color_buffer_half_float",
    "EXT_float_blend",
    "EXT_frag_depth",
    "EXT_shader_texture_lod",
    "EXT_texture_compression_bptc",
    "EXT_texture_compression_rgtc",
    "EXT_texture_filter_anisotropic",
    "EXT_sRGB",
    "OES_element_index_uint",
    "OES_fbo_render_mipmap",
    "OES_standard_derivatives",
    "OES_texture_float",
    "OES_texture_float_linear",
    "OES_texture_half_float",
    "OES_texture_half_float_linear",
    "OES_vertex_array_object",
    "WEBGL_color_buffer_float",
    "WEBGL_compressed_texture_s3tc",
    "WEBGL_compressed_texture_s3tc_srgb",
    "WEBGL_debug_renderer_info",
    "WEBGL_debug_shaders",
    "WEBGL_depth_texture",
    "WEBGL_draw_buffers",
    "WEBGL_lose_context",
    "WEBGL_multi_draw",
  ],
  qualcomm: [
    "ANGLE_instanced_arrays",
    "EXT_blend_minmax",
    "EXT_color_buffer_half_float",
    "EXT_frag_depth",
    "EXT_shader_texture_lod",
    "EXT_texture_filter_anisotropic",
    "OES_element_index_uint",
    "OES_standard_derivatives",
    "OES_texture_float",
    "OES_texture_half_float",
    "OES_vertex_array_object",
    "WEBGL_compressed_texture_astc",
    "WEBGL_compressed_texture_etc",
    "WEBGL_debug_renderer_info",
    "WEBGL_lose_context",
  ],
  other: [
    "ANGLE_instanced_arrays",
    "EXT_blend_minmax",
    "OES_element_index_uint",
    "OES_standard_derivatives",
    "OES_texture_float",
    "OES_vertex_array_object",
    "WEBGL_debug_renderer_info",
    "WEBGL_lose_context",
  ],
};
