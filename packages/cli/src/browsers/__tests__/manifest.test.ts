/**
 * Unit tests for `manifest.ts` — parsing + lookup + cache layer.
 *
 * These tests are pure: no real network. The cache layer is exercised against
 * a tmpdir via the public functions but only through the `noCache` path or a
 * pre-seeded JSON file we drop ourselves; we never hit the live registry.
 */
import { describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  channelKey,
  findChannelDownload,
  findVersionDownload,
  ManifestFetchError,
  PINNED_FALLBACK_CHANNEL,
  PINNED_FALLBACK_VERSION,
  parseChannelManifest,
  parseKnownGoodManifest,
} from "../manifest";

const SAMPLE_CHANNEL = {
  timestamp: "2026-05-07T09:05:34.164Z",
  channels: {
    Stable: {
      channel: "Stable",
      version: "148.0.7778.97",
      downloads: {
        chrome: [
          {
            platform: "linux64",
            url: "https://storage.googleapis.com/chrome-for-testing-public/148.0.7778.97/linux64/chrome-linux64.zip",
          },
          {
            platform: "mac-arm64",
            url: "https://storage.googleapis.com/chrome-for-testing-public/148.0.7778.97/mac-arm64/chrome-mac-arm64.zip",
          },
          {
            platform: "win64",
            url: "https://storage.googleapis.com/chrome-for-testing-public/148.0.7778.97/win64/chrome-win64.zip",
          },
          // CfT may add unknown platforms over time; we silently drop.
          { platform: "ios-arm64", url: "https://example.com/never.zip" },
        ],
      },
    },
    Beta: {
      channel: "Beta",
      version: "149.0.7827.3",
      downloads: {
        chrome: [
          {
            platform: "mac-arm64",
            url: "https://example.com/beta/mac-arm64.zip",
          },
        ],
      },
    },
  },
};

const SAMPLE_KNOWN_GOOD = {
  timestamp: "2026-05-07T09:05:34.171Z",
  versions: [
    {
      version: "131.0.6778.85",
      downloads: {
        chrome: [
          {
            platform: "mac-arm64",
            url: "https://storage.googleapis.com/chrome-for-testing-public/131.0.6778.85/mac-arm64/chrome-mac-arm64.zip",
          },
          {
            platform: "linux64",
            url: "https://storage.googleapis.com/chrome-for-testing-public/131.0.6778.85/linux64/chrome-linux64.zip",
          },
        ],
      },
    },
    {
      version: "132.0.6834.10",
      downloads: {
        chrome: [
          {
            platform: "linux64",
            url: "https://storage.googleapis.com/chrome-for-testing-public/132.0.6834.10/linux64/chrome-linux64.zip",
          },
        ],
      },
    },
  ],
};

describe("parseChannelManifest", () => {
  it("parses the canonical sample shape", () => {
    const m = parseChannelManifest(SAMPLE_CHANNEL);
    expect(m.channels.Stable).toBeDefined();
    expect(m.channels.Stable?.version).toBe("148.0.7778.97");
    // Unknown platforms (ios-arm64) are filtered out.
    expect(m.channels.Stable?.downloads.length).toBe(3);
    expect(m.channels.Stable?.downloads.find((d) => d.platform === "linux64")).toBeDefined();
  });

  it("throws ManifestFetchError(parse) for a non-object payload", () => {
    expect(() => parseChannelManifest("oops")).toThrow(ManifestFetchError);
    expect(() => parseChannelManifest(null)).toThrow(ManifestFetchError);
    expect(() => parseChannelManifest([1, 2, 3])).toThrow(ManifestFetchError);
  });

  it("throws when channels.<name>.version is missing", () => {
    expect(() =>
      parseChannelManifest({
        channels: { Stable: { downloads: { chrome: [] } } },
      }),
    ).toThrow(/version/);
  });
});

describe("parseKnownGoodManifest", () => {
  it("parses the canonical sample shape", () => {
    const m = parseKnownGoodManifest(SAMPLE_KNOWN_GOOD);
    expect(m.versions.length).toBe(2);
    expect(m.versions[0]?.version).toBe("131.0.6778.85");
  });

  it("throws ManifestFetchError(parse) for a non-object payload", () => {
    expect(() => parseKnownGoodManifest({ versions: "not-array" })).toThrow(ManifestFetchError);
    expect(() => parseKnownGoodManifest({})).toThrow(/versions/);
  });

  it("silently skips entries missing required fields rather than failing the whole parse", () => {
    // Robustness: registry occasionally has partial entries; we want the rest to remain usable.
    const m = parseKnownGoodManifest({
      versions: [
        { version: "131.0.6778.85", downloads: { chrome: [] } },
        { downloads: { chrome: [] } }, // no version → skip
        null,
        "garbage",
      ],
    });
    expect(m.versions.length).toBe(1);
    expect(m.versions[0]?.version).toBe("131.0.6778.85");
  });
});

describe("findChannelDownload", () => {
  const m = parseChannelManifest(SAMPLE_CHANNEL);

  it("finds a stable mac-arm64 url", () => {
    const dl = findChannelDownload(m, "stable", "mac-arm64");
    expect(dl?.version).toBe("148.0.7778.97");
    expect(dl?.url).toContain("mac-arm64.zip");
  });

  it("finds a beta mac-arm64 url", () => {
    const dl = findChannelDownload(m, "beta", "mac-arm64");
    expect(dl?.version).toBe("149.0.7827.3");
  });

  it("returns null when the channel does not ship that platform", () => {
    expect(findChannelDownload(m, "beta", "linux64")).toBeNull();
  });
});

describe("findVersionDownload", () => {
  const m = parseKnownGoodManifest(SAMPLE_KNOWN_GOOD);

  it("finds an exact match", () => {
    const dl = findVersionDownload(m, "131.0.6778.85", "linux64");
    expect(dl?.url).toContain("/131.0.6778.85/linux64/");
  });

  it("returns null for an unknown version", () => {
    expect(findVersionDownload(m, "999.0.0.0", "linux64")).toBeNull();
  });

  it("returns null when the version doesn't ship the requested platform", () => {
    expect(findVersionDownload(m, "132.0.6834.10", "mac-arm64")).toBeNull();
  });
});

describe("channelKey", () => {
  it("maps lowercase to canonical case", () => {
    expect(channelKey("stable")).toBe("Stable");
    expect(channelKey("beta")).toBe("Beta");
  });
});

describe("PINNED_FALLBACK_*", () => {
  it("declares a stable channel pin with a dotted-quad version", () => {
    expect(PINNED_FALLBACK_CHANNEL).toBe("stable");
    expect(PINNED_FALLBACK_VERSION).toMatch(/^\d+\.\d+\.\d+\.\d+$/);
  });
});

// Cache layer: exercised end-to-end via fetchChannelManifest with a pre-seeded
// cache file. We do NOT hit the network — by writing a fresh-timestamp cache
// file we ensure the function returns the cached value without ever calling
// fetch().
describe("manifest cache layer (no network)", () => {
  it("returns the cached value when fresh", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mochi-manifest-cache-"));
    try {
      const cachePath = join(dir, "channel-manifest.json");
      await Bun.write(cachePath, JSON.stringify(SAMPLE_CHANNEL));
      const { fetchChannelManifest } = await import("../manifest");
      const m = await fetchChannelManifest({ cacheDir: dir });
      expect(m.channels.Stable?.version).toBe("148.0.7778.97");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
