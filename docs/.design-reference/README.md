# mochi.js Design System 🍡

> **Sticky on the outside. Untouchable on the inside.**

The design system for **mochi.js** — a Bun-native, raw-CDP browser automation framework.
Cute kawaii mascot, deeply technical product. The whole brand lives in that tension.

---

## Sources

This design system was synthesized from:

- **Mascot/logo**: `uploads/ChatGPT Image May 7, 2026, 11_30_27 PM (2).png` — a kawaii mochi character with angel wings and a honey drip on top, plus a navy `mochi.js` wordmark and small honeycomb-dot accents.
- **Product copy / positioning** (provided directly by the user):
  > "The sticky, zero-footprint stealth automation framework for Bun. Leaves no crumbs."
  > Emoji-tagged feature bullets covering Bun-first architecture, the Consistency Engine (fingerprint shapeshifting), native Rust networking via `bun:ffi`, zero-jitter proxies, and inverse behavioral playback.

No codebase, Figma, or website was provided — the visual system is **inferred from the mascot, the wordmark, and the product copy's tonal cues**. See *Caveats* at the bottom.

---

## Index

- `README.md` — this file
- `SKILL.md` — agent skill manifest
- `colors_and_type.css` — design tokens (CSS custom properties)
- `assets/` — mascot, logos, icon-friendly SVGs
- `preview/` — design-system review cards (one card per concept)
- `ui_kits/`
  - `docs_site/` — marketing + docs site UI kit
  - `terminal_demo/` — CLI / terminal living-doc UI kit
- `fonts/` — webfont notes (we use Google Fonts via CDN; see *Type*)

---

## What is mochi.js?

A next-gen browser automation library built **only** for the Bun runtime. Designed to defeat advanced WAFs (DataDome, Turnstile, Cloudflare, etc) where Playwright and Puppeteer fail. Headline ideas:

- **🍡 Bun-First Architecture** — talks to Chrome over `--remote-debugging-pipe` FDs. Sub-ms latency, no open TCP ports.
- **🧬 The Consistency Engine** — seed + profile (e.g. `mac-safari-17`) locks WebGL, AudioContext, Canvas noise, navigator props into a relationally-coherent fingerprint.
- **🦀 Native Rust Networking** — `bun:ffi` bridge to a Rust TLS impersonator for HTTP/2 frame + JA4 spoofing.
- **👻 Zero-Jitter Proxies** — TurboFan-friendly injection payloads pass `performance.now()` micro-jitter checks.
- **🎯 Inverse Behavioral Playback** — Bezier-curved mouse trajectories from real human telemetry.

Audience: serious devs doing anti-bot research, scraping at scale, QA / synthetic monitoring.

---

## Content Fundamentals

### Voice & Tone

mochi.js writes like a **highly competent engineer who happens to use one emoji per paragraph**. The personality dial lives between two poles, and the brand only sounds right when both are present in the same paragraph:

1. **Soft / playful** — "leaves no crumbs", "cute on the outside", "the sticky framework", emoji headers (🍡 🧬 🦀 👻 🎯).
2. **Technical / precise** — "TurboFan JIT-friendly", "JA4 signatures", "V8 isolate", "performance.now() micro-jitter", "sub-millisecond latency".

The combination is the brand. Drop either side and it stops being mochi.js.

### Casing & punctuation

- Product name is **always** lowercase: `mochi.js` — never *Mochi.js*, never *MochiJS*. The mascot can be capitalized as "Mochi" when personified.
- Headings are **sentence case**, not Title Case. Section eyebrows can be UPPERCASE in mono.
- Em-dashes are welcome. Oxford commas always.
- Code identifiers in body copy go in `--inline-code` (mono, with the honey-tinted background).

### Person

- Use **you** for the developer. ("You pass a seed and a profile. mochi.js does the rest.")
- Use **we** sparingly — only for opinionated stances ("We don't ship a Node.js fallback. Bun or bust.").
- The mascot speaks in *first-person mochi voice* on rare occasions for delight: "*hi! i made you a fingerprint ✨*". Use sparingly. Only ever 1 sentence. Always lowercase.

### Emoji policy

Yes, emoji are part of the brand — but rationed:

- ✅ One emoji per feature bullet, used as a marker/icon (🍡 🧬 🦀 👻 🎯 ✨ 🐚 🥢).
- ✅ The five "totem" emoji above are reserved as **section icons** for the five core pillars.
- ❌ No emoji in body prose paragraphs.
- ❌ No emoji in error messages, API reference, or anywhere a user might `grep` logs.

### Vibe examples

> **Good:** "🍡 Bun-First Architecture. mochi.js uses `--remote-debugging-pipe` FDs to talk to Chrome — sub-millisecond latency, zero open TCP ports for WAFs to scan."

> **Good:** "Pass a seed. Pick a profile. Get a relationally-coherent fingerprint that survives `getParameter(0x9245)` and an AudioContext probe in the same breath."

> **Bad (too cute):** "Mochi.js is a *delicious* little library that *bops* websites on the nose 🥺"

> **Bad (too dry):** "Mochi.js is a Bun-based browser automation library with anti-detection capabilities."

