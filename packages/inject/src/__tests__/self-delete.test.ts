/**
 * Unit: self-deletion of init globals.
 *
 * After the payload runs, no `__mochi*` keys may be visible on `window`.
 * The IIFE captures all helpers as locals, but a tail-of-IIFE cleanup
 * sweeps `window` for any stragglers.
 */

import { describe, expect, it } from "bun:test";
import { buildPayload } from "../build";
import { FIXTURE_MATRIX } from "./fixtures";
import { runPayloadInSandbox } from "./sandbox";

describe("self-delete — no __mochi* globals leak", () => {
  it("window has no __mochi-prefixed own properties after run", () => {
    const { code } = buildPayload(FIXTURE_MATRIX);
    const sb = runPayloadInSandbox(code);
    const keys = Object.getOwnPropertyNames(sb.window);
    const leaked = keys.filter((k) => k.startsWith("__mochi"));
    expect(leaked).toEqual([]);
  });

  it("removes any pre-planted __mochi globals", () => {
    const { code } = buildPayload(FIXTURE_MATRIX);
    // Plant before the IIFE runs.
    const planted = `(function(){ window.__mochi_planted__ = 'x'; window.__mochi_oops__ = 'y'; })();${code}`;
    const sb = runPayloadInSandbox(planted);
    expect((sb.window as Record<string, unknown>).__mochi_planted__).toBeUndefined();
    expect((sb.window as Record<string, unknown>).__mochi_oops__).toBeUndefined();
  });
});
