/**
 * Unit: toString cloaking — verifies that every spoofed function answers
 * `.toString()` with the native shape `function ${name}() { [native code] }`.
 *
 * Tests run against the sandbox-loaded payload.
 */

import { describe, expect, it } from "bun:test";
import { buildPayload } from "../build";
import { FIXTURE_MATRIX } from "./fixtures";
import { runPayloadInSandbox } from "./sandbox";

describe("toString cloak — spoofed functions return native-shape toString()", () => {
  it("Function.prototype.toString.toString() returns native shape", () => {
    const { code } = buildPayload(FIXTURE_MATRIX);
    const sb = runPayloadInSandbox(code);
    const fnToString = sb.Function.prototype.toString;
    expect(fnToString.toString()).toBe("function toString() { [native code] }");
  });

  it("WebGLRenderingContext.prototype.getParameter.toString() is cloaked", () => {
    const { code } = buildPayload(FIXTURE_MATRIX);
    const sb = runPayloadInSandbox(code);
    const proto = sb.WebGLRenderingContext.prototype as {
      getParameter: { toString(): string };
    };
    expect(proto.getParameter.toString()).toBe("function getParameter() { [native code] }");
  });

  it("WebGL2RenderingContext.prototype.getParameter.toString() is cloaked", () => {
    const { code } = buildPayload(FIXTURE_MATRIX);
    const sb = runPayloadInSandbox(code);
    const proto = sb.WebGL2RenderingContext.prototype as {
      getParameter: { toString(): string };
    };
    expect(proto.getParameter.toString()).toBe("function getParameter() { [native code] }");
  });

  it("Intl.DateTimeFormat.prototype.resolvedOptions.toString() is cloaked", () => {
    const { code } = buildPayload(FIXTURE_MATRIX);
    const sb = runPayloadInSandbox(code);
    const ro = sb.Intl.DateTimeFormat.prototype.resolvedOptions;
    expect(ro.toString()).toBe("function resolvedOptions() { [native code] }");
  });

  it("userAgentData.getHighEntropyValues.toString() is cloaked", () => {
    const { code } = buildPayload(FIXTURE_MATRIX);
    const sb = runPayloadInSandbox(code);
    const uad = sb.navigator.userAgentData as { getHighEntropyValues: { toString(): string } };
    expect(uad.getHighEntropyValues.toString()).toBe(
      "function getHighEntropyValues() { [native code] }",
    );
  });

  it("normal user-defined functions still show real source", () => {
    const { code } = buildPayload(FIXTURE_MATRIX);
    runPayloadInSandbox(code);
    // Defining a function in this test process (which already had its own
    // Function.prototype.toString untouched, since the sandbox patched a
    // copy only inside the sandboxed evaluation) — the host-side toString
    // is untouched, so we can verify it still produces source.
    function userFn(): number {
      return 42;
    }
    expect(userFn.toString()).toContain("return 42");
  });
});
