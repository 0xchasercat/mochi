// Astro 5.x Content Layer API. The `docs` collection is sourced from
// `docs/content/docs/**/*.{md,mdx}` (one level above `docs/site/`). Frontmatter
// is Zod-validated — bad frontmatter fails the build, by design.
import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";

const docCategories = [
  "getting-started",
  "concepts",
  "guides",
  "api",
  "reference",
] as const;

const docs = defineCollection({
  // `base` is relative to the site root (docs/site/). The content tree lives
  // one directory up at docs/content/docs/.
  loader: glob({ pattern: "**/*.{md,mdx}", base: "../content/docs" }),
  schema: z.object({
    title: z.string(),
    description: z.string().optional(),
    /** Sidebar order within a category. Lower = higher in the list. */
    order: z.number().int().nonnegative(),
    category: z.enum(docCategories),
    /** Auto-stamped by `git log -1` if absent — left optional so authors can
     * pin a date manually for a reissue. */
    lastUpdated: z.coerce.date().optional(),
    /** Hide from sidebar (still routable). Useful for landing pages. */
    hidden: z.boolean().default(false),
  }),
});

export const collections = { docs };
export type DocCategory = (typeof docCategories)[number];
export const DOC_CATEGORIES = docCategories;

/** Pretty label per category, in display order. */
export const CATEGORY_LABELS: Record<DocCategory, string> = {
  "getting-started": "Get started",
  concepts: "Concepts",
  guides: "Guides",
  api: "API reference",
  reference: "Reference",
};

/** Honey-emoji per category for the sidebar header. */
export const CATEGORY_EMOJI: Record<DocCategory, string> = {
  "getting-started": "🍡",
  concepts: "🧬",
  guides: "🎯",
  api: "🦀",
  reference: "📎",
};
