/**
 * Unit: audio + canvas fingerprint spoof modules.
 *
 * The probe-side observables (audioHash + sampleValues window for audio,
 * dataUrlPrefix + dataUrlLength + hash for canvas) are pinned in the
 * matrix's uaCh.audio-fingerprint / uaCh.canvas-fingerprint slots by
 * R-047 / R-048. The inject modules consume these.
 *
 * The sandbox in `sandbox.ts` doesn't yet stand up OfflineAudioContext or
 * HTMLCanvasElement, so we assert the SHAPE of the emitted JS rather than
 * runtime semantics — same pattern as `phase07-modules.test.ts`. Runtime
 * semantics are exercised by the harness E2E gate.
 *
 * Build-time correctness IS exercised here: we verify that the canvas
 * synthesiser produces a data URL whose hashString + length match the
 * captured baseline byte-exactly (the meet-in-the-middle search is the
 * load-bearing piece of this brief).
 *
 * @see tasks/0267-audio-canvas-fingerprint-blobs.md
 */

import { describe, expect, it } from "bun:test";
import { buildPayload } from "../build";
import { emitAudioFingerprintModule } from "../modules/audio-fingerprint";
import { emitCanvasFingerprintModule } from "../modules/canvas-fingerprint";
import { FIXTURE_MATRIX } from "./fixtures";

/** mac-chrome-stable's captured probe observables (mirrors the lookup). */
const MAC_AUDIO_FP = {
  sampleRate: 48000,
  audioHash: "124.04347624466754",
  sampleValues: [
    -0.10808053612709045, -0.3909117877483368, -0.005692681297659874, 0.3892313539981842,
    0.1189708411693573, -0.3545846939086914, -0.22215834259986877, 0.28990939259529114,
    0.30651888251304626, -0.20068734884262085,
  ],
};

const MAC_CANVAS_FP = {
  consistent: true,
  hash: "743CC003",
  dataUrlLength: 25858,
  dataUrlPrefix: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAASwA",
  webpSupport: true,
  jpegHighLength: 26851,
  jpegLowLength: 2347,
  // Precomputed tail for (mac-chrome-stable's prefix, length 25858, hash 743CC003).
  // Generated at boot by `synthesiseCanvasTail` in
  // `packages/consistency/src/rules/lookups/audio-canvas.ts`. Pinning the
  // value here keeps the inject unit tests independent of the consistency
  // package's tail-search timing.
  synthTail: "AAeiumiz",
};

const MATRIX_WITH_FP = {
  ...FIXTURE_MATRIX,
  uaCh: {
    ...FIXTURE_MATRIX.uaCh,
    "audio-fingerprint": JSON.stringify(MAC_AUDIO_FP),
    "canvas-fingerprint": JSON.stringify(MAC_CANVAS_FP),
  },
};

/** hashString — mirrors the probe-page implementation. */
function hashString(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h << 5) - h + s.charCodeAt(i);
    h |= 0;
  }
  return (h >>> 0).toString(16).toUpperCase().padStart(8, "0");
}

describe("audio fingerprint module", () => {
  it("emits a startRendering override when matrix carries the audio-fingerprint slot", () => {
    const code = emitAudioFingerprintModule(MATRIX_WITH_FP);
    expect(code).toContain("audio fingerprint spoof");
    expect(code).toContain("startRendering");
    expect(code).toContain("OfflineAudioContext");
    expect(code).toContain("4500");
    expect(code).toContain("5000");
  });

  it("embeds the captured sample window verbatim", () => {
    const code = emitAudioFingerprintModule(MATRIX_WITH_FP);
    // The 10 captured samples should appear as a JSON array in the payload.
    expect(code).toContain("-0.10808053612709045");
    expect(code).toContain("-0.20068734884262085");
  });

  it("embeds the captured audioHash string", () => {
    const code = emitAudioFingerprintModule(MATRIX_WITH_FP);
    expect(code).toContain('"124.04347624466754"');
  });

  it("registers the override under the native name 'startRendering'", () => {
    const code = emitAudioFingerprintModule(MATRIX_WITH_FP);
    expect(code).toContain('__mochi_register_native__(startRendering, "startRendering")');
  });

  it("skips when matrix has no audio-fingerprint slot", () => {
    const code = emitAudioFingerprintModule(FIXTURE_MATRIX);
    expect(code).toContain("audio fingerprint spoof (skipped");
  });

  it("is deterministic for identical input", () => {
    const a = emitAudioFingerprintModule(MATRIX_WITH_FP);
    const b = emitAudioFingerprintModule(MATRIX_WITH_FP);
    expect(a).toBe(b);
  });
});

