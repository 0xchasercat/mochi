/**
 * Unit tests for `index.ts` — the listing + resolveChromiumBinary surface.
 *
 * We stand up a fake install root by writing `<dir>/<channel>-<version>-<platform>/.mochi-meta.json`
 * files and asserting the resolution rules produce the right pick.
 */
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ChromiumNotFoundError, listInstalled, resolveChromiumBinary } from "../index";
import type { InstallMeta } from "../install";
import type { CftPlatform, Channel } from "../paths";

interface FakeInstall {
  readonly channel: Channel;
  readonly version: string;
  readonly platform: CftPlatform;
  readonly installedAt: string;
}

async function seedInstall(root: string, fake: FakeInstall): Promise<void> {
  const dir = join(root, `${fake.channel}-${fake.version}-${fake.platform}`);
  await mkdir(dir, { recursive: true });
  const meta: InstallMeta = {
    version: fake.version,
    channel: fake.channel,
    platform: fake.platform,
    sourceUrl: `https://example.com/${fake.version}/${fake.platform}.zip`,
    sha256: "0".repeat(64),
    installedAt: fake.installedAt,
    mochiCliVersion: "0.0.1-test",
  };
  await Bun.write(join(dir, ".mochi-meta.json"), JSON.stringify(meta));
}

describe("listInstalled", () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "mochi-browsers-list-"));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("returns [] when the root does not exist", async () => {
    const out = await listInstalled(join(root, "does-not-exist"));
    expect(out).toEqual([]);
  });

  it("returns [] for an empty root", async () => {
    const out = await listInstalled(root);
    expect(out).toEqual([]);
  });

  it("ignores directories without .mochi-meta.json (e.g. .cache, .tmp-*)", async () => {
    await mkdir(join(root, ".cache"), { recursive: true });
    await mkdir(join(root, ".tmp-abc"), { recursive: true });
    await mkdir(join(root, "stranger"), { recursive: true });
    const out = await listInstalled(root);
    expect(out).toEqual([]);
  });

  it("returns installed entries sorted by installedAt desc", async () => {
    await seedInstall(root, {
      channel: "stable",
      version: "131.0.6778.85",
      platform: "mac-arm64",
      installedAt: "2026-01-01T00:00:00.000Z",
    });
    await seedInstall(root, {
      channel: "stable",
      version: "148.0.7778.97",
      platform: "mac-arm64",
      installedAt: "2026-05-01T00:00:00.000Z",
    });
    const out = await listInstalled(root);
    expect(out.length).toBe(2);
    expect(out[0]?.meta.version).toBe("148.0.7778.97");
    expect(out[1]?.meta.version).toBe("131.0.6778.85");
  });
});

describe("resolveChromiumBinary", () => {
  let root: string;
  let prevEnv: string | undefined;
  let prevPath: string | undefined;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "mochi-browsers-resolve-"));
    prevEnv = process.env.MOCHI_BROWSERS_ROOT;
    prevPath = process.env.MOCHI_CHROMIUM_PATH;
    delete process.env.MOCHI_BROWSERS_ROOT;
    delete process.env.MOCHI_CHROMIUM_PATH;
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
    if (prevEnv === undefined) delete process.env.MOCHI_BROWSERS_ROOT;
    else process.env.MOCHI_BROWSERS_ROOT = prevEnv;
    if (prevPath === undefined) delete process.env.MOCHI_CHROMIUM_PATH;
    else process.env.MOCHI_CHROMIUM_PATH = prevPath;
  });

  it("MOCHI_CHROMIUM_PATH wins over everything else", async () => {
    process.env.MOCHI_CHROMIUM_PATH = "/some/byo/chrome";
    const r = await resolveChromiumBinary({ root, channel: "stable", version: "131.0.6778.85" });
    expect(r.path).toBe("/some/byo/chrome");
    expect(r.version).toBe("env-override");
    expect(r.channel).toBe("env-override");
  });

  it("throws ChromiumNotFoundError when nothing is installed", async () => {
    try {
      await resolveChromiumBinary({ root });
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(ChromiumNotFoundError);
      expect((err as Error).message).toContain("mochi browsers install");
    }
  });

  it("picks the most-recent install when no filter is given", async () => {
    await seedInstall(root, {
      channel: "stable",
      version: "131.0.6778.85",
      platform: "mac-arm64",
      installedAt: "2026-01-01T00:00:00.000Z",
    });
    await seedInstall(root, {
      channel: "beta",
      version: "149.0.7827.3",
      platform: "mac-arm64",
      installedAt: "2026-05-01T00:00:00.000Z",
    });
    const r = await resolveChromiumBinary({ root, platform: "mac-arm64" });
    expect(r.version).toBe("149.0.7827.3");
    expect(r.channel).toBe("beta");
  });

  it("filters by channel — picks most recent in that channel", async () => {
    await seedInstall(root, {
      channel: "stable",
      version: "131.0.6778.85",
      platform: "mac-arm64",
      installedAt: "2026-01-01T00:00:00.000Z",
    });
    await seedInstall(root, {
      channel: "stable",
      version: "148.0.7778.97",
      platform: "mac-arm64",
      installedAt: "2026-04-01T00:00:00.000Z",
    });
    await seedInstall(root, {
      channel: "beta",
      version: "149.0.7827.3",
      platform: "mac-arm64",
      installedAt: "2026-05-01T00:00:00.000Z",
    });
    const r = await resolveChromiumBinary({ root, channel: "stable", platform: "mac-arm64" });
    expect(r.version).toBe("148.0.7778.97");
    expect(r.channel).toBe("stable");
  });

  it("filters by exact version", async () => {
    await seedInstall(root, {
      channel: "stable",
      version: "131.0.6778.85",
      platform: "mac-arm64",
      installedAt: "2026-01-01T00:00:00.000Z",
    });
    await seedInstall(root, {
      channel: "stable",
      version: "148.0.7778.97",
      platform: "mac-arm64",
      installedAt: "2026-04-01T00:00:00.000Z",
    });
    const r = await resolveChromiumBinary({
      root,
      version: "131.0.6778.85",
      platform: "mac-arm64",
    });
    expect(r.version).toBe("131.0.6778.85");
  });

  it("error message includes the filter when nothing matches", async () => {
    await seedInstall(root, {
      channel: "stable",
      version: "131.0.6778.85",
      platform: "mac-arm64",
      installedAt: "2026-01-01T00:00:00.000Z",
    });
    try {
      await resolveChromiumBinary({ root, version: "999.0.0.0", platform: "mac-arm64" });
      throw new Error("expected throw");
    } catch (err) {
      expect((err as Error).message).toContain("version=999.0.0.0");
      expect((err as Error).message).toContain("--version 999.0.0.0");
    }
  });

  it("rejects an unsupported --platform", async () => {
    try {
      await resolveChromiumBinary({ root, platform: "atari-jaguar" });
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(ChromiumNotFoundError);
      expect((err as Error).message).toContain("unsupported platform");
    }
  });
});
