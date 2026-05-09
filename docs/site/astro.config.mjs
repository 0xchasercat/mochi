// @ts-check
import mdx from "@astrojs/mdx";
import sitemap from "@astrojs/sitemap";
import { defineConfig } from "astro/config";
import rehypeAutolinkHeadings from "rehype-autolink-headings";
import rehypeSlug from "rehype-slug";

// mochi.js site — landing (/) + docs (/docs/*).
// Hosted at mochijs.com via Cloudflare Pages.
export default defineConfig({
  site: "https://mochijs.com",
  trailingSlash: "ignore",
  build: {
    format: "directory",
  },
  integrations: [mdx(), sitemap()],
  markdown: {
    shikiConfig: {
      // Dark surface for code blocks — matches the brand's stealth-900
      // panel aesthetic and keeps parity with the hand-coded
      // CodeShowcase tabs on the landing page (which uses the same
      // theme via <Code theme="github-dark-dimmed" />). Switched from
      // github-light because cream-on-cream code blocks visually
      // disappeared from the page.
      theme: "github-dark-dimmed",
      wrap: false,
    },
    rehypePlugins: [
      // rehype-slug adds id="..." to every heading so anchor links
      // resolve. Without it the right-rail TOC links scroll nowhere.
      rehypeSlug,
      // rehype-autolink-headings wraps each heading's text in an <a>
      // pointing at its own id, so users can deep-link to any heading.
      // We use behavior: "wrap" + className: "d-h-anchor" so docs.css
      // can render a hover-revealed "#" sigil to the left of the
      // heading (see .d-h-anchor styling).
      [
        rehypeAutolinkHeadings,
        {
          behavior: "wrap",
          properties: { className: ["d-h-anchor"], "aria-label": "Permalink" },
        },
      ],
    ],
  },
});
