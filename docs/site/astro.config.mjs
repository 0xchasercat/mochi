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
      // Dual-theme: cream-blush light + stealth dark. Shiki picks the variant
      // via CSS `[data-theme="stealth"]` — see styles/global.css.
      themes: {
        light: "github-light",
        dark: "github-dark-dimmed",
      },
      wrap: false,
    },
  },
});