---

## Visual Foundations

### Colors

Three families, each with a job. **Navy is the voice. Honey is the highlight. Cream is the mochi.** Stealth (near-black) is reserved for "inside the engine" surfaces — terminals, code blocks, the dark mode of the docs site.

| Family | Role | Anchor |
|---|---|---|
| **Navy** (`--mochi-navy-900` `#1b2447`) | Primary text, wordmark, structural ink | Wordmark |
| **Honey** (`--mochi-honey-500` `#e89425`) | Primary accent, links, CTAs, the drip | Mascot's drip |
| **Cream** (`--mochi-cream-100` `#fbf3e4`) | Page bg, mochi body, surfaces | Mascot body |
| **Blush** (`--mochi-blush` `#f6c2bf`) | Highlights, friendly states, illustration | Mascot cheeks |
| **Stealth** (`--stealth-900` `#11141c`) | Terminal, code, "internals" surfaces | Anti-bot dark |

Status colors get **food nicknames** internally (matcha, strawberry, blueberry) but ship as semantic tokens (`--success`, `--danger`, `--info`).

### Type

- **Display: Nunito** (700/800/900). Round, friendly, evokes the wordmark's heavy rounded sans. Used for headlines, section titles, the wordmark.
- **Body: Inter** (400/500/600/700). Workhorse UI font. Crisp at small sizes, neutral against the warmer display.
- **Mono: JetBrains Mono** (400/500/700). Code, eyebrows, terminals, kbd glyphs.

The wordmark itself uses Nunito 900 with extra-tight tracking (`-0.04em`) to recreate the squashed, sticky proportions of the logo. The `.js` is rendered as `[dot] js` where the dot is a honey-colored circle, echoing the honeycomb dots in the logo.

> **Substitution flagged:** No brand fonts were provided. We're using Google Fonts (Nunito, Inter, JetBrains Mono) as our best-fit reads of the wordmark's heavy rounded sans + a clean tech body. **Please send the real font files** if mochi.js has them and we'll swap them in.

### Spacing & Layout

- **4px base grid.** Tokens `--s-1` (4) → `--s-24` (96).
- Generous gutters on marketing surfaces (`--s-12` to `--s-20`); tighter density in app/CLI surfaces.
- Max content column ~ 720px for prose; 1200px for marketing layouts.

### Radii — squishy, on purpose

Mochi is *squishy*. Radii skew large.

- Buttons & chips: `--r-md` (14px) or `--r-pill` (999px) for primary CTAs.
- Cards: `--r-xl` (28px).
- Hero blobs / mascot containers: `--r-blob` — an organic blob radius (`64% 36% 58% 42% / 52% 48% 52% 48%`) used for decorative mascot-shaped elements only.
- Code blocks & terminals: `--r-md` (14px). Code stays a touch sharper to feel "mechanical".

### Shadows

Soft, sticky, never harsh. All shadows use navy at low alpha.

- `--shadow-xs/sm/md/lg` — standard elevation ramp.
- `--shadow-honey` — a warm honey glow used **only** on the primary CTA hover state and on the mascot's container in hero treatments.
- `--shadow-inset` — a soft inset bottom-edge shadow that gives elements a "squished from above" feel. Used on primary buttons.

### Borders

- Default: 1px `--border` (cream-300, soft beige).
- Strong: 1px `--border-strong` (navy-300) — reserved for active form fields and selected states.
- Honey accents: 1.5px `--border-honey` — used as a focus ring and on the "current section" indicator.
- **No left-border-only colored card patterns.** That's the cliché we explicitly avoid. If we accent a card, we accent a chip *inside* it or use a top-edge honey rule, not a left bar.

### Backgrounds

- **Light surfaces** are flat cream (`--bg`). No gradients on body backgrounds.
- **Hero / feature panels** can use a subtle **honeycomb dot pattern** as a brand texture — a hexagonal grid of `--mochi-honey-200` dots at very low opacity. (See `assets/honeycomb.svg`.)
- **Dark/stealth surfaces** are flat near-black with a single subtle radial-vignette to add depth without gradient slop.
- **Full-bleed images** are reserved for the hero mascot and not much else. The brand's "imagery" is mostly the mascot.

### Animation & motion

