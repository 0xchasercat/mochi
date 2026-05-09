/**
 * Unit: phase-0.7 spoof modules.
 *
 * The new modules (webgpu, media-devices, permissions, network-info,
 * screen-orientation) read JSON-encoded uaCh keys produced by R-031..R-040.
 * The sandbox in `sandbox.ts` doesn't yet stand up navigator.gpu /
 * mediaDevices / permissions / connection / matchMedia, so these tests
 * assert the SHAPE of the emitted JS rather than its runtime semantics —
 * matching the pattern used by `payload-shape.test.ts`. Runtime semantics
 * are exercised by the harness E2E gate against real Chromium.
 *
 */

import { describe, expect, it } from "bun:test";
import { buildPayload } from "../build";
import { emitMediaDevicesModule } from "../modules/media-devices";
import { emitNetworkInfoModule } from "../modules/network-info";
import { emitPermissionsModule } from "../modules/permissions";
import { emitScreenOrientationModule } from "../modules/screen-orientation";
import { emitWebgpuModule } from "../modules/webgpu";
import { FIXTURE_MATRIX } from "./fixtures";

/**
 * Fixture extended with the phase-0.7 uaCh keys. Mirrors the JSON shapes
 * produced by R-031..R-040 in `@mochi.js/consistency`.
 */
const PHASE07_MATRIX = {
  ...FIXTURE_MATRIX,
  uaCh: {
    ...FIXTURE_MATRIX.uaCh,
    "ua-full-version-list": JSON.stringify([
      { brand: "Google Chrome", version: "131.0.6778.110" },
      { brand: "Not.A/Brand", version: "8.0.0.0" },
      { brand: "Chromium", version: "131.0.6778.110" },
    ]),
    "webgpu-features": JSON.stringify(["depth32float-stencil8", "shader-f16"]),
    "webgpu-info": JSON.stringify({
      vendor: "apple",
      architecture: "metal-3",
      device: "",
      description: "",
    }),
    "media-devices": JSON.stringify([
      { kind: "audioinput", label: "" },
      { kind: "videoinput", label: "" },
    ]),
    "media-supported-constraints": JSON.stringify({ deviceId: true, groupId: true }),
    "permissions-defaults": JSON.stringify({ geolocation: "prompt", accelerometer: "granted" }),
    connection: JSON.stringify({ effectiveType: "4g", downlink: 10, rtt: 50, saveData: false }),
    "screen-orientation": JSON.stringify({ type: "landscape-primary", angle: 0 }),
    "media-queries": JSON.stringify({ "prefers-color-scheme": "light", monochrome: false }),
    "storage-estimate": JSON.stringify({ quota: 1_000_000_000, usage: 0 }),
  },
};

describe("phase-0.7 modules — webgpu", () => {
  it("emits a non-empty module when uaCh.webgpu-features is present", () => {
    const code = emitWebgpuModule(PHASE07_MATRIX);
    expect(code).toContain("WebGPU spoof");
    expect(code).toContain("requestAdapter");
    expect(code).toContain("metal-3");
    expect(code).toContain("shader-f16");
  });

  it("skips when matrix has no webgpu data", () => {
    const code = emitWebgpuModule(FIXTURE_MATRIX);
    expect(code).toContain("WebGPU spoof (skipped");
  });
});

describe("phase-0.7 modules — media-devices", () => {
  it("emits enumerateDevices override + seeded deterministic IDs", () => {
    const code = emitMediaDevicesModule(PHASE07_MATRIX);
    expect(code).toContain("enumerateDevices");
    expect(code).toContain("getSupportedConstraints");
    // Deterministic IDs: the deviceId hex appears twice in the source
    // (once per device) — we verify the substring shape, not the exact
    // bytes (those depend on profile.id + seed).
    expect(code).toMatch(/"deviceId":"[a-f0-9]{64}"/);
    expect(code).toMatch(/"groupId":"[a-f0-9]{64}"/);
  });

  it("derives stable IDs per (profile, seed)", () => {
    const a = emitMediaDevicesModule(PHASE07_MATRIX);
    const b = emitMediaDevicesModule(PHASE07_MATRIX);
    expect(a).toBe(b);
  });

  it("derives different IDs per seed", () => {
    const a = emitMediaDevicesModule(PHASE07_MATRIX);
    const b = emitMediaDevicesModule({ ...PHASE07_MATRIX, seed: "fixture-seed-other" });
    expect(a).not.toBe(b);
  });
});

describe("phase-0.7 modules — permissions", () => {
  it("emits Permissions.prototype.query override", () => {
    const code = emitPermissionsModule(PHASE07_MATRIX);
    expect(code).toContain("Permissions.prototype");
    expect(code).toContain('"geolocation":"prompt"');
    expect(code).toContain('"accelerometer":"granted"');
  });

  it("skips when defaults are missing", () => {
    const code = emitPermissionsModule(FIXTURE_MATRIX);
    expect(code).toContain("permissions spoof (skipped");
  });
});

describe("phase-0.7 modules — network-info", () => {
  it("emits effectiveType + downlink + rtt + saveData defines", () => {
    const code = emitNetworkInfoModule(PHASE07_MATRIX);
    expect(code).toContain("effectiveType");
    expect(code).toContain('"4g"');
    expect(code).toContain("10");
    expect(code).toContain("50");
  });
});

describe("phase-0.7 modules — screen-orientation + matchMedia", () => {
  it("emits orientation + matchMedia + storage.estimate spoofs", () => {
    const code = emitScreenOrientationModule(PHASE07_MATRIX);
    expect(code).toContain("landscape-primary");
    expect(code).toContain("matchMedia");
    expect(code).toContain("estimate");
  });
});

describe("phase-0.7 — full payload integration", () => {
  it("buildPayload includes all phase-0.7 module markers", () => {
    const { code } = buildPayload(PHASE07_MATRIX);
    expect(code).toContain("mochi:webgpu");
    expect(code).toContain("mochi:media-devices");
    expect(code).toContain("mochi:permissions");
    expect(code).toContain("mochi:network-info");
    expect(code).toContain("mochi:screen-orientation");
  });

  it("buildPayload deterministic for identical phase-0.7 fixture", () => {
    const a = buildPayload(PHASE07_MATRIX);
    const b = buildPayload(PHASE07_MATRIX);
    expect(a.sha256).toBe(b.sha256);
  });

  it("buildPayload differs when phase-0.7 fixture changes", () => {
    const a = buildPayload(PHASE07_MATRIX);
    const b = buildPayload({
      ...PHASE07_MATRIX,
      uaCh: {
        ...PHASE07_MATRIX.uaCh,
        "screen-orientation": JSON.stringify({ type: "portrait-primary", angle: 90 }),
      },
    });
    expect(a.sha256).not.toBe(b.sha256);
  });
});
