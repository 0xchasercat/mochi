/**
 * @mochi.js/net — out-of-band HTTP facade.
 *
 * Bridges to @mochi.js/net-rs (Rust+wreq cdylib) via Bun:FFI. Provides
 * `Session.fetch` semantics with the configured profile's TLS/H2 fingerprint.
 *
 * v0.0.1 claim release; FFI lands in phase 0.6.
 *
 * @see PLAN.md §5.4 and §10
 */
export const VERSION = "0.0.1" as const;

export interface NetFetchInit {
  readonly method?: string;
  readonly headers?: Record<string, string>;
  readonly body?: string | Uint8Array;
}

/**
 * Profile-fingerprinted fetch. Lands in phase 0.6.
 */
export async function fetch(_url: string, _init?: NetFetchInit): Promise<Response> {
  throw new Error(
    "@mochi.js/net.fetch is not yet implemented (v0.0.1 claim). " +
      "Lands in phase 0.6; see PLAN.md §10.",
  );
}
