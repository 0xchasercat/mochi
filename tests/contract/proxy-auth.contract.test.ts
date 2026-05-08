/**
 * Cross-package contract: proxy auth wiring (task 0160) + init-injector wiring
 * (task 0266).
 *
 * Verifies the structural-wiring contract between `LaunchOptions.proxy`
 * (string + `ProxyConfig` shapes) and the CDP `Fetch.authRequired`
 * handler:
 *
 *   1. `Session({ proxyAuth: { ... } })` calls `Fetch.enable`
 *      with `handleAuthRequests: true` and the task-0266 Document-first
 *      patterns (`[{ urlPattern: "*", resourceType: "Document" }, { urlPattern: "*" }]`),
 *      and answers `Fetch.authRequired` events with `Fetch.continueWithAuth`.
 *   2. `Session()` without `proxyAuth` ALSO sends `Fetch.enable` (task 0266 —
 *      the unified injector splices via `Fetch.fulfillRequest` so the Fetch
 *      domain must be on whenever inject is active). `handleAuthRequests`
 *      is then false, but the Document-first patterns remain.
 *   3. `Session({ bypassInject: true })` without `proxyAuth` does NOT call
 *      `Fetch.enable` — capture flow keeps zero protocol surface.
 *   4. `Session.close()` sends `Fetch.disable` when EITHER inject OR proxy
 *      auth was active, and skips it otherwise.
 *
 * We don't call `mochi.launch()` here because that would spawn Chromium —
 * we drive `Session` directly with a fake CDP transport.
 *
 * @see PLAN.md §8.2 / §8.4 / §10
 * @see tasks/0160-proxy-auth-and-ci-fix.md
 * @see tasks/0266-init-script-fetch-fulfill.md
 */

import { describe, expect, it } from "bun:test";
import { deriveMatrix, type ProfileV1 } from "../../packages/consistency/src/index";
import { Session } from "../../packages/core/src/index";
import { fakeChromiumProcess, makeFakePipe } from "../helpers/cdp-fixture";

function makeProfile(): ProfileV1 {
  return {
    id: "contract-proxy",
    version: "0.0.0-contract",
    engine: "chromium",
    browser: { name: "chrome", channel: "stable", minVersion: "131", maxVersion: "133" },
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
    wreqPreset: "chrome_131_macos",
    userAgent: "Mozilla/5.0 contract",
    uaCh: {},
    entropyBudget: { fixed: [], perSeed: [] },
  };
}

const SETUP_DELAY_MS = 30;

describe("proxy-auth contract (PLAN.md §8.2 / §10, tasks 0160 + 0266)", () => {
  it("with proxy auth: sends Fetch.enable on construction with Document-first patterns", async () => {
    const pipe = makeFakePipe();
    const session = new Session({
      proc: fakeChromiumProcess(pipe, { userDataDir: "/tmp/contract-proxy" }),
      matrix: deriveMatrix(makeProfile(), "seed"),
      seed: "seed",
      proxyAuth: { username: "u", password: "p" },
    });
    // Wait for the deferred init-injector install to settle.
    await new Promise((r) => setTimeout(r, SETUP_DELAY_MS));
    const enable = pipe.written.find((c) => c.parsed.method === "Fetch.enable");
    expect(enable).toBeDefined();
    // Task 0266 unified Fetch.enable owner: Document-first + wildcard.
    expect(enable?.parsed.params).toEqual({
      handleAuthRequests: true,
      patterns: [{ urlPattern: "*", resourceType: "Document" }, { urlPattern: "*" }],
    });
    await session.close();
  });

  it("with proxy auth: answers Fetch.authRequired with credentials", async () => {
    const pipe = makeFakePipe();
    const session = new Session({
      proc: fakeChromiumProcess(pipe, { userDataDir: "/tmp/contract-proxy" }),
      matrix: deriveMatrix(makeProfile(), "seed"),
      seed: "seed",
      proxyAuth: { username: "alice", password: "s3cret" },
    });
    await new Promise((r) => setTimeout(r, SETUP_DELAY_MS));
    pipe.inject({
      method: "Fetch.authRequired",
      params: { requestId: "req-1", authChallenge: { source: "Proxy" } },
    });
    await new Promise((r) => setTimeout(r, SETUP_DELAY_MS));
    const reply = pipe.written.find((c) => c.parsed.method === "Fetch.continueWithAuth");
    expect(reply).toBeDefined();
    expect(reply?.parsed.params).toEqual({
      requestId: "req-1",
      authChallengeResponse: {
        response: "ProvideCredentials",
        username: "alice",
        password: "s3cret",
      },
    });
    await session.close();
  });

  it("without proxy auth, default inject: still sends Fetch.enable (task 0266 — body splice path)", async () => {
    const pipe = makeFakePipe();
    const session = new Session({
      proc: fakeChromiumProcess(pipe, { userDataDir: "/tmp/contract-proxy" }),
      matrix: deriveMatrix(makeProfile(), "seed"),
      seed: "seed",
    });
    await new Promise((r) => setTimeout(r, SETUP_DELAY_MS));
    const enable = pipe.written.find((c) => c.parsed.method === "Fetch.enable");
    expect(enable).toBeDefined();
    // No auth → handleAuthRequests is false; patterns still cover Document
    // (so we can fulfill) AND a wildcard fallback (so non-Document is
    // forwarded immediately and Chromium doesn't hang).
    expect(enable?.parsed.params).toEqual({
      handleAuthRequests: false,
      patterns: [{ urlPattern: "*", resourceType: "Document" }, { urlPattern: "*" }],
    });
    await session.close();
  });

  it("with bypassInject:true and no proxy auth — NEVER sends Fetch.enable", async () => {
    // Capture-style flow keeps the v0.1 "zero extra protocol surface"
    // posture: no payload, no auth → no Fetch domain at all.
    const pipe = makeFakePipe();
    const session = new Session({
      proc: fakeChromiumProcess(pipe, { userDataDir: "/tmp/contract-proxy" }),
      matrix: deriveMatrix(makeProfile(), "seed"),
      seed: "seed",
      bypassInject: true,
    });
    await new Promise((r) => setTimeout(r, SETUP_DELAY_MS));
    const enable = pipe.written.find((c) => c.parsed.method === "Fetch.enable");
    expect(enable).toBeUndefined();
    await session.close();
  });

  it("close() sends Fetch.disable when the unified injector was active", async () => {
    const pipe = makeFakePipe();
    const session = new Session({
      proc: fakeChromiumProcess(pipe, { userDataDir: "/tmp/contract-proxy" }),
      matrix: deriveMatrix(makeProfile(), "seed"),
      seed: "seed",
      proxyAuth: { username: "u", password: "p" },
    });
    await new Promise((r) => setTimeout(r, SETUP_DELAY_MS));
    await session.close();
    const disable = pipe.written.find((c) => c.parsed.method === "Fetch.disable");
    expect(disable).toBeDefined();
  });

  it("close() does NOT send Fetch.disable when neither inject nor proxy auth ran", async () => {
    const pipe = makeFakePipe();
    const session = new Session({
      proc: fakeChromiumProcess(pipe, { userDataDir: "/tmp/contract-proxy" }),
      matrix: deriveMatrix(makeProfile(), "seed"),
      seed: "seed",
      bypassInject: true,
    });
    await new Promise((r) => setTimeout(r, SETUP_DELAY_MS));
    await session.close();
    const disable = pipe.written.find((c) => c.parsed.method === "Fetch.disable");
    expect(disable).toBeUndefined();
  });
});
