---
"@mochi.js/core": patch
---

Tighten the worker payload-inject race window via patchright's
`Runtime.evaluate("globalThis", { serialization: "idOnly" })` trick
(task 0254). On `Target.attachedToTarget` for a worker-style target,
mochi now extracts the worker's executionContextId by parsing
`objectId.split(".")[1]` of an idOnly-serialised `globalThis`, then
delivers the inject via `Runtime.callFunctionOn({ functionDeclaration,
executionContextId, returnByValue: true })` before
`Runtime.runIfWaitingForDebugger`. The bound-context call replaces
v0.1.x's bare `Runtime.evaluate({ expression: payload.code })`, which
worked but was coarser.

The §8.2 forbidden-method invariant is preserved: `Runtime.enable` is
never sent. The whole point of the idOnly bootstrap is to extract the
contextId without it. A new contract test
(`tests/contract/worker-idonly-bootstrap.contract.test.ts`) pins the
call sequence and the negative invariant, and asserts the parser fails
loudly if Chromium ever shifts the objectId wire format.

Source-cited reference: patchright `crServiceWorkerPatch.ts:32-43`,
`crPagePatch.ts:404-417`.
