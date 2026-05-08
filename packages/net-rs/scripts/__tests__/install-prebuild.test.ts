/**
 * Unit tests for the postinstall script. We exercise `runInstall` with
 * mocked fetch + a temp `nativeDir` so nothing escapes to the real
 * filesystem outside `os.tmpdir()`. No network access — every test
 * provides its own `fetchImpl`.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  computeSha256,
  detectPlatform,
  type InstallOptions,
  type PlatformInfo,
  parseSha256File,
  releaseAssetUrl,
  runInstall,
  SKIP_ENV_VAR,
} from "../install-prebuild";

const FAKE_VERSION = "0.1.0" as const;

/** Build a tiny binary buffer + its sha256 (hex) for fixture purposes. */
function makeFakeAsset(): { buf: Uint8Array; hash: string } {
  const buf = new TextEncoder().encode("not-a-real-cdylib-but-good-enough");
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(buf);
  return { buf, hash: hasher.digest("hex") };
}

interface RecordedCall {
  url: string;
  method: string;
}

interface MockFetchOpts {
  /** Map of URL → body bytes for binary; URL → text for sha files. */
  responses: Map<string, { status: number; body: Uint8Array | string }>;
  recorded: RecordedCall[];
}

function makeMockFetch(opts: MockFetchOpts): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    opts.recorded.push({ url, method: init?.method ?? "GET" });
    const r = opts.responses.get(url);
    if (r === undefined) {
      return new Response(null, { status: 404 });
    }
    const body = typeof r.body === "string" ? r.body : r.body.slice();
    return new Response(body, { status: r.status });
  }) as typeof fetch;
}

describe("detectPlatform", () => {
  it("maps darwin-arm64", () => {
    expect(detectPlatform("darwin", "arm64")).toEqual({
      platform: "darwin-arm64",
      ext: "dylib",
      fileName: "mochi_net-darwin-arm64.dylib",
    });
  });

  it("maps darwin-x64", () => {
    expect(detectPlatform("darwin", "x64")).toEqual({
      platform: "darwin-x64",
      ext: "dylib",
      fileName: "mochi_net-darwin-x64.dylib",
    });
  });

  it("maps linux-x64 to .so", () => {
    expect(detectPlatform("linux", "x64")).toEqual({
      platform: "linux-x64",
      ext: "so",
      fileName: "mochi_net-linux-x64.so",
    });
  });

  it("maps linux-arm64 to .so", () => {
    expect(detectPlatform("linux", "arm64")).toEqual({
      platform: "linux-arm64",
      ext: "so",
      fileName: "mochi_net-linux-arm64.so",
    });
  });

  it("maps win32-x64 to .dll (no `lib` prefix)", () => {
    const info = detectPlatform("win32", "x64");
    expect(info?.fileName).toBe("mochi_net-win32-x64.dll");
    expect(info?.fileName.startsWith("lib")).toBe(false);
  });

  it("returns null for unsupported tuples", () => {
    expect(detectPlatform("freebsd", "x64")).toBeNull();
    expect(detectPlatform("linux", "ia32")).toBeNull();
    expect(detectPlatform("openbsd", "arm64")).toBeNull();
  });
});

describe("releaseAssetUrl", () => {
  it("URL-encodes the @mochi.js/net-rs@<v> tag (both @ and /)", () => {
    const url = releaseAssetUrl("0.1.0", "mochi_net-darwin-arm64.dylib");
    expect(url).toContain("github.com/0xchasercat/mochi/releases/download/");
    // The tag segment must contain encoded `@` (%40) and `/` (%2F).
    expect(url).toContain("%40mochi.js%2Fnet-rs%400.1.0");
    expect(url.endsWith("/mochi_net-darwin-arm64.dylib")).toBe(true);
  });

  it("supports overriding the repo (used by forks)", () => {
    const url = releaseAssetUrl("0.1.0", "x.dylib", "fork/mochi");
    expect(url).toContain("github.com/fork/mochi/releases/download/");
  });
});

