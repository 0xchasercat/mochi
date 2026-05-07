/**
 * Unit tests for the §8.2 forbidden-method runtime assertions.
 *
 * Each forbidden constraint gets its own test. These assertions are
 * non-negotiable mochi stealth invariants — if any of these tests starts
 * failing, the offending PR violates PLAN.md §8.2.
 */

import { describe, expect, it } from "bun:test";
import {
  assertNotForbidden,
  FORBIDDEN_METHOD_NAMES,
  ForbiddenCdpMethodError,
} from "../cdp/forbidden";

describe("ForbiddenCdpMethodError + assertNotForbidden (PLAN.md §8.2)", () => {
  it("rejects Runtime.enable on any target", () => {
    let thrown: unknown;
    try {
      assertNotForbidden("Runtime.enable", {});
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(ForbiddenCdpMethodError);
    const e = thrown as ForbiddenCdpMethodError;
    expect(e.method).toBe("Runtime.enable");
    expect(e.reason).toContain("PLAN.md §8.2");
  });

  it("rejects Page.createIsolatedWorld", () => {
    let thrown: unknown;
    try {
      assertNotForbidden("Page.createIsolatedWorld", { frameId: "foo" });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(ForbiddenCdpMethodError);
    const e = thrown as ForbiddenCdpMethodError;
    expect(e.method).toBe("Page.createIsolatedWorld");
    expect(e.reason).toContain("PLAN.md §8.2");
    expect(e.reason).toContain("Page.createIsolatedWorld");
  });

  it("rejects Runtime.evaluate when includeCommandLineAPI === true", () => {
    let thrown: unknown;
    try {
      assertNotForbidden("Runtime.evaluate", {
        expression: "1+1",
        includeCommandLineAPI: true,
      });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(ForbiddenCdpMethodError);
    const e = thrown as ForbiddenCdpMethodError;
    expect(e.method).toBe("Runtime.evaluate");
    expect(e.reason).toContain("includeCommandLineAPI");
  });

  it("permits Runtime.evaluate when includeCommandLineAPI is omitted or false", () => {
    expect(() => assertNotForbidden("Runtime.evaluate", { expression: "1+1" })).not.toThrow();
    expect(() =>
      assertNotForbidden("Runtime.evaluate", {
        expression: "1+1",
        includeCommandLineAPI: false,
      }),
    ).not.toThrow();
  });

  it("permits unrelated CDP methods", () => {
    expect(() => assertNotForbidden("Page.navigate", { url: "about:blank" })).not.toThrow();
    expect(() => assertNotForbidden("DOM.getDocument")).not.toThrow();
    expect(() => assertNotForbidden("Target.setAutoAttach", { autoAttach: true })).not.toThrow();
  });

  it("FORBIDDEN_METHOD_NAMES includes both unconditional rejects", () => {
    expect(FORBIDDEN_METHOD_NAMES).toContain("Runtime.enable");
    expect(FORBIDDEN_METHOD_NAMES).toContain("Page.createIsolatedWorld");
  });
});
