# `docs/` — mochi.js documentation

Two trees live here:

- [`content/docs/`](content/docs) — Markdown / MDX source for every doc page,
  organized by category (`getting-started/`, `concepts/`, `guides/`, `api/`,
  `reference/`). Frontmatter is Zod-validated by the Astro content collection
  schema in [`site/src/content.config.ts`](site/src/content.config.ts).
- [`site/`](site) — the Astro 5.x app that renders the landing page (`/`)
  and the docs (`/docs/*`) at <https://mochijs.com>. Bun-only; not part of
  the publish pipeline.

## Local dev

```sh
cd docs/site
bun install
bun run dev      # → http://localhost:4321
bun run build    # → dist/, ready for Cloudflare Pages
bun run preview  # serve the built site locally
```

The repo root also exposes proxy scripts:

```sh
bun run docs:dev
bun run docs:build
bun run docs:preview
```

## Authoring

Every Markdown file under `content/docs/<category>/<slug>.md` becomes a route
at `/docs/<category>/<slug>`. Required frontmatter:

```yaml
---
title: <string>
description: <optional 1-line summary, used for SEO and search>
order: <number, sidebar ordering within the category>
category: <getting-started | concepts | guides | api | reference>
lastUpdated: <YYYY-MM-DD>
---
```

The build fails if any of those are missing or wrong-typed — by design.

## Other contents

- [`limits.md`](limits.md) — historical pointer to the canonical
  [Known limits](content/docs/reference/limits.md) page. Don't edit the stub;
  edit the canonical file.
- [`quickstart.md`](quickstart.md) — the 5-minute walkthrough referenced from
  the README. Will fold into [`content/docs/getting-started/quickstart.md`](content/docs/getting-started/quickstart.md)
  in a follow-up.
- [`audits/`](audits) — per-library stealth-tooling audits (Patchright, etc.).
- [`.design-reference/`](.design-reference) — the committed design system that
  the Astro site is a pixel-faithful port of. Don't edit the kits; edit the
  ported components in `site/src/components/`.
