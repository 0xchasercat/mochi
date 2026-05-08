// @ts-check
import mdx from "@astrojs/mdx";
import sitemap from "@astrojs/sitemap";
import { defineConfig } from "astro/config";

// mochi.js site — landing (/) + docs (/docs/*).
// Hosted at mochijs.com via Cloudflare Pages (deploy in task 0241).
export default defineConfig({
  site: "https://mochijs.com",
  trailingSlash: "ignore",
  build: {
    format: "directory",
  },
  integrations: [mdx(), sitemap()],
  markdown: {
    shikiConfig: {
      // Single light theme — site is cream-only, no global dark/light
      // toggle. Code blocks that intentionally look terminal-dark
      // (landing CodeShowcase, etc.) are styled in landing.css with
      // raw --stealth-* tokens; that's a brand-design choice for a
      // specific component, not a theme.
      theme: "github-light",
      wrap: false,
    },
  },
});
