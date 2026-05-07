# 0080: behavioral engine v0

**Package:** `behavioral` (with `core` page-method wiring)
**Phase:** `0.8`
**Estimated size:** L
**Dependencies:** 0001, 0011 (Page class), 0020 (consistency for seeded PRNG reuse)

## Goal

Implement `@mochi.js/behavioral` per PLAN.md §5.5 + §11. Pure-data synthesis: cubic Bezier paths + Fitts's-Law durations + Gaussian jitter for `humanClick`, lognormal-digraph keystroke timing for `humanType`, inertial scroll for `humanScroll`. Wire these into `@mochi.js/core`'s `Page` so `await page.humanClick("#submit")` actually issues human-shaped CDP `Input.dispatchMouseEvent` sequences.

After this lands, mochi-driven sessions don't just spoof fingerprints — they MOVE like humans. Combined with phase 0.3's spoofing, this closes the gap on the most common bot-detection heuristics.

## Success criteria

### `@mochi.js/behavioral` public surface

- [ ] `synthesizeMouseTrajectory(opts: { from: Point; to: Point; box?: Box; profile?: BehaviorProfile; seed?: string }): TrajectoryEvent[]`
  - Cubic Bezier with 4 control points: P0 = from, P3 = sampled inside `box` (Gaussian toward center) or = `to` if no box.
  - P1, P2 placed off-axis, magnitude ~0.3–0.5 of Euclidean distance, perpendicular offset scaled by `tremor`.
  - Sample N points where N = `ceil(MT * 60)` (60 events/sec).
  - Each point Gaussian-jittered (σ = `tremor * pixelSize`) with τ ≈ 30ms autocorrelation.
  - Movement duration: Fitts `MT = a + b * log2(D/W + 1)` with `a = 200ms`, `b = 90ms/bit` (per-profile overridable).
  - 5–15% chance overshoot+correction past target by `1.05–1.15 * D`, then corrective sub-curve.
- [ ] `synthesizeKeystrokes(opts: { text: string; profile?: BehaviorProfile; seed?: string }): KeystrokeEvent[]`
  - Per-letter press duration: Gaussian(80, 25) ms.
  - Inter-key delay model:
    - Same-hand digraphs: lognormal(μ=4.7, σ=0.35)
    - Cross-hand digraphs: lognormal(μ=4.4, σ=0.30)
    - After space: lognormal(μ=4.9, σ=0.40)
    - After punctuation: 1.3× same-hand
  - Mistakes: rate = `mistakeRate` (default 0.02). On mistake: type wrong key (adjacent on QWERTY), 200–500ms delay, backspace, 100–300ms delay, type correct key.
  - Hand assignment: a static QWERTY-keys-to-hand table.
- [ ] `synthesizeScroll(opts: { from: number; to: number; duration?: number; profile?: BehaviorProfile; seed?: string }): ScrollEvent[]`
  - Inertial scroll: initial velocity = (target distance / 0.5s), friction-decay τ ≈ 350ms.
  - Per-frame `deltaY` capped at 100px/frame.
  - Output: ordered `{tMs, deltaY}[]`.

### Determinism

