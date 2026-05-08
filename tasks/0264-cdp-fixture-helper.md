# 0264: shared CDP fixture helper to eliminate per-test responder duplication

**Package:** `tests` (test-infra) + minor `core` (export of helpers)
**Phase:** `0.2` hygiene
**Estimated size:** S
**Dependencies:** none (pure test-infra refactor)

## Goal

Eliminate the architectural friction surfaced repeatedly during waves 2 and 3: every fake-pipe contract test hand-rolls its own CDP responder loop, which means every new CDP method introduced anywhere in the codebase requires manually updating every fixture that drives a `Session`. We've now hit the same trap three times:

1. **Wave 2 / 0254 (worker idOnly bootstrap)**: contract test had to embed literal NUL bytes (`0x00`) as frame delimiters via the source-file template literal — `Read` and `grep` rendered them as spaces, costing the implementing agent ~10 minutes.
2. **Wave 2 / 0255 (UA override)**: same NUL-byte pattern. Agent had to update three existing fixtures to register an auto-responder for `Network.setUserAgentOverride`.
3. **Wave 3 / 0262 (geo consistency)**: same NUL-byte pattern. Agent had to update three more fixtures to register an auto-responder for `Emulation.setTimezoneOverride`.
4. **Post-merge fallout**: 0261's brand-new contract test (which 0262 couldn't see) didn't have the auto-responder for `Emulation.setTimezoneOverride`. Main went red. Hot-fixed in `053f8b1`.

The pattern is structural: hand-rolled per-test responders + opaque NUL-byte framing = guaranteed silent failure when the next CDP method gets added. Fix by extracting a shared helper.

## Success criteria

### Shared helper

- [ ] New `tests/helpers/cdp-fixture.ts` (or similar location — verify the existing test-helper layout). Exports:
  - `makeFakePipe(opts?: { responders?: Partial<CdpResponders> }): { reader, writer, inject(frame), pending }` — opens a pair of fake pipe streams suitable for `MessageRouter` consumption. Handles the NUL-byte framing internally; consumers never see the wire format.
  - `defaultResponders` — a baseline map keyed by CDP method name → `(params) => result`. Includes EVERY method any current `Session` setup path sends:
    - `Target.setAutoAttach` → `{}`
    - `Target.createTarget` → `{ targetId: "tgt-test" }`
    - `Target.attachToTarget` → `{ sessionId: "page-test" }`
    - `Page.enable` → `{}`
    - `Network.setUserAgentOverride` → `{}`
    - `Emulation.setTimezoneOverride` → `{}`
    - `Fetch.enable` → `{}`
    - `Fetch.disable` → `{}`
    - `Page.addScriptToEvaluateOnNewDocument` → `{ identifier: "scr-test" }`
    - `Page.removeScriptToEvaluateOnNewDocument` → `{}`
    - `Target.closeTarget` → `{ success: true }`
  - The list is pinned by a contract test that diffs `defaultResponders` keys against every CDP method `Session` is observed to send (introspect via a recording fake pipe). When a new method is added without updating `defaultResponders`, the diff test fails — exactly the regression we keep hitting.
- [ ] Per-test consumers can override / extend via `makeFakePipe({ responders: { "Custom.method": params => ({...}) } })` — the override merges over `defaultResponders`, so tests only declare the methods THEY care about asserting on.
- [ ] The framing layer NEVER appears in source as a literal NUL byte. All NULs go through `String.fromCharCode(0)` / `out[utf8.length] = 0x00` / equivalent programmatic construction. Block source-level NULs via a new repo-level lint rule or a contract test that scans `tests/` for `\x00` literals.

### Migration

Rewrite the existing fixtures to use the shared helper:

- [ ] `packages/core/src/__tests__/inject.test.ts`
- [ ] `packages/core/src/__tests__/proxy-auth.test.ts`
- [ ] `tests/contract/proxy-auth.contract.test.ts`
- [ ] `tests/contract/challenges-turnstile.contract.test.ts`
- [ ] `tests/contract/headless-ua-no-leak.contract.test.ts`
- [ ] `tests/contract/uach-network-parity.contract.test.ts`
- [ ] `tests/contract/worker-idonly-bootstrap.contract.test.ts`
- [ ] `tests/contract/inject-no-runtime-enable.contract.test.ts`
- [ ] Any other fake-pipe-driving fixture under `tests/contract/` or `packages/*/src/__tests__/`

Each migration should preserve the existing assertions verbatim — the helper only replaces the boilerplate scaffold.

### Verification

- [ ] `bun run test` and `bun run test:contract` continue to pass with byte-identical assertions across every migrated fixture.
- [ ] The new contract test (responders ↔ Session-observed methods) catches a regression: introduce a new `await this.router.send("Synthetic.method", ...)` call in a throwaway branch, run the contract test, observe failure naming `Synthetic.method` as missing from `defaultResponders`.
- [ ] No source-level `\x00` literals remain in `tests/` / `packages/*/src/__tests__/` (scan via the new contract test).

### Other

- [ ] No new runtime dependencies.
- [ ] No public API changes (the helper is private to tests).
- [ ] Changeset: NONE (test-infra-only).

## Out of scope

- Replacing the fake pipe with a real loopback Chromium for contract tests — too heavy; defeats the purpose of having a fast contract layer.
- Changing how `MessageRouter` parses frames — the issue is downstream of router, not in it.
- Migrating live conformance tests — those don't use fake pipes.

## Implementation notes

- See `tests/contract/uach-network-parity.contract.test.ts` for the most-recent fake-pipe responder — it's the canonical pattern to extract from.
- The CDP frame format on `--remote-debugging-pipe`: each frame is JSON UTF-8 followed by a single `0x00` byte. mochi's transport reads bytes until NUL, parses the preceding UTF-8 as JSON. Helper must emit the same shape.
- Bun's `Uint8Array` + `TextEncoder` is the safe construction path — never embed NULs via template literals.
- Naming: prefer `makeFakePipe` over `mockTransport` etc. — the helper is concrete, not a mock.

## Validation

```sh
bun run typecheck && bun run lint && bun run test && bun run test:contract
# Then synthetically: introduce a new "Synthetic.method" send in a throwaway
# branch in session.ts, run test:contract, verify the new diff-test fails
# with a named-method message. Revert.
```

## Submission

```sh
bun work create 0264 repo
cd worktrees/0264
bun work submit 0264 --draft
```
