/**
 * Phase 0.6 unit smoke tests for `@mochi.js/net`.
 *
 * The network E2E (`MOCHI_NET_E2E=1`) lives in
 * `tests/contract/net-ja4.contract.test.ts`. This file is the ABI-shape
 * surface — exports, dylib-resolution, marshalling helpers — and runs
 * without network or a built dylib (we don't `loadLib` here).
 */

import { describe, expect, it } from "bun:test";
import * as net from "../index";

describe("@mochi.js/net public surface", () => {
  it("exports VERSION", () => {
    expect(net.VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("exports the FFI helpers", () => {
    expect(typeof net.openCtx).toBe("function");
    expect(typeof net.requestOnCtx).toBe("function");
    expect(typeof net.fetch).toBe("function");
    expect(typeof net.nativeVersion).toBe("function");
    expect(typeof net.dylibCandidates).toBe("function");
    expect(typeof net.resolveDylibPath).toBe("function");
  });

  it("dylibCandidates includes target/release path under workspace root", () => {
    const candidates = net.dylibCandidates();
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates.some((c) => /target\/release\/libmochi_net\./.test(c))).toBe(true);
  });

  it("dylibCandidates includes the postinstall native/ asset for supported platforms", () => {
    const candidates = net.dylibCandidates();
    const fileName = net.nativeAssetFileName();
    if (fileName === null) {
      // Unsupported platform — only the cargo-build paths should be present.
      // Sanity: no `mochi_net-` (native asset) candidate appears.
      expect(candidates.some((c) => /\/native\/mochi_net-/.test(c))).toBe(false);
      return;
    }
    expect(candidates.some((c) => c.endsWith(`/native/${fileName}`))).toBe(true);
  });

  it("native/ candidate is preferred over target/release (postinstall over cargo)", () => {
    // Only meaningful on a supported platform; otherwise this is a no-op.
    const fileName = net.nativeAssetFileName();
    if (fileName === null) return;
    const candidates = net.dylibCandidates();
    const nativeIdx = candidates.findIndex((c) => c.endsWith(`/native/${fileName}`));
    const cargoReleaseIdx = candidates.findIndex((c) => /target\/release\/libmochi_net\./.test(c));
    expect(nativeIdx).toBeGreaterThanOrEqual(0);
    expect(cargoReleaseIdx).toBeGreaterThanOrEqual(0);
    expect(nativeIdx).toBeLessThan(cargoReleaseIdx);
  });

  it("MOCHI_NET_DYLIB env override is the first candidate", () => {
    const prev = process.env.MOCHI_NET_DYLIB;
    process.env.MOCHI_NET_DYLIB = "/tmp/synthetic-mochi-net-test.dylib";
    try {
      const candidates = net.dylibCandidates();
      expect(candidates[0]).toBe("/tmp/synthetic-mochi-net-test.dylib");
    } finally {
      if (prev === undefined) delete process.env.MOCHI_NET_DYLIB;
      else process.env.MOCHI_NET_DYLIB = prev;
    }
  });

  it("resolveDylibPath errors helpfully when the dylib is missing", () => {
    const prev = process.env.MOCHI_NET_DYLIB;
    process.env.MOCHI_NET_DYLIB = "/tmp/definitely-does-not-exist-mochi-net.dylib";
    try {
      // We can't easily stub existsSync here without mocking modules, so we
      // just check that *some* path-not-found shape is thrown when the
      // override is bogus AND no real build exists. If a real release build
      // happens to exist, this test still passes via the workspace path —
      // we then assert the resolved path includes libmochi_net.
      try {
        const p = net.resolveDylibPath();
        expect(p).toMatch(/(libmochi_net|mochi_net-)\./);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        expect(msg).toMatch(/no @mochi\.js\/net-rs binary found/);
      }
    } finally {
      if (prev === undefined) delete process.env.MOCHI_NET_DYLIB;
      else process.env.MOCHI_NET_DYLIB = prev;
    }
  });
});
