/**
 * Recipe: Login flow with cookie persistence.
 *
 * Run 1: humanType the credentials, click submit, persist Session.cookies to
 * disk. Run 2: load the jar; if it's missing or stale (auth probe fails), fall
 * through to the interactive login. Concrete error handling for "stale jar"
 * via a try/catch on a post-load auth probe.
 *
 * @see https://mochijs.com/docs/guides/recipe-login-with-cookie-persistence
 */

import { existsSync } from "node:fs";
import { mochi } from "@mochi.js/core";

const JAR = process.env.COOKIE_JAR ?? "./state/example-cookies.json";
const APP_ORIGIN = process.env.APP_ORIGIN ?? "https://app.example.com";
const APP_EMAIL = process.env.APP_EMAIL ?? "me@example.com";
const APP_PASSWORD = process.env.APP_PASSWORD ?? "";

const session = await mochi.launch({
  profile: "mac-m4-chrome-stable",
  seed: "warm-account-001",
});

try {
  // Cookies BEFORE any navigation — Storage.setCookies works on the root
  // browser target, no tab needed. Cookie pattern is a RegExp, not a string.
  if (existsSync(JAR)) {
    try {
      await session.cookies.load(JAR, { pattern: /\.example\.com$/ });
      console.log("loaded cookie jar");
    } catch (err) {
      // cookies.load throws on missing-file / bad-version / bad-JSON. Treat
      // any failure as "stale jar; fall through to interactive login".
      console.warn(`cookie jar unusable (${String(err)}); will re-login`);
    }
  }

  const page = await session.newPage();
  await page.goto(`${APP_ORIGIN}/dashboard`);

  // Auth probe: if the jar replayed cleanly, we land on /dashboard. If it's
  // stale or missing, the server bounces us to /login. `page.url` is a
  // GETTER, no parens.
  if (page.url.includes("/login")) {
    console.log("running interactive login");
    await page.humanType("input[name=email]", APP_EMAIL);
    // Password fields rarely tolerate transient typos; pin mistakeRate to 0.
    await page.humanType("input[name=password]", APP_PASSWORD, { mistakeRate: 0 });
    await page.humanClick("button[type=submit]");
    await page.waitFor("[data-logged-in]", { state: "visible", timeout: 30_000 });

    // Persist the freshly-issued cookies for next time. Same pattern on save
    // and load — mismatched patterns leak cookies from outside the scope.
    await session.cookies.save(JAR, { pattern: /\.example\.com$/ });
    console.log(`saved cookie jar to ${JAR}`);
  } else {
    console.log("logged in via cookie jar — skipped interactive flow");
  }

  // Authenticated work — read the greeting, dump the dashboard HTML.
  const greeting = await page.text("[data-testid=user-greeting]");
  console.log("greeting:", greeting);
  await Bun.write("./out/dashboard.html", await page.content());
} finally {
  await session.close();
}
