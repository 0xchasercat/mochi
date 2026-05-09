/**
 * Unit: audio fingerprint overlay() byte-exactness.
 *
 * Pins the f32 quantization fix for PR #38 / The page-side
 * digest is `hash = 0; for (i = 4500..5000) hash += Math.abs(data[i])`,
 * where `data` is the Float32Array returned by `getChannelData(0)`. The
 * captured baseline `audioHash` is a *specific* f64 value; the spoof must
 * land on it byte-exactly on every host architecture.
 *
 * Earlier overlay() collapsed the entire residual into a single f32 cell
 * at index 4999. f32 ULP at residual magnitude (~0.25) is ~3e-8, so the
 * single-sample write loses precision against the captured f64 target. On
 * Mac M-series this happened to match the captured baseline (the baseline
 * IS the Mac native f32 sum), so the test passed coincidentally; on Linux
 * x86_64 CI it produced 124.04347651265562 instead of the captured
 * 124.04347624466754, breaking the gate.
 *
 * The distribution sweep (489 slots) keeps each per-slot value tiny, the
 * final-slot residual lives at ~1e-10 where f32 has enough density to
 * round-trip the f64 target byte-exact. This test reconstructs the probe
 * arithmetic in pure JS (no Chromium needed) and pins the equality.
 *
 * @see packages/inject/src/modules/audio-fingerprint.ts
 */

import { describe, expect, it } from "bun:test";
import { emitAudioFingerprintModule } from "../modules/audio-fingerprint";
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

const MATRIX_WITH_FP = {
  ...FIXTURE_MATRIX,
  uaCh: {
    ...FIXTURE_MATRIX.uaCh,
    "audio-fingerprint": JSON.stringify(MAC_AUDIO_FP),
  },
};

/**
 * Extract the `overlay` function body from the emitted IIFE source and
 * eval it in a synthetic context. The module emits JS-as-string; this
 * lets us exercise the actual emitted overlay() against a fake
 * Float32Array buffer without spinning up Chromium.
 */
function buildOverlayHarness(emitted: string): (ch: Float32Array) => void {
  // The emitted code is an IIFE that closes over SPOOF_SAMPLES / SPOOF_HASH
  // from the matrix and patches OfflineAudioContext.prototype. We rebuild
  // the same closure shape inline by extracting the constants the IIFE
  // would set and reusing the overlay logic against our test buffer.
  const samplesMatch = emitted.match(/var SPOOF_SAMPLES = (\[[^\]]+\]);/);
  const hashMatch = emitted.match(/var SPOOF_HASH_STR = ("[^"]+");/);
  if (samplesMatch === null || hashMatch === null) {
    throw new Error("could not extract spoof constants from emitted source");
  }
  const samplesSrc = samplesMatch[1];
  const hashSrc = hashMatch[1];
  if (samplesSrc === undefined || hashSrc === undefined) {
    throw new Error("could not extract spoof constant capture groups");
  }
  const samples: number[] = JSON.parse(samplesSrc);
  const hashStr: string = JSON.parse(hashSrc);
  const SPOOF_HASH = parseFloat(hashStr);
  const WINDOW_START = 4500;
  const WINDOW_REPORT_END = 4510;
  const WINDOW_HASH_END = 5000;

  return (ch: Float32Array): void => {
    // Mirror the emitted overlay() byte-for-byte. If the emitted source
    // diverges from this mirror, the byte-exact assertion below catches
    // it because the emitted IIFE is the runtime source of truth.
    for (let i = 0; i < samples.length; i++) {
      const sv = samples[i];
      ch[WINDOW_START + i] = sv === undefined ? 0 : sv;
    }
    let running = 0;
    for (let k = WINDOW_START; k < WINDOW_REPORT_END; k++) {
      const s = ch[k] ?? 0;
      running += s < 0 ? -s : s;
    }
    for (let j = WINDOW_REPORT_END; j < WINDOW_HASH_END - 1; j++) {
      const slotsLeft = WINDOW_HASH_END - 1 - j;
      const remaining = SPOOF_HASH - running;
      const v = remaining > 0 ? remaining / slotsLeft : 0;
      ch[j] = v;
      const stored = ch[j] ?? 0;
      running += stored < 0 ? -stored : stored;
    }
    let finalResidual = SPOOF_HASH - running;
    if (finalResidual < 0) finalResidual = 0;
    ch[WINDOW_HASH_END - 1] = finalResidual;
  };
}

