# 0150: humanize conformance suite (port CloakBrowser tests/test_humanize_unit.mjs + test_human_visual.mjs)

**Package:** `harness` (with cascading fixes in `behavioral` + `core` per surfaced bugs)
**Phase:** `0.5.x`
**Estimated size:** L
**Dependencies:** 0001, 0011, 0080 (behavioral engine), 0050+0051 (harness MVP), 0070 (consistency 100% Zero-Diff), 0140 (stealth conformance — establishes the conformance pattern)

## Goal

Port [CloakHQ/CloakBrowser/tests/test_humanize_unit.mjs](https://raw.githubusercontent.com/CloakHQ/CloakBrowser/main/tests/test_humanize_unit.mjs) and [test_human_visual.mjs](https://raw.githubusercontent.com/CloakHQ/CloakBrowser/main/tests/test_human_visual.mjs) to a mochi-native Bun-TS conformance suite under `packages/harness/src/conformance/humanize/`. Validates that `humanClick`/`humanType`/`humanScroll` produce event distributions that survive ML-style behavioral classifiers — the harder bar than just "no straight-line clicks."

After this lands, v1.0 release additionally gates on `bun conformance:humanize` passing alongside `bun conformance:stealth` (from 0140).

## Success criteria

### Source porting

- [ ] Vendor `tests/fixtures/cloakbrowser/test_humanize_unit.mjs` and `test_human_visual.mjs` verbatim with a SHA pin in `SOURCE.md`.
- [ ] Port each test class/section to a Bun:test in `packages/harness/src/conformance/humanize/__tests__/`. Best to mirror the upstream's section-by-section structure:
  - `config-resolution.test.ts` — section 1 (config defaults, careful preset, custom override, rand/randRange/sleep)
  - `bezier-math.test.ts` — section 2 (Bezier control points, intermediate samples, smoothness)
  - `mouse-trajectory.test.ts` — section 3 (humanMove, clickTarget, distribution shape)
  - `keystroke-timing.test.ts` — section on typing timing distributions
  - `fill-clearing.test.ts` — section on clearing existing input values
  - `bot-detection-form.test.ts` — section that POSTs through a form and verifies the page accepts the submission
  - `patching-integrity.test.ts` — section asserting the framework didn't break native APIs

### Mapping CloakBrowser → mochi APIs

CloakBrowser's `resolveConfig`, `humanMove`, `clickTarget` map to mochi as follows:
- `resolveConfig(preset, overrides)` → `mochi.behavioral.synthesizeMouseTrajectory`'s `profile` param + `opts` overrides
- `humanMove(page, x, y)` → `page.humanMove(x, y)` (NEW — currently only `humanClick(selector)`; agent adds `humanMove`)
- `clickTarget(page, selector)` → `page.humanClick(selector)`

The tests assert on the SHAPE of the produced events (count, timing, Bezier control points, etc.). Most assertions translate directly. Where mochi's API differs from CloakBrowser's (e.g., we don't expose `resolveConfig` — the matrix's `behavior` block is the equivalent), the agent adapts the assertion to mochi's surface while preserving the semantic.

### Surface gaps the porting will surface

The agent will likely discover these gaps during porting:

1. **`page.humanMove(x, y)`** — CloakBrowser exposes a free-standing humanMove that animates the cursor without clicking. mochi currently only has `humanClick`. Add `humanMove` to `Page` (delegating to `synthesizeMouseTrajectory` + dispatch without the final mousePressed/Released).
2. **Cursor-position state on Page** — mochi's `humanClick` likely starts each move from `(0, 0)` or some fixed point. CloakBrowser tracks the cursor across moves (so consecutive `humanMove` calls compose realistically). Add `Page._cursorX/Y` state, initialized from the matrix's `initial_cursor_x/y` config (or sensible defaults), updated after every move.
3. **`fill clearing`** — `humanType(selector, "")` should clear the field by sending Backspace N times where N = current value length, with realistic key timings. CloakBrowser's `humanType` does this; check if mochi's does. If not, fix.
4. **Result reporting** — CloakBrowser collects results into a structured `results` array. mochi's bun:test handles this natively. The port doesn't need to copy the result-collection scaffolding.

### Bot-detection form test (live network)

`test_human_visual.mjs` includes a section that POSTs through a real bot-detection form and asserts acceptance. This is `MOCHI_ONLINE=1`-gated, mirroring 0140's online layer. Document the target form URL upstream uses; pin it.

### Wiring

- [ ] Root scripts:
  - `"conformance:humanize": "bun test packages/harness/src/conformance/humanize/__tests__/"` (offline parts)
  - `"conformance:humanize:online": "MOCHI_ONLINE=1 bun test packages/harness/src/conformance/humanize/__tests__/"` (includes online form)
- [ ] `.github/workflows/pr-fast.yml`: add `bun run conformance:humanize` step. Hard-fail at v0.5.x+.
- [ ] `.github/workflows/release.yml`: pre-publish gate on `conformance:stealth` (from 0140) AND `conformance:humanize`. Both must pass.

### Documentation discipline (per 0140 pattern)

- [ ] For each test that fails AND is C++-only / fork-required: `docs/limits.md` entry with rationale.
- [ ] For each test that NOW PASSES because the agent fixed `@mochi.js/behavioral` or `@mochi.js/core`'s Page methods: changeset note describing the fix.

### Other

- [ ] Existing harness gate continues to pass — `bun harness:diff mac-m4-chrome-stable` shows no regression.
- [ ] Existing 0140 stealth conformance continues to pass.
- [ ] All gates green.
- [ ] Changeset: `@mochi.js/harness` minor + cascading minors on `@mochi.js/{behavioral,core}`.

## Out of scope

- **Stealth conformance** — task 0140.
- **The Python tests** (`test_humanize_unit.py` 68KB) — the .py file is mostly the same logic in Python. Port only the .mjs (already JS). If a useful test exists ONLY in .py, agent can port it manually but should justify in the report.
- **CloakBrowser's behavior-tracker integration** — out of scope; we just want the test cases.
- **Touch gestures / mobile** — v2.

## Implementation notes

- File layout under `packages/harness/src/conformance/humanize/`:
  - `__tests__/{config-resolution,bezier-math,mouse-trajectory,keystroke-timing,fill-clearing,bot-detection-form,patching-integrity}.test.ts`
  - `helpers.ts` — session-fixture + cursor-state shims
- Vendor path: `tests/fixtures/cloakbrowser/{test_humanize_unit.mjs,test_human_visual.mjs,SOURCE.md}`
- `Page._cursorX/_cursorY`: store private, initialize from `MatrixV1.profile.behavior.initial_cursor_*` if present (extend the schema's `behavior` block via codegen if needed), default to `(viewport.width / 2, viewport.height / 2)`.
- `Page.humanMove(x, y)`: same dispatch path as humanClick minus the click events. Returns Promise<void>.
- `humanType` clearing: when text is empty and selector has existing value, send Backspace N times.
- For the bot-detection-form test: pick the upstream's URL, document it, and gate behind `MOCHI_ONLINE=1`. If the form is gone (sites change), the agent can sub in a similar form (forms.gle/something or a self-hosted echo) and document.
- Keystroke distribution tests assert MEAN/STDDEV within a band over many samples. The mochi behavioral engine is deterministic per (opts, seed); the test passes the same seed and asserts the distribution shape that seed produces. Update upstream's "rand within bounds" tests to use mochi's seeded PRNG.

## Validation

```sh
bun typecheck
bun lint
bun test
bun test:contract --pkg=harness

# Offline humanize conformance:
MOCHI_E2E=1 MOCHI_CHROMIUM_PATH="..." bun run conformance:humanize

# Online (real bot-detection form):
MOCHI_ONLINE=1 MOCHI_E2E=1 MOCHI_CHROMIUM_PATH="..." bun run conformance:humanize:online

# Existing gates must continue to pass:
MOCHI_E2E=1 bun harness:diff mac-m4-chrome-stable
MOCHI_E2E=1 bun run conformance:stealth   # if 0140 has merged before 0150
```

When everything's green: `bun work submit 0150 --draft`.

## Touch list (rough)

- `packages/harness/src/conformance/humanize/__tests__/*.test.ts` (new — 7 files)
- `packages/harness/src/conformance/humanize/helpers.ts` (new)
- `packages/core/src/page.ts` (add `humanMove(x, y)`; extend `humanType` to clear; track `_cursorX/_cursorY`)
- `packages/core/src/__tests__/page.test.ts` (extend with new methods)
- `packages/behavioral/src/index.ts` (any tweaks needed for cursor-state composition)
- `tests/fixtures/cloakbrowser/{test_humanize_unit.mjs,test_human_visual.mjs,SOURCE.md}` (vendored)
- `package.json` (root): add `conformance:humanize` scripts
- `.github/workflows/pr-fast.yml`: hard-fail step
- `.github/workflows/release.yml`: pre-publish gate
- `docs/limits.md`: humanize-side limits
- `.changeset/humanize-conformance.md` (new)
