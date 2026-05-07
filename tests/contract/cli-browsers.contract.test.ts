/**
 * Cross-package contract: `@mochi.js/cli` exports the `resolveChromiumBinary`
 * surface that `@mochi.js/core` (task 0011) will consume.
 *
 * The shape pinned here is the load-bearing one: changing it requires bumping
 * `@mochi.js/cli` major and updating all consumers in lockstep. The tests do
 * not exercise the network — they assert exports exist + behave correctly
 * against an in-memory install fixture.
 *
 * @see PLAN.md §5.8
 * @see tasks/0010-mochi-browsers-install.md "Programmatic API"
 */
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ChromiumNotFoundError,
  defaultInstallRoot,
  detectPlatform,
  type InstalledBrowser,
  type InstallMeta,
  listInstalled,
  PINNED_FALLBACK_VERSION,
  type ResolveChromiumOpts,
  type ResolvedChromium,
  resolveChromiumBinary,
} from "../../packages/cli/src/index";

describe("@mochi.js/cli — browsers surface contract", () => {
  it("exports the resolveChromiumBinary function", () => {
    expect(typeof resolveChromiumBinary).toBe("function");
  });

  it("exports the listInstalled function", () => {
    expect(typeof listInstalled).toBe("function");
  });

  it("exports the defaultInstallRoot helper", () => {
    expect(typeof defaultInstallRoot).toBe("function");
    const r = defaultInstallRoot();
    expect(typeof r).toBe("string");
  });

  it("exports detectPlatform with the CfT-platform-or-null contract", () => {
    expect(typeof detectPlatform).toBe("function");
    const p = detectPlatform();
    if (p !== null) {
      expect(["mac-arm64", "mac-x64", "linux64", "win64"]).toContain(p);
    }
  });

  it("exports ChromiumNotFoundError as a constructable error class", () => {
    const e = new ChromiumNotFoundError("no install");
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe("ChromiumNotFoundError");
  });

  it("exports a non-empty PINNED_FALLBACK_VERSION as a dotted-quad", () => {
    expect(PINNED_FALLBACK_VERSION).toMatch(/^\d+\.\d+\.\d+\.\d+$/);
  });
});

describe("@mochi.js/cli — resolveChromiumBinary semantic contract", () => {
  let root: string;
  let prevPath: string | undefined;
  let prevRoot: string | undefined;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "mochi-cli-contract-"));
    prevPath = process.env.MOCHI_CHROMIUM_PATH;
    prevRoot = process.env.MOCHI_BROWSERS_ROOT;
    delete process.env.MOCHI_CHROMIUM_PATH;
    delete process.env.MOCHI_BROWSERS_ROOT;
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
    if (prevPath === undefined) delete process.env.MOCHI_CHROMIUM_PATH;
    else process.env.MOCHI_CHROMIUM_PATH = prevPath;
    if (prevRoot === undefined) delete process.env.MOCHI_BROWSERS_ROOT;
    else process.env.MOCHI_BROWSERS_ROOT = prevRoot;
  });

  it("returns a ResolvedChromium with the documented fields", async () => {
    // Seed a fake install.
    const installDir = join(root, "stable-131.0.6778.85-mac-arm64");
    await mkdir(installDir, { recursive: true });
    const meta: InstallMeta = {
      version: "131.0.6778.85",
      channel: "stable",
      platform: "mac-arm64",
      sourceUrl: "https://example.com/x.zip",
      sha256: "0".repeat(64),
      installedAt: "2026-05-08T00:00:00.000Z",
      mochiCliVersion: "0.0.1-test",
    };
    await Bun.write(join(installDir, ".mochi-meta.json"), JSON.stringify(meta));

    const opts: ResolveChromiumOpts = { root, platform: "mac-arm64" };
    const r: ResolvedChromium = await resolveChromiumBinary(opts);
    expect(r.path).toContain("Google Chrome for Testing");
    expect(r.channel).toBe("stable");
    expect(r.version).toBe("131.0.6778.85");
    expect(r.platform).toBe("mac-arm64");
  });

  it("MOCHI_CHROMIUM_PATH override returns the env value with version='env-override'", async () => {
    process.env.MOCHI_CHROMIUM_PATH = "/some/byo/chrome";
    const r = await resolveChromiumBinary({ root });
    expect(r.path).toBe("/some/byo/chrome");
    expect(r.version).toBe("env-override");
    expect(r.channel).toBe("env-override");
  });

  it("throws ChromiumNotFoundError pointing at `mochi browsers install`", async () => {
    try {
      await resolveChromiumBinary({ root });
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(ChromiumNotFoundError);
      expect((err as Error).message).toContain("mochi browsers install");
    }
  });

  it("listInstalled returns InstalledBrowser[] with the documented shape", async () => {
    const installDir = join(root, "stable-131.0.6778.85-mac-arm64");
    await mkdir(installDir, { recursive: true });
    const meta: InstallMeta = {
      version: "131.0.6778.85",
      channel: "stable",
      platform: "mac-arm64",
      sourceUrl: "https://example.com/x.zip",
      sha256: "0".repeat(64),
      installedAt: "2026-05-08T00:00:00.000Z",
      mochiCliVersion: "0.0.1-test",
    };
    await Bun.write(join(installDir, ".mochi-meta.json"), JSON.stringify(meta));

    const all: InstalledBrowser[] = await listInstalled(root);
    expect(all.length).toBe(1);
    const first = all[0];
    if (!first) throw new Error("expected one entry");
    expect(first.installDir).toBe(installDir);
    expect(first.binaryPath).toContain("Google Chrome for Testing");
    expect(first.meta.version).toBe("131.0.6778.85");
  });
});
