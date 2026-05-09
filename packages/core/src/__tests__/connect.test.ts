/**
 * Unit tests for `mochi.connect` validation + the no-spoof
 * `resolveProfileSource(null)` branch in `launch.ts`.
 *
 * These tests are pure (no Chromium spawn, no WebSocket) — they cover the
 * input-validation surface that runs BEFORE any I/O is attempted, plus
 * the locked behaviour of `resolveProfileSource` for the new null branch.
 *
 * The full WebSocket-transport happy path lives in
 * `tests/contract/connect-ws-transport.contract.test.ts`; this file only
 * exercises the synchronous validation and the helper that drives it.
 */

import { describe, expect, it } from "bun:test";
import type { ProfileV1 } from "@mochi.js/consistency";
import { connect } from "../connect";
import { resolveProfileSource } from "../launch";

describe("resolveProfileSource(null)", () => {
  it("returns { profile: null, id: null, autoPicked: false }", async () => {
    const out = await resolveProfileSource(null);
    expect(out.profile).toBeNull();
    expect(out.id).toBeNull();
    expect(out.autoPicked).toBe(false);
  });

  it("inline ProfileV1 still flows through unchanged (regression guard)", async () => {
    const profile: ProfileV1 = {
      id: "test-fixture",
      version: "0.0.0",
      engine: "chromium",
      browser: { name: "chrome", channel: "stable", minVersion: "148", maxVersion: "148" },
      os: { name: "linux", version: "22", arch: "x64" },
      device: {
        vendor: "generic",
        model: "generic-x64",
        cpuFamily: "intel-core-i7",
        cores: 8,
        memoryGB: 16,
      },
      display: { width: 1920, height: 1080, dpr: 1, colorDepth: 24, pixelDepth: 24 },
      gpu: {
        vendor: "Intel Inc.",
        renderer: "Intel Iris Xe Graphics",
        webglUnmaskedVendor: "Google Inc.",
        webglUnmaskedRenderer: "ANGLE",
        webglMaxTextureSize: 16384,
        webglMaxColorAttachments: 8,
        webglExtensions: [],
      },
      audio: {
        contextSampleRate: 48000,
        audioWorkletLatency: 0.005,
        destinationMaxChannelCount: 2,
      },
      fonts: { family: "linux-baseline", list: ["DejaVu Sans"] },
      timezone: "UTC",
      locale: "en-US",
      languages: ["en-US", "en"],
      behavior: { hand: "right" as const, tremor: 0.18, wpm: 60, scrollStyle: "smooth" as const },
      wreqPreset: "chrome_148_linux",
      userAgent: "Mozilla/5.0 ...",
      uaCh: {},
      entropyBudget: { fixed: [], perSeed: [] },
    };
    const out = await resolveProfileSource(profile);
    expect(out.profile).toBe(profile);
    expect(out.id).toBe("test-fixture");
    expect(out.autoPicked).toBe(false);
  });
});

describe("connect() — pre-I/O validation", () => {
  it("throws when neither wsEndpoint nor browserURL is supplied", async () => {
    let err: Error | undefined;
    try {
      await connect({ profile: null });
    } catch (e) {
      err = e as Error;
    }
    expect(err).toBeDefined();
    expect(err?.message).toContain("wsEndpoint");
  });

  it("throws when both wsEndpoint and browserURL are empty strings", async () => {
    let err: Error | undefined;
    try {
      await connect({ wsEndpoint: "", browserURL: "", profile: null });
    } catch (e) {
      err = e as Error;
    }
    expect(err).toBeDefined();
    expect(err?.message).toContain("wsEndpoint");
  });

  it("throws when profile is undefined (auto-pick is meaningless for a remote browser)", async () => {
    let err: Error | undefined;
    try {
      // `profile` is intentionally omitted to drive validation.
      await connect({ wsEndpoint: "ws://example.invalid:9222/devtools/browser/x" });
    } catch (e) {
      err = e as Error;
    }
    expect(err).toBeDefined();
    expect(err?.message).toMatch(/profile.*required/i);
  });

  it("throws when a profile id is supplied without a seed", async () => {
    let err: Error | undefined;
    try {
      await connect({
        wsEndpoint: "ws://example.invalid:9222/devtools/browser/x",
        profile: "linux-chrome-stable",
      });
    } catch (e) {
      err = e as Error;
    }
    expect(err).toBeDefined();
    expect(err?.message).toContain("seed");
  });

  it("rejects with a clear message when browserURL fetch fails", async () => {
    let err: Error | undefined;
    try {
      // Port 1 is privileged; on most systems nothing listens here.
      await connect({ browserURL: "http://localhost:1", profile: null });
    } catch (e) {
      err = e as Error;
    }
    expect(err).toBeDefined();
    expect(err?.message).toContain("/json/version");
  });
});
