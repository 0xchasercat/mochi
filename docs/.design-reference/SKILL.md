---
name: mochi-design
description: Use this skill to generate well-branded interfaces and assets for mochi.js, either for production or throwaway prototypes/mocks/etc. Contains essential design guidelines, colors, type, fonts, assets, and UI kit components for prototyping.
user-invocable: true
---

Read the README.md file within this skill, and explore the other available files.

If creating visual artifacts (slides, mocks, throwaway prototypes, etc), copy assets out and create static HTML files for the user to view. If working on production code, you can copy assets and read the rules here to become an expert in designing with this brand.

If the user invokes this skill without any other guidance, ask them what they want to build or design, ask some questions, and act as an expert designer who outputs HTML artifacts _or_ production code, depending on the need.

## Quick reference for mochi.js

- **Tonal rule:** soft + technical, in the same paragraph. Drop either side and it stops being mochi.js.
- **Wordmark:** always lowercase `mochi.js`. The `.` is rendered as a honey-colored circle, never a period glyph.
- **Five totem emoji** (reserved for pillars only): 🍡 dango · 🧬 helix · 🦀 crab · 👻 ghost · 🎯 bullseye.
- **Tokens:** `colors_and_type.css` — import this. Don't invent colors. Honey is the only accent.
- **Type:** Nunito 800/900 display, Inter body, JetBrains Mono code. Sub for closest match if unavailable.
- **Surfaces:** light cream for marketing/docs, near-black "stealth" for terminals/code/internals.
- **Mascot:** `assets/mochi-mascot.png`. Use ≥ 48px. Don't recolor. Don't redraw as SVG.
- **Avoid:** glassmorphism, left-border-only colored cards, scale/rotate hovers, emoji in body prose.

## Files

- `README.md` — full system spec (voice, visual foundations, iconography, caveats)
- `colors_and_type.css` — design tokens
- `assets/` — mascot PNG, wordmark SVG, honeycomb pattern
- `preview/` — design system review cards (copy as references)
- `ui_kits/docs_site/` — marketing/docs UI kit (React via Babel)
- `ui_kits/terminal_demo/` — CLI terminal UI kit (React via Babel)
