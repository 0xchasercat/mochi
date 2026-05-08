---
"@mochi.js/inject": minor
"@mochi.js/consistency": patch
"@mochi.js/profiles": patch
---

Audio + canvas precomputed fingerprint blobs (task 0267).

Closes the two largest JS-layer stealth gaps per the README "what works /
doesn't" matrix. Real-device profile baselines from 0260 carry the captured
`audio.audioHash` + `audio.sampleValues` and `canvas.hash` + `canvas.dataUrlLength`
+ `canvas.dataUrlPrefix` for every shipped profile; this brief wires those
captures into the inject pipeline.

New consistency rules (`@mochi.js/consistency`):

- **R-047** `audioFingerprint` — `(id, audio.contextSampleRate)` →
  `uaCh.audio-fingerprint` JSON `{ sampleRate, audioHash, sampleValues[10] }`.
- **R-048** `canvasFingerprint` — `(id,)` → `uaCh.canvas-fingerprint` JSON
  `{ consistent, hash, dataUrlLength, dataUrlPrefix, webpSupport,
  jpegHighLength, jpegLowLength, synthTail }`. The `synthTail` is computed
  once per (prefix, length, hash) triple via meet-in-the-middle search and
  memoised in `packages/consistency/src/rules/lookups/audio-canvas.ts`.

New inject modules (`@mochi.js/inject`):

- **`audio-fingerprint.ts`** — patches
  `OfflineAudioContext.prototype.startRendering`. Runs the underlying call
  (preserves real timing — synthetic 0ms is a tell) then overlays the
  captured `sampleValues` onto channel 0 at indices [4500..4510) and
  balances the [4510..4999) range so `sum |data[i]|` over [4500..5000)
  matches the captured `audioHash` byte-exactly.
- **`canvas-fingerprint.ts`** — patches
  `HTMLCanvasElement.prototype.toDataURL`,
  `OffscreenCanvas.prototype.convertToBlob`, and the 2D context's draw
  methods (to flag "is this a fingerprint probe?" via canvas size +
  recorded text draws). When the heuristic matches, returns a synthesised
  data URL whose `hashString(url)` + length + first-50-char prefix match
  the captured baseline byte-exactly. Non-probe canvases fall through to
  native rendering. FP rate <1% on a manual review of 1000 top-Alexa
  pages.

Both modules cloak via `__mochi_register_native__`.

Per-profile updates (`@mochi.js/profiles`):

- `expected-divergences.json` — removes the `audio.**` and `canvas.**`
  entries from every shipped profile (`mac-chrome-stable`, `mac-chrome-beta`,
  `mac-brave-stable`, `mac-m4-chrome-stable`, `windows-chrome-stable`,
  `linux-chrome-stable`). The `mac-m4-chrome-stable` profile's
  expected-divergences list is now empty — the canonical "everything
  matches" baseline.

PLAN.md §9.3 + §9.4 amended with the new lock chain + heuristic
description. README "what works / doesn't" matrix flips both rows from
`deferred` to `works`. Inject payload size grows ~5KB per profile (well
under the 80KB soft budget); the 25KB synthesised data URL is reconstructed
at runtime from a prefix + 8-char tail + filler-recipe to keep payload
bytes minimal.
