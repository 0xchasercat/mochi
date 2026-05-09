# `docs/` — mochi.js documentation

mochi runs a **hybrid documentation model**: most pages are site-canonical
(authored once, rendered at <https://mochijs.com>), but a few development
surfaces stay repo-canonical because they're load-bearing for contributors
working in the tree. Per task 0270, do not duplicate content across the two
trees — pick the canonical home and leave a pointer at the other location.

## Site canonical — <https://mochijs.com>

Edit under [`content/docs/<category>/<slug>.md`](content/docs). The Astro
app in [`site/`](site) renders these as `/docs/<category>/<slug>` routes.

| Category | What lives there |
|---|---|
| `getting-started/` | Install, quickstart, first-session, Linux server, "is mochi for me?" |
| `concepts/` | Stealth philosophy, consistency engine, JA4 coherence, inject pipeline, behavioral synth, probe manifest, network FFI, profiles |
| `guides/` | Cookbook recipes (10), proxy auth, profile capture, screenshots, Turnstile, conformance suite, cookies + storage |
| `api/` | Per-package reference: `core`, `cli`, `consistency`, `inject`, `behavioral`, `net`, `profiles`, `harness`, `challenges` |
| `reference/` | Limits, comparison, FAQ, glossary, invariants, migration, changelog |

Frontmatter is Zod-validated by [`site/src/content.config.ts`](site/src/content.config.ts);
the build fails closed on missing or wrong-typed fields.

## Repo canonical — this directory tree (and the project root)

A handful of files stay in-repo because they're the contract that humans
and subagents read before touching code:

- [`README.md`](../README.md) — the front door. Pitch + proof + cross-links.
- [`PLAN.md`](../PLAN.md) — design contract. The 8 architectural invariants live in §2.
- [`AGENTS.md`](../AGENTS.md) — subagent operating manual; `bun work`, PR conventions, harness gate.
- [`CONTRIBUTING.md`](../CONTRIBUTING.md) — short version of "how to contribute".
- [`CHANGELOG.md`](../CHANGELOG.md) — release notes (also mirrored at `/docs/reference/changelog`).

Per-package READMEs (`packages/<pkg>/README.md`) stay in-repo as
"npm-page-shaped" entry points; each links to `https://mochijs.com/docs/api/<pkg>`
for the canonical reference.

## Other contents

- [`audits/`](audits) — per-library stealth-tooling audits (patchright, puppeteer-real-browser, nodriver, undetected-chromedriver, synthesis). These stay in-repo and are linked from [`reference/comparison`](https://mochijs.com/docs/reference/comparison) as raw GitHub URLs (line-number citations are load-bearing).
- [`limits.md`](limits.md) — pointer stub. The canonical document is at <https://mochijs.com/docs/reference/limits>.

## Local dev

```sh
cd docs/site
bun install
bun run dev      # → http://localhost:4321
bun run build    # → dist/, ready for Cloudflare Pages
bun run preview  # serve the built site locally
```

The repo root also exposes proxy scripts: `bun run docs:dev`,
`bun run docs:build`, `bun run docs:preview`.

## Hands off

- `content/docs/**` is the **source** of the site — edit there, never in `site/dist/`.
- `site/src/components/`, `site/src/styles/`, etc. are the design system. Don't restyle on a whim.