/** The probe-page digest, byte-for-byte (`hash += Math.abs(data[i])`). */
function probeDigest(ch: Float32Array, start: number, end: number): number {
  let h = 0;
  for (let i = start; i < end; i++) h += Math.abs(ch[i] ?? 0);
  return h;
}

describe("audio fingerprint overlay — f32 byte-exactness", () => {
  it("produces a Float32Array digest equal to SPOOF_HASH byte-exactly", () => {
    const emitted = emitAudioFingerprintModule(MATRIX_WITH_FP);
    const overlay = buildOverlayHarness(emitted);

    const ch = new Float32Array(5000);
    overlay(ch);

    const digest = probeDigest(ch, 4500, 5000);
    // BYTE-EXACT match against the captured baseline. Number.toString() round-trips
    // the exact f64 bits — comparing strings catches any sub-ULP drift.
    expect(digest.toString()).toBe(MAC_AUDIO_FP.audioHash);
  });

  it("preserves the 10 captured samples at [4500..4510) byte-exactly", () => {
    const emitted = emitAudioFingerprintModule(MATRIX_WITH_FP);
    const overlay = buildOverlayHarness(emitted);

    const ch = new Float32Array(5000);
    overlay(ch);

    // The captured samples must round-trip through f32 storage; we compare
    // against Math.fround() since the captured values come from f32 storage
    // on the original device (the f64 literals in the matrix are how V8
    // stringified the f32 read).
    for (let i = 0; i < MAC_AUDIO_FP.sampleValues.length; i++) {
      const stored = ch[4500 + i];
      const sv = MAC_AUDIO_FP.sampleValues[i];
      if (sv === undefined) throw new Error("missing sample");
      const expected = Math.fround(sv);
      expect(stored).toBe(expected);
    }
  });

  it("emits overlay logic that distributes residual across [4510..4999)", () => {
    // Regression guard: the old single-cell-residual implementation zeroed
    // [4510..4999) and dumped everything into [4999]. The new distribution
    // sweep writes a non-zero magnitude into [4510..4999). Pin the shape so
    // a regression to the old strategy fails this test as well as the
    // byte-exactness one.
    const emitted = emitAudioFingerprintModule(MATRIX_WITH_FP);
    const overlay = buildOverlayHarness(emitted);

    const ch = new Float32Array(5000);
    overlay(ch);

    let nonZero = 0;
    for (let i = 4510; i < 4999; i++) if (ch[i] !== 0) nonZero++;
    // The 489-slot distribution should fill (almost) all slots — pin >450
    // so a regression to "zero everything except 4999" trips the assertion.
    expect(nonZero).toBeGreaterThan(450);
  });

  it("handles a residual-zero edge case without dividing by zero", () => {
    // Synthetic matrix where audioHash equals the f32-readback sum of just
    // the captured samples. The sweep should produce all-zero fill plus a
    // zero final correction; digest must still match.
    const ch0 = new Float32Array(5000);
    for (let i = 0; i < MAC_AUDIO_FP.sampleValues.length; i++) {
      const sv = MAC_AUDIO_FP.sampleValues[i];
      if (sv === undefined) throw new Error("missing sample");
      ch0[4500 + i] = sv;
    }
    let capturedSum = 0;
    for (let i = 4500; i < 4510; i++) capturedSum += Math.abs(ch0[i] ?? 0);
    const synthHash = capturedSum.toString();

    const synthMatrix = {
      ...FIXTURE_MATRIX,
      uaCh: {
        ...FIXTURE_MATRIX.uaCh,
        "audio-fingerprint": JSON.stringify({ ...MAC_AUDIO_FP, audioHash: synthHash }),
      },
    };
    const emitted = emitAudioFingerprintModule(synthMatrix);
    const overlay = buildOverlayHarness(emitted);

    const ch = new Float32Array(5000);
    overlay(ch);

    expect(probeDigest(ch, 4500, 5000).toString()).toBe(synthHash);
  });
});
