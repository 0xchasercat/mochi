/**
 * Drift detector for `tests/helpers/cdp-fixture.ts`'s `defaultResponders`.
 *
 * Records every CDP `router.send(method, ...)` mochi makes during a stock
 * `Session` lifecycle (construct → newPage → page.close → session.close)
 * and asserts every recorded method has a key in `defaultResponders`.
 *
 * When a future PR adds a new `router.send("Foo.bar", ...)` call to
 * `Session` (or its callees) without updating `defaultResponders`, this
 * test fails with the missing method named — the exact regression we keep
 * hitting (waves 2 and 3, four times). The author updates the responders
 * map in the same PR; the rest of the fixture suite keeps working.
 *
 * Worker-bootstrap methods (`Runtime.evaluate`, `Runtime.callFunctionOn`,
 * `Runtime.runIfWaitingForDebugger`) are NOT in `defaultResponders` because
 * the worker path isn't on the stock `newPage` → `close` lifecycle —
 * tests that exercise it provide their own responders. We assert only that
 * the lifecycle covered here is fully covered.
 *
 * @see tests/helpers/cdp-fixture.ts
 * @see tasks/0264-cdp-fixture-helper.md
 */

import { describe, expect, it } from "bun:test";
import { deriveMatrix, type ProfileV1 } from "../../packages/consistency/src/index";
import { Session } from "../../packages/core/src/session";
import { defaultResponders, fakeChromiumProcess, makeFakePipe } from "../helpers/cdp-fixture";

function fixtureProfile(): ProfileV1 {
  return {
    id: "cdp-fixture-coverage",
    version: "0.0.0",
    engine: "chromium",
    browser: { name: "chrome", channel: "stable", minVersion: "131", maxVersion: "133" },
    os: { name: "macos", version: "14", arch: "arm64" },
    device: { vendor: "Apple", model: "M2", cpuFamily: "apple-silicon-m2", cores: 8, memoryGB: 16 },
    display: { width: 1728, height: 1117, dpr: 2, colorDepth: 30, pixelDepth: 30 },
    gpu: {
      vendor: "Apple Inc.",
      renderer: "Apple M2",
      webglUnmaskedVendor: "Google Inc. (Apple)",
      webglUnmaskedRenderer: "ANGLE (Apple, ANGLE Metal Renderer: Apple M2)",
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
    userAgent: "Mozilla/5.0 contract",
    uaCh: {},
    entropyBudget: { fixed: [], perSeed: [] },
  };
}

describe("contract: defaultResponders covers every CDP method a stock Session lifecycle sends", () => {
  it("Session construction → newPage → page.close → session.close sends only methods present in defaultResponders", async () => {
    const pipe = makeFakePipe();
    const matrix = deriveMatrix(fixtureProfile(), "drift-detector");

    const session = new Session({
      proc: fakeChromiumProcess(pipe, { userDataDir: "/tmp/cdp-fixture-coverage" }),
      matrix,
      seed: "drift-detector",
      defaultTimeoutMs: 1000,
    });

    try {
      const page = await session.newPage();
      await page.close();
    } finally {
      await session.close();
    }

    // Drain microtasks so any in-flight responses settle before we read
    // `written`.
    await new Promise((r) => setTimeout(r, 50));

    const observedMethods = new Set<string>();
    for (const frame of pipe.written) {
      const m = frame.parsed.method;
      if (typeof m === "string") observedMethods.add(m);
    }

    // Sanity: we observed at least the create-attach-enable trio. Without
    // this the test would pass vacuously if `Session` failed silently.
    expect(observedMethods.has("Target.createTarget")).toBe(true);
    expect(observedMethods.has("Target.attachToTarget")).toBe(true);
    expect(observedMethods.has("Page.enable")).toBe(true);

    // Every observed method MUST be in `defaultResponders` — the drift
    // assertion. If a new send slips into Session without updating the
    // helper, this fails with the missing method right here.
    const missing: string[] = [];
    for (const method of observedMethods) {
      if (!Object.hasOwn(defaultResponders, method)) {
        missing.push(method);
      }
    }
    if (missing.length > 0) {
      throw new Error(
        `[cdp-fixture-coverage] Session sent CDP method(s) not covered by ` +
          `defaultResponders: ${missing.sort().join(", ")}. ` +
          `Add a responder for each in tests/helpers/cdp-fixture.ts so the ` +
          `next fixture that drives Session doesn't trip on them.`,
      );
    }
  }, 10_000);

  it("defaultResponders keys exactly match the documented responder list (the brief's pinned set)", () => {
    // Pinned per task 0264. If this list changes, update the brief and the
    // helper's JSDoc together so the documentation stays truthful.
    const expected = [
      "Target.setAutoAttach",
      "Target.createTarget",
      "Target.attachToTarget",
      "Target.closeTarget",
      "Page.enable",
      "Network.setUserAgentOverride",
      "Emulation.setTimezoneOverride",
      "Fetch.enable",
      "Fetch.disable",
      "Page.addScriptToEvaluateOnNewDocument",
      "Page.removeScriptToEvaluateOnNewDocument",
    ].sort();
    const actual = Object.keys(defaultResponders).sort();
    expect(actual).toEqual(expected);
  });
});
