/**
 * Single-source-of-truth site config — version, repo, brand strings.
 *
 * Bump `VERSION` when @mochi.js/core publishes; the docs site reads it
 * from here for the nav chip + landing footer + (anywhere else that wants
 * to display the current release).
 *
 * The audit found the nav chip and the footer disagreed (TopNav said
 * 0.8.0, Footer said 0.1.2). Single export prevents drift.
 */

/** Latest @mochi.js/core release. Sync on every Version PR merge. */
export const VERSION = "0.9.3";

/** Public site URL. */
export const SITE_URL = "https://mochijs.com";

/** Public GitHub URL (org/repo). */
export const GITHUB_URL = "https://github.com/0xchasercat/mochi";

/** Default OG/Twitter image. The mochi mascot is used as a temporary
 * fallback (320×320 — works on Twitter as `summary` card, sub-optimal as
 * the `summary_large_image` card we declare in BaseLayout). Replace with
 * a proper 1200×630 og.png whenever someone has cycles to design one;
 * BaseLayout.astro picks up whichever path lives here. */
export const DEFAULT_OG_IMAGE = "/mochi-mascot.png";

/** Brand description used as the &lt;meta name="description"&gt; default. */
export const SITE_DESCRIPTION =
  "Bun-native, raw-CDP browser automation. Relational fingerprint locking, JIT-installed spoofing, Chromium-native fetch. Leaves no crumbs.";
