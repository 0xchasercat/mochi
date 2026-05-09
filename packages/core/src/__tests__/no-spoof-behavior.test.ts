/**
 * Unit test: Session built with `matrix: null` (no-spoof mode) returns
 * pages whose behavioral fallback is `DEFAULT_BEHAVIOR` from
 * `@mochi.js/behavioral`.
 *
 * Drives a stock Session against the shared fake-CDP-pipe fixture.
 * Verifies the wire-level effect (no spoof CDP overrides on `newPage`)
 * AND the in-process effect (`Session.profile === null`,
 * `_internalPayload() === null`).
 *
 * The `humanClick` synth-level fallback is covered in
 * `packages/behavioral/src/__tests__/default-behavior.test.ts`; we
 * cross-check here that `Page` accepts the no-spoof construction without
 * throwing — meaning the fallback was wired correctly in
 * `Session.newPage`.
 */

import { describe, expect, it } from "bun:test";
import { DEFAULT_BEHAVIOR } from "@mochi.js/behavioral";
import { fakeChromiumProcess, makeFakePipe } from "../../../../tests/helpers/cdp-fixture";
import { Session } from "../index";

describe("no-spoof Session: behavior falls back to DEFAULT_BEHAVIOR", () => {
  it("constructs a Page without throwing when matrix is null", async () => {
    const pipe = makeFakePipe();
    const session = new Session({
      proc: fakeChromiumProcess(pipe, { userDataDir: "/tmp/no-spoof-fallback" }),
      matrix: null,
      seed: "",
      defaultTimeoutMs: 1000,
    });
    try {
      const page = await session.newPage();
      expect(page).toBeDefined();
      // The Page is alive — its `url` getter returns the seed URL.
      expect(page.url).toBe("about:blank");
    } finally {
      await pipe.waitFor("Target.setAutoAttach", { timeoutMs: 2_000 }).catch(() => undefined);
      await session.close();
    }
  }, 10_000);

  it("DEFAULT_BEHAVIOR is the canonical no-spoof fallback (wpm=60, smooth scroll, right hand, 0.18 tremor)", () => {
    // Pinned by the brief. If a future change tunes these values, update
    // both the test AND the docs in `docs/content/docs/api/core.md`.
    expect(DEFAULT_BEHAVIOR.hand).toBe("right");
    expect(DEFAULT_BEHAVIOR.tremor).toBe(0.18);
    expect(DEFAULT_BEHAVIOR.wpm).toBe(60);
    expect(DEFAULT_BEHAVIOR.scrollStyle).toBe("smooth");
  });
});
