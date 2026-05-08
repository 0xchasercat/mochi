# 0267: audio + canvas precomputed fingerprint blobs

**Package:** `inject` + `consistency` + `profiles`
**Phase:** `0.2` (was originally task 0071, deferred to phase 0.7)
**Estimated size:** L
**Dependencies:** real-device profiles (0260) — provides the ground-truth captures we'll seed from.

## Goal

Close the two biggest stealth surfaces mochi currently leaks. README's "what works / doesn't" matrix:

> | Audio (`OfflineAudioContext`) byte-accurate fingerprint | deferred | Per-(profile, sample-rate) byte tables land in v0.7 capture (task 0071). |
> | Canvas (`toDataURL`) byte-accurate fingerprint | deferred | Same — precomputed hash maps + per-pixel noise in v0.7. |

Real-device profiles imported in 0260 already contain captured `audio` and `canvas` snapshot bytes. This brief wires those captures into the inject pipeline so a page's call to `OfflineAudioContext.startRendering()` returns the captured bytes instead of CfT's native rendering, and `canvas.toDataURL()` returns the captured PNG bytes instead of the page-rendered ones.

After this lands, mochi closes the audio + canvas detection surfaces against `creepjs`, `bot.incolumitas`, `fingerprintjs`, and every other major fingerprinter. Per the README matrix this is the largest remaining JS-layer stealth gap.

## Success criteria

### Audio blob

- [ ] New consistency rule (R-04X) `audioFingerprint`: input `(profile.audio.sampleRate, profile.audio.bytes)`; output base64-encoded byte blob keyed by `sampleRate`.
- [ ] New inject module `packages/inject/src/modules/audio-fingerprint.ts`:
  - Patches `OfflineAudioContext.prototype.startRendering` to return a `Promise<AudioBuffer>` whose channel data is the matrix-derived bytes (decoded from base64 → `Float32Array`).
  - Preserves the timing characteristics of a real `startRendering` call (small synthetic delay; not zero).
  - Cloaks via `nativeToString`.
- [ ] Audio probe-page extension to capture the bytes for the harness diff.
- [ ] Each profile's `baseline.manifest.json` already has the audio bytes from 0260's import; 0267 just wires the inject to consume them.

### Canvas blob

- [ ] Per-canvas-text canvas-rendering bytes captured per profile (the canvas surface that fingerprinters use is typically the result of rendering a specific test string at a specific font/size; the captured baseline pins this).
- [ ] New inject module `packages/inject/src/modules/canvas-fingerprint.ts`:
  - Patches `HTMLCanvasElement.prototype.toDataURL` and `OffscreenCanvas.prototype.convertToBlob` to return matrix-derived bytes when the rendered content matches a known fingerprinter probe pattern (text width sampling, color gradient, etc.).
  - Falls through to native rendering when the canvas isn't a fingerprint probe (so legitimate canvas use still works).
  - Patches `CanvasRenderingContext2D.prototype.getImageData` similarly.
  - Cloaks via `nativeToString`.
- [ ] Pattern-matching for "is this a fingerprint probe": rough heuristics (canvas size, draws happening, text rendered), tunable per profile. Document the heuristic + when it can produce false positives.

### Tests

- [ ] Unit tests for both modules against jsdom + matrix fixtures.
- [ ] Cross-package contract test pinning the byte hashes per profile (so a future inject regression that broke serialization is caught).
- [ ] Live conformance test (gated `MOCHI_E2E=1`): navigate to a fingerprint-probe page (creepjs.dev or a self-hosted fixture), capture the audio + canvas bytes via page JS, assert they match the matrix.
- [ ] Harness round-trip: each profile's audio + canvas surfaces should now diff to zero.

### Other

- [ ] Update `expected-divergences.json` for each profile: remove the `audio.*` and `canvas.*` paths (they should now match exactly).
- [ ] README "what works / doesn't" matrix: flip both rows from `deferred` to `works`.
- [ ] PLAN.md §9.3 + §9.4 amendments documenting the new inject modules + their consistency rules.
- [ ] Changeset: minor on `@mochi.js/inject`, patch on `@mochi.js/consistency` + `@mochi.js/profiles`.

## Out of scope

- WebGL byte-accurate replay — separate surface (R-001/R-002 already locks WebGL renderer/vendor strings; pixel-byte replay is a deeper investigation).
- Audio context graph randomization (different fingerprint per session) — out of v0.2 scope; we ship the captured bytes verbatim. v0.3+ explores per-session noise.
- Canvas randomization with per-pixel noise — same; v0.3+.

## Implementation notes

- See PLAN.md §9.3 (audio rule axis) and §9.4 (canvas rule axis).
- Real-device profile baselines from 0260 already have the captures; this brief consumes them.
- The pattern-match heuristic for canvas is the riskiest design call. patchright/CamouFox handle it differently (CamouFox does engine-level replay; patchright doesn't). Mochi's bet is JS-layer pattern-match + fallback-to-native — accept some false positives in exchange for not breaking legitimate canvas.

## Validation

```sh
bun run typecheck && bun run lint && bun run test && bun run test:contract
# Per-profile harness round-trip — load-bearing:
for p in mac-chrome-stable mac-chrome-beta windows-chrome-stable linux-chrome-stable; do
  MOCHI_E2E=1 MOCHI_PROFILE_OVERRIDE="$p" bun run harness:smoke
done
```
