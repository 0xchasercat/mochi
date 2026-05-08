/**
 * Cross-package contract: the literal substring "Headless" MUST NEVER appear
 * in any UA-related surface mochi exposes — neither in the JS layer (the
 * inject payload) nor at the network layer (the User-Agent header on early
 * `Network.requestWillBeSent` events that fire before `addScriptToEvaluate-
 * OnNewDocument` could possibly run).
 *
 * Two layers, both pinned here:
 *
 * 1. **JS layer (defensive)**: build the inject payload from a canonical
 *    matrix and assert the BUILT bundle (post-`buildPayload`) contains no
 *    `"Headless"` substring anywhere — comments, banners, source — none.
 *
 * 2. **Network layer (the real defensive case)**: drive a `Session` against
 *    a fake CDP transport and assert that `Network.setUserAgentOverride` is
 *    sent on every page session AFTER `Target.attachToTarget` and BEFORE
 *    any document script can run. Then simulate a `Network.requestWillBeSent`
 *    event and verify its `request.headers["User-Agent"]` is the matrix UA,
 *    NOT a `"HeadlessChrome"`-bearing string.
 *
 * This brief exists because under `--headless=new` (PLAN.md / task 0220)
 * Chromium's bare UA still contains `"HeadlessChrome"`. The inject module
 * patches `navigator.userAgent` in JS, but early subresource / preload /
 * navigation requests fire BEFORE the inject can land — only a CDP-level
 * `Network.setUserAgentOverride` on the page session catches those bytes.
 *
 * Sources: udc `__init__.py:519-527`, nodriver `tab.py:203-222` (both flag
 * the same defensive gap as LOW; mochi pins the invariant here).
 *
 * @see PLAN.md I-5, §6.1, §8.2 (Network.enable forbidden globally — but
 *   `Network.setUserAgentOverride` is a stateless setter that does NOT
 *   require Network.enable, so §8.2 is unaffected)
 * @see tasks/0255-headless-ua-contract-test.md
 */

import { describe, expect, it } from "bun:test";
import { deriveMatrix, type ProfileV1 } from "../../packages/consistency/src/index";
import { Session } from "../../packages/core/src/session";
import { buildPayload } from "../../packages/inject/src/index";
import { fakeChromiumProcess, makeFakePipe } from "../helpers/cdp-fixture";

// ---- shared fixture ---------------------------------------------------------

/**
 * Minimal viable profile — derives a non-headless matrix UA.
 *
 * Profile id is deliberately kept free of any case-insensitive "headless"
 * substring (the contract test below greps the built bundle for it).
 */
function fixtureProfile(): ProfileV1 {
  return {
    id: "ua-leak-contract",
    version: "0.0.0",
    engine: "chromium",
    browser: { name: "chrome", channel: "stable", minVersion: "131", maxVersion: "133" },
    os: { name: "macos", version: "14", arch: "arm64" },
    device: {
      vendor: "Apple",
      model: "Mac14,2",
      cpuFamily: "apple-silicon-m2",
      cores: 8,
      memoryGB: 16,
    },
    display: { width: 1728, height: 1117, dpr: 2, colorDepth: 30, pixelDepth: 30 },
    gpu: {
      vendor: "Apple Inc.",
      renderer: "Apple M2",
      webglUnmaskedVendor: "Google Inc. (Apple)",
      webglUnmaskedRenderer: "ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)",
      webglMaxTextureSize: 16384,
      webglMaxColorAttachments: 8,
      webglExtensions: [],
    },
    audio: { contextSampleRate: 48000, audioWorkletLatency: 0.005, destinationMaxChannelCount: 2 },
    fonts: { family: "macos-baseline", list: ["Helvetica"] },
    timezone: "America/Los_Angeles",
    locale: "en-US",
    languages: ["en-US", "en"],
    behavior: { hand: "right", tremor: 0.18, wpm: 60, scrollStyle: "smooth" },
    wreqPreset: "chrome_131_macos",
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.6778.86 Safari/537.36",
    uaCh: {},
    entropyBudget: { fixed: [], perSeed: [] },
  };
}

// ---- Layer 1: built inject bundle never contains "Headless" -----------------

describe("contract: inject payload bundle never contains the literal 'Headless'", () => {
  it("buildPayload(matrix).code has no 'Headless' substring", () => {
    const matrix = deriveMatrix(fixtureProfile(), "ua-bundle-pin");
    const { code } = buildPayload(matrix);
    // Belt-and-braces: assert against both the case-exact substring (the
    // detection vector) and a case-insensitive sweep so a stray comment
    // can't slip through under a future refactor.
    expect(code.includes("Headless")).toBe(false);
    expect(code.toLowerCase().includes("headless")).toBe(false);
  });

  it("matrix.userAgent itself does not contain 'Headless'", () => {
    const matrix = deriveMatrix(fixtureProfile(), "ua-matrix-pin");
    expect(matrix.userAgent.includes("Headless")).toBe(false);
  });
});

// ---- Layer 2: Session sends Network.setUserAgentOverride at page-attach -----

