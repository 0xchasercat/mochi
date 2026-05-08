---
"@mochi.js/harness": minor
"@mochi.js/core": minor
---

Task 0150 — humanize conformance suite + supporting Page surface.

- **`@mochi.js/harness`** gains a new conformance suite under
  `src/conformance/humanize/__tests__/` — a mochi-native port of
  CloakHQ/CloakBrowser's `tests/test_humanize_unit.mjs` +
  `tests/test_human_visual.mjs`. Seven test files cover config
  resolution, Bezier math, mouse trajectory (E2E), keystroke timing,
  fill clearing (E2E), patching integrity, and (online,
  `MOCHI_ONLINE=1`) the `deviceandbrowserinfo.com` bot-detection form.
  Run via `bun run conformance:humanize` (offline) or
  `bun run conformance:humanize:online`.
- **`@mochi.js/core`** ships three Page-surface additions:
  - `Page.humanMove(x, y, opts?)` — animate the cursor to (x, y)
    along a Bezier trajectory without dispatching a click. Same
    underlying synth as `humanClick` minus the press/release.
  - `Page.cursorPosition()` — read the tracked cursor (x, y) so
    sequences of `humanMove`/`humanClick` chain realistically.
  - `Page.humanType("", selector)` — clearing semantics.
    Emits Backspace × `value.length` with realistic key timing
    instead of being a no-op as it was before.
- Companion correctness fix: `Input.dispatchKeyEvent` now carries
  the proper `code` + `windowsVirtualKeyCode` for control keys
  (Backspace/Enter/Tab/Escape/Delete) so Chromium fires the
  edit-action handler, not just the JS keydown event. Printable
  letters/digits/space also get plausible `KeyA`/`Digit0`/`Space`
  codes for layout-aware page code.
- Root scripts + CI gates wired:
  - `bun run conformance:humanize` is a PR-fast hard-fail step.
  - `bun run conformance:humanize` is a release-pre-publish gate.
- Initial cursor position now defaults to the matrix's
  `display.width/2, display.height/2` (PLAN.md I-5) instead of (0, 0)
  — a real human's pointer is never at the viewport origin.
