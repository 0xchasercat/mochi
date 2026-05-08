# 0240: Astro site — landing page + docs (mochijs.com)

**Package:** new — `docs/site/` (Astro app), content at `docs/content/`
**Phase:** `0.12` (post-v0.1.0)
**Estimated size:** XL
**Dependencies:** v0.1.0 published, design system at `docs/.design-reference/`, banner at `assets/mochi-banner.png`, README from task 0230 (for link targets + canonical wording)

## Goal

Build the production landing page + docs site for mochi.js, deployed on Cloudflare Pages at mochijs.com. Implementation is Astro + content collections so writers can update markdown without touching frontend code. Pixel-faithful to the committed design system. Single Astro project handles both landing (`/`) and docs (`/docs/*`).

After this lands the docs site is browseable end-to-end and ready for Cloudflare deployment (task 0241).

## Repo layout (target)

```
docs/
├── content/                      # markdown content (Astro content collections)
│   └── docs/
│       ├── getting-started/
│       │   ├── 01-install.md
│       │   ├── 02-first-session.md
│       │   ├── 03-quickstart.md
│       ├── concepts/
│       │   ├── consistency-engine.md
│       │   ├── inject-pipeline.md
│       │   ├── profiles.md
│       │   ├── probe-manifest.md
│       │   ├── behavioral-synth.md
│       │   └── network-ffi.md
│       ├── guides/
│       │   ├── proxy-auth.md
│       │   ├── capture-a-profile.md
│       │   └── conformance-suite.md
│       ├── api/
│       │   ├── core.md           # Generated (TODO) or hand-written for v1
│       │   ├── inject.md
│       │   ├── consistency.md
│       │   ├── behavioral.md
│       │   └── harness.md
│       └── reference/
│           ├── changelog.md      # Symlink or content-collection-loader to root CHANGELOG
│           ├── limits.md         # Pulled from docs/limits.md
│           └── invariants.md     # Distilled from PLAN.md §2
├── site/                         # Astro app
│   ├── src/
│   │   ├── components/
│   │   │   ├── landing/          # Hero, FeaturePillars, CodeShowcase, Footer, Nav (from docs_site/ ui_kit)
│   │   │   └── docs/             # Sidebar, TOC, MDX renderers (from docs/ ui_kit)
│   │   ├── layouts/
│   │   │   ├── LandingLayout.astro
│   │   │   └── DocsLayout.astro
│   │   ├── pages/
│   │   │   ├── index.astro       # Landing (/)
│   │   │   ├── docs/[...slug].astro
│   │   │   └── 404.astro
│   │   ├── content/              # content collection schemas (Zod)
│   │   │   └── config.ts
│   │   ├── styles/
│   │   │   ├── tokens.css        # Ported from docs/.design-reference/colors_and_type.css
│   │   │   └── global.css
│   │   └── lib/                  # syntax highlighting, search index, etc.
│   ├── public/
│   │   ├── mochi-mascot.png      # Copy from docs/.design-reference/assets/
│   │   ├── wordmark.svg
│   │   ├── honeycomb.svg
│   │   └── favicon.svg
│   ├── astro.config.mjs
│   ├── package.json              # @mochi.js/site (private:true)
│   └── tsconfig.json
├── .design-reference/            # Already committed — source of truth for design
└── README.md                     # docs/ README explaining the structure
```

## Success criteria

### Astro project

