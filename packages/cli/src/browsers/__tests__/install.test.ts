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
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assertBinaryLaunches,
  BinarySmokeError,
  DownloadError,
  resolveDownload,
  Sha256MismatchError,
  smokeBinary,
  UnzipError,
} from "../install";
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
  it("BinarySmokeError carries cause + missingLib + stderrTail", () => {
    const e = new BinarySmokeError("missing-libs", "boom", "libnss3.so", "tail");
    expect(e.name).toBe("BinarySmokeError");
    expect(e.cause).toBe("missing-libs");
    expect(e.missingLib).toBe("libnss3.so");
    expect(e.stderrTail).toBe("tail");
  });
});

/**
 * Post-extract `--version` smoke — the deliverable for task 0259's first
 * goal. We stage tiny shell-script "binaries" that simulate Chromium's exit
 * shapes (success, missing-libs stderr, generic exec failure) and assert
 * the smoke classifies them correctly.
 *
 * We skip on Windows because the shell-script trick doesn't translate; the
 * smoke itself runs on Windows but the install command intentionally only
 * runs it on `linux64` (macOS / Windows ship the deps via the OS).
 */
describe.skipIf(process.platform === "win32")("post-install binary smoke", () => {
  async function withFakeBinary<T>(body: string, fn: (path: string) => Promise<T> | T): Promise<T> {
    const dir = await mkdtemp(join(tmpdir(), "mochi-smoke-"));
    try {
      const path = join(dir, "fake-chrome");
      await writeFile(path, `#!/bin/sh\n${body}\n`);
      await chmod(path, 0o755);
      return await fn(path);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  it("returns ok=true when the fake binary prints a version line and exits 0", async () => {
    await withFakeBinary("echo 'Google Chrome for Testing 131.0.6778.85'\nexit 0", (p) => {
      const r = smokeBinary(p);
      expect(r.ok).toBe(true);
      expect(r.versionLine).toContain("131.0.6778.85");
      expect(r.exitCode).toBe(0);
      expect(r.missingLib).toBeNull();
    });
  });

  it("classifies a missing-shared-library stderr as cause='missing-libs' with the .so name", async () => {
    await withFakeBinary(
      "echo 'fake-chrome: error while loading shared libraries: libnss3.so: cannot open shared object file' >&2\nexit 127",
      (p) => {
        try {
          assertBinaryLaunches(p);
          throw new Error("expected throw");
        } catch (err) {
          expect(err).toBeInstanceOf(BinarySmokeError);
          expect((err as BinarySmokeError).cause).toBe("missing-libs");
          expect((err as BinarySmokeError).missingLib).toBe("libnss3.so");
          // Hint must include the apt install line so the user can paste it.
          expect((err as BinarySmokeError).message).toContain("sudo apt-get install");
          expect((err as BinarySmokeError).message).toContain("libnss3");
        }
      },
    );
  });

  it("classifies a generic non-zero exit (no shared-libs hit) as cause='exec'", async () => {
    await withFakeBinary("echo 'fake-chrome: garbled startup' >&2\nexit 1", (p) => {
      try {
        assertBinaryLaunches(p);
        throw new Error("expected throw");
      } catch (err) {
        expect(err).toBeInstanceOf(BinarySmokeError);
        expect((err as BinarySmokeError).cause).toBe("exec");
        expect((err as BinarySmokeError).missingLib).toBeNull();
        expect((err as BinarySmokeError).message).toContain("--force");
      }
    });
  });

  it("smokeBinary returns ok=false on a missing binary path (no throw)", () => {
    // ENOENT path — Bun.spawnSync surfaces this as exitCode != 0 with no
    // stderr. We don't throw; we let `assertBinaryLaunches` handle the
    // throwing semantics, and `smokeBinary` is the testable seam.
    const r = smokeBinary("/no/such/binary/anywhere");
    expect(r.ok).toBe(false);
  });
});
