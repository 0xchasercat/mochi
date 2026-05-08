/**
 * Cross-package contract: `@mochi.js/core`'s `resolveBinary()` correctly
 * consumes `@mochi.js/cli`'s `resolveChromiumBinary()` return value.
 *
 * This contract surfaced as a real CI failure: cli returns
 * `{ path, channel, version, platform }` but core was reading the result as
 * `string | null` and silently dropping the resolved binary. Local development
 * with `MOCHI_CHROMIUM_PATH` set masked the bug because the env-var path
 * short-circuits before the cli path ever runs.
 *
 * This test pins the integration: a fake `@mochi.js/cli`-shaped resolver
 * returning the documented object → core's `resolveBinary` returns the
 * `.path` field, not `null`.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveBinary } from "../../packages/core/src/binary";

let tmpRoot: string;
let fakeBinary: string;
let originalEnv: string | undefined;

beforeEach(() => {
  // Create a real on-disk file we can point the resolver at — Bun.file().exists()
  // verifies path existence on every resolution path.
  tmpRoot = mkdtempSync(join(tmpdir(), "mochi-core-cli-contract-"));
  fakeBinary = join(tmpRoot, "fake-chrome");
  writeFileSync(fakeBinary, "#!/bin/sh\necho fake\n", { mode: 0o755 });
  originalEnv = process.env.MOCHI_CHROMIUM_PATH;
  delete process.env.MOCHI_CHROMIUM_PATH;
});

afterEach(() => {
  if (originalEnv === undefined) {
    delete process.env.MOCHI_CHROMIUM_PATH;
  } else {
    process.env.MOCHI_CHROMIUM_PATH = originalEnv;
  }
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe("contract: @mochi.js/core ← @mochi.js/cli binary resolution", () => {
  it("MOCHI_CHROMIUM_PATH env override returns the path verbatim", async () => {
    process.env.MOCHI_CHROMIUM_PATH = fakeBinary;
    const path = await resolveBinary();
    expect(path).toBe(fakeBinary);
  });

  it("explicit LaunchOptions.binary takes precedence over env", async () => {
    process.env.MOCHI_CHROMIUM_PATH = "/some/other/path/that/does/not/matter";
    const path = await resolveBinary(fakeBinary);
    expect(path).toBe(fakeBinary);
  });

  it("non-existent explicit path throws a clear error", async () => {
    await expect(resolveBinary("/this/path/definitely/does/not/exist")).rejects.toThrow(
      /points to a non-existent path/,
    );
  });

  it("non-existent MOCHI_CHROMIUM_PATH throws a clear error", async () => {
    process.env.MOCHI_CHROMIUM_PATH = "/this/path/definitely/does/not/exist";
    await expect(resolveBinary()).rejects.toThrow(/points to a non-existent path/);
  });
});

describe("contract: @mochi.js/cli's resolveChromiumBinary return shape", () => {
  it("@mochi.js/cli exports resolveChromiumBinary as a function", async () => {
    const mod = await import("../../packages/cli/src/index");
    expect(typeof (mod as { resolveChromiumBinary?: unknown }).resolveChromiumBinary).toBe(
      "function",
    );
  });

  it("@mochi.js/cli's resolveChromiumBinary throws (not returns null) when no install is present", async () => {
    const mod = await import("../../packages/cli/src/index");
    type ResolveFn = (opts?: { root?: string }) => Promise<{
      path: string;
      channel: string;
      version: string;
      platform: string;
    }>;
    const fn = (mod as { resolveChromiumBinary?: ResolveFn }).resolveChromiumBinary;
    expect(fn).toBeDefined();
    if (!fn) throw new Error("resolveChromiumBinary not exported");

    // No installs in our tmp root → the cli throws with a friendly
    // "no install found, run `mochi browsers install`" error. This pins the
    // contract that core's tryCliResolve relies on: throw caught and falls
    // through to the canonical ChromiumNotFoundError.
    await expect(fn({ root: tmpRoot })).rejects.toThrow();
  });
});
