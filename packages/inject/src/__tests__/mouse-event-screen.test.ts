/**
 * Unit: `mouse-event-screen` inject module (R-041 lock).
 *
 * Asserts the patched MouseEvent.prototype getters return
 * `clientX + window.screenX` (and Y), and that the descriptor is shaped
 * like Chrome's native `{ configurable: true, enumerable: true }` with a
 * cloaked `[native code]` toString.
 *
 * Sandbox seeds `window.screenX = 50, window.screenY = 75` (see
 * `sandbox.ts`). The fake `MouseEvent` constructor copies clientX/Y from
 * the init dict onto the instance; the patched prototype getter reads
 * those + window.screenX/Y to produce the screen-relative value.
 *
 * @see PLAN.md §5.3
 */

import { describe, expect, it } from "bun:test";
import { buildPayload } from "../build";
import { FIXTURE_MATRIX } from "./fixtures";
import { runPayloadInSandbox } from "./sandbox";

describe("inject runtime overrides — MouseEvent.screenX/screenY (R-041)", () => {
  it("patched screenX returns clientX + window.screenX", () => {
    const { code } = buildPayload(FIXTURE_MATRIX);
    const sb = runPayloadInSandbox(code);
    const Win = sb.window as Record<string, unknown>;
    const wx = Win.screenX as number;
    const ev = new sb.MouseEvent("test", { clientX: 100, clientY: 200 });
    expect((ev as { screenX: number }).screenX).toBe(100 + wx);
  });

  it("patched screenY returns clientY + window.screenY", () => {
    const { code } = buildPayload(FIXTURE_MATRIX);
    const sb = runPayloadInSandbox(code);
    const Win = sb.window as Record<string, unknown>;
    const wy = Win.screenY as number;
    const ev = new sb.MouseEvent("test", { clientX: 100, clientY: 200 });
    expect((ev as { screenY: number }).screenY).toBe(200 + wy);
  });

  it("works with zero coords (clientX=0 → screenX === window.screenX)", () => {
    const { code } = buildPayload(FIXTURE_MATRIX);
    const sb = runPayloadInSandbox(code);
    const Win = sb.window as Record<string, unknown>;
    const ev = new sb.MouseEvent("test", { clientX: 0, clientY: 0 });
    expect((ev as { screenX: number }).screenX).toBe(Win.screenX as number);
    expect((ev as { screenY: number }).screenY).toBe(Win.screenY as number);
  });

  it("descriptor mirrors Chrome's native shape (configurable:true, enumerable:true)", () => {
    const { code } = buildPayload(FIXTURE_MATRIX);
    const sb = runPayloadInSandbox(code);
    const proto = sb.MouseEvent.prototype as Record<string, unknown>;
    const dx = Object.getOwnPropertyDescriptor(proto, "screenX");
    const dy = Object.getOwnPropertyDescriptor(proto, "screenY");
    expect(dx).toBeDefined();
    expect(dy).toBeDefined();
    expect(dx?.configurable).toBe(true);
    expect(dx?.enumerable).toBe(true);
    expect(dy?.configurable).toBe(true);
    expect(dy?.enumerable).toBe(true);
    expect(typeof dx?.get).toBe("function");
    expect(typeof dy?.get).toBe("function");
  });

  it("getter.toString() is cloaked to native shape", () => {
    const { code } = buildPayload(FIXTURE_MATRIX);
    const sb = runPayloadInSandbox(code);
    const proto = sb.MouseEvent.prototype as Record<string, unknown>;
    const dx = Object.getOwnPropertyDescriptor(proto, "screenX");
    const dy = Object.getOwnPropertyDescriptor(proto, "screenY");
    // The toString cloak runs in the sandbox's `Function.prototype.toString`,
    // so we must call into the sandbox to stringify the getter.
    const sbFnToString = (sb.Function.prototype as { toString: (this: unknown) => string })
      .toString;
    const sxStr = sbFnToString.call(dx?.get as unknown);
    const syStr = sbFnToString.call(dy?.get as unknown);
    expect(sxStr).toBe("function get screenX() { [native code] }");
    expect(syStr).toBe("function get screenY() { [native code] }");
  });

  it("payload code includes the mouse-event-screen module marker", () => {
    const { code } = buildPayload(FIXTURE_MATRIX);
    expect(code).toContain("mochi:mouse-event-screen");
    expect(code).toContain("MouseEvent.prototype");
  });
});
