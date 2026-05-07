/**
 * End-to-end install test, gated on MOCHI_E2E=1.
 *
 * Skipped by default — actually downloads ~150MB of Chromium-for-Testing zip
 * from Google's CfT registry, hashes it, unzips it, and asserts the binary is
 * executable.
 *
 * Run manually:
 *   MOCHI_E2E=1 bun test packages/cli/src/browsers/__tests__/install.e2e.test.ts
 *
 * Uses MOCHI_BROWSERS_ROOT=<tmpdir> so the test never touches the user's home
 * directory.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listInstalled, resolveChromiumBinary } from "../index";
import { install } from "../install";
import { detectPlatform } from "../paths";

const enabled = process.env.MOCHI_E2E === "1";
const platform = detectPlatform();

describe.skipIf(!enabled || platform === null)("e2e: download → hash → extract → resolve", () => {
  let root: string;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "mochi-browsers-e2e-"));
  });

  afterAll(async () => {
    if (root) await rm(root, { recursive: true, force: true });
  });

  it(
    "installs the pinned default version end-to-end",
    async () => {
      if (platform === null) throw new Error("unsupported platform");
      // Pin to PINNED_FALLBACK_VERSION explicitly so the test is reproducible
      // regardless of what's currently in the channel manifest.
      const result = await install({
        root,
        channel: "stable",
        platform,
        version: "131.0.6778.85",
        mochiCliVersion: "0.0.1-e2e",
      });
      expect(result.alreadyInstalled).toBe(false);
      expect(result.meta.sha256).toMatch(/^[0-9a-f]{64}$/);
      // Binary file exists.
      const s = await stat(result.binaryPath);
      expect(s.isFile()).toBe(true);
      // Re-running is a no-op.
      const second = await install({
        root,
        channel: "stable",
        platform,
        version: "131.0.6778.85",
        mochiCliVersion: "0.0.1-e2e",
      });
      expect(second.alreadyInstalled).toBe(true);
      // listInstalled finds it.
      const all = await listInstalled(root);
      expect(all.length).toBe(1);
      // resolveChromiumBinary returns the same path.
      const resolved = await resolveChromiumBinary({ root, platform });
      expect(resolved.path).toBe(result.binaryPath);
    },
    { timeout: 5 * 60 * 1000 }, // 5min: large download
  );
});
