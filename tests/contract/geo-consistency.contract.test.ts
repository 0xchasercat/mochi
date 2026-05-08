/**
 * Cross-package contract: the post-reconciliation matrix's `timezone` MUST
 * be sent to Chromium via `Emulation.setTimezoneOverride` on every new page
 * session, AFTER `Target.attachToTarget` and BEFORE the inject script
 * install. This pins the JS-side timezone spoof that drives both
 * `Intl.DateTimeFormat().resolvedOptions().timeZone` AND
 * `Date.getTimezoneOffset()` (Chromium's V8 reads from the same internal
 * source for both, per the brief — so a single CDP send covers both
 * surfaces).
 *
 * Per `Emulation.setTimezoneOverride` docs (chromium.googlesource.com),
 * the method does NOT require `Emulation.enable`; it stores override
 * state directly on the `EmulationAgent`. PLAN.md §8.2's bans
 * (`Runtime.enable`, `Page.createIsolatedWorld`, etc.) are unaffected.
 *
 * The reconciler half of task 0262 is unit-tested in
 * `packages/core/src/__tests__/geo-consistency.test.ts`. This contract
 * test pins the SESSION-LEVEL wiring: matrix.timezone in → CDP frame out,
 * with the right session id, before inject script install.
 *
 * @see PLAN.md §8.2 / §9 / I-5
 * @see tasks/0262-ip-tz-locale-exit-consistency.md
 */

import { describe, expect, it } from "bun:test";
import { deriveMatrix, type ProfileV1 } from "../../packages/consistency/src/index";
import { Session } from "../../packages/core/src/session";
import { fakeChromiumProcess, makeFakePipe } from "../helpers/cdp-fixture";

function fixtureProfile(): ProfileV1 {
  return {
    id: "geo-tz-contract",
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
    timezone: "Europe/Berlin",
    locale: "de-DE",
    languages: ["de-DE", "de", "en"],
    behavior: { hand: "right", tremor: 0.18, wpm: 60, scrollStyle: "smooth" },
    wreqPreset: "chrome_131_macos",
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.6778.86 Safari/537.36",
    uaCh: {},
    entropyBudget: { fixed: [], perSeed: [] },
  };
}

describe("contract: Emulation.setTimezoneOverride pins matrix.timezone per page session", () => {
  it("Session.newPage sends Emulation.setTimezoneOverride with matrix timezone on the page session", async () => {
    const pipe = makeFakePipe({
      responders: {
        "Target.createTarget": () => ({ targetId: "tgt-tz-1" }),
        "Target.attachToTarget": () => ({ sessionId: "tz-page-sess" }),
        "Page.addScriptToEvaluateOnNewDocument": () => ({ identifier: "scr-tz-1" }),
      },
    });
    const matrix = deriveMatrix(fixtureProfile(), "tz-pin");

    const session = new Session({
      proc: fakeChromiumProcess(pipe, { userDataDir: "/tmp/contract-fake-tz-override" }),
      matrix,
      seed: "tz-pin",
      defaultTimeoutMs: 250,
    });

    try {
      const page = await session.newPage();
      expect(page).toBeDefined();

      // The contract assertion: at least one Emulation.setTimezoneOverride
      // frame was written, addressed to the page session, with the matrix tz.
      const tzFrames = pipe.written.filter(
        (f) => f.parsed.method === "Emulation.setTimezoneOverride",
      );
      expect(tzFrames.length).toBeGreaterThanOrEqual(1);

      const tzOnPage = tzFrames.find((f) => f.parsed.sessionId === "tz-page-sess");
      expect(tzOnPage).toBeDefined();
      const tzParams = tzOnPage?.parsed.params as { timezoneId?: string } | undefined;
      expect(tzParams?.timezoneId).toBe(matrix.timezone);
      expect(tzParams?.timezoneId).toBe("Europe/Berlin");

      // Ordering: Page.enable BEFORE Emulation.setTimezoneOverride. The
      // inject install used to anchor a third leg here, but task 0266
      // retired the per-page `Page.addScriptToEvaluateOnNewDocument` call
      // in favour of a session-level `Fetch.fulfillRequest` body splice
      // (PLAN.md §8.4 amended). The timezone override is still wired
      // before the page can navigate (and therefore before the spliced
      // payload runs), so the I-5 invariant is preserved end-to-end.
      const idxPageEnable = pipe.written.findIndex(
        (f) => f.parsed.method === "Page.enable" && f.parsed.sessionId === "tz-page-sess",
      );
      const idxTzOverride = pipe.written.findIndex(
        (f) =>
          f.parsed.method === "Emulation.setTimezoneOverride" &&
          f.parsed.sessionId === "tz-page-sess",
      );
      expect(idxPageEnable).toBeGreaterThanOrEqual(0);
      expect(idxTzOverride).toBeGreaterThanOrEqual(0);
      expect(idxPageEnable).toBeLessThan(idxTzOverride);

      await page.close();
    } finally {
      await session.close();
    }
  }, 10_000);

  it("bypassInject sessions do NOT send Emulation.setTimezoneOverride (capture flow needs bare timezone)", async () => {
    const pipe = makeFakePipe({
      responders: {
        "Target.createTarget": () => ({ targetId: "tgt-bypass" }),
        "Target.attachToTarget": () => ({ sessionId: "bypass-sess" }),
      },
    });
    const matrix = deriveMatrix(fixtureProfile(), "bypass-no-tz");

    const session = new Session({
      proc: fakeChromiumProcess(pipe, { userDataDir: "/tmp/contract-fake-bypass-tz" }),
      matrix,
      seed: "bypass-no-tz",
      defaultTimeoutMs: 250,
      bypassInject: true,
    });

    try {
      const page = await session.newPage();
      expect(page).toBeDefined();
      const tzFrames = pipe.written.filter(
        (f) => f.parsed.method === "Emulation.setTimezoneOverride",
      );
      expect(tzFrames.length).toBe(0);
      // Likewise, no UA override (existing contract — confirms bypass scope).
      const uaFrames = pipe.written.filter(
        (f) => f.parsed.method === "Network.setUserAgentOverride",
      );
      expect(uaFrames.length).toBe(0);
      await page.close();
    } finally {
      await session.close();
    }
  }, 10_000);
});
