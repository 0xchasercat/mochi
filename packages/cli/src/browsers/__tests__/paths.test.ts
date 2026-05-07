/**
 * Unit tests for `paths.ts` — pure mapping/layout helpers.
 */
import { describe, expect, it } from "bun:test";
import {
  binaryPathFor,
  binaryPathInExtractDir,
  CFT_PLATFORMS,
  type CftPlatform,
  CHANNELS,
  defaultInstallRoot,
  detectPlatform,
  installDir,
  isCftPlatform,
  isChannel,
} from "../paths";

describe("detectPlatform", () => {
  it("maps darwin-arm64 to mac-arm64", () => {
    expect(detectPlatform("darwin", "arm64")).toBe("mac-arm64");
  });

  it("maps darwin-x64 to mac-x64", () => {
    expect(detectPlatform("darwin", "x64")).toBe("mac-x64");
  });

  it("maps linux-x64 to linux64", () => {
    expect(detectPlatform("linux", "x64")).toBe("linux64");
  });

  it("maps win32-x64 to win64", () => {
    expect(detectPlatform("win32", "x64")).toBe("win64");
  });

  it("returns null for linux-arm64 (CfT does not ship)", () => {
    expect(detectPlatform("linux", "arm64")).toBeNull();
  });

  it("returns null for win32-ia32", () => {
    expect(detectPlatform("win32", "ia32")).toBeNull();
  });

  it("returns null for freebsd-x64 (unsupported)", () => {
    expect(detectPlatform("freebsd", "x64")).toBeNull();
  });
});

describe("isCftPlatform / isChannel", () => {
  it("isCftPlatform accepts the canonical four", () => {
    for (const p of CFT_PLATFORMS) {
      expect(isCftPlatform(p)).toBe(true);
    }
  });
  it("isCftPlatform rejects bogus inputs", () => {
    expect(isCftPlatform("mac")).toBe(false);
    expect(isCftPlatform("linux-arm64")).toBe(false);
    expect(isCftPlatform("")).toBe(false);
  });
  it("isChannel accepts stable + beta only", () => {
    for (const c of CHANNELS) {
      expect(isChannel(c)).toBe(true);
    }
    expect(isChannel("dev")).toBe(false);
    expect(isChannel("Stable")).toBe(false); // case-sensitive
  });
});

describe("defaultInstallRoot", () => {
  it("honors MOCHI_BROWSERS_ROOT when set", () => {
    const prev = process.env.MOCHI_BROWSERS_ROOT;
    process.env.MOCHI_BROWSERS_ROOT = "/tmp/mochi-test-root";
    try {
      expect(defaultInstallRoot()).toBe("/tmp/mochi-test-root");
    } finally {
      if (prev === undefined) delete process.env.MOCHI_BROWSERS_ROOT;
      else process.env.MOCHI_BROWSERS_ROOT = prev;
    }
  });

  it("falls back to ~/.mochi/browsers when env is unset", () => {
    const prev = process.env.MOCHI_BROWSERS_ROOT;
    delete process.env.MOCHI_BROWSERS_ROOT;
    try {
      expect(defaultInstallRoot()).toMatch(/\.mochi\/browsers$/);
    } finally {
      if (prev !== undefined) process.env.MOCHI_BROWSERS_ROOT = prev;
    }
  });
});

describe("installDir", () => {
  it("encodes channel + version + platform in the directory name", () => {
    expect(installDir("/r", "stable", "131.0.6778.85", "mac-arm64")).toBe(
      "/r/stable-131.0.6778.85-mac-arm64",
    );
  });
  it("keeps installs distinct across platforms for the same version", () => {
    const a = installDir("/r", "stable", "131.0.6778.85", "mac-arm64");
    const b = installDir("/r", "stable", "131.0.6778.85", "linux64");
    expect(a).not.toBe(b);
  });
});

describe("binaryPathInExtractDir", () => {
  const cases: ReadonlyArray<[CftPlatform, string]> = [
    [
      "mac-arm64",
      "/x/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
    ],
    [
      "mac-x64",
      "/x/chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
    ],
    ["linux64", "/x/chrome-linux64/chrome"],
    ["win64", "/x/chrome-win64/chrome.exe"],
  ];
  for (const [platform, expected] of cases) {
    it(`computes the correct binary path on ${platform}`, () => {
      expect(binaryPathInExtractDir("/x", platform)).toBe(expected);
    });
  }
});

describe("binaryPathFor", () => {
  it("composes installDir + binaryPathInExtractDir", () => {
    const p = binaryPathFor("/r", "stable", "131.0.6778.85", "linux64");
    expect(p).toBe("/r/stable-131.0.6778.85-linux64/chrome-linux64/chrome");
  });
});
