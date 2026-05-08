# 0250: MouseEvent.screenX / screenY getter patch

**Package:** `inject` (+ new consistency rule)
**Phase:** `0.2`
**Estimated size:** S
**Dependencies:** v0.1.2 shipped, audits 0200–0203 merged
**Source:** `docs/audits/puppeteer-real-browser.md` HIGH finding
**Source-cited reference:** `puppeteer-real-browser`'s `lib/cjs/module/pageController.js:48-58`

## Goal

Close a real I-5 (relational consistency) leak: when CDP `Input.dispatchMouseEvent` synthesizes click events, `event.screenX` / `event.screenY` are wrong (often 0 or mid-viewport instead of screen-relative). Sites that read `event.screenX` for clickjacking/bot heuristics see an obvious tell. Patch the prototype getters to return `clientX + window.screenX` and `clientY + window.screenY` so dispatched events look indistinguishable from real ones.

## Success criteria

- [ ] New inject module `packages/inject/src/modules/mouse-event-screen.ts` (~15 LOC). Installs prototype-level getters on `MouseEvent.prototype.screenX` and `MouseEvent.prototype.screenY`. Returns `this.clientX + window.screenX` and `this.clientY + window.screenY` respectively. Preserves the original descriptor's `enumerable` + `configurable` shape so `Object.getOwnPropertyDescriptor(MouseEvent.prototype, "screenX").get.toString()` returns the spoofed function (which itself is `Function.prototype.toString`-cloaked via the existing `nativeToString` helper).
- [ ] Wire into `packages/inject/src/build.ts` so the module is included in the IIFE bundle.
- [ ] New consistency rule (`R-041`) in `packages/consistency/src/rules/`. Probably in a new `mouseEvent.ts` file or folded into the existing `screen.ts`. The rule asserts `MouseEvent.screenX === clientX + window.screenX` (an identity, technically — the rule's job is to *lock* the relationship in the matrix and assert it via the harness probe).
- [ ] Probe Manifest schema extension: `mouseEvent` block with `screenX_getter_native_pattern` and the relationship invariant. Bump schema version per the existing schema-versioning guidance.
- [ ] Probe page (`tests/fixtures/probe-page.html`) gains a `MouseEvent` synthesis + readback step that captures the getter's behavior into the probe output.
- [ ] Unit test for the inject module against a jsdom (or minimal `MouseEvent` shim) that asserts the spoofed getter returns the expected sum.
- [ ] Conformance test extension: a new test in `packages/harness/src/conformance/stealth/__tests__/` that dispatches `Input.dispatchMouseEvent` via CDP, captures `event.screenX` from a `addEventListener("click", ...)` handler, asserts the value matches `clientX + window.screenX`. Gate with `MOCHI_E2E=1`.
- [ ] Changeset: minor on `@mochi.js/inject`, patch on `@mochi.js/consistency`.

## Out of scope

- `MouseEvent.movementX` / `movementY` — separate fields, separate analysis. If the audits for this surface in v0.3+, file a follow-up brief.
- `TouchEvent` / `PointerEvent` synthesis — different path. Mouse only for v0.2.
- Behavioral integration — the existing Bezier/Fitts pipeline produces `clientX`/`clientY`; the prototype patch makes the dispatched events' `screenX`/`screenY` consistent with whatever the synth chose. No behavioral changes needed.

## Implementation notes

- See `PLAN.md` §8.4 (inject pattern, `worldName: ""` main world). The module installs its getters in the main world via the same `addScriptToEvaluateOnNewDocument` channel as every other inject module.
- The `Function.prototype.toString` cloak: every other inject module uses a `nativeToString` helper to make the patched getters' `.toString()` return `function screenX() { [native code] }`. Mirror that exactly; don't roll your own.
- `window.screenX` itself must be matrix-derived. As of v0.1, `inject/screen.ts` spoofs `screen.width/height/availWidth/availHeight` but does it also spoof `window.screenX/screenY`? Verify; if not, that's a separate companion fix in this PR (window position relative to multi-monitor setup; matrix should derive from `display` rule).
- Verify the patched getter is invisible to `Object.getOwnPropertyDescriptor(MouseEvent.prototype, "screenX")`. The descriptor's `get` field will be our function; `.toString()` should be cloaked; `configurable` and `enumerable` should match the original. Run the cross-check: `(new MouseEvent("test", {clientX: 100})).screenX` should equal `100 + window.screenX`.

## Validation

```sh
bun run typecheck       # 10/10 packages green
bun run lint            # biome
bun run test            # all unit tests including new mouse-event-screen unit + R-041
bun run test:contract   # cross-package contracts
# Conformance is gated on MOCHI_E2E=1; CI runs it.
```
