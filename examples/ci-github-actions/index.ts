/**
 * Recipe: GitHub Actions / CI runner.
 *
 * The workflow file at `.github/workflows/example.yml` is the actual example
 * — Bun setup, browser cache, apt deps, headless defaults. This script is a
 * one-liner the workflow runs to prove the install works end-to-end.
 *
 * @see https://mochijs.com/docs/guides/recipe-ci-github-actions
 */

import { mochi } from "@mochi.js/core";

const env = mochi.detectLinuxServerEnv();
console.log(`[mochi] linux-server probe: ${env.rationale}`);
// On ubuntu-latest you'll see: serverNoDisplay=true, root=false, container=false.

const session = await mochi.launch({
  profile: "linux-chrome-stable",
  seed: process.env.GITHUB_RUN_ID ?? "ci-default",
  // headlessMode auto-resolves to "new" because DISPLAY is unset on the
  // runner. Pinning explicitly so the behavior is unambiguous.
  headlessMode: "new",
  ...(process.env.PROXY_URL !== undefined ? { proxy: process.env.PROXY_URL } : {}),
});

try {
  const page = await session.newPage();
  await page.goto("https://example.com/", { waitUntil: "domcontentloaded" });
  const title = await page.text("title");
  console.log(`title: ${title}`);
  await Bun.write("./out/page.html", await page.content());
} finally {
  await session.close();
}
