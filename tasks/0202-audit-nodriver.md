# 0202: audit nodriver against mochi

**Type:** research / docs only (no source-code changes)
**Phase:** v0.2 audit batch (post-v0.1.0)
**Estimated size:** M
**Output:** `docs/audits/nodriver.md` (commit + PR)

## Goal

Identify every stealth trick, leak fix, fingerprint surface, behavioral pattern, or convenience feature in `nodriver` (https://github.com/ultrafunkamsterdam/nodriver) — the successor to `undetected-chromedriver` that uses CDP directly — that mochi v0.1.0 does NOT have. Output is a structured report that becomes Phase B (synthesis) input.

## Method

1. Clone https://github.com/ultrafunkamsterdam/nodriver. Read the source — Python, structured similar to mochi (CDP-direct, no Selenium).
2. Read README + docs site. Capture their "stealth checklist" if documented.
3. Read open + last 6 months closed issues. Filter for detection-relevant terms.
4. Read mochi's `PLAN.md` + inject modules + consistency rules. Verify our coverage.
5. **Specific surfaces to compare**:
   - CDP event suppression / filtering they apply
   - User-agent + navigator surface spoofing
   - Profile-state warming (cookies, localStorage seeded before site load)
   - Their "config" abstractions for fingerprint preset selection
   - Behavioral helpers (mouse movement, typing)
   - Headless detection avoidance specifics
6. Cross-check against the 4 reference test sites.

## Report format

Write to `docs/audits/nodriver.md` (≤1500 words). Same template as 0200.

## Submission

```sh
bun work create 0202 docs
cd worktrees/0202
git add docs/audits/nodriver.md
git commit -m "docs(audits): nodriver audit against mochi v0.1.0"
bun work submit 0202 --draft
```

## Out of scope

- Cross-language porting concerns — note in passing if relevant but don't dwell.
- Implementing fixes.
