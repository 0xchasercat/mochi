# 0200: audit puppeteer-real-browser against mochi

**Type:** research / docs only (no source-code changes)
**Phase:** v0.2 audit batch (post-v0.1.0)
**Estimated size:** M
**Output:** `docs/audits/puppeteer-real-browser.md` (commit + PR)

## Goal

Identify every stealth trick, leak fix, fingerprint surface, behavioral pattern, or convenience feature in `puppeteer-real-browser` (https://github.com/zfcsoftware/puppeteer-real-browser) that mochi v0.1.0 does NOT have. Output is a structured report that becomes Phase B (synthesis) input.

## Method

1. Clone the lib into a tmp dir. Read the actual source — README and marketing claims are not enough.
2. Read open issues + last 6 months of closed issues. Filter for "detected", "fingerprint", "leak", "blocked", "captcha", "Cloudflare", "Turnstile". This is where real-world failures get reported.
3. Read mochi's `PLAN.md` (especially §2 invariants, §8.2 forbidden CDP methods, §10 network FFI), `packages/inject/src/modules/*` (current spoofing surface), `packages/consistency/src/rules/*` (current 30 rules). Don't assume mochi has things — verify by reading.
4. **For each finding**: cite the source file + line in puppeteer-real-browser, name the equivalent mochi surface (or "missing"), assess severity.
5. Cross-check against the 4 reference test sites: `bot.incolumitas.com`, `creepjs (abrahamjuliot.github.io/creepjs)`, `fingerprint.com/web-scraping`, `browserleaks.com`. If the lib's docs/issues mention scoring against any of these, capture the score.

## Report format

Write to `docs/audits/puppeteer-real-browser.md` (≤1500 words):

```markdown
# Audit: puppeteer-real-browser

**Date:** <YYYY-MM-DD>
**Lib version audited:** <git sha or version>
**Auditor:** mochi audit agent (task 0200)

## Summary

<1 paragraph: structural posture of this lib vs mochi. Stock Chrome? Forked? CDP-only or WebDriver? Bun/Node/Python?>

## They have / we don't

Ranked HIGH / MED / LOW impact. Each finding cites source.

- [HIGH] **<surface name>**: `<repo>/<file>:<line>` — <what it does, why it matters, severity reasoning>
- [MED] **<surface name>**: `<repo>/<file>:<line>` — <...>
- [LOW] **<surface name>**: `<repo>/<file>:<line>` — <...>

## We have / they don't (sanity check)

Surfaces mochi covers that this lib doesn't — sanity-check that we're not regressing.

- mochi has X (cite mochi source); this lib does not have an equivalent.

## Bench scoring (if their docs / issues report against any)

- bot.incolumitas.com: <score or "not measured">
- creepjs.dev: <...>
- fingerprint.com /web-scraping: <...>
- browserleaks.com: <...>

## Recommended adoption

**Up to 5 items**, ranked by impact-to-effort. Each is a candidate for a v0.2 task brief.

1. **<surface>** — port their approach at `<file>:<line>`; map to mochi consistency rule R-XXX or new inject module.
2. ...

## Out of scope (requires C++ patches per I-1)

If they only achieve a thing via patched Chromium binary, list it here. Don't propose adoption.

- ...

## Notable: convenience features

Things like Turnstile clickers, Cloudflare bypass tricks, profile warming, cookie persistence — list separately. These map to `@mochi.js/challenges` (task 0220) or future convenience packages, not core stealth.

- ...
```

## Submission

Standard worktree workflow:

```sh
bun work create 0200 docs
# (use `docs` as the package label since this is repo-level docs)
cd worktrees/0200
# write docs/audits/puppeteer-real-browser.md
git add docs/audits/puppeteer-real-browser.md
git commit -m "docs(audits): puppeteer-real-browser audit against mochi v0.1.0"
bun work submit 0200 --draft
```

Or if `bun work submit` crashes on the worktree-gitdir bug (task #20), open the PR via `gh pr create` directly.

## Out of scope

- Implementing any fixes — that's Phase B/C work after synthesis.
- Speculation. Every finding must cite source.
- Re-scoring our own conformance suite — done separately.

## Success criteria

Per the "Method" + "Report format" sections above. This is a research-only brief: success = a non-empty, source-citing audit report at `docs/audits/puppeteer-real-browser.md` matching the template (Summary / They-have / We-have / Bench / Adoption / Out-of-scope / Convenience). The report becomes Phase B (synthesis) input.

## Implementation notes

This task does NOT modify any source files. It produces one markdown audit report. Follow the "Method" section verbatim — no code, no test harnesses, no PR-touching first-party packages. If you find yourself editing `packages/*/src/*`, you're outside scope; stop and surface.

## Validation

```sh
test -f docs/audits/puppeteer-real-browser.md && wc -w docs/audits/puppeteer-real-browser.md  # word count <= 1500
grep -E '^## (Summary|They have|We have|Bench|Recommended|Out of scope)' docs/audits/puppeteer-real-browser.md | wc -l  # all sections present
```
