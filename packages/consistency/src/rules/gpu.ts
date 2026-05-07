/**
 * GPU + WebGL rules. Cover R-001, R-002, R-003, R-024, R-025.
 *
 * @see tasks/0020-consistency-engine-v0.md
 * @see PLAN.md §9.2
 */

import { defineRule, type Rule } from "../rule";
import {
  classifyGpuVendor,
  deriveWebglUnmaskedRenderer,
  deriveWebglUnmaskedVendor,
  lookupMaxColorAttachments,
  lookupMaxTextureSize,
  WEBGL_EXTENSIONS_BY_VENDOR,
} from "./lookups/gpu";

/** R-001 — `gpu.{vendor,renderer}` → `gpu.webglUnmaskedVendor`. */
export const R001: Rule = defineRule<readonly [string, string], string>({
  id: "R-001",
  description: "WebGL unmasked vendor — Chrome wraps device vendor in 'Google Inc. (...)'",
  inputs: ["gpu.vendor", "gpu.renderer"],
  output: "gpu.webglUnmaskedVendor",
  derive([vendor, renderer]) {
    return deriveWebglUnmaskedVendor(vendor, renderer);
  },
});

/** R-002 — `gpu.{vendor,renderer}` → `gpu.webglUnmaskedRenderer`. */
export const R002: Rule = defineRule<readonly [string, string], string>({
  id: "R-002",
  description: "WebGL unmasked renderer — Chrome wraps device renderer with ANGLE prefix",
  inputs: ["gpu.vendor", "gpu.renderer"],
  output: "gpu.webglUnmaskedRenderer",
  derive([vendor, renderer]) {
    return deriveWebglUnmaskedRenderer(vendor, renderer);
  },
});

/** R-003 — `gpu.renderer` → `gpu.webglMaxTextureSize` (lookup). */
export const R003: Rule = defineRule<readonly [string], number>({
  id: "R-003",
  description: "MAX_TEXTURE_SIZE lookup keyed off renderer family",
  inputs: ["gpu.renderer"],
  output: "gpu.webglMaxTextureSize",
  derive([renderer]) {
    return lookupMaxTextureSize(renderer);
  },
});

/** R-024 — `gpu.vendor` → `gpu.webglExtensions` (curated per vendor). */
export const R024: Rule = defineRule<readonly [string], readonly string[]>({
  id: "R-024",
  description: "Curated WebGL extension list per GPU vendor class",
  inputs: ["gpu.vendor"],
  output: "gpu.webglExtensions",
  derive([vendor]) {
    return [...WEBGL_EXTENSIONS_BY_VENDOR[classifyGpuVendor(vendor)]];
  },
});

/** R-025 — `gpu.renderer` → `gpu.webglMaxColorAttachments` (lookup). */
export const R025: Rule = defineRule<readonly [string], number>({
  id: "R-025",
  description: "MAX_COLOR_ATTACHMENTS lookup — desktop ⇒ 8, mobile ⇒ 4",
  inputs: ["gpu.renderer"],
  output: "gpu.webglMaxColorAttachments",
  derive([renderer]) {
    return lookupMaxColorAttachments(renderer);
  },
});

export const GPU_RULES: readonly Rule[] = [R001, R002, R003, R024, R025];
