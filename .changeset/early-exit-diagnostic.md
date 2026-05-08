---
"@mochi.js/core": patch
---

`spawnChromium` now diagnoses Chromium dying within 750ms of spawn and surfaces a clear error naming the most likely cause — sandbox refusal under root, missing libs, malformed flags — instead of letting the eventual EPIPE on the first CDP write bubble up with no context. When the stderr tail matches Chromium's "Running as root without --no-sandbox" pattern, the error includes the canonical fixes (run as non-root, `chmod 4755 chrome-sandbox`, or `args: ['--no-sandbox']`).

Plus a "Linux gotcha — Chromium and root" note in `docs/quickstart.md` so server / dev-rig setups don't hit the EPIPE first.
