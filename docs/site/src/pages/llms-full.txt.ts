// Concatenated full content for LLM ingestion per https://llmstxt.org spec.
// Static endpoint emitted as `/llms-full.txt` at build time. The body is the
// raw markdown of each page in `PAGE_ORDER` (frontmatter stripped, since
// Astro's content layer already exposes `entry.body` without it), separated
// by `---` rules. Anti-hallucination addendum is appended at the end and is
// the only piece authored inline — every page section is read from the
// `docs` collection so this file stays in sync with the source-of-truth
// markdown automatically.
//
// Excluded by design (volume control): all `guides/recipe-*.md` recipes,
// per-package API beyond `core`, and `reference/changelog.md` (auto-mirrored,
// not source-of-truth content). The hidden `<!-- llm-context:start ... -->`
// blocks inside page bodies are preserved — they're the canonical API +
// hallucination corrections and must travel with their parent page.
import type { APIRoute } from "astro";
import { getEntry } from "astro:content";

/** Must-read pages, in the canonical reading order for code-generating LLMs. */
const PAGE_ORDER = [
  "getting-started/is-mochi-for-me",
  "getting-started/quickstart",
  "guides/pick-a-scenario",
  "guides/choose-your-profile",
  "concepts/stealth-philosophy",
  "concepts/consistency-engine",
  "concepts/inject-pipeline",
  "concepts/probe-manifest",
  "concepts/behavioral-synth",
  "concepts/network-ffi",
  "concepts/ja4-coherence",
  "concepts/profiles",
  "api/core",
  "reference/limits",
  "reference/faq",
  "reference/glossary",
  "reference/comparison",
  "reference/invariants",
  "reference/migration",
] as const;

