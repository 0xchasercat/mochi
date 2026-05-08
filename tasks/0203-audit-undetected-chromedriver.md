# 0203: audit undetected-chromedriver against mochi

**Type:** research / docs only (no source-code changes)
**Phase:** v0.2 audit batch (post-v0.1.0)
**Estimated size:** M
**Output:** `docs/audits/undetected-chromedriver.md` (commit + PR)

## Goal

Identify every stealth trick, leak fix, fingerprint surface, behavioral pattern, or convenience feature in `undetected-chromedriver` (https://github.com/ultrafunkamsterdam/undetected-chromedriver) that mochi v0.1.0 does NOT have. Output is a structured report that becomes Phase B (synthesis) input.

**Context**: undetected-chromedriver is the most-used Python automation-stealth lib (4 years of community contributions). Many of its patches address WebDriver-specific leaks (`cdc_*` symbols, `$wdc_`, etc.) which **don't apply to mochi** (we use CDP pipe, not WebDriver/chromedriver). Filter aggressively — most findings will be "WebDriver-specific, N/A". The valuable findings are the surface-level fingerprint patches that apply regardless of automation transport.

## Method

1. Clone https://github.com/ultrafunkamsterdam/undetected-chromedriver. Read the source.
2. Read the patcher.py file specifically — the chromedriver binary patches. Most of these are WebDriver-specific (skip those).
3. Read their `__init__.py` ChromeOptions setup — these are flag-level fingerprint tricks that DO apply to us.
4. Read open + last 6 months closed issues. Filter for non-WebDriver detection issues.
5. **Specific items to look for** (these ARE applicable to mochi):
   - Chrome flags they set / unset that we don't (cross-check `packages/core/src/proc.ts` `DEFAULT_CHROMIUM_FLAGS`)
   - Profile-warming patterns
   - Their version-detection logic (binary version → preset matching) — relevant to our profile system
   - Anti-debugger workarounds (we hit incolumitas with this; they may have a different approach)
   - User-agent, sec-ch-ua handling
6. **Skip** (not applicable to mochi — document briefly in report's "intentional difference" section):
   - All `cdc_*` / `$wdc_` symbol patches — we don't use chromedriver
   - WebDriver-protocol-level fixes — we use CDP pipe
   - Selenium-binding edge cases
7. Cross-check against the 4 reference test sites.

## Report format

Write to `docs/audits/undetected-chromedriver.md` (≤1500 words). Same template as 0200, but expect the "Out of scope (intentional difference)" section to be longer than the others — that's correct.

## Submission

```sh
bun work create 0203 docs
cd worktrees/0203
git add docs/audits/undetected-chromedriver.md
git commit -m "docs(audits): undetected-chromedriver audit against mochi v0.1.0"
bun work submit 0203 --draft
```

## Out of scope

- WebDriver-protocol concerns. We don't use it. Note + move on.
- Implementing fixes.

## Success criteria

Per the "Method" + "Report format" sections above. This is a research-only brief: success = a non-empty, source-citing audit report at `docs/audits/undetected-chromedriver.md` matching the template (Summary / They-have / We-have / Bench / Adoption / Out-of-scope / Convenience). The report becomes Phase B (synthesis) input.

## Implementation notes

This task does NOT modify any source files. It produces one markdown audit report. Follow the "Method" section verbatim — no code, no test harnesses, no PR-touching first-party packages. If you find yourself editing `packages/*/src/*`, you're outside scope; stop and surface.

## Validation

```sh
test -f docs/audits/undetected-chromedriver.md && wc -w docs/audits/undetected-chromedriver.md  # word count <= 1500
grep -E '^## (Summary|They have|We have|Bench|Recommended|Out of scope)' docs/audits/undetected-chromedriver.md | wc -l  # all sections present
```
