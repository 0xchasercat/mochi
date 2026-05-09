/**
 * Stealth conformance — Layer 1 (offline) — audio + canvas fingerprint.
 *
 * Verifies the inject layer's R-047 / R-048 spoofs land on the page exactly
 * as the captured baselines describe. The probe-page heuristic (size +
 * text draws) gates the canvas spoof; this test runs the probe-page
 * fingerprinters verbatim and asserts the observable triple matches the
 * captured baseline byte-exactly.
 *
 * Gated by `MOCHI_E2E=1`. Profile: `mac-m4-chrome-stable`. The captured
 * canvas observables (hash 96152ABE, length 24094) and audio observables
 * (audioHash 124.04347624466754, sampleValues window) are pinned in the
 * baseline manifest.
 *
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { Session } from "@mochi.js/core";
import {
  CONFORMANCE_PROFILE,
  E2E_ENABLED,
  evalExpr,
  launchSharedSession,
  withPage,
} from "../helpers";

const TEST_TIMEOUT_MS = 20_000;
const SUITE_TIMEOUT_MS = 60_000;

const describeOrSkip = E2E_ENABLED ? describe : describe.skip;

/** Mirror of the probe-page's `hashString` — used to assert the spoof. */
const HASH_STRING_SRC = `
  function hashString(s) {
    var h = 0;
    for (var i = 0; i < s.length; i++) {
      h = ((h << 5) - h) + s.charCodeAt(i);
      h |= 0;
    }
    return (h >>> 0).toString(16).toUpperCase().padStart(8, "0");
  }
`;

describeOrSkip(
  `stealth conformance / Layer 1 — audio + canvas fingerprint (profile=${CONFORMANCE_PROFILE})`,
  () => {
    let session: Session;

    beforeAll(async () => {
      session = await launchSharedSession();
    }, SUITE_TIMEOUT_MS);

    afterAll(async () => {
      if (session !== undefined) {
        await session.close();
      }
    }, SUITE_TIMEOUT_MS);

    it(
      "canvas: 300x150 toDataURL hash + length match the mac-m4 baseline",
      async () => {
        await withPage(session, async (page) => {
          await page.goto("about:blank");
          // Replicate the probe-page's canvas drawing exactly so the
          // heuristic (size 300x150 + text draws) trips and the inject
          // returns the synthesised data URL.
          const r = await evalExpr<{ hash: string; length: number; prefix: string }>(
            page,
            `
            (function() {
              ${HASH_STRING_SRC}
              var canvas = document.createElement("canvas");
              canvas.width = 300; canvas.height = 150;
              var ctx = canvas.getContext("2d");
              ctx.fillStyle = "#f60"; ctx.fillRect(125, 1, 62, 20);
              ctx.fillStyle = "#069"; ctx.font = "14px Arial, sans-serif";
              ctx.fillText("mochi probe", 2, 15);
              var d = canvas.toDataURL("image/png");
              return { hash: hashString(d), length: d.length, prefix: d.substring(0, 50) };
            })()
            `,
          );
          // mac-m4-chrome-stable's captured baseline.
          expect(r.hash).toBe("96152ABE");
          expect(r.length).toBe(24094);
          expect(r.prefix).toBe("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAASwA");
        });
      },
      TEST_TIMEOUT_MS,
    );

    it(
      "canvas: non-probe size (e.g. 100x100) falls through to native rendering",
      async () => {
        await withPage(session, async (page) => {
          await page.goto("about:blank");
          // 100x100 — outside the probe-size whitelist. The inject must
          // fall through to native; the result will NOT equal the captured
          // 300x150 baseline.
          const r = await evalExpr<{ length: number; prefix: string }>(
            page,
            `
            (function() {
              var canvas = document.createElement("canvas");
              canvas.width = 100; canvas.height = 100;
              var ctx = canvas.getContext("2d");
              ctx.fillStyle = "#f60"; ctx.fillRect(0, 0, 100, 100);
              ctx.fillStyle = "#069"; ctx.font = "14px Arial, sans-serif";
              ctx.fillText("legitimate", 2, 15);
              var d = canvas.toDataURL("image/png");
              return { length: d.length, prefix: d.substring(0, 22) };
            })()
            `,
          );
          // The 100x100 canvas should produce a real PNG (length varies but
          // is much smaller than 24094, and prefix decodes to width 100, not 300).
          expect(r.length).toBeLessThan(24094);
          expect(r.prefix).toBe("data:image/png;base64,");
        });
      },
      TEST_TIMEOUT_MS,
    );

    it(
      "audio: OfflineAudioContext.startRendering returns the spoofed sample window",
      async () => {
        await withPage(session, async (page) => {
          await page.goto("about:blank");
          const r = await evalExpr<{
            audioHash: string;
            sampleValues: number[];
          }>(
            page,
            `
            (async function() {
              var off = new OfflineAudioContext(1, 44100, 44100);
              var osc = off.createOscillator();
              osc.type = "triangle";
              osc.frequency.setValueAtTime(10000, off.currentTime);
              var comp = off.createDynamicsCompressor();
              comp.threshold.setValueAtTime(-50, off.currentTime);
              comp.knee.setValueAtTime(40, off.currentTime);
              comp.ratio.setValueAtTime(12, off.currentTime);
              comp.attack.setValueAtTime(0, off.currentTime);
              comp.release.setValueAtTime(0.25, off.currentTime);
              osc.connect(comp); comp.connect(off.destination); osc.start(0);
              var rendered = await off.startRendering();
              var data = rendered.getChannelData(0);
              var hash = 0;
              for (var i = 4500; i < 5000; i++) hash += Math.abs(data[i]);
              return {
                audioHash: hash.toString(),
                sampleValues: Array.prototype.slice.call(data, 4500, 4510),
              };
            })()
            `,
          );
          // mac-m4-chrome-stable's captured baseline (same as mac-chrome-stable
          // — Mac M4 + Mac M-series share the audio fingerprint).
          expect(r.audioHash).toBe("124.04347624466754");
          // Sample window byte-exact.
          const expectedSamples = [
            -0.10808053612709045, -0.3909117877483368, -0.005692681297659874, 0.3892313539981842,
            0.1189708411693573, -0.3545846939086914, -0.22215834259986877, 0.28990939259529114,
            0.30651888251304626, -0.20068734884262085,
          ];
          for (let i = 0; i < 10; i++) {
            expect(r.sampleValues[i]).toBeCloseTo(expectedSamples[i]!, 8);
          }
        });
      },
      TEST_TIMEOUT_MS,
    );
  },
);
