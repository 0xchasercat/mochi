/**
 * Cross-package contract: `@mochi.js/cli` exports the `capture` surface
 * that phase 0.5's `@mochi.js/harness` will consume to share the same
 * probe-page fixture + derive-profile pipeline.
 *
 * The shape pinned here is load-bearing. Changing it requires bumping
 * `@mochi.js/cli` major and updating the harness in lockstep.
 *
 * @see PLAN.md §5.7 / §5.8
 * @see tasks/0040-mochi-capture.md
 */

import { describe, expect, it } from "bun:test";
import {
  type CapturedProbes,
  type CaptureOptions,
  CaptureValidationError,
  collectProvenance,
  deriveProfile,
  findProbePage,
  loadProfileSchema,
  locateProbePage,
  type ProbePageLocation,
  type ProvenanceInputs,
  type ProvenanceRecord,
  renderProvenance,
  runCapture,
  type ValidationError,
  type ValidationResult,
  validate,
} from "../../packages/cli/src/capture/index";

describe("@mochi.js/cli — capture surface contract", () => {
  it("exports runCapture as a function", () => {
    expect(typeof runCapture).toBe("function");
  });

  it("exports deriveProfile as a function", () => {
    expect(typeof deriveProfile).toBe("function");
  });

  it("exports the probe-page locator helpers", () => {
    expect(typeof findProbePage).toBe("function");
    expect(typeof locateProbePage).toBe("function");
  });

  it("exports the provenance helpers", () => {
    expect(typeof collectProvenance).toBe("function");
    expect(typeof renderProvenance).toBe("function");
  });

  it("exports the schema-validation helpers", () => {
    expect(typeof validate).toBe("function");
    expect(typeof loadProfileSchema).toBe("function");
  });

  it("exports CaptureValidationError as a constructable error class", () => {
    const e = new CaptureValidationError("x", [], "/tmp/.invalid");
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe("CaptureValidationError");
    expect(e.invalidDir).toBe("/tmp/.invalid");
  });
});

describe("@mochi.js/cli — capture types compile-time pin", () => {
  it("CaptureOptions accepts the documented shape", () => {
    const opts: CaptureOptions = {
      profileId: "x",
      outDir: "/tmp/x",
      browserPath: "/tmp/chrome",
      seed: "s",
      headless: true,
      interactive: false,
      probeTimeoutMs: 5000,
      provenanceInputs: {
        capturer: "u",
        machine: "u",
        browserVersion: "u",
        mochiVersion: "u",
      },
    };
    expect(opts.profileId).toBe("x");
  });

  it("ProvenanceRecord / ProvenanceInputs / ProbePageLocation / etc. are nameable", () => {
    const p: ProvenanceInputs = { capturer: "u" };
    const r: ProvenanceRecord = {
      profileId: "x",
      capturer: p.capturer ?? "u",
      machine: "u",
      browserVersion: "u",
      mochiVersion: "u",
      capturedAt: "2026-05-08T00:00:00.000Z",
      notes: "",
    };
    const loc: ProbePageLocation = {
      absolutePath: "/x",
      fileUrl: "file:///x",
      repoRoot: "/",
    };
    const probes: CapturedProbes = {};
    const valErr: ValidationError = { path: "/", message: "x" };
    const valRes: ValidationResult = { valid: true, errors: [] };
    expect(r.profileId).toBe("x");
    expect(loc.absolutePath).toBe("/x");
    expect(Object.keys(probes).length).toBe(0);
    expect(valErr.path).toBe("/");
    expect(valRes.valid).toBe(true);
  });
});

describe("@mochi.js/cli — derived profile schema contract", () => {
  it("deriveProfile output passes loadProfileSchema validation for an empty payload", async () => {
    const profile = deriveProfile({}, { profileId: "contract-empty" });
    const schema = await loadProfileSchema();
    const r = validate(profile, schema);
    expect(r.valid).toBe(true);
  });
});
