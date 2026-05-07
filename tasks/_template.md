# <id>: <short title>

**Package:** `<package>`
**Phase:** `0.x`
**Estimated size:** S | M | L
**Dependencies:** <list of task-ids that must merge first, or "none">

## Goal

<!-- 2–4 sentences. What this task delivers. Why now. -->

## Success criteria

<!-- Concrete, checkable bullets. The PR cannot merge until each is true. -->

- [ ] <bullet>
- [ ] <bullet>
- [ ] All package gates green (typecheck, lint, test, contract, harness-smoke if applicable)
- [ ] PROVENANCE updated if any profile changed
- [ ] `docs/limits.md` updated if any new limit discovered

## Out of scope

<!-- Explicit non-goals. If you find yourself doing one of these, stop and surface. -->

- <bullet>

## Implementation notes

<!-- Sketch of approach. Links to PLAN.md sections that govern this work.
     Gotchas the brief author already knows about.
     Concrete file paths the agent should look at. -->

- See `PLAN.md` §<section>
- Touch only `packages/<pkg>/src/...`
- Do NOT add new dependencies without orchestrator approval

## Validation

<!-- Exact commands the agent should run before `mochi-work submit`. -->

```sh
bun typecheck
bun lint
bun test --filter=@mochi.js/<pkg>
bun test:contract --pkg=<pkg>
# additional task-specific commands here
```
