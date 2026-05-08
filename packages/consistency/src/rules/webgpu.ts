/**
 * WebGPU rules. Cover R-032 (features) and R-033 (adapter info).
 *
 * Both rules emit JSON-encoded values into the open-keyed `uaCh` map: that's
 * the only schema-stable expansion slot at v0.7 (PLAN.md §6.1). The inject-
 * side WebGPU module parses these strings and serves them from
 * `navigator.gpu.requestAdapter().{features,info}`.
 *
 * @see PLAN.md §9.5 (WebGPU adapter info)
 * @see tasks/0070-consistency-rules-full.md
 */

import { defineRule, type Rule } from "../rule";
import { classifyGpuVendor } from "./lookups/gpu";
import { WEBGPU_FEATURES_BY_VENDOR, WEBGPU_INFO_BY_VENDOR } from "./lookups/webgpu";

/**
 * R-032 — `gpu.vendor` → `uaCh.webgpu-features` as a JSON-encoded array of
 * feature strings. Inject parses and exposes via `adapter.features` (a
 * `GPUSupportedFeatures` set).
 */
export const R032: Rule = defineRule<readonly [string], string>({
  id: "R-032",
  description: "WebGPU adapter.features list per GPU vendor class",
  inputs: ["gpu.vendor"],
  output: "uaCh.webgpu-features",
  derive([vendor]) {
    const key = classifyGpuVendor(vendor);
    return JSON.stringify(WEBGPU_FEATURES_BY_VENDOR[key]);
  },
});

/**
 * R-033 — `gpu.vendor` → `uaCh.webgpu-info` as a JSON-encoded `{vendor,
 * architecture, device, description}` shape. Inject parses and exposes via
 * `adapter.info`. Chromium routinely returns empty `device` and
 * `description` for the secure default; only `vendor` and `architecture`
 * carry signal.
 */
export const R033: Rule = defineRule<readonly [string], string>({
  id: "R-033",
  description: "WebGPU adapter.info shape per GPU vendor class",
  inputs: ["gpu.vendor"],
  output: "uaCh.webgpu-info",
  derive([vendor]) {
    const key = classifyGpuVendor(vendor);
    return JSON.stringify(WEBGPU_INFO_BY_VENDOR[key]);
  },
});

export const WEBGPU_RULES: readonly Rule[] = [R032, R033];
