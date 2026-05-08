/**
 * probe-page.ts — locate the canonical probe-page fixture.
 *
 * The fixture lives at `<repo-root>/tests/fixtures/probe-page.html` (PLAN.md
 * §13.1). It's shared between `mochi capture` (this package) and the phase
 * 0.5 `@mochi.js/harness` runner; both walk up from cwd to find the repo
 * root the same way.
 *
 * @see tasks/0040-mochi-capture.md "Implementation notes — probe-page.ts"
 */

import { existsSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";

/** Absolute filesystem path to `tests/fixtures/probe-page.html`. */
export interface ProbePageLocation {
  readonly absolutePath: string;
  readonly fileUrl: string;
  readonly repoRoot: string;
}

/**
 * Walk up from `start` until a directory containing
 * `tests/fixtures/probe-page.html` is found. Returns the location, or
 * `null` if the fixture cannot be located within 32 levels.
 *
 * The walk anchors on the fixture itself rather than e.g. `package.json`
 * so a foreign caller cannot accidentally point us at the wrong fixture.
 */
export function findProbePage(start: string = process.cwd()): ProbePageLocation | null {
  let dir = start;
  if (!isAbsolute(dir)) dir = join(process.cwd(), dir);
  for (let i = 0; i < 32; i++) {
    const candidate = join(dir, "tests", "fixtures", "probe-page.html");
    if (existsSync(candidate)) {
      return {
        absolutePath: candidate,
        fileUrl: pathToFileUrl(candidate),
        repoRoot: dir,
      };
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
  return null;
}

/**
 * Convert an absolute POSIX/Windows path to a `file://` URL. Avoids the
 * Node `url.pathToFileURL` import to keep the capture module pure-Bun.
 */
export function pathToFileUrl(absolutePath: string): string {
  // Encode path components but keep `/` separators readable.
  const normalized = absolutePath.replace(/\\/g, "/");
  const encoded = normalized
    .split("/")
    .map((seg) => encodeURIComponent(seg).replace(/'/g, "%27"))
    .join("/");
  return normalized.startsWith("/") ? `file://${encoded}` : `file:///${encoded}`;
}

/**
 * Throwing variant of {@link findProbePage}. Consumers that expect the
 * fixture to exist in their cwd-to-root chain should use this.
 */
export function locateProbePage(start?: string): ProbePageLocation {
  const found = findProbePage(start);
  if (!found) {
    throw new Error(
      "[mochi capture] could not locate tests/fixtures/probe-page.html.\n" +
        "  Expected to find it walking up from cwd. Run from inside the mochi monorepo,\n" +
        "  or set MOCHI_PROBE_PAGE to the absolute path of probe-page.html.",
    );
  }
  return found;
}
