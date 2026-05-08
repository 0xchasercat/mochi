# 0230: world-class README + banner + 5-min quickstart

**Package:** repo-level docs
**Phase:** `0.11` (post-v0.1.0)
**Estimated size:** M
**Dependencies:** v0.1.0 published to npm

## Goal

Replace the current placeholder README with a world-class top-of-funnel doc that takes a new visitor from zero to "running mochi" in under 5 minutes. Hero banner, value prop in one sentence, install + quickstart code block that actually runs, links to live site + docs, honest "what works / what doesn't" matrix, badges, license, contributing.

The README is what a Hacker News submission lands on. Treat it as the most-read marketing asset mochi has.

## Success criteria

### README

- [ ] Hero banner image at `assets/mochi-banner.png` (already committed). README opens with `<p align="center"><img src="assets/mochi-banner.png" alt="mochi.js" width="800" /></p>`.
- [ ] One-sentence value prop directly under the banner. Example shape (rewrite for tone): *"A Bun-native browser automation framework with relationally-locked fingerprint spoofing, behavioral playback, and JA4-impersonating out-of-band HTTP — one coherent stack instead of Patchright + fingerprint-injector + curl-impersonate."*
- [ ] Badges row: npm version, license, CI status, GitHub stars, Discord (placeholder if no server yet).
- [ ] **Quickstart that actually runs**: `bun add @mochi.js/core @mochi.js/cli` → `bunx mochi browsers install` → minimal `mochi.launch` snippet that opens a page and dumps the spoofed UA. The snippet must be copy-pasteable; verify it works against the v0.1.0 npm package.
- [ ] **Honest "what works / what doesn't" matrix** — direct port of `docs/limits.md` distilled into a table. PLAN.md I-8 is the rule: brag about what works, list what doesn't. Don't paper over.
- [ ] **Comparison table** vs the peer group (puppeteer-real-browser, patchright, nodriver, undetected-chromedriver). Same axes I outlined in chat earlier: relational consistency / JA4 / behavioral synth / probe-manifest / single-runtime / etc. Cite the audit reports landed in `docs/audits/` once they exist (post-0200-0203).
- [ ] Links to: docs site (mochijs.com once 0240/0241 land), examples, changelog, contributing, security policy.
- [ ] License footer.
- [ ] **No emojis** unless extremely deliberate (one accent emoji on the hero is fine; throughout-the-doc emoji-soup is not the brand).

### Quickstart doc (separate file, linked from README)

- [ ] `docs/quickstart.md` — 5-minute walkthrough. From `bun add` to first session to first humanClick. Include expected console output for sanity. Each step copy-pasteable.
- [ ] At the end: pointer to docs.mochijs.com (or mochijs.com/docs once it lands) for deeper coverage.

### Tone + voice

- [ ] Match the design system's brand voice (`docs/.design-reference/preview/voice.html`): direct, technically precise, lightly playful but never marketing-fluff. The slogan in `colors_and_type.css` is "Sticky on the outside, untouchable on the inside." — use it sparingly but well.
- [ ] No marketing superlatives ("blazing fast", "revolutionary", etc.). State facts.
- [ ] Short paragraphs. Code-block-heavy.

### Verification

- [ ] Walk through the quickstart yourself on a clean checkout. Each command must run without error against published v0.1.0.
- [ ] Spell-check pass.
- [ ] Markdown lint clean (no broken links, no trailing-whitespace).
- [ ] All linked-to files exist (docs/limits.md, CHANGELOG.md, LICENSE, CONTRIBUTING.md — create CONTRIBUTING.md skeleton if missing).

## Out of scope

- Docs site implementation — that's task 0240.
- Cloudflare deploy — that's task 0241.
- API reference docs — generated separately, lands in 0240.
- Long-form tutorials — separate from quickstart.

## Implementation notes

- Read `docs/.design-reference/preview/voice.html` for the brand voice spec.
- Don't include the raw "Sticky on the outside, untouchable on the inside." line in the README header — it lives on the landing page. README header is more functional.
- Look at high-quality OSS READMEs for shape: `bunjs/bun`, `oven-sh/bun`, `pnpm/pnpm`, `astral-sh/uv`. Match their density-to-readability ratio.
- The "comparison table" must be honest — see chat history for the actual peer-group analysis (we beat them on relational consistency / JA4 / behavioral synth / probe-manifest, tie on CDP-careful posture, lose on ecosystem maturity / stable-Chrome-quirks / Turnstile auto-click).

## Submission

```sh
bun work create 0230 docs
cd worktrees/0230
# write README.md, docs/quickstart.md, CONTRIBUTING.md skeleton if needed
# verify the quickstart actually runs against v0.1.0 npm
git add README.md docs/quickstart.md CONTRIBUTING.md
git commit -m "docs(repo): world-class README + banner + 5-min quickstart"
bun work submit 0230 --draft
```
