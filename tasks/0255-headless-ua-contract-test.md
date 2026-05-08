# 0255: defensive contract test — `navigator.userAgent` never contains `"Headless"`

**Package:** repo-level test (`tests/contract/`)
**Phase:** `0.2`
**Estimated size:** XS
**Dependencies:** v0.1.2 shipped
**Source:** `docs/audits/undetected-chromedriver.md` LOW + `docs/audits/nodriver.md` LOW (both flag the same defensive gap)
**Source-cited reference:** udc `__init__.py:519-527`, nodriver `tab.py:203-222`

## Goal

Add a defensive contract test that pins one invariant: the literal substring `"Headless"` never appears in any UA-related surface mochi exposes. Two layers:

1. **JS layer** (already covered by R-006 / inject/navigator.ts): `navigator.userAgent` is matrix-derived and by construction non-headless. Pin via a contract test that fails if any inject module ever produces a UA containing `"Headless"`.
2. **Network layer** (the *real* defensive case): early `Network.requestWillBeSent` events fire BEFORE `Page.addScriptToEvaluateOnNewDocument` lands. The bare browser UA in those events still contains `"HeadlessChrome"` under `--headless=new` unless we also do a CDP-level `Network.setUserAgentOverride` at session start. Test pins both.

## Success criteria

- [ ] New contract test `tests/contract/headless-ua-no-leak.contract.test.ts`:
  - Drives a `Session` via mocked CDP transport with the default profile.
  - Asserts that the inject payload bundle, when string-searched, contains no `"Headless"` literal.
  - Asserts that `Network.setUserAgentOverride` is sent at session-start (or that the matrix UA is otherwise applied at network-layer before any request fires) — verify the actual mechanism mochi uses today.
  - Asserts that mocked `Network.requestWillBeSent` events captured during a goto have `request.headers["User-Agent"]` matching the matrix UA, NOT containing `"Headless"`.
- [ ] If the network-layer mechanism doesn't already exist (i.e., `Network.setUserAgentOverride` isn't being sent at session-start), this brief expands to add it — surface that in the agent's report. The test catches the gap; closing it is part of the same PR.
- [ ] Changeset: patch on `@mochi.js/core` (if any source changes), or a docs-only changeset if pure test addition.

## Out of scope

- Sec-CH-UA family — that's already covered by R-005/R-007/R-031. This brief is specifically the literal `"Headless"` substring across UA surfaces.
- `--headless=new` vs. legacy `--headless` debate — we ship `--headless=new` per task 0220 ("never legacy headless — sannysoft trivially detects"). Out of scope.

## Implementation notes

- See `PLAN.md` I-5 (relational consistency), §6.1 (UA derivation from matrix).
- Verify the v0.1.x mechanism for early-network UA: search `packages/core/src/session.ts` and `packages/inject/src/modules/navigator.ts` for `setUserAgentOverride`. If it's NOT there, that's the gap this brief closes — the inject module fires too late for early navigation requests.
- The inject payload bundle string-search should grep the BUILT bundle (post `inject/build.ts`), not the source (we want to catch any compiled-in regression).

## Validation

```sh
bun run typecheck && bun run lint && bun run test && bun run test:contract
# This brief's whole point is the contract test, so test:contract is the gate.
```
