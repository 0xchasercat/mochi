/**
 * Per-page LLM-readable markdown endpoint.
 *
 * For every doc page at `/docs/<slug>`, this route also emits the raw
 * markdown body at `/docs/<slug>/llms.md`. Lets users (esp. Claude Code)
 * scope context to a single section without ingesting the whole
 * `/llms-full.txt`.
 *
 * Pattern matches what Anthropic / Vercel / Astro itself ship — the doc
 * URL has a `.md` sibling that returns the raw markdown the page was
 * rendered from. Frontmatter is stripped (Astro's content layer exposes
 * `entry.body` without it). The hidden `<!-- llm-context:start ... -->`
 * blocks are preserved — they're the canonical API + hallucination
 * corrections and must travel with the page.
 *
 * Companion endpoints:
 *   - /llms.txt        — site index per llmstxt.org
 *   - /llms-full.txt   — concatenated bodies of the must-read pages
 *
 * Closes #54.
 */
import type { APIRoute } from "astro";
import { getCollection } from "astro:content";

export async function getStaticPaths() {
  const all = await getCollection("docs");
  return all.map((entry) => ({
    params: { slug: entry.id },
    props: { body: entry.body, id: entry.id, title: entry.data.title },
  }));
}

interface Props {
  body: string;
  id: string;
  title: string;
}

export const GET: APIRoute<Props> = ({ props }) => {
  const { body, id, title } = props;
  // One-line provenance header so an LLM ingesting this in isolation knows
  // which page it came from + has the canonical web URL to cite back.
  const header =
    `<!-- source: https://mochijs.com/docs/${id} -->\n` +
    `<!-- title: ${title} -->\n\n`;
  return new Response(`${header}${body ?? ""}`, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Cache-Control": "public, max-age=0, must-revalidate",
    },
  });
};
