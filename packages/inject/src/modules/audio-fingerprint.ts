/**
 * Spoof module: `OfflineAudioContext.prototype.startRendering`.
 *
 * The audio fingerprint surface — the most-watched JS-layer leak after
 * canvas. Real fingerprint libraries (creepjs, fingerprintjs, bot.incolumitas)
 * build an OfflineAudioContext, route an oscillator through a
 * DynamicsCompressor, render, then sample `getChannelData(0)` somewhere in
 * the [4500..5000] window. The float values returned are GPU/driver/OS
 * coupled — every Mac M1, every Windows AMD, every Linux Intel produces
 * its own bit-exact signature.
 *
 * Reads from the matrix:
 *   - `matrix.uaCh["audio-fingerprint"]` (R-047) — JSON
 *     `{ sampleRate, audioHash, sampleValues[10] }`.
 *
 * Strategy:
 *
 *   1. Patch `OfflineAudioContext.prototype.startRendering`. The wrapper
 *      runs the underlying `startRendering` so legitimate audio code (web
 *      audio games, voice processing, etc.) keeps working — we don't fight
 *      a real graph.
 *   2. After the real promise resolves, *overwrite* the [4500..4510) slice
 *      of channel 0 with the captured `sampleValues`, and balance the
 *      [4500..5000) range so `sum(|data[i]|)` matches `audioHash` exactly.
 *      The remaining samples (channel 1+, indices outside the probe window)
 *      stay native — anything probing other indices sees real audio output.
 *   3. Preserve real-startRendering timing. CfT renders ~44100 samples in
 *      ~10ms; we don't add a synthetic delay because the underlying call
 *      already honours real wall-clock. (Earlier mochi drafts capped the
 *      promise at 0ms — that's a tell. We resolve when the wrapped call
 *      resolves; if it takes 9ms, we take 9ms.)
 *   4. `nativeToString` cloak via `__mochi_register_native__`.
 *
 * Probe-side observable contract (from `tests/fixtures/probe-page.html`):
 *
 *   var hash = 0;
 *   for (var i = 4500; i < 5000; i++) hash += Math.abs(data[i]);
 *   result.audioHash    = hash.toString();
 *   result.sampleValues = data[4500..4510];   // 10 reported floats
 *
 * Both must equal the captured baseline byte-exactly. The 4500..5000 hash
 * window has 500 samples; we hold 10 of them at captured values
 * (`sampleValues[0..9]` map to `data[4500..4510)`) and rebalance the
 * remaining 490 to make `sum(abs)` land on the captured `audioHash`.
 *
 * Caveats / known false-negatives:
 *   - If a fingerprinter reads samples *outside* [4500..5000], they see
 *     real CfT-rendered audio. That's a mismatch vs the device baseline
 *     for that window — but no public fingerprinter samples outside this
 *     window in the v0.7 probe corpus. v0.8 may extend the captured
 *     window if the corpus changes.
 *   - If the page constructs an OfflineAudioContext with no oscillator/
 *     compressor (rare — would be ~zero output), our overwrite still
 *     plants the captured values at [4500..4510), changing legitimate
 *     audio output by 10 samples. This is a controlled false-positive;
 *     real audio applications use AudioContext, not OfflineAudioContext,
 *     so the surface area is small.
 *
 * @see PLAN.md §9.3
 * @see tasks/0267-audio-canvas-fingerprint-blobs.md
 */

import type { MatrixV1 } from "@mochi.js/consistency";

interface AudioFingerprint {
  readonly sampleRate: number;
  readonly audioHash: string;
  readonly sampleValues: readonly number[];
}

function tryParse<T>(s: unknown): T | null {
  if (typeof s !== "string" || s.length === 0) return null;
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
}

export function emitAudioFingerprintModule(matrix: MatrixV1): string {
  const fp = tryParse<AudioFingerprint>(matrix.uaCh["audio-fingerprint"]);
  if (
    fp === null ||
    !Array.isArray(fp.sampleValues) ||
    fp.sampleValues.length < 10 ||
    typeof fp.audioHash !== "string"
  ) {
    return `
// ---- audio fingerprint spoof (skipped — no matrix.uaCh["audio-fingerprint"]) ----
`;
  }

  const sampleValuesLiteral = JSON.stringify(fp.sampleValues.slice(0, 10));
  // The probe stringifies the JS Number sum (no toFixed) — match `Number.toString()`
  // exactly by parsing the captured string back to Number then re-stringifying it
  // inside the IIFE. We send it as a plain string here.
  const audioHashLiteral = JSON.stringify(fp.audioHash);

  return `
// ---- audio fingerprint spoof ----------------------------------------------
(function() {
  if (typeof OfflineAudioContext === "undefined") return;
  var proto = OfflineAudioContext.prototype;
  if (proto === null || proto === undefined) return;
  var orig = proto.startRendering;
  if (typeof orig !== "function") return;

  var SPOOF_SAMPLES = ${sampleValuesLiteral};
  var SPOOF_HASH_STR = ${audioHashLiteral};
  // Parse the hash string into a JS Number once so the runtime balancing
  // arithmetic is a fast double, then we re-stringify only if a probe asks.
  var SPOOF_HASH = parseFloat(SPOOF_HASH_STR);
  var WINDOW_START = 4500;
  var WINDOW_REPORT_END = 4510;   // first 10 — captured byte-exact.
  var WINDOW_HASH_END = 5000;     // 500-sample window the probe sums.

  /**
   * Overlay the captured sample window on a rendered AudioBuffer's channel 0.
   * The remaining samples in the [4500..5000) range are zeroed and one
   * sentinel sample at index 4999 is set to the residual so the absolute-
   * value sum hits the captured audioHash.
   */
  function overlay(buffer) {
    if (buffer === null || buffer === undefined) return buffer;
    var ch;
    try {
      ch = buffer.getChannelData(0);
    } catch (_e) {
      return buffer;
    }
    if (ch === undefined || ch === null || ch.length < WINDOW_HASH_END) return buffer;

    // 1. Plant the 10 reported samples.
    var capturedAbsSum = 0;
    for (var i = 0; i < SPOOF_SAMPLES.length; i++) {
      var v = SPOOF_SAMPLES[i];
      ch[WINDOW_START + i] = v;
      capturedAbsSum += v < 0 ? -v : v;
    }

    // 2. Zero the [4510..4999) range so we control the abs-sum.
    for (var j = WINDOW_REPORT_END; j < WINDOW_HASH_END - 1; j++) ch[j] = 0;

    // 3. Plant the residual at index 4999. Probe is sum |data[i]| over
    //    [4500..5000), so the residual is positive by construction.
    var residual = SPOOF_HASH - capturedAbsSum;
    if (residual < 0) residual = 0; // capture invariant: hash >= captured-window sum
    ch[WINDOW_HASH_END - 1] = residual;
    return buffer;
  }

  function startRendering() {
    // Run the underlying call so timing characteristics are real and any
    // page-side audio consumers see a normal AudioBuffer shape.
    var p;
    try {
      p = __mochi_apply__.call(orig, this, []);
    } catch (e) {
      return Promise.reject(e);
    }
    if (p === null || p === undefined || typeof p.then !== "function") {
      // Underlying call didn't return a Promise — degrade gracefully by
      // returning what we got rather than throwing.
      return p;
    }
    return p.then(function(buffer) { return overlay(buffer); });
  }
  __mochi_register_native__(startRendering, "startRendering");

  try {
    __mochi_defineProperty__(proto, "startRendering", {
      configurable: true,
      enumerable: false,
      writable: true,
      value: startRendering,
    });
  } catch (_e) {}
})();
`;
}
