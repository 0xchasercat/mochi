# 0263: `page.evaluate` await-promise support + `evalExpr` async-expression handling

**Package:** `core` + `harness` (test helper)
**Phase:** `0.2` (hot-fix follow-up to 0261/0262)
**Estimated size:** S
**Dependencies:** none — pure correctness fix

## Goal

Fix two related bugs surfaced by 0261's UA-CH parity live test and 0262's geo-consistency live test, both of which had to be skipped on merge to keep main green:

1. **`Page.evaluate` doesn't await page-side Promises.** The current `Runtime.callFunctionOn` send omits `awaitPromise: true`. So `page.evaluate(() => navigator.userAgentData.getHighEntropyValues([...]))` round-trips the Promise as `undefined`. Every async page-side API (`fetch`, IndexedDB, Permissions, every `*Async` shape) is currently unusable from `page.evaluate`.

2. **`evalExpr` returns `undefined` for some sync expressions** — specifically `-(new Date().getTimezoneOffset())`. The contract test for the same surface works (unit test pinning matrix → CDP send); only the round-trip-through-Chromium readback fails. Root cause likely related to (1) or a `-0` serialization quirk through `returnByValue: true` / `new Function()`-constructed function `.toString()` not surviving the CDP wire.

After this lands, the two skipped live tests (`uach-parity.test.ts`, `geo-consistency.test.ts`) re-enable and the cross-layer invariants get full E2E validation in addition to the existing contract tests.

## Success criteria

### `Page.evaluate` async fix

- [ ] `packages/core/src/page.ts` — `Page.evaluate<T>(fn: () => T | Promise<T>): Promise<T>` (signature accepts Promise-returning functions).
- [ ] The `Runtime.callFunctionOn` send adds `awaitPromise: true`. Per CDP spec this makes the call wait for any returned Promise before resolving. Doesn't affect non-Promise returns.
- [ ] Verify `awaitPromise: true` doesn't violate PLAN.md §8.2 — it doesn't (no forbidden domain, no isolated world creation, no executionContextCreated leak).
- [ ] Unit test pinning the new behavior with a fake CDP that sees the param + returns a fake Promise-resolved value.
- [ ] Contract test capturing params; assert `awaitPromise: true` is set.
- [ ] Live conformance test gated `MOCHI_E2E=1`: `page.evaluate(async () => { await new Promise(r => setTimeout(r, 10)); return 42; })` returns 42.

### `evalExpr` async support + offset-eval bug

- [ ] `packages/harness/src/conformance/stealth/helpers.ts` — `evalExpr<T>(page, expr)` continues to support sync expressions AND handles Promise-returning ones. Should resolve once `page.evaluate` awaits Promises.
- [ ] Reproduce the negative-zero round-trip case locally if it persists. If it's a `-0` serialization bug at the CDP layer:
  - adjust the assertion to use `Math.abs(pageOffsetMin)` (paper over), OR
  - send `0 - new Date().getTimezoneOffset()` instead of `-(new Date().getTimezoneOffset())` (workaround), OR
  - track upstream Bun / CDP serialization fix.

### Re-enable the skipped live tests

- [ ] Restore `describeOrSkip` in `packages/harness/src/conformance/stealth/__tests__/uach-parity.test.ts` to its original form.
- [ ] Same for `geo-consistency.test.ts`.
- [ ] Both should pass on the next CI run.

## Out of scope

- Backwards-compat shim for old `page.evaluate(fn: () => T)` where T was a Promise — narrow change.
- Investigating other CDP serialization quirks beyond `-0` — separate brief.

## Implementation notes

- `awaitPromise: true` on `Runtime.callFunctionOn` is the canonical CDP mechanism for async page-side eval. Puppeteer / Playwright both default to it.
- The parameter has been in CDP since Chromium 67+; safe across all modern CfT builds.

## Validation

```sh
bun run typecheck && bun run lint && bun run test && bun run test:contract
MOCHI_E2E=1 MOCHI_ONLINE=1 bun test packages/harness/src/conformance/stealth/__tests__/uach-parity.test.ts
MOCHI_E2E=1 MOCHI_ONLINE=1 bun test packages/harness/src/conformance/stealth/__tests__/geo-consistency.test.ts
```

## Submission

```sh
bun work create 0263 core
cd worktrees/0263
bun work submit 0263 --draft
```
