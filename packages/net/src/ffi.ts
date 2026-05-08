/**
 * Bun:FFI binding to the `@mochi.js/net-rs` cdylib (Rust + wreq).
 *
 * Resolution order for the dylib path (PLAN.md §14 phase 0.10,
 * tasks/0100):
 *   1. `process.env.MOCHI_NET_DYLIB` — explicit override (tests + power
 *      users).
 *   2. `<net-rs>/native/mochi_net-${platform}.${ext}` — the path the
 *      `@mochi.js/net-rs` postinstall script downloads to. Filename uses
 *      a platform suffix (e.g. `mochi_net-darwin-arm64.dylib`,
 *      `mochi_net-win32-x64.dll`) to match the per-platform build matrix
 *      assets on GH Releases. Note: no `lib` prefix — Cargo emits
 *      `mochi_net.dll` on Windows (no `lib`), and we keep the same root
 *      across all platforms for consistency.
 *   3. `<workspace>/target/release/libmochi_net.<suffix>` — Cargo
 *      workspace target (developer cargo build).
 *   4. `<net-rs>/target/release/libmochi_net.<suffix>` — non-workspace
 *      target (fallback if Cargo workspace settings change).
 *   5. Debug counterparts of (3) and (4) for `cargo build` (no
 *      --release).
 *
 * On consumer machines (npm-installed), step 2 wins. On dev machines
 * with a fresh `cargo build --release ...`, step 3 wins. Either way the
 * loader Just Works without env config.
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
 * Resolve the platform-suffixed filename used by the postinstall asset
 * matrix (e.g. `mochi_net-darwin-arm64.dylib`). Returns `null` for
 * unsupported tuples — callers fall through to the cargo-target paths.
 */
export function nativeAssetFileName(
  nodePlatform: NodeJS.Platform = process.platform,
  nodeArch: string = process.arch,
): string | null {
  if (nodePlatform === "darwin" && nodeArch === "arm64") return "mochi_net-darwin-arm64.dylib";
  if (nodePlatform === "darwin" && nodeArch === "x64") return "mochi_net-darwin-x64.dylib";
  if (nodePlatform === "linux" && nodeArch === "x64") return "mochi_net-linux-x64.so";
  if (nodePlatform === "linux" && nodeArch === "arm64") return "mochi_net-linux-arm64.so";
  if (nodePlatform === "win32" && nodeArch === "x64") return "mochi_net-win32-x64.dll";
  return null;
}

/**
 * Compute the candidate filesystem locations the cdylib may live at, in
 * preference order. See file-level docstring for the full ordering.
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

  // (2) The postinstall-downloaded native asset, if available for this
  // (platform, arch). This is the production path on consumer machines.
  const nativeFile = nativeAssetFileName();
  if (nativeFile !== null) {
    candidates.push(resolve(netRsRoot, "native", nativeFile));
  }

  // (3) + (4) Cargo developer build — release first, then debug.
  const cargoFileName = `libmochi_net.${suffix}`;
  candidates.push(resolve(workspaceRoot, "target/release", cargoFileName));
  candidates.push(resolve(netRsRoot, "target/release", cargoFileName));
  candidates.push(resolve(workspaceRoot, "target/debug", cargoFileName));
  candidates.push(resolve(netRsRoot, "target/debug", cargoFileName));

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
    `[mochi-net] no @mochi.js/net-rs binary found for ${process.platform}-${process.arch}. ` +
      `Looked at:\n${candidates.map((c) => `  - ${c}`).join("\n")}\n` +
      "Either: (a) verify your platform is supported (darwin-arm64, darwin-x64, " +
      "linux-x64, linux-arm64, win32-x64), (b) build from source with " +
      "`cargo build --release --manifest-path packages/net-rs/Cargo.toml`, or " +
      "(c) set MOCHI_NET_DYLIB=/abs/path/to/libmochi_net." +
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