- [ ] New `docs/site/` Astro app with `astro@latest` (5.x). Bun-only — `package.json` `"engines": { "bun": ">=1.1" }`. `name: "@mochi.js/site"`, `private: true` (we don't publish the site itself).
- [ ] `astro.config.mjs` integrations: `@astrojs/mdx` (markdown→Astro), `shiki` for syntax highlighting (theme: ported `colors-stealth.html` palette for dark code blocks, `colors-cream-blush.html` for light), optional `@astrojs/sitemap` and `@astrojs/rss`.
- [ ] **Content collections** (`src/content/config.ts`) with Zod schema for docs frontmatter: `title: string`, `description?: string`, `order: number` (sidebar ordering), `category: enum`, `lastUpdated: date (auto)`. Frontmatter required on every doc.
- [ ] Build artifacts gitignored: `docs/site/dist/`, `docs/site/.astro/`, `docs/site/node_modules/`. Add to root `.gitignore`.

### Landing page (`/`)

- [ ] Pixel-faithful port of `docs/.design-reference/ui_kits/docs_site/index.html` + sub-components (`Hero.jsx`, `FeaturePillars.jsx`, `CodeShowcase.jsx`, `Nav.jsx`, `Footer.jsx`). Convert each `.jsx` to `.astro` (or use `@astrojs/react` to render them as-is — agent's choice; native `.astro` is preferred for perf).
- [ ] Hero block uses the `mochi-mascot.png` + `wordmark.svg` from the design assets. Headline + tagline + dual CTA ("Get started" → `/docs/getting-started/01-install`, "GitHub" → `https://github.com/0xchasercat/mochi`).
- [ ] Five feature pillars (per the design's `FeaturePillars.jsx`) — fill content from the framework's actual selling points: relational consistency, JA4 TLS impersonation, behavioral synth, probe-manifest measurable diff, single coherent stack.
- [ ] Code showcase: a real, runnable mochi snippet rendered with the stealth-themed syntax highlighting. Use the shiki theme ported from `colors-stealth.html`.
- [ ] Footer: minimal, wordmark + license + GitHub link.

### Docs site (`/docs/*`)

- [ ] Three-column layout per `docs/.design-reference/ui_kits/docs/styles.css` and `Shell.jsx`: left sidebar (nav tree built from content collection), center content (markdown-rendered), right TOC (auto-generated from h2/h3).
- [ ] Sidebar: hierarchical, collapsible, current-page highlighted in honey accent. Generated from content collection metadata (`category`, `order`).
- [ ] **Theme toggle** (cream ↔ stealth/dark) via `[data-theme="stealth"]` per the design tokens. Persisted to `localStorage`.
- [ ] **Search**: client-side Pagefind (or alternative) integration. Indexed at build time. Keyboard shortcut: `⌘K` / `Ctrl+K`.
- [ ] Code blocks: shiki with both light + stealth themes (shiki dual-theme), copy-button overlay, language label.
- [ ] Callout/admonition components: `:::note`, `:::warning`, `:::danger` styled per the semantic colors in `colors_and_type.css`.
- [ ] Anchor links on every heading (clickable hash icon).
- [ ] Previous/next page navigation at the bottom of every doc, derived from sidebar order.

### Initial content

Don't try to write *every* doc. Write the scaffold + a few flagship pages so the site is browseable:

- [ ] `docs/getting-started/01-install.md` — full install path, one of the agent's verifications must be that this matches the README quickstart from 0230 (single source of truth).
- [ ] `docs/getting-started/02-first-session.md` — first `mochi.launch` walkthrough.
- [ ] `docs/concepts/consistency-engine.md` — explain relational consistency. Pull from PLAN.md §9 + packages/consistency/src/.
- [ ] `docs/concepts/probe-manifest.md` — explain Zero-Diff measurement. Pull from PLAN.md §13.
- [ ] `docs/reference/limits.md` — copy from `docs/limits.md`. Make this the canonical location and update root `docs/limits.md` to a stub-with-link.
- [ ] `docs/reference/invariants.md` — distilled from PLAN.md §2 (the 8 invariants).
- [ ] All other content pages: scaffolded with frontmatter + `## TODO` placeholder. Site must still build with empty pages.

### API reference

- [ ] **Hand-written for v1**: each major package gets a single `docs/api/<package>.md` with the public API surface listed manually. Don't try to wire TypeDoc / API-extractor in this task — that's a v0.13 follow-up.
- [ ] Content scope per page: type signatures + 1-paragraph description per public export. Match the actual exports from `packages/<pkg>/src/index.ts`.

### Build + dev workflow

- [ ] `cd docs/site && bun install && bun run dev` works locally on first checkout.
- [ ] `bun run build` produces a static `dist/` ready for Cloudflare Pages.
- [ ] `bun run preview` serves the built site locally.
- [ ] Top-level package.json gains `docs:dev` / `docs:build` / `docs:preview` proxy scripts for ergonomics.

### Tests

- [ ] Smoke test: `bun run build` exits 0 in CI.
- [ ] Link-checker pass: no broken internal links. Use `lychee` or `astro-broken-link-checker`.
- [ ] Image assets all present; no 404s on referenced paths.

### Other

- [ ] **No new TS package gates** for this — the site is an HTML output, not a published package. It does NOT participate in the `bun run typecheck` / `bun run test` aggregations. The site has its own `bun run docs:typecheck` / `docs:build` / `docs:lint` set, run as a separate workflow.
- [ ] New CI workflow `.github/workflows/docs-build.yml` — runs `bun run docs:build` on PR + push. Caches Astro's `.astro/` directory. Fails the build on broken links or missing assets.
- [ ] Root `.gitignore` updated with: `docs/site/dist/`, `docs/site/.astro/`, `docs/site/node_modules/`, `docs/site/.cache/`.
- [ ] Changeset: NONE (site is private; no npm publish).

## Out of scope

- Cloudflare Pages deploy + DNS — task 0241.
- TypeDoc auto-generation of API ref — v0.13 follow-up.
- Algolia / paid search — Pagefind is free and good enough.
- i18n — single English locale for now.
- Blog / changelog feed UI — fold changelog into a single docs page for v1; full feed UI is later.
- A/B testing, analytics — fold in later.
- The README itself — task 0230.
- New design directions — strictly port what's in `.design-reference/`. Anything you want to change, file a follow-up task.

## Implementation notes

- Read `docs/.design-reference/colors_and_type.css` first — that's the design tokens. Port verbatim into `docs/site/src/styles/tokens.css`. Don't rename CSS custom properties.
- The design archive's `ui_kits/docs_site/` is the LANDING page (confusingly named); `ui_kits/docs/` is the DOCS site. The user's URL fragments confirm this.
- Components in the archive are React `.jsx`. Two valid ports:
  1. Convert to `.astro` (preferred for static perf).
  2. Use `@astrojs/react` and import as-is.
  Choose per-component based on interactivity — purely-presentational components → `.astro`, ones that need client state (theme toggle, search) → React with `client:load` directive.
- Astro 5 has Content Layer API — use it for the docs content collection. Glob loader pointing at `docs/content/docs/**/*.{md,mdx}`.
- Frontmatter schema MUST be enforced via Zod. Bad frontmatter should fail the build, not silently render.
- Read `docs/.design-reference/preview/code-block.html` for the code-block component design. Match it.
- Read `docs/.design-reference/preview/voice.html` for the brand voice. Pages you write content for should match this voice.

## Submission

```sh
bun work create 0240 site
cd worktrees/0240
# build the Astro app, port components, write initial content
cd docs/site && bun install && bun run build  # must pass
git add docs/site docs/content docs/README.md .gitignore .github/workflows/docs-build.yml
git commit -m "feat(docs): Astro site for landing + docs at docs/site"
bun work submit 0240 --draft
```

## Validation

```sh
# Site builds clean
cd docs/site && bun install && bun run build && cd ../..
# Output exists
test -d docs/site/dist && test -f docs/site/dist/index.html
# Doc routes resolve (Astro emits `docs/<slug>/index.html`)
test -f docs/site/dist/docs/getting-started/01-install/index.html || \
  ls docs/site/dist/docs 2>/dev/null
# 404 page emitted
test -f docs/site/dist/404.html
# No broken-link errors in build output (build fails on broken refs by default)
# Repo gates still green
bun run typecheck && bun run lint
```
