# 0201: audit patchright against mochi

**Type:** research / docs only (no source-code changes)
**Phase:** v0.2 audit batch (post-v0.1.0)
**Estimated size:** M
**Output:** `docs/audits/patchright.md` (commit + PR)

## Goal

Identify every stealth trick, leak fix, fingerprint surface, behavioral pattern, or convenience feature in `patchright` (https://github.com/Kaliiiiiiiiii-Vinyzu/patchright — and the Python equivalent `patchright-python`) that mochi v0.1.0 does NOT have. Output is a structured report that becomes Phase B (synthesis) input.

**Critical context**: patchright is mochi's closest peer. It also avoids `Runtime.enable` and `Page.createIsolatedWorld`. The patchright README documents specific CDP-side leak fixes that we should benchmark against directly. This is the highest-value audit of the four.

## Method

1. Clone https://github.com/Kaliiiiiiiiii-Vinyzu/patchright + the Python repo. Read the patches/ dir or equivalent — these are the actual stealth fixes.
2. Read their README's "What's patched" / "Detection improvements" section in detail. Each item is a specific leak; capture how they fix it.
3. Read open + last 6 months closed issues. Look for "detected by ...", "fingerprint", "still detected" threads. Their issue tracker is where real failures land.
4. Read mochi's `PLAN.md` §2 invariants, §8.2 (forbidden CDP), `packages/inject/src/modules/*`, `packages/consistency/src/rules/*`. Verify mochi's actual coverage — don't guess.
5. **Specific leak surfaces to compare** (patchright explicitly addresses some of these):
   - `Page.callFunctionOn` return value coercion / serialization quirks
   - `Target.attachToTarget({ flatten: true })` usage
   - `Runtime.runIfWaitingForDebugger` semantics
   - Console.log / console.error patterns leaking automation context
   - Native error stack traces and `.toString()` on injected functions
   - `sourceURL` patterns in evaluated scripts
   - Worker target handling (auto-attach + inject pattern + race window)
   - CDP event filtering — what they suppress that we don't
6. Cross-check against the 4 reference test sites. Patchright issues frequently mention CreepJS scores — capture them.

## Report format

Write to `docs/audits/patchright.md` (≤1500 words). Same template as `tasks/0200-audit-puppeteer-real-browser.md` (Summary / They-have / We-have / Bench / Adoption / Out-of-scope / Convenience).

**Special instruction**: patchright is structural-twin to mochi. Allocate proportionally more space to the "They have / we don't" section since that's where v0.2 adoption candidates concentrate.

## Submission

Same as 0200:

```sh
bun work create 0201 docs
cd worktrees/0201
# write docs/audits/patchright.md
git add docs/audits/patchright.md
git commit -m "docs(audits): patchright audit against mochi v0.1.0"
bun work submit 0201 --draft
```

## Out of scope

- Implementing any fixes — Phase B/C work.
- Speculation without source citation.
- Comparing patchright's Playwright-fork code paths to mochi's CDP-direct code paths in detail — too low-level. Compare semantics not implementations.