describe("parseSha256File", () => {
  it("accepts the bare 64-hex form", () => {
    expect(parseSha256File(`${"abc".repeat(21)}a`)).toBeTruthy(); // 64 chars
    const hash = "0".repeat(64);
    expect(parseSha256File(hash)).toBe(hash);
  });

  it("accepts the GNU coreutils form (`<hex>  <filename>`)", () => {
    const hash = "a".repeat(64);
    expect(parseSha256File(`${hash}  mochi_net-linux-x64.so`)).toBe(hash);
  });

  it("trims trailing whitespace + newlines", () => {
    const hash = "f".repeat(64);
    expect(parseSha256File(`${hash}\n`)).toBe(hash);
  });

  it("normalises uppercase hex to lowercase", () => {
    const hash = `ABCDEF${"0".repeat(58)}`;
    expect(parseSha256File(hash)).toBe(hash.toLowerCase());
  });

  it("rejects malformed input", () => {
    expect(() => parseSha256File("nope")).toThrow();
    expect(() => parseSha256File("abc")).toThrow();
    expect(() => parseSha256File("g".repeat(64))).toThrow();
  });
});

/** Tiny assertion helper so tests don't need `!` on `detectPlatform` results. */
function mustDetect(platform: NodeJS.Platform, arch: string): PlatformInfo {
  const info = detectPlatform(platform, arch);
  if (info === null) throw new Error(`unexpected null detectPlatform(${platform},${arch})`);
  return info;
}

