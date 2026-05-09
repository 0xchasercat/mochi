/**
 * WebGPU lookup tables — adapter info + features list keyed by GPU vendor.
 *
 * The WebGPU `requestAdapter()` API exposes:
 *   - `adapter.features` — a `GPUSupportedFeatures` set; iterable strings.
 *   - `adapter.info` — `{ vendor, architecture, device, description }`.
 *   - `adapter.isFallbackAdapter` — `false` on real hardware.
 *
 * Captured baselines (e.g. `mac-m4-chrome-stable/baseline.manifest.json`)
 * carry the exact features list + info shape Chrome reports for that
 * device. v0.7 ships per-vendor curated lists keyed by GPU vendor class.
 *
 * @see PLAN.md §9.5 (WebGPU adapter info — phase 0.7)
 */

import type { GpuVendorKey } from "./gpu";

/**
 * `adapter.info` shape per vendor. `device` and `description` are typically
 * empty strings on Chrome's secure default ("masked" adapter info); only
 * `vendor` and `architecture` carry signal. Captured Mac M4 baseline shows
 * `architecture: "metal-3"`, `vendor: "apple"`.
 */
export interface WebGpuAdapterInfo {
  readonly vendor: string;
  readonly architecture: string;
  readonly device: string;
  readonly description: string;
}

export const WEBGPU_INFO_BY_VENDOR: Readonly<Record<GpuVendorKey, WebGpuAdapterInfo>> = {
  apple: { vendor: "apple", architecture: "metal-3", device: "", description: "" },
  intel: { vendor: "intel", architecture: "xe", device: "", description: "" },
  amd: { vendor: "amd", architecture: "rdna-3", device: "", description: "" },
  nvidia: { vendor: "nvidia", architecture: "ada", device: "", description: "" },
  qualcomm: { vendor: "qualcomm", architecture: "adreno-7", device: "", description: "" },
  other: { vendor: "", architecture: "", device: "", description: "" },
};

/**
 * Curated `adapter.features` lists per vendor. Order matters — iteration
 * order over `GPUSupportedFeatures` is fingerprintable. Lists derived from
 * the captured baselines under `packages/profiles/data/<id>/baseline.manifest.json`
 * (web-gpu probe). Refresh per Chrome major.
 *
 * Apple Silicon list — captured from `mac-m4-chrome-stable` 2026-05-08:
 * 22 features in this exact order.
 */
export const WEBGPU_FEATURES_BY_VENDOR: Readonly<Record<GpuVendorKey, readonly string[]>> = {
  apple: [
    "depth32float-stencil8",
    "rg11b10ufloat-renderable",
    "texture-formats-tier1",
    "bgra8unorm-storage",
    "texture-compression-bc",
    "dual-source-blending",
    "core-features-and-limits",
    "float32-filterable",
    "indirect-first-instance",
    "texture-compression-astc-sliced-3d",
    "float32-blendable",
    "texture-compression-astc",
    "texture-compression-etc2",
    "depth-clip-control",
    "texture-compression-bc-sliced-3d",
    "shader-f16",
    "timestamp-query",
    "clip-distances",
    "texture-formats-tier2",
    "primitive-index",
    "texture-component-swizzle",
    "subgroups",
  ],
  // Conservative cross-vendor lists; expand as captures land per vendor.
  intel: [
    "depth32float-stencil8",
    "rg11b10ufloat-renderable",
    "texture-formats-tier1",
    "bgra8unorm-storage",
    "texture-compression-bc",
    "dual-source-blending",
    "core-features-and-limits",
    "float32-filterable",
    "indirect-first-instance",
    "depth-clip-control",
    "shader-f16",
    "timestamp-query",
  ],
  amd: [
    "depth32float-stencil8",
    "rg11b10ufloat-renderable",
    "texture-formats-tier1",
    "bgra8unorm-storage",
    "texture-compression-bc",
    "dual-source-blending",
    "core-features-and-limits",
    "float32-filterable",
    "indirect-first-instance",
    "depth-clip-control",
    "shader-f16",
    "timestamp-query",
  ],
  nvidia: [
    "depth32float-stencil8",
    "rg11b10ufloat-renderable",
    "texture-formats-tier1",
    "bgra8unorm-storage",
    "texture-compression-bc",
    "dual-source-blending",
    "core-features-and-limits",
    "float32-filterable",
    "indirect-first-instance",
    "depth-clip-control",
    "shader-f16",
    "timestamp-query",
  ],
  qualcomm: ["texture-compression-astc", "texture-compression-etc2", "core-features-and-limits"],
  other: ["core-features-and-limits"],
};
