/**
 * Unit: payload shape and determinism.
 *
 *   - `buildPayload` returns a non-empty IIFE string.
 *   - The string parses as valid JS (`new Function` accepts it).
 *   - Same matrix → byte-identical code → identical sha256.
 *   - Differs across matrices.
 *   - sha256 is 64 hex chars.
 *   - `code` is wrapped in a single top-level IIFE.
 *
 * @see tasks/0030-inject-engine-v0.md §"payload-shape.test.ts"
 */

import { describe, expect, it } from "bun:test";
import { buildPayload } from "../build";
import { FIXTURE_MATRIX } from "./fixtures";

describe("buildPayload — payload shape and determinism", () => {
  it("returns code + sha256", () => {
    const out = buildPayload(FIXTURE_MATRIX);
    expect(typeof out.code).toBe("string");
    expect(out.code.length).toBeGreaterThan(0);
    expect(typeof out.sha256).toBe("string");
    expect(out.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("wraps code in a single top-level IIFE", () => {
    const { code } = buildPayload(FIXTURE_MATRIX);
    // Allow leading whitespace; first non-whitespace token must be `(`.
    expect(code.trimStart().startsWith("(function")).toBe(true);
    // Tail must close the IIFE and invoke it.
    expect(code.trimEnd().endsWith("})();")).toBe(true);
  });

  it("parses as valid JS (new Function accepts it)", () => {
    const { code } = buildPayload(FIXTURE_MATRIX);
    // We don't EXECUTE it here (no DOM); we only confirm it parses.
    expect(() => new Function(code)).not.toThrow();
  });

  it("is deterministic across calls (same matrix → identical code)", () => {
    const a = buildPayload(FIXTURE_MATRIX);
    const b = buildPayload(FIXTURE_MATRIX);
    expect(a.code).toBe(b.code);
    expect(a.sha256).toBe(b.sha256);
  });

  it("changes when the matrix's userAgent changes", () => {
    const a = buildPayload(FIXTURE_MATRIX);
    const b = buildPayload({ ...FIXTURE_MATRIX, userAgent: "Mozilla/5.0 (different)" });
    expect(a.sha256).not.toBe(b.sha256);
    expect(a.code).not.toBe(b.code);
  });

  it("ignores derivedAt for byte stability", () => {
    // Per the build doc: only fields used by spoof modules affect output.
    // The header banner does NOT include derivedAt, so changing it must
    // not change the bytes.
    const a = buildPayload(FIXTURE_MATRIX);
    const b = buildPayload({ ...FIXTURE_MATRIX, derivedAt: "2099-12-31T23:59:59.999Z" });
    expect(a.sha256).toBe(b.sha256);
  });

  it("respects the soft size budget (≤ 80 KB)", () => {
    const { code } = buildPayload(FIXTURE_MATRIX);
    expect(new TextEncoder().encode(code).length).toBeLessThanOrEqual(80 * 1024);
  });
});