describe("runInstall", () => {
  let nativeDir: string;

  beforeEach(async () => {
    nativeDir = await mkdtemp(join(tmpdir(), "mochi-net-install-"));
  });

  afterEach(async () => {
    await rm(nativeDir, { recursive: true, force: true });
  });

  function baseOpts(overrides: Partial<InstallOptions> = {}): InstallOptions {
    return {
      version: FAKE_VERSION,
      nativeDir,
      env: {},
      logger: { warn: () => {}, info: () => {} },
      ...overrides,
    };
  }

  it("happy path: downloads, verifies sha, atomic-renames into native/", async () => {
    const { buf, hash } = makeFakeAsset();
    const platformInfo = mustDetect("darwin", "arm64");
    const binUrl = releaseAssetUrl(FAKE_VERSION, platformInfo.fileName);
    const recorded: RecordedCall[] = [];
    const responses = new Map([
      [binUrl, { status: 200, body: buf }],
      [`${binUrl}.sha256`, { status: 200, body: `${hash}  ${platformInfo.fileName}\n` }],
    ]);
    const fetchImpl = makeMockFetch({ responses, recorded });

    const outcome = await runInstall(baseOpts({ platformInfo, fetchImpl }));

    expect(outcome.kind).toBe("downloaded");
    if (outcome.kind === "downloaded") {
      expect(outcome.sha256).toBe(hash);
      // File must exist at the right path.
      const targetStat = await stat(outcome.targetPath);
      expect(targetStat.isFile()).toBe(true);
      // No leftover .partial.
      await expect(stat(`${outcome.targetPath}.partial`)).rejects.toThrow();
      // Bytes match.
      const onDisk = await readFile(outcome.targetPath);
      expect(Array.from(new Uint8Array(onDisk))).toEqual(Array.from(buf));
    }
    // Both URLs were fetched.
    expect(recorded.map((r) => r.url)).toContain(binUrl);
    expect(recorded.map((r) => r.url)).toContain(`${binUrl}.sha256`);
  });

  it("env-skip: MOCHI_NET_SKIP_POSTINSTALL=1 is a no-op", async () => {
    const recorded: RecordedCall[] = [];
    const fetchImpl = makeMockFetch({ responses: new Map(), recorded });
    const outcome = await runInstall(
      baseOpts({
        env: { [SKIP_ENV_VAR]: "1" },
        fetchImpl,
      }),
    );
    expect(outcome).toEqual({ kind: "skipped-env" });
    // No fetch happened.
    expect(recorded.length).toBe(0);
  });

  it("unsupported platform: skips with `skipped-unsupported`, no fetch", async () => {
    const recorded: RecordedCall[] = [];
    const fetchImpl = makeMockFetch({ responses: new Map(), recorded });
    const outcome = await runInstall(
      baseOpts({
        platformInfo: null,
        fetchImpl,
      }),
    );
    expect(outcome.kind).toBe("skipped-unsupported");
    expect(recorded.length).toBe(0);
  });

  it("network failure: returns `failed-download`, exits non-fatally", async () => {
    const platformInfo = mustDetect("linux", "x64");
    const fetchImpl = (async () => {
      throw new Error("ENETUNREACH simulated");
    }) as unknown as typeof fetch;
    const outcome = await runInstall(baseOpts({ platformInfo, fetchImpl }));
    expect(outcome.kind).toBe("failed-download");
    if (outcome.kind === "failed-download") {
      expect(outcome.error).toContain("ENETUNREACH simulated");
    }
    // No file written.
    await expect(stat(`${nativeDir}/${platformInfo.fileName}`)).rejects.toThrow();
  });

  it("sha256 mismatch: refuses to install, leaves no .partial", async () => {
    const { buf } = makeFakeAsset();
    const platformInfo = mustDetect("linux", "arm64");
    const binUrl = releaseAssetUrl(FAKE_VERSION, platformInfo.fileName);
    const wrongHash = "1".repeat(64);
    const responses = new Map([
      [binUrl, { status: 200, body: buf }],
      [`${binUrl}.sha256`, { status: 200, body: wrongHash }],
    ]);
    const fetchImpl = makeMockFetch({ responses, recorded: [] });

    const outcome = await runInstall(baseOpts({ platformInfo, fetchImpl }));
    expect(outcome.kind).toBe("failed-sha");
    if (outcome.kind === "failed-sha") {
      expect(outcome.expected).toBe(wrongHash);
      expect(outcome.actual.length).toBe(64);
      expect(outcome.actual).not.toBe(wrongHash);
    }
    // No leftover .partial, no installed file.
    await expect(stat(`${nativeDir}/${platformInfo.fileName}`)).rejects.toThrow();
    await expect(stat(`${nativeDir}/${platformInfo.fileName}.partial`)).rejects.toThrow();
  });

  it("idempotent: a second run skips when the file already exists", async () => {
    const { buf, hash } = makeFakeAsset();
    const platformInfo = mustDetect("darwin", "x64");
    const binUrl = releaseAssetUrl(FAKE_VERSION, platformInfo.fileName);
    const recorded1: RecordedCall[] = [];
    const responses = new Map([
      [binUrl, { status: 200, body: buf }],
      [`${binUrl}.sha256`, { status: 200, body: hash }],
    ]);
    const fetchImpl1 = makeMockFetch({ responses, recorded: recorded1 });

    const first = await runInstall(baseOpts({ platformInfo, fetchImpl: fetchImpl1 }));
    expect(first.kind).toBe("downloaded");

    const recorded2: RecordedCall[] = [];
    const fetchImpl2 = makeMockFetch({ responses, recorded: recorded2 });
    const second = await runInstall(baseOpts({ platformInfo, fetchImpl: fetchImpl2 }));
    expect(second.kind).toBe("skipped-existing");
    // Second run did NOT touch the network.
    expect(recorded2.length).toBe(0);
  });

  it("HTTP non-200 on the sha file is reported as failed-download", async () => {
    const { buf } = makeFakeAsset();
    const platformInfo = mustDetect("win32", "x64");
    const binUrl = releaseAssetUrl(FAKE_VERSION, platformInfo.fileName);
    const responses = new Map([
      [binUrl, { status: 200, body: buf }],
      [`${binUrl}.sha256`, { status: 404, body: "not found" }],
    ]);
    const fetchImpl = makeMockFetch({ responses, recorded: [] });

    const outcome = await runInstall(baseOpts({ platformInfo, fetchImpl }));
    expect(outcome.kind).toBe("failed-download");
  });
});

describe("computeSha256", () => {
  it("matches the digest of `Bun.CryptoHasher.update(buf).digest('hex')`", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mochi-net-sha-"));
    try {
      const buf = new TextEncoder().encode("hello mochi");
      const path = join(dir, "x.bin");
      await Bun.write(path, buf);

      const expected = new Bun.CryptoHasher("sha256").update(buf).digest("hex");
      const actual = await computeSha256(path);
      expect(actual).toBe(expected);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
