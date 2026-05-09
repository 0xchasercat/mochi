/**
 * Phase 0.4 GATE — end-to-end capture against real Chromium.
 *
 * Spawns a bare, un-spoofed Chromium via `mochi.launch({ bypassInject:
 * true })`, drives it to the local probe-page fixture, polls
 * `window.__probesReady`, parses the result, derives a ProfileV1,
 * validates against the schema, and writes the artifacts to a tmp dir.
 *
 * Gated by `MOCHI_E2E=1`. Set `MOCHI_CHROMIUM_PATH` to a real Chromium /
 * Chrome / Chromium-for-Testing binary.
 *
 * Budget: < 30 seconds total (10s for launch+probe, 20s grace).
 *
 * Does NOT commit any data — output goes to a fresh tmp dir per test.
 *
 * @see PLAN.md §12.1 / §14 phase 0.4
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCapture } from "../index";

const E2E_ENABLED = process.env.MOCHI_E2E === "1";
const TEST_TIMEOUT_MS = 30_000;

const describeOrSkip = E2E_ENABLED ? describe : describe.skip;

describeOrSkip("@mochi.js/cli capture E2E (MOCHI_E2E=1)", () => {
  let outDir: string;

  beforeAll(async () => {
    outDir = await mkdtemp(join(tmpdir(), "mochi-capture-e2e-"));
  });

  afterAll(async () => {
    await rm(outDir, { recursive: true, force: true }).catch(() => {});
  });

  it(
    "captures the host machine into a ProfileV1 + baseline manifest + provenance",
    async () => {
      const result = await runCapture({
        profileId: "e2e-host-snapshot",
        outDir,
        seed: "e2e-test",
        headless: true,
        interactive: false,
        provenanceInputs: {
          capturer: "e2e",
          machine: "ci",
          mochiVersion: "0.0.1-e2e",
        },
        probeTimeoutMs: 20_000,
      });

      // The captured ProfileV1 carries the device's truth.
      expect(result.profile.id).toBe("e2e-host-snapshot");
      expect(result.profile.engine).toBe("chromium");
      expect(["macos", "windows", "linux"]).toContain(result.profile.os.name);
      expect(result.profile.device.cores).toBeGreaterThan(0);
      expect(result.profile.display.width).toBeGreaterThan(0);
      expect(result.profile.gpu.webglUnmaskedRenderer.length).toBeGreaterThan(0);

      // Files exist at the documented paths.
      expect(await Bun.file(result.profilePath).exists()).toBe(true);
      expect(await Bun.file(result.manifestPath).exists()).toBe(true);
      expect(await Bun.file(result.provenancePath).exists()).toBe(true);

      // profile.json round-trips through JSON.parse.
      const profileText = await Bun.file(result.profilePath).text();
      const parsed = JSON.parse(profileText);
      expect(parsed.id).toBe("e2e-host-snapshot");
      expect(typeof parsed.userAgent).toBe("string");

      // baseline.manifest.json contains all the probe families.
      const manifestText = await Bun.file(result.manifestPath).text();
      const probes = JSON.parse(manifestText);
      expect(typeof probes.navigator).toBe("object");
      expect(typeof probes.screen).toBe("object");
      expect(typeof probes.canvas).toBe("object");
      expect(typeof probes.webgl).toBe("object");
      expect(typeof probes.fonts).toBe("object");
      expect(typeof probes.timing).toBe("object");
      expect(typeof probes.bot).toBe("object");

      // PROVENANCE.md has the documented headers.
      const prov = await Bun.file(result.provenancePath).text();
      expect(prov).toContain("# PROVENANCE — e2e-host-snapshot");
      expect(prov).toContain("| capturer | e2e |");
    },
    TEST_TIMEOUT_MS,
  );
});
