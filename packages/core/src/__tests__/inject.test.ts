/**
 * Unit tests for the inject pipeline as it interacts with `Session` —
 * specifically the `bypassInject` short-circuit that capture-style flows
 * (`mochi capture`, the eventual harness baseline collector) need so the
 * browser reports its bare, un-spoofed fingerprint.
 *
 * No real Chromium process is spawned; we drive `Session` against a fake
 * `ChromiumProcess` via the shared `tests/helpers/cdp-fixture.ts` helper.
 * The §8.2 forbidden-method assertions still gate every send through
 * `MessageRouter`, so the test implicitly enforces those too.
 *
 * @see PLAN.md §12.1 — capture must run against bare Chromium.
 * @see tests/helpers/cdp-fixture.ts — shared helper consolidating fake-pipe boilerplate.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { deriveMatrix, type ProfileV1 } from "@mochi.js/consistency";
import {
  type FakePipe,
  fakeChromiumProcess,
  makeFakePipe,
} from "../../../../tests/helpers/cdp-fixture";
import { Session } from "../session";

const TEST_PROFILE: ProfileV1 = {
  id: "bypass-inject-fixture",
  version: "0.0.0-test",
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

describe("Session.bypassInject (PLAN.md §12.1, task 0040)", () => {
  let pipe: FakePipe;
  let session: Session | undefined;

  beforeEach(() => {
    pipe = makeFakePipe({
      responders: {
        // Tests below assert on identifier shape — keep these stable.
        "Target.createTarget": () => ({ targetId: "page-target-1" }),
        "Target.attachToTarget": () => ({ sessionId: "session-1" }),
        "Page.addScriptToEvaluateOnNewDocument": () => ({ identifier: "should-never-fire" }),
      },
    });
    session = undefined;
  });

  afterEach(async () => {
    if (session !== undefined) {
      try {
        await session.close();
      } catch {
        // best effort
      }
    }
  });

  it("with bypassInject:true — newPage() never sends Page.addScriptToEvaluateOnNewDocument and no Fetch.enable for inject", async () => {
    const matrix = deriveMatrix(TEST_PROFILE, "bypass-test");
    session = new Session({
      proc: fakeChromiumProcess(pipe, { userDataDir: "/tmp/fake-mochi-test" }),
      matrix,
      seed: "bypass-test",
      bypassInject: true,
    });

    const page = await session.newPage();
    expect(page).toBeDefined();
    // Allow the constructor's deferred init-injector promise to settle (it's
    // a no-op in this case but the rejection-handler microtasks still queue).
    await new Promise((r) => setTimeout(r, 5));

    const methods = pipe.written
      .map((w) => w.parsed.method)
      .filter((m): m is string => typeof m === "string");
    expect(methods).toContain("Target.createTarget");
    expect(methods).toContain("Target.attachToTarget");
    expect(methods).toContain("Page.enable");
    // Task 0266 contract: no Page.addScriptToEvaluateOnNewDocument under
    // bypassInject — the session-level injector is also short-circuited.
    expect(methods).not.toContain("Page.addScriptToEvaluateOnNewDocument");
    // No Runtime.evaluate — worker injection is also bypassed.
    expect(methods).not.toContain("Runtime.evaluate");
    // No proxy creds, no payload to deliver — the unified injector
    // short-circuits and does NOT send Fetch.enable. Capture flow keeps a
    // zero-extra-protocol-surface posture.
    expect(methods).not.toContain("Fetch.enable");
  });

  it("with bypassInject:true — _internalPayload() is null", () => {
    const matrix = deriveMatrix(TEST_PROFILE, "null-payload");
    session = new Session({
      proc: fakeChromiumProcess(pipe, { userDataDir: "/tmp/fake-mochi-test" }),
      matrix,
      seed: "null-payload",
      bypassInject: true,
    });
    expect(session._internalPayload()).toBeNull();
    expect(session._internalBypassInject()).toBe(true);
  });

  it("with bypassInject omitted — Session installs the unified Fetch-domain injector instead of Page.addScriptToEvaluateOnNewDocument", async () => {
    // Override the script identifier for this test — it asserts that the
    // dual-mechanism `addScriptToEvaluateOnNewDocument` call (commit 2 of
    // 0266) carries the wrapped matrix payload.
    const localPipe = makeFakePipe({
      responders: {
        "Target.createTarget": () => ({ targetId: "page-target-2" }),
        "Target.attachToTarget": () => ({ sessionId: "session-2" }),
        "Page.addScriptToEvaluateOnNewDocument": () => ({ identifier: "inj-1" }),
      },
    });
    const matrix = deriveMatrix(TEST_PROFILE, "default-inject");
    session = new Session({
      proc: fakeChromiumProcess(localPipe, { userDataDir: "/tmp/fake-mochi-test" }),
      matrix,
      seed: "default-inject",
    });
    expect(session._internalBypassInject()).toBe(false);
    const payload = session._internalPayload();
    expect(payload).not.toBeNull();
    expect(payload?.code.length ?? 0).toBeGreaterThan(0);

    const page = await session.newPage();
    expect(page).toBeDefined();
    // Yield once so the deferred installInitInjector promise settles.
    await new Promise((r) => setTimeout(r, 10));

    const methods = localPipe.written
      .map((w) => w.parsed.method)
      .filter((m): m is string => typeof m === "string");
    // Task 0266 dual-mechanism: Session uses BOTH Fetch.fulfillRequest body
    // splice (HTTP/HTTPS Document responses — closes source-attribution
    // leak) AND Page.addScriptToEvaluateOnNewDocument (per-page fallback for
    // about:blank / data: / blob: where Fetch domain can't intercept). The
    // wrapped payload's `__mochi_inject_marker` early-return prevents
    // double-execution when both fire on the same realm.
    expect(methods).toContain("Page.addScriptToEvaluateOnNewDocument");
    const addScriptCall = localPipe.written.find(
      (w) => w.parsed.method === "Page.addScriptToEvaluateOnNewDocument",
    );
    const addScriptParams = addScriptCall?.parsed.params as
      | { source?: string; runImmediately?: boolean; worldName?: string }
      | undefined;
    expect(addScriptParams?.runImmediately).toBe(true);
    expect(addScriptParams?.worldName).toBe(""); // PLAN.md §8.4 — main world
    expect(addScriptParams?.source).toContain("__mochi_inject_marker"); // idempotency guard
    // Fetch.enable is sent ONCE on session construction with the
    // Document-first patterns. Auth is off because no proxyAuth was set.
    expect(methods).toContain("Fetch.enable");
    const enableCall = localPipe.written.find((w) => w.parsed.method === "Fetch.enable");
    const enableParams = enableCall?.parsed.params as
      | {
          handleAuthRequests?: boolean;
          patterns?: { urlPattern?: string; resourceType?: string }[];
        }
      | undefined;
    expect(enableParams?.handleAuthRequests).toBe(false);
    expect(enableParams?.patterns).toBeDefined();
    expect(enableParams?.patterns?.[0]).toEqual({
      urlPattern: "*",
      resourceType: "Document",
    });
    expect(enableParams?.patterns?.[1]).toEqual({ urlPattern: "*" });
  });
});
