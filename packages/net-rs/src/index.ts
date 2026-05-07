/**
 * @mochi.js/net-rs — Bun:FFI binding to the Rust+wreq cdylib.
 *
 * v0.0.1 claim release; real FFI loading + wreq integration lands in phase 0.6.
 *
 * @see PLAN.md §10
 */
export const VERSION = "0.0.1" as const;

/** Whether the native cdylib is built and loadable on this platform. */
export function available(): boolean {
  // Phase 0.6 will dlopen the cdylib and verify symbols.
  return false;
}