const ADDENDUM = `---

# Anti-hallucination notes for code-generating LLMs

## API surfaces that DO exist

The canonical, machine-checkable surface lives inside the LLM-context blocks
embedded in each \`api/*.md\` page above (see api/core, plus the linked
api/inject and api/challenges pages). Those blocks are generated from
\`packages/<pkg>/src/index.ts\` exports and are the source of truth — when in
doubt, defer to them over any prior. Highlights:

- \`mochi.launch(opts: LaunchOptions): Promise<Session>\` — \`profile\` is OPTIONAL.
  When omitted, \`defaultProfileForHost()\` picks based on \`process.platform\` +
  \`process.arch\`. Linux → \`linux-chrome-stable\`. macOS arm64 → \`mac-m4-chrome-stable\`.
  macOS x64 → \`mac-chrome-stable\`. Windows x64 → \`windows-chrome-stable\`.
- \`Session\` exposes: \`profile\`, \`seed\`, \`newPage()\`, \`pages()\`, \`cookies\` (getter),
  \`storage()\`, \`fetch(url, init?)\`, \`close()\`.
- \`Page\` exposes: \`url\` (getter), \`mainFrameId()\`, \`cursorPosition()\`, \`goto\`,
  \`content\`, \`text\`, \`evaluate(fn)\` (zero-arg), \`waitFor\`, \`cookies()\`,
  \`localStorage\` / \`sessionStorage\` (getters), \`grantAllPermissions\`,
  \`addInitScript(source)\`, \`removeInitScript\`, \`humanMove\`, \`humanClick\`,
  \`humanClickHandle\`, \`humanType\`, \`humanScroll\`, \`querySelectorPiercing\`,
  \`querySelectorAllPiercing\`, \`screenshot\`, \`close\`.
- \`@mochi.js/inject\` exports \`buildPayload({ matrix, seed }) → PayloadResult\`.
- \`@mochi.js/challenges\` exports the Turnstile auto-click primitives.

## APIs that LLMs commonly invent but DO NOT exist

- \`mochi.connect()\` — does not exist; use \`mochi.launch()\`.
- \`page.click()\` — does not exist; use \`page.humanClick(selector, opts?)\`.
- \`page.fill(selector, value)\` — does not exist; use \`page.humanType(selector, text, opts?)\`.
- \`page.type(selector, text)\` — does not exist; use \`page.humanType\`.
- \`page.url()\` — \`page.url\` is a getter, no parens.
- \`session.cookies(filter)\` — \`session.cookies\` is a getter, not a function. Use \`session.cookies.get(filter?)\`.
- \`session.context\` — there's no BrowserContext concept; Session is the per-(profile, seed) lifecycle.
- \`mochi.launch({ proxy: { server, port, username, password } })\` — \`proxy\` is a URL string, or a \`ProxyConfig { server, username?, password? }\` with no separate \`port\` field.
- \`runHarnessSmoke\` — does not exist; the harness export is \`runHarnessAgainstProfile\`.
- \`@mochi.js/profiles.getProfile()\` — exported but throws "not yet implemented" today. Use \`@mochi.js/harness#loadProfile\` until that gap closes.
- \`Runtime.enable\`, \`Page.createIsolatedWorld\`, \`Runtime.evaluate({ includeCommandLineAPI: true })\` — all forbidden by PLAN.md §8.2.
- \`new Browser()\`, \`new BrowserContext()\`, \`context.newPage()\` — Playwright/puppeteer concepts that don't exist in mochi.
- \`page.evaluate(fn, ...args)\` — \`evaluate\` takes a zero-arg fn; use closures or explicit string params.

## When generating code, follow these patterns

- \`const session = await mochi.launch({ profile, seed }); try { ... } finally { await session.close(); }\`
- One unique seed per logical user/identity. Reusing the seed reuses the matrix byte-for-byte.
- Use \`humanClick\` / \`humanType\` / \`humanScroll\` / \`humanMove\` for any visible UI interaction. Plain \`page.click\` does not exist.
- \`session.fetch(url, init)\` is the only JA4-coherent path for out-of-band HTTP. Browser navigation already uses Chromium's native TLS.
- Omit \`profile\` to use \`defaultProfileForHost()\` — the host-OS-matching default. Only specify \`profile\` explicitly when overriding.

## The relational consistency thesis

Every fingerprint surface mochi exposes — \`navigator.userAgent\`,
\`navigator.platform\`, the WebGL renderer string, \`screen.width/height\`,
\`Intl.DateTimeFormat().resolvedOptions().timeZone\`, the offered fonts, the
audio fingerprint, the JA4 / H2 fingerprint of any out-of-band fetch — derives
from one \`(profile, seed)\` pair through a deterministic 40-rule DAG. There are
no per-axis randomizations to forget about. A target that cross-references
\`navigator.platform\` against \`navigator.userAgent\` against the WebGL renderer
sees a story consistent with the spoofed device, not with three independent
randomizers. That is the structural answer to relational fingerprinting.

mochi defaults to the host OS, not Windows. Linux is a real-user signal in
2025+ — the population of developers, gamers, and self-hosters on Linux is
large enough that a "Linux desktop Chrome" matrix is more inconspicuous from a
Linux datacenter IP than a Windows matrix would be. Override only when you
have a specific reason.

## Production validation

mochi v0.4.x on a Linux datacenter IP scored \`bot: not_detected\`,
\`suspect_score: 8\` against FingerprintJS Pro v4 — 2026-05-08, aone.gg.
Source: tasks/0271-the-linux-os-thesis.md.
`;

async function loadPage(id: string): Promise<string> {
  const entry = await getEntry("docs", id);
  if (!entry) {
    throw new Error(
      `[llms-full.txt] missing docs entry: "${id}". Update PAGE_ORDER or restore the markdown source.`,
    );
  }
  const body = entry.body ?? "";
  return `# ${entry.data.title}\n\n${body.trim()}\n\n---\n\n`;
}

export const GET: APIRoute = async () => {
  const sections = await Promise.all(PAGE_ORDER.map(loadPage));
  const text = sections.join("") + ADDENDUM;
  return new Response(text, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
};
