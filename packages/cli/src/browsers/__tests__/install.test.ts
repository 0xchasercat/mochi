/**
 * Unit tests for `install.ts` — the resolution layer around the CfT manifest
 * + offline fallback paths. We do NOT exercise actual downloads here; that
 * lives in `install.e2e.test.ts` gated on `MOCHI_E2E=1`.
 *
 * The strategy: drop a fresh-timestamp manifest cache file into a tmpdir and
 * call `resolveDownload` with `cacheDir` pointed at it. This exercises every
 * non-network branch of the resolution logic with deterministic inputs.
 */
import { describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DownloadError, resolveDownload, Sha256MismatchError, UnzipError } from "../install";
import { PINNED_FALLBACK_VERSION } from "../manifest";

const SAMPLE_CHANNEL_RAW = {
  channels: {
    Stable: {
      channel: "Stable",
      version: "148.0.7778.97",
      downloads: {
        chrome: [
          {
            platform: "mac-arm64",
            url: "https://example.com/stable/mac-arm64.zip",
          },
          { platform: "linux64", url: "https://example.com/stable/linux64.zip" },
        ],
      },
    },
    Beta: {
      channel: "Beta",
      version: "149.0.7827.3",
      downloads: {
        chrome: [{ platform: "mac-arm64", url: "https://example.com/beta/mac-arm64.zip" }],
      },
    },
  },
};

const SAMPLE_KNOWN_GOOD_RAW = {
  versions: [
    {
      version: "131.0.6778.85",
      downloads: {
        chrome: [
          { platform: "mac-arm64", url: "https://example.com/v131/mac-arm64.zip" },
          { platform: "linux64", url: "https://example.com/v131/linux64.zip" },
        ],
      },
    },
  ],
};

async function withCache<T>(
  fn: (cacheDir: string) => Promise<T>,
  files: Readonly<Record<string, unknown>> = {},
): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "mochi-install-test-"));
  try {
    for (const [name, payload] of Object.entries(files)) {
      await Bun.write(join(dir, name), JSON.stringify(payload));
    }
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("resolveDownload — channel-driven", () => {
  it("resolves the implicit stable channel for mac-arm64", async () => {
    await withCache(
      async (cacheDir) => {
        const r = await resolveDownload({
          channel: "stable",
          platform: "mac-arm64",
          cacheDir,
        });
        expect(r.version).toBe("148.0.7778.97");
        expect(r.url).toContain("mac-arm64");
        expect(r.fellBackToPinned).toBe(false);
      },
      { "channel-manifest.json": SAMPLE_CHANNEL_RAW },
    );
  });

  it("resolves the beta channel", async () => {
    await withCache(
      async (cacheDir) => {
        const r = await resolveDownload({
          channel: "beta",
          platform: "mac-arm64",
          cacheDir,
        });
        expect(r.version).toBe("149.0.7827.3");
      },
      { "channel-manifest.json": SAMPLE_CHANNEL_RAW },
    );
  });

  it("errors clearly when the channel doesn't ship that platform", async () => {
    await withCache(
      async (cacheDir) => {
        try {
          await resolveDownload({
            channel: "beta",
            platform: "linux64",
            cacheDir,
          });
          throw new Error("expected throw");
        } catch (err) {
          expect(err).toBeInstanceOf(DownloadError);
          expect((err as DownloadError).message).toContain("does not ship");
        }
      },
      { "channel-manifest.json": SAMPLE_CHANNEL_RAW },
    );
  });
});

describe("resolveDownload — explicit version", () => {
  it("resolves when the version + platform exists in the catalog", async () => {
    await withCache(
      async (cacheDir) => {
        const r = await resolveDownload({
          channel: "stable",
          version: "131.0.6778.85",
          platform: "mac-arm64",
          cacheDir,
        });
        expect(r.version).toBe("131.0.6778.85");
        expect(r.url).toContain("/v131/");
      },
      { "known-good-manifest.json": SAMPLE_KNOWN_GOOD_RAW },
    );
  });

  it("errors when the version doesn't exist", async () => {
    await withCache(
      async (cacheDir) => {
        try {
          await resolveDownload({
            channel: "stable",
            version: "999.0.0.0",
            platform: "mac-arm64",
            cacheDir,
          });
          throw new Error("expected throw");
        } catch (err) {
          expect(err).toBeInstanceOf(DownloadError);
          expect((err as DownloadError).message).toContain("not found");
        }
      },
      { "known-good-manifest.json": SAMPLE_KNOWN_GOOD_RAW },
    );
  });
});

describe("resolveDownload — offline fallback", () => {
  it("falls back to the pinned default when offline + no version", async () => {
    await withCache(async (cacheDir) => {
      const r = await resolveDownload({
        channel: "stable",
        platform: "linux64",
        cacheDir,
        offline: true,
      });
      expect(r.version).toBe(PINNED_FALLBACK_VERSION);
      expect(r.fellBackToPinned).toBe(true);
      expect(r.url).toContain(PINNED_FALLBACK_VERSION);
    });
  });

  it("offline + matching pinned version succeeds", async () => {
    await withCache(async (cacheDir) => {
      const r = await resolveDownload({
        channel: "stable",
        version: PINNED_FALLBACK_VERSION,
        platform: "mac-arm64",
        cacheDir,
        offline: true,
      });
      expect(r.version).toBe(PINNED_FALLBACK_VERSION);
      expect(r.fellBackToPinned).toBe(true);
    });
  });

  it("offline + non-pinned version errors clearly", async () => {
    await withCache(async (cacheDir) => {
      try {
        await resolveDownload({
          channel: "stable",
          version: "200.0.0.0",
          platform: "mac-arm64",
          cacheDir,
          offline: true,
        });
        throw new Error("expected throw");
      } catch (err) {
        expect(err).toBeInstanceOf(DownloadError);
        expect((err as DownloadError).cause).toBe("network");
        expect((err as Error).message).toContain("offline");
      }
    });
  });
});

describe("error class shapes", () => {
  it("Sha256MismatchError carries expected/actual fields", () => {
    const e = new Sha256MismatchError("aaa", "bbb");
    expect(e.name).toBe("Sha256MismatchError");
    expect(e.expected).toBe("aaa");
    expect(e.actual).toBe("bbb");
    expect(e.message).toContain("aaa");
    expect(e.message).toContain("bbb");
  });
  it("UnzipError carries the exit code", () => {
    const e = new UnzipError("boom", 42);
    expect(e.exitCode).toBe(42);
  });
  it("DownloadError carries a discriminated cause", () => {
    const e = new DownloadError("network", "no dns");
    expect(e.cause).toBe("network");
  });
});
