---
"@mochi.js/consistency": minor
"@mochi.js/inject": minor
"@mochi.js/core": patch
---

Phase 0.7 JS-rules deliverable — drives the harness intentional count from
15 to 0 against `mac-m4-chrome-stable` at 100% structural match. The
consistency engine grows to 40 rules:

- **R-002** tightens the WebGL `unmaskedRenderer` ANGLE wrap (regression
  fix: half-wrapped `"ANGLE Metal Renderer: …"` profile inputs are now
  re-wrapped instead of passed through verbatim).
- **R-031** adds `uaCh.ua-full-version-list` keyed off a tip-locked
  `(browser, major)` lookup. Chrome 131 → 131.0.6778.110; Chrome 147 →
  147.0.7727.138. R-004 now consumes the same lookup so the legacy
  `userAgent` and the `userAgentData.fullVersionList` agree.
- **R-032/R-033** add `uaCh.webgpu-features` and `uaCh.webgpu-info`
  keyed off `gpu.vendor`. Apple Silicon catalog matches the captured
  M4 baseline verbatim (22 features, `architecture: "metal-3"`).
- **R-034..R-040** add MediaDevices.enumerateDevices shape +
  `getSupportedConstraints`, Permissions.query defaults, NetworkInformation
  `connection`, `screen.orientation`, `matchMedia` answers, and
  `storage.estimate` to the matrix.

`@mochi.js/inject` ships five new spoof modules (`webgpu`, `media-devices`,
`permissions`, `network-info`, `screen-orientation`) and teaches
`client-hints` to read the tip-locked full-version-list. `media-devices`
derives `deviceId` / `groupId` via `SHA-256(profile.id + ":" + seed +
":mediaDevices:<i>:<kind>")` for byte-stable per-(profile, seed) IDs.

`packages/profiles/data/mac-m4-chrome-stable/expected-divergences.json`
trims to just `audio.**` + `canvas.**` (deferred to task 0071).
`baseline.manifest.json` is corrected for the natural-Chrome shape
(`webdriver: false`, no `HeadlessChrome` UA leak, `deviceMemory: 8` per
Chrome's quantization).
