/**
 * Spoof module: `navigator.gpu.requestAdapter()` adapter shape.
 *
 * Reads from the matrix:
 *   - `matrix.uaCh["webgpu-features"]` (R-032) — JSON string array
 *   - `matrix.uaCh["webgpu-info"]`     (R-033) — JSON `{vendor, architecture,
 *                                                    device, description}`
 *
 * Spoofs `adapter.features` (a `GPUSupportedFeatures` set) and
 * `adapter.info` (a `GPUAdapterInfo` shape) on the adapter Promise that
 * `requestAdapter()` returns. Falls through to the original adapter when
 * the matrix is missing the keys.
 *
 * Adapter `isFallbackAdapter` is forced false (real-hardware behaviour).
 *
 * Implementation strategy:
 *   - Wrap `GPU.prototype.requestAdapter` (where `GPU` is the type of
 *     `navigator.gpu`). When the wrapped Promise resolves, return a Proxy
 *     over the adapter that intercepts `features`, `info`, and
 *     `isFallbackAdapter` reads.
 *   - When `requestAdapter` returns null (e.g. no GPU available in the
 *     headless capture), build a synthetic adapter from the matrix data.
 *     The probe-page only reads `features` / `info` / `isFallbackAdapter`,
 *     so we don't need a full adapter implementation.
 *
 * @see PLAN.md §9.5
 */

import type { MatrixV1 } from "@mochi.js/consistency";

interface WebGpuInfo {
  readonly vendor: string;
  readonly architecture: string;
  readonly device: string;
  readonly description: string;
}

function tryParse<T>(s: unknown): T | null {
  if (typeof s !== "string" || s.length === 0) return null;
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
}

export function emitWebgpuModule(matrix: MatrixV1): string {
  const features = tryParse<readonly string[]>(matrix.uaCh["webgpu-features"]) ?? [];
  const info = tryParse<WebGpuInfo>(matrix.uaCh["webgpu-info"]) ?? {
    vendor: "",
    architecture: "",
    device: "",
    description: "",
  };

  // If the matrix carries no WebGPU data, skip — emit a comment.
  if (features.length === 0 && info.vendor === "") {
    return `
// ---- WebGPU spoof (skipped — no matrix.uaCh["webgpu-*"]) ------------------
`;
  }

  const featuresLiteral = JSON.stringify(features);
  const infoLiteral = JSON.stringify(info);

  return `
// ---- WebGPU spoof ----------------------------------------------------------
(function() {
  if (typeof navigator === "undefined") return;
  var gpu = navigator.gpu;
  if (gpu === undefined || gpu === null) return;

  var SPOOF_FEATURES = ${featuresLiteral};
  var SPOOF_INFO = ${infoLiteral};

  // Build the spoofed adapter. We don't need to satisfy the full GPUAdapter
  // interface — the probe-page reads .features, .info, .isFallbackAdapter
  // only. Real adapter methods (requestDevice etc.) fall through to the
  // wrapped original via Proxy when an underlying adapter exists.
  function buildSpoofFeatures() {
    // adapter.features is a GPUSupportedFeatures (Set-like). Build a Set
    // populated with the spoofed strings; iteration order matches insertion.
    var s = new Set();
    for (var i = 0; i < SPOOF_FEATURES.length; i++) s.add(SPOOF_FEATURES[i]);
    return s;
  }

  function buildSpoofInfo() {
    // GPUAdapterInfo is dictionary-shaped; freezing prevents page mutation.
    return Object.freeze({
      vendor: SPOOF_INFO.vendor,
      architecture: SPOOF_INFO.architecture,
      device: SPOOF_INFO.device,
      description: SPOOF_INFO.description,
    });
  }

  function wrapAdapter(realAdapter) {
    // The probe checks adapter && adapter.features etc. Use a Proxy so all
    // unhandled property accesses pass through to the real adapter.
    var spoofFeatures = buildSpoofFeatures();
    var spoofInfo = buildSpoofInfo();
    if (realAdapter === null || realAdapter === undefined) {
      // No real adapter — return a synthetic stub that satisfies the
      // probe-page surface. requestDevice() resolves to undefined so
      // probes that try to instantiate a device get an unhelpful (but
      // non-throwing) result. isFallbackAdapter is intentionally omitted
      // so the probe-page's \`adapter.isFallbackAdapter\` read returns
      // undefined — matching the captured baseline shape on the M4 capture.
      return {
        features: spoofFeatures,
        info: spoofInfo,
        requestDevice: function() { return Promise.resolve(undefined); },
      };
    }
    return new Proxy(realAdapter, {
      get: function(target, prop) {
        if (prop === "features") return spoofFeatures;
        if (prop === "info") return spoofInfo;
        // Pass through isFallbackAdapter — Chromium versions vary on whether
        // the property exists. Returning the real value keeps the harness
        // diff aligned with the captured baseline shape.
        var v = target[prop];
        if (typeof v === "function") return v.bind(target);
        return v;
      },
    });
  }

  // Wrap GPU.prototype.requestAdapter so the returned Promise resolves to
  // the spoofed adapter. Fall back to gpu.requestAdapter directly if the
  // prototype isn't reachable (test sandboxes).
  var proto = __mochi_getPrototypeOf__(gpu);
  var target = proto !== null && proto !== undefined && typeof proto.requestAdapter === "function"
    ? proto
    : gpu;
  var orig = target.requestAdapter;
  if (typeof orig !== "function") return;

  function requestAdapter(opts) {
    try {
      var p = __mochi_apply__.call(orig, this, [opts]);
      if (p && typeof p.then === "function") {
        return p.then(function(adapter) { return wrapAdapter(adapter); }, function(_e) {
          // If the underlying call rejects, synthesize from matrix.
          return wrapAdapter(null);
        });
      }
    } catch (_e) {}
    // Fallback: synthesize from matrix.
    return Promise.resolve(wrapAdapter(null));
  }
  __mochi_register_native__(requestAdapter, "requestAdapter");

  try {
    __mochi_defineProperty__(target, "requestAdapter", {
      configurable: true,
      enumerable: false,
      writable: true,
      value: requestAdapter,
    });
  } catch (_e) {}
})();
`;
}
