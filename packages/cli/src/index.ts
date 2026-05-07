/**
 * @mochi.js/cli — programmatic CLI surface (also exposed as the `mochi` binary).
 *
 * v0.0.1 claim release; subcommands land progressively (phase 0.4: capture; 0.5: harness;
 * 0.0+: work; 0.11: browsers install).
 *
 * @see PLAN.md §5.8
 */
export const VERSION = "0.0.1" as const;

export const SUBCOMMANDS = ["browsers", "capture", "harness", "work", "version"] as const;
export type Subcommand = (typeof SUBCOMMANDS)[number];

export async function main(_argv: readonly string[]): Promise<number> {
  // Minimal placeholder so `mochi version` works at v0.0.1.
  const arg = _argv[0];
  if (arg === "version" || arg === "--version" || arg === "-v") {
    console.log(`mochi v${VERSION}`);
    return 0;
  }
  console.error(
    `mochi v${VERSION} (claim release)\n` +
      `subcommands not yet implemented; see https://github.com/0xchasercat/mochi`,
  );
  return 1;
}
