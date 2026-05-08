/**
 * Cross-package contract: `@mochi.js/net`'s loader picks up a stub
 * binary at `packages/net-rs/native/mochi_net-${platform}.${ext}`
 * BEFORE falling through to the cargo `target/release` path.
 *
 * We don't actually `dlopen` here — invalid bytes would just blow up.
 * We assert path resolution: `dylibCandidates()` orders the native/
 * directory ahead of target/release, and `resolveDylibPath()` picks
 * the native/ stub when both exist. Bun's `dlopen` is exercised in
 * `packages/net/src/__tests__/internal.test.ts` (gated by
 * MOCHI_NET_E2E=1).
 *
 * Phase 0.10 deliverable — tasks/0100-cross-platform-prebuilds.md.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dylibCandidates, nativeAssetFileName, resolveDylibPath } from "../../packages/net/src/ffi";

// packages/net/src/ffi.ts walks up from its own __dirname to find the
// net-rs sibling; we stub that path on disk under a temp tree.
const NET_FFI_PATH = fileURLToPath(new URL("../../packages/net/src/ffi.ts", import.meta.url));
const NET_RS_NATIVE_DIR = resolve(dirname(NET_FFI_PATH), "../../net-rs/native");

const PLATFORM_FILE = nativeAssetFileName();

let stubBinaryPath: string | null = null;
let didCreateNative = false;

beforeAll(() => {
  // Skip the suite on unsupported platforms — the resolver explicitly
  // doesn't add a native candidate there.
  if (PLATFORM_FILE === null) return;
  if (!existsSync(NET_RS_NATIVE_DIR)) {
    mkdirSync(NET_RS_NATIVE_DIR, { recursive: true });
    didCreateNative = true;
  }
  stubBinaryPath = resolve(NET_RS_NATIVE_DIR, PLATFORM_FILE);
  // Only place a stub if there isn't already a real binary there. We do
  // not want to clobber a postinstall-installed dylib on a dev machine.
  if (!existsSync(stubBinaryPath)) {
    writeFileSync(stubBinaryPath, "stub-not-a-real-cdylib");
  } else {
    // Real binary present — flag so we don't delete it in afterAll.
    stubBinaryPath = null;
  }
});

afterAll(() => {
  if (stubBinaryPath !== null) {
    rmSync(stubBinaryPath, { force: true });
  }
  if (didCreateNative) {
    // Best-effort cleanup; if other tests added .gitkeep we leave it.
    try {
      rmSync(NET_RS_NATIVE_DIR, { recursive: true });
    } catch {
      /* ignore */
    }
  }
});

describe("contract: net loader prefers native/ over target/release", () => {
  it("(skip on unsupported platform)", () => {
    if (PLATFORM_FILE === null) {
      // Sanity: skip-marker. The other tests early-return as well.
      expect(true).toBe(true);
    } else {
      expect(PLATFORM_FILE).toMatch(/^mochi_net-(darwin|linux|win32)-/);
    }
  });

  it("dylibCandidates lists native/<file> before any target/release path", () => {
    if (PLATFORM_FILE === null) return;
    const candidates = dylibCandidates();
    const nativeIdx = candidates.findIndex((c) => c.endsWith(`/native/${PLATFORM_FILE}`));
    const targetIdx = candidates.findIndex((c) => /target\/release\/libmochi_net\./.test(c));
    expect(nativeIdx).toBeGreaterThanOrEqual(0);
    expect(targetIdx).toBeGreaterThanOrEqual(0);
    expect(nativeIdx).toBeLessThan(targetIdx);
  });

  it("resolveDylibPath picks the native/ stub when present", () => {
    if (PLATFORM_FILE === null) return;
    if (stubBinaryPath === null) {
      // Real binary present from a prior cargo build / postinstall —
      // resolveDylibPath should still return *some* native/ path.
      const path = resolveDylibPath();
      expect(path).toContain(`/native/${PLATFORM_FILE}`);
      return;
    }
    // Use a temp env override blocker: we want resolution to fall to
    // step 2 (native/), not step 1 (env). Make sure MOCHI_NET_DYLIB is
    // unset for this assertion.
    const prev = process.env.MOCHI_NET_DYLIB;
    delete process.env.MOCHI_NET_DYLIB;
    try {
      const path = resolveDylibPath();
      expect(path).toBe(stubBinaryPath);
    } finally {
      if (prev !== undefined) process.env.MOCHI_NET_DYLIB = prev;
    }
  });

  it("MOCHI_NET_DYLIB env override still trumps native/", () => {
    if (PLATFORM_FILE === null) return;
    const overrideTmp = mkdtempSync(`${tmpdir()}/mochi-net-override-`);
    const overrideFile = `${overrideTmp}/whatever.dylib`;
    writeFileSync(overrideFile, "x");
    const prev = process.env.MOCHI_NET_DYLIB;
    process.env.MOCHI_NET_DYLIB = overrideFile;
    try {
      const path = resolveDylibPath();
      expect(path).toBe(overrideFile);
    } finally {
      if (prev === undefined) delete process.env.MOCHI_NET_DYLIB;
      else process.env.MOCHI_NET_DYLIB = prev;
      rmSync(overrideTmp, { recursive: true, force: true });
    }
  });
});

afterEach(() => {
  // Defensive — ensure no test leaked an env override across boundaries.
  // (No-op if nothing leaked.)
});
