/**
 * Shared error types for `@mochi.js/core`. Centralized so internal modules can
 * import without going through the public index barrel.
 */

import { VERSION } from "./version";

/**
 * Thrown when a public API surface is declared by the v1 contract but not yet
 * implemented in the current phase. Always names the target API so callers can
 * grep for the milestone in PLAN.md.
 */
export class NotImplementedError extends Error {
  readonly api: string;
  constructor(api: string) {
    super(
      `${api} is not yet implemented. mochi is at v${VERSION}. ` +
        "See PLAN.md §14 (Implementation phases) for the roadmap.",
    );
    this.name = "NotImplementedError";
    this.api = api;
  }
}
