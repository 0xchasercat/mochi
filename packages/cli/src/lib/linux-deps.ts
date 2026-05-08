/**
 * linux-deps.ts — single source of truth for the Chromium-for-Testing
 * apt runtime dependency list on Linux.
 *
 * Why this exists
 * ---------------
 * Chromium-for-Testing ships only the binary (no `.deb` dep tree). On a fresh
 * Ubuntu / Debian box without these libs the binary spawns then immediately
 * dies with `error while loading shared libraries: <name>.so` on stderr,
 * surfacing through mochi as a `BrowserCrashedError` / `EPIPE` with no clue
 * what's actually missing. Two consecutive first-time-user reports during
 * v0.1.2 testing hit this. Task 0259.
 *
 * The list below MUST stay in lockstep with the apt invocation in
 * `.github/workflows/pr-fast.yml` and `.github/workflows/release.yml` — both
 * CI workflows run on bare `ubuntu-latest` and need the same dep set to
 * launch Chromium for the conformance gates. A contract test
 * (`tests/contract/cli-linux-deps.contract.test.ts`) diffs the workflows
 * against this constant on every PR so drift is caught at the gate.
 *
 * Source: derived from Playwright's `install-deps` for chromium on Ubuntu;
 * verified against CfT v131 + v148 on ubuntu-22.04 + ubuntu-24.04
 * (libasound2 → libasound2t64 transition between 22.04 → 24.04 is captured
 * by including the t64 variant — apt resolves it on either release).
 *
 * @see tasks/0259-linux-first-run-experience.md
 */

/**
 * Canonical Chromium-for-Testing runtime dep list. Order matches the apt
 * invocation in the CI workflows so the diff in the contract test is
 * trivial. Do not sort — order is part of the contract.
 */
export const LINUX_RUNTIME_DEPS: readonly string[] = [
  "ca-certificates",
  "fonts-liberation",
  "libasound2t64",
  "libatk-bridge2.0-0",
  "libatk1.0-0",
  "libcairo2",
  "libcups2",
  "libdbus-1-3",
  "libexpat1",
  "libfontconfig1",
  "libgbm1",
  "libglib2.0-0",
  "libgtk-3-0",
  "libnspr4",
  "libnss3",
  "libpango-1.0-0",
  "libpangocairo-1.0-0",
  "libx11-6",
  "libx11-xcb1",
  "libxcb1",
  "libxcomposite1",
  "libxcursor1",
  "libxdamage1",
  "libxext6",
  "libxfixes3",
  "libxi6",
  "libxrandr2",
  "libxrender1",
  "libxss1",
  "libxtst6",
  "xdg-utils",
];

/**
 * The verbatim apt install line we surface to the user. Kept as a single
 * formatted string (not a function) so error messages, docs, and the contract
 * test can all reference the exact same bytes.
 */
export const LINUX_RUNTIME_DEPS_APT_LINE: string = [
  "sudo apt-get update -qq && sudo apt-get install -y --no-install-recommends",
  ...LINUX_RUNTIME_DEPS,
].join(" \\\n  ");

/**
 * The canonical "missing shared library" error tail Chromium emits when one
 * of `LINUX_RUNTIME_DEPS` is absent. Kept as a regex constant so both the
 * post-install smoke (in `cli/browsers/install.ts`) and the early-exit
 * diagnostic (in `core/proc.ts`) match the same shape.
 *
 * Sample stderr line:
 *   `chrome: error while loading shared libraries: libnss3.so: cannot open shared object file: No such file or directory`
 *
 * The capture group extracts the offending `.so` name so callers can
 * surface it in the human-readable error.
 */
export const MISSING_SHARED_LIB_RE = /error while loading shared libraries:\s+([^\s:]+)/i;

/**
 * Build the canonical user-facing error block for a missing-shared-library
 * stderr tail. Used by the post-install binary smoke and by the proc.ts
 * early-exit diagnostic so both surfaces emit the same remediation text —
 * the user can paste any sentence into a search engine and find the docs
 * section we cross-link from.
 *
 * @param missingLib — the `.so` name extracted from stderr, or null if the
 *                    regex did not match a specific lib (we still print the
 *                    full apt line for safety).
 */
export function formatMissingLibHint(missingLib: string | null): string {
  const header =
    missingLib !== null
      ? `Chromium failed to start: missing shared library '${missingLib}'.`
      : "Chromium failed to start: missing shared libraries.";
  return [
    "",
    header,
    "Chromium-for-Testing ships only the binary; on a fresh Linux server the",
    "system libs Chromium links against are not preinstalled. Install them:",
    "",
    `  ${LINUX_RUNTIME_DEPS_APT_LINE}`,
    "",
    "See https://mochijs.com/docs/getting-started/install#linux-runtime-dependencies",
  ].join("\n");
}
