/**
 * Audio + canvas fingerprint rules. Cover R-047 and R-048.
 *
 * The captures are device-fixed (same value per profile across every seed)
 * and live in `./lookups/audio-canvas.ts`. The rule's job is to copy the
 * lookup row into a JSON-serialised `uaCh.audio-fingerprint` /
 * `uaCh.canvas-fingerprint` slot the inject layer reads.
 *
 * R-047 (`audioFingerprint`): inputs `(id, audio.contextSampleRate)`. We
 * carry `contextSampleRate` as an input so the DAG records the relationship
 * (PLAN.md §9.2 — "rules declare semantic dependency, not just data
 * dependency"); the value is double-checked against the lookup row.
 *
 * R-048 (`canvasFingerprint`): input `(id,)`. Canvas captures don't depend
 * on any other matrix axis — the fingerprint surface is GPU/OS-driver
 * coupled and that coupling is folded into the per-profile lookup row.
 *
 * Closing the audio + canvas surfaces flips the README "what works /
 * doesn't" matrix's two largest leakers from `deferred` to `works`.
 *
 * @see PLAN.md §9.3 (audio), §9.4 (canvas)
 * @see tasks/0267-audio-canvas-fingerprint-blobs.md
 */

import { defineRule, type Rule } from "../rule";
import { audioCaptureFor, canvasCaptureFor, canvasTailFor } from "./lookups/audio-canvas";

/**
 * R-047 — `(id, audio.contextSampleRate)` → `uaCh.audio-fingerprint` JSON.
 *
 * Output shape (consumed by `packages/inject/src/modules/audio-fingerprint.ts`):
 *   `{ "sampleRate": number,
 *      "audioHash":  string,         // sum of |data[i]|, i in [4500..5000)
 *      "sampleValues": number[10] }` // data[4500..4510)
 *
 * The reported `sampleRate` is the OfflineAudioContext sample rate the
 * fingerprint probe constructs (probe-page.html uses 44100 verbatim; the
 * AudioContext's `sampleRate` getter returns `audio.contextSampleRate`).
 */
export const R047: Rule = defineRule<readonly [string, number], string>({
  id: "R-047",
  description: "Audio fingerprint blob (probe-side audioHash + sampleValues window) per profile",
  inputs: ["id", "audio.contextSampleRate"],
  output: "uaCh.audio-fingerprint",
  derive([profileId, _ctxSampleRate]) {
    const cap = audioCaptureFor(profileId);
    return JSON.stringify({
      sampleRate: cap.sampleRate,
      audioHash: cap.audioHash,
      sampleValues: cap.sampleValues,
    });
  },
});

/**
 * R-048 — `(id,)` → `uaCh.canvas-fingerprint` JSON.
 *
 * Output shape (consumed by `packages/inject/src/modules/canvas-fingerprint.ts`):
 *   `{ "consistent": true,
 *      "hash": "8-uppercase-hex",          // hashString(toDataURL("image/png"))
 *      "dataUrlLength": number,            // exact length
 *      "dataUrlPrefix": string,            // first 50 chars
 *      "webpSupport": boolean,
 *      "jpegHighLength": number,
 *      "jpegLowLength": number,
 *      "synthTail": "8-base64-chars" }`    // pre-computed via meet-in-middle
 *
 * The `synthTail` is computed once per (prefix, length, hash) triple by
 * `canvasTailFor` (memoised in the lookup). The inject module emits this
 * tail verbatim — no runtime brute-force, no JIT-tier fragility.
 *
 * The probe-page heuristic for "is this a fingerprint canvas?" — 300×150
 * with text + gradient — is matched in the inject module; non-probe
 * canvases fall through to native rendering so legitimate canvas use
 * stays correct. See the inject module for the FP discussion.
 */
export const R048: Rule = defineRule<readonly [string], string>({
  id: "R-048",
  description:
    "Canvas fingerprint blob (probe-side hash + length + prefix + synth tail) per profile",
  inputs: ["id"],
  output: "uaCh.canvas-fingerprint",
  derive([profileId]) {
    const cap = canvasCaptureFor(profileId);
    const synthTail = canvasTailFor(profileId);
    return JSON.stringify({
      consistent: cap.consistent,
      hash: cap.hash,
      dataUrlLength: cap.dataUrlLength,
      dataUrlPrefix: cap.dataUrlPrefix,
      webpSupport: cap.webpSupport,
      jpegHighLength: cap.jpegHighLength,
      jpegLowLength: cap.jpegLowLength,
      synthTail,
    });
  },
});

export const AUDIO_CANVAS_RULES: readonly Rule[] = [R047, R048];