describe("canvas fingerprint module", () => {
  it("emits a toDataURL override when matrix carries the canvas-fingerprint slot", () => {
    const code = emitCanvasFingerprintModule(MATRIX_WITH_FP);
    expect(code).toContain("canvas fingerprint spoof");
    expect(code).toContain("toDataURL");
    expect(code).toContain("HTMLCanvasElement");
  });

  it("synthesises a data URL whose hash + length match the captured baseline", () => {
    const code = emitCanvasFingerprintModule(MATRIX_WITH_FP);
    expect(code).toContain("synth verified at build time");
    // Extract the prefix + tail + filler-length from the emitted source and
    // rebuild — the runtime IIFE does this same expansion.
    const prefMatch = code.match(/var SPOOF_PNG_PREFIX = (".*?");/);
    const tailMatch = code.match(/var SPOOF_PNG_TAIL = (".*?");/);
    const lenMatch = code.match(/var SPOOF_PNG_FILLER_LEN = (\d+);/);
    expect(prefMatch).not.toBeNull();
    expect(tailMatch).not.toBeNull();
    expect(lenMatch).not.toBeNull();
    if (prefMatch === null || tailMatch === null || lenMatch === null) return;
    const prefix = JSON.parse(prefMatch[1]!);
    const tail = JSON.parse(tailMatch[1]!);
    const fillerLen = Number.parseInt(lenMatch[1]!, 10);
    const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let filler = "";
    for (let i = 0; i < fillerLen; i++) filler += B64[(i * 7 + 11) % 64];
    const url = prefix + filler + tail;
    expect(url.length).toBe(MAC_CANVAS_FP.dataUrlLength);
    expect(url.startsWith(MAC_CANVAS_FP.dataUrlPrefix)).toBe(true);
    expect(hashString(url)).toBe(MAC_CANVAS_FP.hash);
  });

  it("includes the probe-size whitelist (300x150, 240x140, 200x60, 280x60)", () => {
    const code = emitCanvasFingerprintModule(MATRIX_WITH_FP);
    expect(code).toContain('"w":300,"h":150');
    expect(code).toContain('"w":240,"h":140');
    expect(code).toContain('"w":200,"h":60');
    expect(code).toContain('"w":280,"h":60');
  });

  it("flags drawText separately from generic draw operations", () => {
    const code = emitCanvasFingerprintModule(MATRIX_WITH_FP);
    expect(code).toContain("fillText");
    expect(code).toContain("strokeText");
    expect(code).toContain("drewText");
    expect(code).toContain("isProbeCanvas");
  });

  it("registers the toDataURL override under the native name", () => {
    const code = emitCanvasFingerprintModule(MATRIX_WITH_FP);
    expect(code).toContain('__mochi_register_native__(toDataURL, "toDataURL")');
  });

  it("skips when matrix has no canvas-fingerprint slot", () => {
    const code = emitCanvasFingerprintModule(FIXTURE_MATRIX);
    expect(code).toContain("canvas fingerprint spoof (skipped");
  });

  it("is deterministic for identical input", () => {
    const a = emitCanvasFingerprintModule(MATRIX_WITH_FP);
    const b = emitCanvasFingerprintModule(MATRIX_WITH_FP);
    expect(a).toBe(b);
  });
});

describe("audio + canvas integration with buildPayload", () => {
  it("buildPayload includes both fingerprint module markers when present", () => {
    const { code } = buildPayload(MATRIX_WITH_FP);
    expect(code).toContain("mochi:audio-fingerprint");
    expect(code).toContain("mochi:canvas-fingerprint");
  });

  it("buildPayload size stays under the 80KB soft budget for a real profile fixture", () => {
    const { code } = buildPayload(MATRIX_WITH_FP);
    // 80KB budget; soft warning only — but we want to know if either module
    // bloats the payload past it. The compact emit (prefix+tail+filler-recipe)
    // keeps this comfortably under.
    expect(code.length).toBeLessThan(80 * 1024);
  });

  it("buildPayload is deterministic for identical fingerprint slots", () => {
    const a = buildPayload(MATRIX_WITH_FP);
    const b = buildPayload(MATRIX_WITH_FP);
    expect(a.sha256).toBe(b.sha256);
  });

  it("buildPayload differs when the canvas hash changes", () => {
    const a = buildPayload(MATRIX_WITH_FP);
    const b = buildPayload({
      ...MATRIX_WITH_FP,
      uaCh: {
        ...MATRIX_WITH_FP.uaCh,
        "canvas-fingerprint": JSON.stringify({ ...MAC_CANVAS_FP, hash: "DEADBEEF" }),
      },
    });
    expect(a.sha256).not.toBe(b.sha256);
  });
});
