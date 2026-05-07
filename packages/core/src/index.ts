/**
 * @mochi.js/core — the Bun-native browser automation framework.
 *
 * This is a v0.0.1 claim release. The full surface — `mochi.launch()`, `Session`,
 * `Page`, `humanClick`, `humanType`, `humanScroll` — lands incrementally per
 * the implementation phases in PLAN.md (phase 0.1 → 1.0).
 *
 * @see https://github.com/0xchasercat/mochi
 */

export const VERSION = "0.0.1" as const;

export class NotImplementedError extends Error {
  constructor(public readonly api: string) {
    super(
      `${api} is not yet implemented. mochi is at v${VERSION} (claim release). ` +
        `See https://github.com/0xchasercat/mochi for the implementation roadmap.`,
    );
    this.name = "NotImplementedError";
  }
}

/**
 * The mochi namespace. v0.0.1 placeholder; real surface lands in phase 0.1.
 */
export const mochi = {
  /** Framework version. */
  version: VERSION,

  /**
   * Launch a browser session. Lands in phase 0.1.
   *
   * @example
   * ```ts
   * import { mochi } from "@mochi.js/core";
   * const session = await mochi.launch({ profile: "mac-m2-chrome-stable", seed: "user-1" });
   * ```
   */
  launch(_opts?: unknown): never {
    throw new NotImplementedError("mochi.launch");
  },
} as const;

export type Mochi = typeof mochi;
