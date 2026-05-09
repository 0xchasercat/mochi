/**
 * Contract test for `mochi.launch({ profile: null })` — "no-spoof mode".
 *
 * Pins the load-bearing behaviour: when `profile` is explicitly `null`,
 * the Session must NOT layer any fingerprint override on top of the
 * bare browser. Specifically:
 *
 *   - NO `Page.addScriptToEvaluateOnNewDocument` is sent (the inject
 *     entry point) — the inject pipeline is skipped entirely.
 *   - NO `Network.setUserAgentOverride` is sent (UA spoof).
 *   - NO `Emulation.setTimezoneOverride` is sent (TZ spoof).
 *   - NO `Fetch.enable` is sent unless proxy auth requires it (the
 *     init-injector body-splice path is also skipped).
 *
 * `humanClick` / `humanType` etc. still work — they fall back to
 * `DEFAULT_BEHAVIOR` from `@mochi.js/behavioral`.
 *
 * Implementation: drives a stock `Session` against the shared
 * fake-CDP-pipe fixture (see `tests/helpers/cdp-fixture.ts`). No real
 * Chromium is spawned; assertions are over the recorded wire log.
 *
 * @see ../../packages/core/src/launch.ts
 * @see ../../packages/core/src/session.ts
 */

import { describe, expect, it } from "bun:test";
import { Session } from "../../packages/core/src/index";
import { fakeChromiumProcess, makeFakePipe } from "../helpers/cdp-fixture";

describe("contract: profile: null is no-spoof mode", () => {
  it("Session constructed with matrix=null sends no spoof CDP overrides on newPage", async () => {
    const pipe = makeFakePipe();
    const session = new Session({
      proc: fakeChromiumProcess(pipe, { userDataDir: "/tmp/no-spoof" }),
      matrix: null,
      seed: "",
      defaultTimeoutMs: 1000,
    });
    try {
      // Profile field surfaces null.
      expect(session.profile).toBeNull();
      // Sessions launched (vs. connected) default to owned: true; this
      // test exercises the launch-style construction path.
      expect(session.owned).toBe(true);

      // Drive a newPage round-trip — every CDP method the session
      // would send during setup is captured on `pipe.written`.
      const page = await session.newPage();
      expect(page).toBeDefined();

      const methods = pipe.written
        .map((f) => f.parsed.method)
        .filter((m): m is string => typeof m === "string");

      // Load-bearing assertions: NO spoof overrides on the wire.
      expect(methods).not.toContain("Page.addScriptToEvaluateOnNewDocument");
      expect(methods).not.toContain("Network.setUserAgentOverride");
      expect(methods).not.toContain("Emulation.setTimezoneOverride");
      // Init-injector is also off (no payload, no proxy auth) so
      // Fetch.enable should not have been sent.
      expect(methods).not.toContain("Fetch.enable");

      // Sanity: the page setup CDP methods that DON'T depend on a
      // matrix still fired — the session works, it just doesn't spoof.
      expect(methods).toContain("Target.createTarget");
      expect(methods).toContain("Target.attachToTarget");
      expect(methods).toContain("Page.enable");
    } finally {
      await session.close();
    }
  }, 10_000);

  it("Session payload is null and inject-bypass branches are taken", async () => {
    const pipe = makeFakePipe();
    const session = new Session({
      proc: fakeChromiumProcess(pipe, { userDataDir: "/tmp/no-spoof-payload" }),
      matrix: null,
      seed: "",
      defaultTimeoutMs: 1000,
    });
    try {
      // _internalPayload exposes the compiled inject; in no-spoof mode
      // there is no payload to compile.
      expect(session._internalPayload()).toBeNull();
      // Inject is NOT bypassed (the `bypassInject` flag is its own knob,
      // for the capture flow); no-spoof mode is a separate path that
      // arrives at the same outcome on the inject side.
      expect(session._internalBypassInject()).toBe(false);
      // Let the constructor's setAutoAttach round-trip complete before
      // teardown so the fixture's microtask queue drains cleanly.
      await pipe.waitFor("Target.setAutoAttach", { timeoutMs: 2_000 }).catch(() => undefined);
    } finally {
      await session.close();
    }
  }, 10_000);
});
