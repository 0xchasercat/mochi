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
 * @see tasks/0040-mochi-capture.md — `bypassInject: true` requirement.
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

  it("with bypassInject:true — newPage() never sends Page.addScriptToEvaluateOnNewDocument", async () => {
    const matrix = deriveMatrix(TEST_PROFILE, "bypass-test");
    session = new Session({
      proc: fakeChromiumProcess(pipe, { userDataDir: "/tmp/fake-mochi-test" }),
      matrix,
      seed: "bypass-test",
      bypassInject: true,
    });

    const page = await session.newPage();
    expect(page).toBeDefined();

    const methods = pipe.written
      .map((w) => w.parsed.method)
      .filter((m): m is string => typeof m === "string");
    expect(methods).toContain("Target.createTarget");
    expect(methods).toContain("Target.attachToTarget");
    expect(methods).toContain("Page.enable");
    // The contract: ZERO addScriptToEvaluateOnNewDocument sends.
    expect(methods).not.toContain("Page.addScriptToEvaluateOnNewDocument");
    // And no Runtime.evaluate either (worker injection is also bypassed).
    expect(methods).not.toContain("Runtime.evaluate");
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

  it("with bypassInject omitted — _internalPayload() is non-null and newPage installs the inject script", async () => {
    // Override the script identifier for this test — it asserts that the
    // `addScriptToEvaluateOnNewDocument` call carries the matrix payload's
    // compiled code.
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

    const methods = localPipe.written
      .map((w) => w.parsed.method)
      .filter((m): m is string => typeof m === "string");
    // Default behavior: the inject script IS installed.
    expect(methods).toContain("Page.addScriptToEvaluateOnNewDocument");
    // And the params carry the compiled payload code.
    const installCall = localPipe.written.find(
      (w) => w.parsed.method === "Page.addScriptToEvaluateOnNewDocument",
    );
    const params = installCall?.parsed.params as
      | { source?: string; runImmediately?: boolean }
      | undefined;
    expect(params?.source).toBe(payload?.code);
    expect(params?.runImmediately).toBe(true);
  });
});