- **Easing of choice: `--ease-mochi`** = `cubic-bezier(0.34, 1.56, 0.64, 1)` — a gentle overshoot for buttons and the mascot, because mochi has a little bounce.
- **`--ease-out`** for sober transitions in app/docs UI.
- Durations: `120ms` micro, `220ms` base, `420ms` deliberate.
- Hover states: a 2-3px lift + `--shadow-md` → `--shadow-honey`. No scale, no rotate (the brand bounces, it doesn't wiggle).
- Press states: `translateY(1px)` and shadow contraction. Never use a color flash on press.
- The mascot in hero positions does a 3-frame idle: **breathe** (1.00 → 1.02 scale, 3.5s loop, ease-in-out). That's it. He doesn't dance.

### Hover & press states (the rules)

- **Buttons primary**: hover → +2px translateY, shadow shifts to `--shadow-honey`, bg darkens to `--accent-hover`. Press → returns to baseline + 1px down.
- **Buttons secondary**: hover → bg becomes `--accent-soft`, border becomes `--border-honey`. Press → bg `--accent-soft` darker.
- **Links**: hover → underline appears (animated `text-underline-offset` from 4 → 2px), color stays.
- **Cards (clickable)**: hover → `translateY(-2px)`, shadow `--shadow-md` → `--shadow-lg`, border stays.
- **List rows**: hover → bg becomes `--bg-subtle`. No transform.

### Transparency & blur

- Used **rarely**. The only places blur is allowed:
  1. The sticky docs nav: `backdrop-filter: blur(12px)` over a 70%-alpha `--bg` so content scrolls under cleanly.
  2. Modal scrims: `rgba(27, 36, 71, 0.45)` with no blur.
- No frosted-glass cards. No glassmorphism.

### Imagery vibe

Warm, off-white, slightly buttery. If we ever ship product photography, treat it with a 5% warm overlay (`--mochi-honey-50` at 8% multiply) to keep it tonally consistent with the cream background. **No grain, no high-saturation photography, no stock dev imagery (the "diverse hands on laptop" type).** When we need a "person" we use the mochi mascot.

### Cards

- Bg: `--bg-elevated` (white) on cream, or `--bg-subtle` on white.
- Border: 1px `--border`, no inner border.
- Radius: `--r-xl` (28px).
- Shadow: `--shadow-sm` at rest, `--shadow-md` on hover.
- Padding: `--s-6` (24px) minimum, `--s-8` (32px) for marketing.
- Title in `var(--font-display) 700 var(--t-xl)`, body in `var(--font-sans) 400 var(--t-base)`.

### Layout rules — fixed elements

- Top nav is sticky on docs and marketing, 64px tall, with backdrop blur.
- A small honey-colored "skip to API" pill floats bottom-right on long doc pages (z-index 50).
- The mascot mini (24×24) appears in the top-left of the nav, never elsewhere fixed.

---

## Iconography

mochi.js ships with **two coexisting icon vocabularies** because the brand has two halves:

### 1. Lucide (line icons) — for UI

We use **Lucide** (CDN: `https://unpkg.com/lucide-static@latest/icons/*.svg`) for all functional UI iconography — nav items, buttons, form affordances, sidebar entries, toasts. Stroke width `1.75`, line-cap round, color inherits from `currentColor`.

> **Substitution flagged:** No icon set was provided in the brand assets. Lucide is our pick because its rounded-stroke geometry sits well next to the round mochi mascot. **Please confirm or substitute** if mochi.js has its own preferred icon set.

### 2. The "totem" emoji — for marketing pillars

Five emoji are reserved as **named brand markers**, each mapped to a feature pillar. They appear large in feature blocks (32–64px), in section eyebrows on docs, and as visual anchors in the README.

| Emoji | Name | Pillar |
|---|---|---|
| 🍡 | *dango* | Bun-First Architecture (the wrapper / package itself) |
| 🧬 | *helix* | The Consistency Engine (fingerprint shapeshifting) |
| 🦀 | *crab* | Native Rust Networking |
| 👻 | *ghost* | Zero-Jitter Proxies (invisible to WAFs) |
| 🎯 | *bullseye* | Inverse Behavioral Playback (precise human-mimicry) |

Bonus delight emoji: ✨ (success states only), 🐚 (rare; used for "shell" / CLI references). Never substitute these with line icons.

### 3. Honeycomb dots — decorative motif

The logo includes tiny honeycomb-dot accents around the wordmark. We use this motif as a **decorative texture** (`assets/honeycomb.svg`) — a low-opacity hex-dot pattern usable as a section background or divider.

### 4. The mascot — illustration, not an icon

The mascot is an **illustration**, not an icon. Don't render it at < 48px (he loses his cheeks). Don't recolor him. Don't draw a "simplified" version — if you need him small, use the actual PNG (`assets/mochi-mascot.png`) shrunk down, or use the wordmark instead.

---

## Caveats

- **No codebase, Figma, or website were provided.** The visual system is inferred from the mascot, the wordmark, and product copy. If mochi.js has an existing site, README on GitHub, or docs theme, send it and we'll align.
- **Fonts substituted.** Nunito / Inter / JetBrains Mono are best-fit Google Fonts; flag and swap if you have brand fonts.
- **Icons substituted.** Lucide is our best-fit pick; flag and swap if you have a preferred set.
- **No real product screens to copy.** UI kits are interpretive — they show what a mochi.js docs site, terminal, and code surface *should* look like under this design language, not screenshots of a shipped product.

---

## Asks for the next round

Help me make this **perfect**:

1. **Send any existing docs site, GitHub README, or marketing site URL** — even a draft. I'll align the kits to it pixel-for-pixel.
2. **Confirm or replace fonts.** Is Nunito the right read of the wordmark?
3. **Confirm or replace the icon set.** Is Lucide fine, or do you have a custom set?
4. **The five totem emoji** — keep all five? Swap any?
5. **Dark mode mascot** — should he have a dark variant (e.g. shadowed, "stealth" version) for the dark/terminal surfaces?