- [ ] All three functions accept `seed?: string` (when omitted, derive from a per-call counter or use a fresh time-based seed; document the determinism contract).
- [ ] Reuse the xoshiro256** PRNG from `@mochi.js/consistency` (don't re-implement). If consistency's PRNG isn't exported publicly, expose it via a new sub-export `@mochi.js/consistency/prng`. Document the cross-package dep.
- [ ] Same `(opts, seed)` → byte-identical output across runs. Test this in a determinism suite (10 iterations, deep-equal).

### `BehaviorProfile`

- [ ] Read from `MatrixV1.profile.behavior` (already in profile.schema.json from 0003): `{ hand: "right"|"left", tremor: number, wpm: number, scrollStyle: "smooth"|"step" }`.
- [ ] Override per-call via `opts.profile`.
- [ ] If neither matrix nor opts provides, use defaults: `{ hand: "right", tremor: 0.18, wpm: 65, scrollStyle: "smooth" }`.

### `@mochi.js/core` Page integration

- [ ] `page.humanClick(selector, opts?: { button?: "left"|"right"|"middle"; duration?: number; preMoveSettle?: boolean }): Promise<void>`
  - Resolves selector via `DOM.querySelector` → `DOM.getBoxModel` to get the target box.
  - Picks click point inside box (Gaussian toward center).
  - Calls `synthesizeMouseTrajectory`, dispatches each event via `Input.dispatchMouseEvent({type: "mouseMoved", x, y, ...})`.
  - On final event, sends `mousePressed` then `mouseReleased` at the target with realistic press-duration (~30–80 ms).
  - Default `duration` derived from Fitts. `preMoveSettle: true` adds a Gaussian(150, 50)ms idle before movement (default true).
- [ ] `page.humanType(selector, text, opts?: { wpm?: number; mistakeRate?: number }): Promise<void>`
  - Focuses selector via `DOM.focus({nodeId})`.
  - Calls `synthesizeKeystrokes`, dispatches events via `Input.dispatchKeyEvent({type: "keyDown", text, ...})` and `keyUp`.
  - Handles mistakes by emitting Backspace then the correct key.
- [ ] `page.humanScroll(opts: { to: string|{x:number,y:number}; duration?: number }): Promise<void>`
  - Resolves `to` (selector → scroll-into-view target Y, or absolute coords).
  - Calls `synthesizeScroll`, dispatches `Input.dispatchMouseEvent({type: "mouseWheel", deltaY})` per frame, paced via `setTimeout` (ok for ms-level scheduling here; not ms-critical).

### Tests

- [ ] Unit tests in `packages/behavioral/src/__tests__/`:
  - Mouse trajectory: starts at `from`, ends at point inside `box`, ordered increasing tMs, Bezier-shape sanity (bend exists), overshoot frequency in expected range.
  - Keystrokes: ordered tMs, mistake rate within ±2% over 1000-char run with `mistakeRate=0.05`, digraph timing distributions match expected shape.
  - Scroll: monotonic delta direction, total scroll == to-from, frame rate ~60fps.
- [ ] Determinism suite: 10 fixed (input, seed) → byte-identical output every iteration.
- [ ] Cross-package contract `tests/contract/behavioral-page.contract.test.ts`: drives `page.humanClick` against a fake CDP transport, asserts the recorded `Input.dispatchMouseEvent` sequence has correct shape (count, time spacing, final mousePressed/Released).
- [ ] **MOCHI_E2E gated** `packages/core/src/__tests__/behavioral.e2e.test.ts`: real Chromium, navigate to a probe page, `humanClick` on a button, `humanType` into an input, assert the page receives correctly-shaped events (count of `mousemove` events, timing distribution).

### Other

- [ ] All gates green.
- [ ] Changeset: `@mochi.js/behavioral` minor + `@mochi.js/core` minor.
- [ ] `docs/limits.md` updated: real-trace recording deferred to v1.x; touch gestures v2; per-profile mouse acceleration curves v1.x.

## Out of scope

- Real-trace recording API (`mochi record`) — v1.x.
- Touch gestures (mobile) — v2.
- Per-profile mouse acceleration curves — v1.x.
- Eye-tracking-coupled mouse models — v2+.
- Multi-touch / pinch / rotate — v2+.
- Drag-and-drop synthesis — later.
- Realistic typing-error correction beyond "type wrong, backspace, retype" — v1.x.

## Implementation notes

- File layout under `packages/behavioral/src/`:
  - `index.ts` — re-exports
  - `mouse.ts` — `synthesizeMouseTrajectory`
  - `keys.ts` — `synthesizeKeystrokes` + QWERTY hand-table + adjacency map
  - `scroll.ts` — `synthesizeScroll`
  - `bezier.ts` — pure Bezier sampling helpers
  - `fitts.ts` — Fitts's Law calculator
  - `gauss.ts` — Box-Muller Gaussian sampler against an injected PRNG
  - `prng.ts` — wrapper that consumes `@mochi.js/consistency/prng`
  - `__tests__/*.test.ts`
- Keep all functions pure; `@mochi.js/core` is the side-effect layer.
- For Bezier: the De Casteljau algorithm is fine but cubic-Bezier closed-form `B(t) = (1-t)³P0 + 3(1-t)²tP1 + 3(1-t)t²P2 + t³P3` is simpler.
- For Box-Muller (Gaussian): two uniform samples → `sqrt(-2 ln u1) * cos(2π u2)`. Cache the second output.
- For QWERTY hand table: left = `qwertasdfgzxcvb`, right = `yuiophjklnm` plus space (right thumb). Adjacency map: `{q:{w,a},w:{q,e,a,s},e:{w,r,s,d},...}` for mistake-key selection.

## Validation

```sh
bun typecheck
bun lint
bun test
bun test:contract --pkg=behavioral

# E2E (real Chromium, smoke test):
MOCHI_E2E=1 MOCHI_CHROMIUM_PATH=... bun test packages/core/src/__tests__/behavioral.e2e.test.ts

# manual smoke:
MOCHI_CHROMIUM_PATH=... bun -e '
import { mochi } from "@mochi.js/core";
const s = await mochi.launch({profile: "mac-m2-chrome-stable", seed: "demo"});
const p = await s.newPage();
await p.goto("data:text/html,<button id=b>click me</button><input id=i>");
await p.humanClick("#b");                 // visible movement before click
await p.humanType("#i", "hello world");   // realistic typing
await s.close();
'
```

When everything's green: `bun work submit 0080 --draft`.

## Touch list (rough)

- `packages/behavioral/src/{index,mouse,keys,scroll,bezier,fitts,gauss,prng}.ts` (new)
- `packages/behavioral/src/__tests__/*.test.ts` (units + determinism)
- `packages/behavioral/package.json` (depends on `@mochi.js/consistency: workspace:*`)
- `packages/consistency/src/index.ts` or new `packages/consistency/src/prng/index.ts` exports the PRNG publicly (was internal at 0020)
- `packages/core/src/page.ts` (replace `humanClick`/`humanType`/`humanScroll` placeholders with real bodies)
- `packages/core/src/__tests__/behavioral.e2e.test.ts` (new, gated)
- `tests/contract/behavioral-page.contract.test.ts` (new)
- `.changeset/behavioral-engine-v0.md` (new)
- `docs/limits.md` (recording, touch, accel curves)