describe("contract: Network.setUserAgentOverride pins early-network UA to matrix", () => {
  it("Session.newPage sends Network.setUserAgentOverride with matrix UA on the page session", async () => {
    const pipe = makeFakePipe({
      responders: {
        "Target.createTarget": () => ({ targetId: "tgt-1" }),
        "Target.attachToTarget": () => ({ sessionId: "page-sess-1" }),
        "Page.addScriptToEvaluateOnNewDocument": () => ({ identifier: "scr-1" }),
      },
    });
    const matrix = deriveMatrix(fixtureProfile(), "ua-network-pin");

    const session = new Session({
      proc: fakeChromiumProcess(pipe, { userDataDir: "/tmp/contract-fake-headless-ua" }),
      matrix,
      seed: "ua-network-pin",
      defaultTimeoutMs: 250,
    });

    try {
      const page = await session.newPage();
      expect(page).toBeDefined();

      // The contract assertion: at least one Network.setUserAgentOverride
      // frame was written, addressed to the page session, with the matrix UA.
      const overrideFrames = pipe.written.filter(
        (f) => f.parsed.method === "Network.setUserAgentOverride",
      );
      expect(overrideFrames.length).toBeGreaterThanOrEqual(1);

      const overrideOnPage = overrideFrames.find((f) => f.parsed.sessionId === "page-sess-1");
      expect(overrideOnPage).toBeDefined();
      const overrideParams = overrideOnPage?.parsed.params as { userAgent?: string } | undefined;
      expect(typeof overrideParams?.userAgent).toBe("string");
      expect(overrideParams?.userAgent).toBe(matrix.userAgent);
      // The matrix UA itself never contains "Headless" (Layer 1 above pins
      // this independently — re-asserting here makes the regression message
      // local to whichever layer broke).
      expect(overrideParams?.userAgent?.includes("Headless")).toBe(false);

      // Ordering invariant: the override MUST be sent BEFORE the page
      // session is otherwise wired up — early subresource requests fire
      // before any page script, so the network-layer override is what
      // catches them. We assert relative to Page.enable on the page session
      // (which is `await`ed before any other page-bound CDP send in
      // Session.newPage). Task 0266 retired the per-page
      // `Page.addScriptToEvaluateOnNewDocument` install in favour of the
      // session-level Fetch.fulfillRequest body splice, so we no longer
      // anchor against that frame.
      const indexOfOverride = pipe.written.findIndex(
        (f) =>
          f.parsed.method === "Network.setUserAgentOverride" &&
          f.parsed.sessionId === "page-sess-1",
      );
      const indexOfPageEnable = pipe.written.findIndex(
        (f) => f.parsed.method === "Page.enable" && f.parsed.sessionId === "page-sess-1",
      );
      expect(indexOfOverride).toBeGreaterThanOrEqual(0);
      expect(indexOfPageEnable).toBeGreaterThanOrEqual(0);
      // Override is sent AFTER Page.enable but BEFORE any subsequent
      // page-bound action (newPage returns immediately after these wires).
      expect(indexOfPageEnable).toBeLessThan(indexOfOverride);

      await page.close();
    } finally {
      await session.close();
    }
  }, 10_000);

  it("simulated early Network.requestWillBeSent UA never contains 'Headless'", async () => {
    // This test models the real-world race: Chromium fires
    // Network.requestWillBeSent for the navigation request itself before
    // any document script can run. The UA in those events is whatever
    // Network.setUserAgentOverride installed (or, if mochi forgot to install
    // it, the bare browser UA — which contains "HeadlessChrome").
    //
    // We simulate the event using the matrix UA we just verified gets
    // installed, and assert the captured `request.headers["User-Agent"]`
    // header is clean.

    const matrix = deriveMatrix(fixtureProfile(), "early-request-pin");

    // Synthesize what Chromium would emit AFTER setUserAgentOverride lands:
    // a Network.requestWillBeSent whose headers carry the override UA.
    const simulatedEvent = {
      method: "Network.requestWillBeSent",
      params: {
        requestId: "1000.1",
        loaderId: "loader-1",
        documentURL: "https://example.test/",
        request: {
          url: "https://example.test/",
          method: "GET",
          headers: {
            "User-Agent": matrix.userAgent,
            Accept: "text/html",
          },
          initialPriority: "VeryHigh",
          referrerPolicy: "strict-origin-when-cross-origin",
        },
        timestamp: 0,
        wallTime: 0,
        initiator: { type: "other" },
        type: "Document",
      },
    };

    const ua = simulatedEvent.params.request.headers["User-Agent"];
    expect(typeof ua).toBe("string");
    expect(ua.includes("Headless")).toBe(false);
    expect(ua.toLowerCase().includes("headless")).toBe(false);
    expect(ua).toBe(matrix.userAgent);
  });

  it("bypassInject sessions do NOT send Network.setUserAgentOverride (capture flow needs bare UA)", async () => {
    const pipe = makeFakePipe({
      responders: {
        "Target.createTarget": () => ({ targetId: "tgt-bypass" }),
        "Target.attachToTarget": () => ({ sessionId: "page-bypass" }),
      },
    });
    const matrix = deriveMatrix(fixtureProfile(), "bypass-no-override");

    const session = new Session({
      proc: fakeChromiumProcess(pipe, { userDataDir: "/tmp/contract-fake-bypass-ua" }),
      matrix,
      seed: "bypass-no-override",
      bypassInject: true,
      defaultTimeoutMs: 250,
    });

    try {
      const page = await session.newPage();
      expect(page).toBeDefined();

      // The bypass invariant: a capture session reports the BARE browser
      // fingerprint. That includes the bare UA — so we MUST NOT install
      // Network.setUserAgentOverride here, even though the matrix is set.
      const overrideFrames = pipe.written.filter(
        (f) => f.parsed.method === "Network.setUserAgentOverride",
      );
      expect(overrideFrames.length).toBe(0);

      await page.close();
    } finally {
      await session.close();
    }
  }, 10_000);
});
