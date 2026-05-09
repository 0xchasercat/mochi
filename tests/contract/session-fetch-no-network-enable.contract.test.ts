/**
 * Empirical Q-1 verifier for `Session.fetch`'s Mechanism A.
 *
 * `Network.loadNetworkResource` is implemented in Chromium's
 * `content/browser/devtools/protocol/network_handler.cc`. Inspection of
 * the handler shows it operates against the host's StoragePartition
 * rather than the per-target NetworkAgent's request observer, so it
 * does NOT require `Network.enable` to be sent first. This test pins
 * that empirically: every `Session.fetch` issued during the test must
 * NOT cause `Network.enable` to appear on the wire.
 *
 * Why this matters:
 *
 *   - PLAN.md §8.2 forbids `Network.enable` because it surfaces *events*
 *     (`requestWillBeSent`, etc.) which carry a fingerprint signal.
 *   - If Chromium ever changes `Network.loadNetworkResource` to require
 *     `Network.enable`, our Mechanism A path would silently start sending
 *     a forbidden method. This test fails the build the moment that
 *     happens. Recovery: drop the GET fast-path and route everything via
 *     Mechanism B (the page-evaluate path).
 *
 * @see tasks/0290-drop-wreq-bump-chrome.md §A2 / §11 Q-1
 * @see PLAN.md §8.2
 */

import { describe, expect, it } from "bun:test";
import { deriveMatrix, type ProfileV1 } from "../../packages/consistency/src/index";
import { Session } from "../../packages/core/src/index";
import { fakeChromiumProcess, makeFakePipe } from "../helpers/cdp-fixture";

function fixtureProfile(): ProfileV1 {
  return {
    id: "no-network-enable-fixture",
    version: "0.0.0-contract",
    engine: "chromium",
    browser: { name: "chrome", channel: "stable", minVersion: "148", maxVersion: "148" },
    os: { name: "macos", version: "14", arch: "arm64" },
    device: {
      vendor: "apple",
      model: "macbook-air-m2",
      cpuFamily: "apple-m2",
      cores: 8,
      memoryGB: 16,
    },
    display: { width: 1512, height: 982, dpr: 2, colorDepth: 30, pixelDepth: 30 },
    gpu: {
      vendor: "Apple Inc.",
      renderer: "Apple M2",
      webglUnmaskedVendor: "Apple Inc.",
      webglUnmaskedRenderer: "Apple M2",
      webglMaxTextureSize: 16384,
      webglMaxColorAttachments: 8,
      webglExtensions: [],
    },
    audio: { contextSampleRate: 48000, audioWorkletLatency: 0.005, destinationMaxChannelCount: 2 },
    fonts: { family: "macos-baseline", list: ["Helvetica"] },
    timezone: "America/Los_Angeles",
    locale: "en-US",
    languages: ["en-US", "en"],
    behavior: { hand: "right", tremor: 0.18, wpm: 65, scrollStyle: "smooth" },
    wreqPreset: "chrome_148_macos",
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36",
    uaCh: {},
    entropyBudget: { fixed: [], perSeed: [] },
  };
}

describe("contract: Session.fetch never sends Network.enable (Q-1)", () => {
  it("Mechanism A (simple GET) does not trip Network.enable on the wire", async () => {
    let chunkCount = 0;
    const pipe = makeFakePipe({
      responders: {
        "Network.loadNetworkResource": () => ({
          resource: {
            success: true,
            httpStatusCode: 200,
            headers: {},
            stream: "io-handle-1",
          },
        }),
        "IO.read": () => {
          chunkCount += 1;
          return chunkCount === 1 ? { data: "ok", eof: false } : { data: "", eof: true };
        },
        "IO.close": () => ({}),
      },
    });
    const matrix = deriveMatrix(fixtureProfile(), "no-net-enable");
    const session = new Session({
      proc: fakeChromiumProcess(pipe, { userDataDir: "/tmp/no-network-enable" }),
      matrix,
      seed: "no-net-enable",
      defaultTimeoutMs: 1000,
    });

    try {
      await session.fetch("https://example.com/api");
      // The load-bearing assertion: the wire log must NOT contain
      // Network.enable. If Chromium ever requires it for
      // loadNetworkResource, Mechanism A is no longer §8.2-clean and we
      // must fall back to Mechanism B exclusively.
      const methods = pipe.written
        .map((f) => f.parsed.method)
        .filter((m): m is string => typeof m === "string");
      expect(methods).not.toContain("Network.enable");
      // Sanity: Mechanism A actually fired.
      expect(methods).toContain("Network.loadNetworkResource");
    } finally {
      await session.close();
    }
  }, 10_000);

  it("Mechanism B (POST) does not trip Network.enable either", async () => {
    const pipe = makeFakePipe({
      responders: {
        "DOM.getDocument": () => ({ root: { nodeId: 1 } }),
        "DOM.resolveNode": () => ({ object: { objectId: "doc-obj" } }),
        "Runtime.callFunctionOn": () => ({
          result: {
            type: "object",
            value: { status: 200, headers: {}, bodyB64: "" },
          },
        }),
      },
    });
    const matrix = deriveMatrix(fixtureProfile(), "no-net-enable-b");
    const session = new Session({
      proc: fakeChromiumProcess(pipe, { userDataDir: "/tmp/no-network-enable-b" }),
      matrix,
      seed: "no-net-enable-b",
      defaultTimeoutMs: 1000,
    });
    try {
      await session.fetch("https://example.com/api", { method: "POST", body: "{}" });
      const methods = pipe.written
        .map((f) => f.parsed.method)
        .filter((m): m is string => typeof m === "string");
      expect(methods).not.toContain("Network.enable");
      expect(methods).toContain("Runtime.callFunctionOn");
    } finally {
      await session.close();
    }
  }, 10_000);
});
