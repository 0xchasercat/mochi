# 0254: worker context bootstrap via `Runtime.evaluate("globalThis", { serialization: "idOnly" })`

**Package:** `core`
**Phase:** `0.2`
**Estimated size:** S
**Dependencies:** v0.1.2 shipped, audits 0200–0203 merged
**Source:** `docs/audits/patchright.md` HIGH finding
**Source-cited reference:** patchright `crServiceWorkerPatch.ts:32-43`, `crPagePatch.ts:404-417`

## Goal

Tighten the worker payload-inject race window. v0.1.x calls `Runtime.evaluate({ expression: payload.code })` against the paused worker session — coarse but works. Patchright's better pattern: pre-`runIfWaitingForDebugger`, do `Runtime.evaluate("globalThis", { serialization: "idOnly" })` against the worker target, parse contextId from `objectId.split(".")[1]`, register a local `CRExecutionContext`, then use `Runtime.callFunctionOn` against that contextId for every subsequent worker op — never `Runtime.enable`.

This gives a stable contextId for every later `callFunctionOn`, lets us treat the worker target like any other execution context, and shrinks the inject race from "evaluate-then-resume" to "extract-context-then-evaluate-then-resume".

## Success criteria

- [ ] In `packages/core/src/session.ts` (the auto-attach worker handler — currently at ~`session.ts:483-530`), replace the direct `Runtime.evaluate({ expression: payload.code })` with:
  1. `Runtime.evaluate("globalThis", { serialization: "idOnly" })` against the worker session.
  2. Parse contextId from `result.objectId.split(".")[1]`. Validate the parse — fail loudly with a clear error if the format is unexpected, don't silently fall through.
  3. Cache the contextId on the worker target's local CRExecutionContext.
  4. Inject the payload via `Runtime.callFunctionOn({ functionDeclaration: payload, executionContextId })`.
  5. Then `Runtime.runIfWaitingForDebugger`.
- [ ] **Critical**: do NOT add `Runtime.enable`. The whole point is that we extract contextId via `Runtime.evaluate("globalThis")` (which works without `Runtime.enable`) instead of waiting for an `executionContextCreated` event.
- [ ] Cross-package contract test in `tests/contract/`: drive a mocked CDP session through the worker auto-attach flow, assert the call sequence is `Runtime.evaluate("globalThis", idOnly)` → parse → `Runtime.callFunctionOn(executionContextId)` → `Runtime.runIfWaitingForDebugger`. Assert `Runtime.enable` is NEVER sent.
- [ ] Update `docs/limits.md` "Worker context injection" entry to note the tightened race (or remove it if this fully closes the gap; verify with the agent's harness output).
- [ ] Changeset: patch on `@mochi.js/core`.

## Out of scope

- Service worker handling — patchright's `crServiceWorkerPatch.ts` covers SWs separately. Page-side dedicated workers + iframes are scope-1; SWs are a follow-up brief if the audits surface SW-specific issues.
- Re-issuing `Runtime.addBinding` per-context — that's task `0258` (exposeBinding API), not this one.
- Changing the inject payload format itself.

## Implementation notes

- See `PLAN.md` §8.2 (forbidden CDP — `Runtime.enable` is forbidden), §8.3 (the `DOM.resolveNode → callFunctionOn` workaround pattern this brief extends to workers), §8.4.
- Patchright source: `crServiceWorkerPatch.ts:32-43` and `crPagePatch.ts:404-417`. Read both — they're complementary.
- The objectId format: Chromium emits objectIds as `"{remoteObjectId}.{contextId}.{frameId}"` historically, but the format has shifted across versions. Patchright takes `split(".")[1]` for the contextId. Verify against current Chromium-for-Testing (v131+); if the format has changed, document and adapt.
- The `Runtime.callFunctionOn` request shape: `{ functionDeclaration, executionContextId, returnByValue: true }` — verify `returnByValue` is what we want for inject (we don't need a remote handle for the payload result).

## Validation

```sh
bun run typecheck && bun run lint && bun run test && bun run test:contract
# Online conformance gated MOCHI_E2E=1 + MOCHI_ONLINE=1; CI runs it.
```
