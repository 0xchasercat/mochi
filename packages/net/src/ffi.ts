/**
 * Bun:FFI binding to the `@mochi.js/net-rs` cdylib (Rust + wreq).
 *
 * Resolution order for the dylib path:
 *   1. `process.env.MOCHI_NET_DYLIB` — explicit override (used by tests &
 *      power users).
 *   2. `<workspace>/target/release/libmochi_net.<suffix>` — Cargo workspace
 *      target (the path Cargo actually emits to in our workspace).
 *   3. `<net-rs>/target/release/libmochi_net.<suffix>` — non-workspace target
 *      (fallback in case Cargo workspace settings change in future).
 *
 * Phase 0.6 requires running `cargo build --release --manifest-path
 * packages/net-rs/Cargo.toml` locally before the binding loads. Prebuilt
 * platform binaries are deferred to phase 0.10 (PLAN.md §14).
 *
 * @see PLAN.md §10
 */

import { dlopen, suffix } from "bun:ffi";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/** Suffix of the platform's dynamic library: `dylib` / `so` / `dll`. */
export const DYLIB_SUFFIX = suffix;

/**
 * Compute the candidate filesystem locations the cdylib may live at, in
 * preference order.
 */
export function dylibCandidates(): string[] {
  const candidates: string[] = [];

  const envOverride = process.env.MOCHI_NET_DYLIB;
  if (envOverride !== undefined && envOverride.length > 0) {
    candidates.push(envOverride);
  }

  // packages/net/src/ → ../../.. = workspace root
  const workspaceRoot = resolve(__dirname, "../../..");
  // packages/net/src/ → ../../net-rs = sibling crate dir
  const netRsRoot = resolve(__dirname, "../../net-rs");

  const fileName = `libmochi_net.${suffix}`;
  candidates.push(resolve(workspaceRoot, "target/release", fileName));
  candidates.push(resolve(netRsRoot, "target/release", fileName));
  candidates.push(resolve(workspaceRoot, "target/debug", fileName));
  candidates.push(resolve(netRsRoot, "target/debug", fileName));

  return candidates;
}

/**
 * Resolve the dylib path. Throws a helpful error naming the build command if
 * none of the candidates exist on disk.
 */
export function resolveDylibPath(): string {
  const candidates = dylibCandidates();
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  throw new Error(
    `[mochi-net] cdylib not found. Looked at:\n${candidates.map((c) => `  - ${c}`).join("\n")}\n` +
      "Build it with `cargo build --release --manifest-path packages/net-rs/Cargo.toml`. " +
      "Alternatively set MOCHI_NET_DYLIB=/abs/path/to/libmochi_net." +
      DYLIB_SUFFIX,
  );
}

/** The `bun:ffi` symbol map matching `packages/net-rs/src/lib.rs`. */
export const symbolMap = {
  mochi_net_open: { args: ["cstring"], returns: "ptr" },
  mochi_net_close: { args: ["ptr"], returns: "void" },
  mochi_net_request: { args: ["ptr", "cstring"], returns: "ptr" },
  mochi_net_response_status: { args: ["ptr"], returns: "i32" },
  mochi_net_response_headers_json: { args: ["ptr"], returns: "ptr" },
  mochi_net_response_body: { args: ["ptr", "ptr"], returns: "ptr" },
  mochi_net_response_free: { args: ["ptr"], returns: "void" },
  mochi_net_last_error: { args: [], returns: "ptr" },
  mochi_net_string_free: { args: ["ptr"], returns: "void" },
  mochi_net_version: { args: [], returns: "ptr" },
} as const;

/** The dlopen handle exposing the symbol map. */
export type NetLib = ReturnType<typeof dlopen<typeof symbolMap>>;

let _lib: NetLib | undefined;

/**
 * Lazily dlopen the cdylib once. Subsequent calls return the cached handle.
 */
export function loadLib(): NetLib {
  if (_lib === undefined) {
    const path = resolveDylibPath();
    _lib = dlopen(path, symbolMap);
  }
  return _lib;
}

/**
 * Reset the cached dlopen handle. Test-only — production code never needs
 * this. Used so a test can swap `MOCHI_NET_DYLIB` between runs.
 *
 * @internal
 */
export function _resetForTest(): void {
  _lib = undefined;
}
