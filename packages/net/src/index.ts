/**
 * `@mochi.js/net` — out-of-band HTTP facade.
 *
 * Bridges to `@mochi.js/net-rs` (Rust + wreq cdylib) via Bun:FFI. Provides
 * `Session.fetch` semantics with the configured profile's TLS/H2 fingerprint.
 *
 * Phase 0.6: real FFI; v0.0.1 placeholder retired. See PLAN.md §10.
 *
 * ### Per-Session lifecycle
 *
 * 1. `Session.start()` (or first fetch) creates a `NetCtx` via {@link openCtx}.
 * 2. Each `Session.fetch(...)` reuses the Ctx; the underlying wreq Client
 *    pools connections internally.
 * 3. `Session.close()` calls `ctx.close()` which `mochi_net_close`s the Rust
 *    handle and drops the per-Ctx Tokio runtime. Idempotent.
 *
 * @see PLAN.md §5.4 / §10
 */

import { CString, type Pointer, ptr, read } from "bun:ffi";
import { loadLib, resolveDylibPath } from "./ffi";

export const VERSION = "0.0.1" as const;

// Re-export for power users / tests.
export { dylibCandidates, nativeAssetFileName, resolveDylibPath } from "./ffi";

/** Init shape accepted by {@link fetch}. Mirrors a subset of `RequestInit`. */
export interface NetFetchInit {
  readonly method?: string;
  readonly headers?: Record<string, string> | Headers;
  /** UTF-8 body; v0.6 does not support binary or streaming. */
  readonly body?: string | null;
  /** wreq preset name, e.g. `chrome_131_macos`. Required. */
  readonly preset: string;
  /** Optional outbound proxy URL. */
  readonly proxy?: string;
  /** Per-call connect timeout (ms). Default 10_000. */
  readonly connectTimeoutMs?: number;
  /** Per-call total timeout (ms). Default 30_000. */
  readonly timeoutMs?: number;
}

/** A live FFI handle to a per-Session Tokio runtime + wreq Client. */
export interface NetCtx {
  /** Opaque pointer; do not dereference from JS. */
  readonly handle: Pointer;
  /** Frees the underlying Rust resources. Idempotent. */
  close(): void;
}

/** Internal: read a heap-owned C string returned from the cdylib and free it. */
function readAndFreeCString(p: Pointer | null): string | null {
  if (p === null) return null;
  const s = new CString(p).toString();
  loadLib().symbols.mochi_net_string_free(p);
  return s;
}

/** Internal: pull and clear the thread-local last-error message. */
function lastError(): string {
  const p = loadLib().symbols.mochi_net_last_error();
  const s = readAndFreeCString(p as Pointer | null);
  return s ?? "(unknown error)";
}

/** Open a Ctx for a given preset (and optional proxy). */
export function openCtx(spec: { preset: string; proxy?: string }): NetCtx {
  const lib = loadLib();
  const json = JSON.stringify({
    preset: spec.preset,
    proxy: spec.proxy ?? null,
  });
  // bun:ffi `cstring` accepts a JS string and NUL-terminates it.
  const handle = lib.symbols.mochi_net_open(Buffer.from(`${json}\0`, "utf8"));
  if (handle === null || (handle as unknown as number) === 0) {
    throw new Error(`[mochi-net] mochi_net_open failed: ${lastError()}`);
  }
  let closed = false;
  return {
    handle: handle as Pointer,
    close(): void {
      if (closed) return;
      closed = true;
      lib.symbols.mochi_net_close(handle);
    },
  };
}

/** Coerce a `Headers` or plain record to a deterministic name→value object. */
function flattenHeaders(h: NetFetchInit["headers"]): Record<string, string> {
  if (h === undefined) return {};
  if (h instanceof Headers) {
    const out: Record<string, string> = {};
    h.forEach((v, k) => {
      out[k] = v;
    });
    return out;
  }
  return { ...h };
}

/**
 * Drive a single request through `mochi_net_request`, marshalling the
 * response into a standard Web `Response`. The Ctx is reused; the per-call
 * Rust response handle is freed eagerly once the body has been copied into
 * the `Response`.
 */
export function requestOnCtx(ctx: NetCtx, url: string, init: NetFetchInit): Response {
  const lib = loadLib();
  const requestJson = JSON.stringify({
    method: init.method ?? "GET",
    url,
    headers: flattenHeaders(init.headers),
    body: init.body ?? null,
  });
  const respPtr = lib.symbols.mochi_net_request(
    ctx.handle,
    Buffer.from(`${requestJson}\0`, "utf8"),
  );
  if (respPtr === null || (respPtr as unknown as number) === 0) {
    throw new Error(`[mochi-net] mochi_net_request failed: ${lastError()}`);
  }
  try {
    const status = lib.symbols.mochi_net_response_status(respPtr);
    if (status < 0) {
      throw new Error(`[mochi-net] response_status returned ${status}`);
    }
    const headersJsonPtr = lib.symbols.mochi_net_response_headers_json(respPtr);
    const headersJson = readAndFreeCString(headersJsonPtr as Pointer | null) ?? "{}";
    const headersObj: Record<string, string> = JSON.parse(headersJson) as Record<string, string>;

    // `mochi_net_response_body` writes len into a usize* slot. We allocate a
    // small Buffer for it.
    const lenBuf = new BigUint64Array(1);
    const lenPtr = ptr(lenBuf);
    const bodyPtr = lib.symbols.mochi_net_response_body(respPtr, lenPtr);
    const bodyLen = Number(lenBuf[0] ?? 0n);
    let bodyBytes: Uint8Array;
    if (bodyPtr === null || (bodyPtr as unknown as number) === 0 || bodyLen === 0) {
      bodyBytes = new Uint8Array(0);
    } else {
      // Copy the borrowed Rust slice into JS-owned memory, since the Rust
      // pointer becomes invalid after `mochi_net_response_free`.
      const view = new Uint8Array(bodyLen);
      for (let i = 0; i < bodyLen; i += 1) {
        view[i] = read.u8(bodyPtr as Pointer, i);
      }
      bodyBytes = view;
    }

    // Build a Web `Response`. Strip illegal headers (Headers ctor rejects
    // some e.g. `set-cookie` cluster — but standard Headers does accept it).
    const headers = new Headers();
    for (const [k, v] of Object.entries(headersObj)) {
      try {
        headers.append(k, v);
      } catch {
        // ignore unmappable header names rather than failing the whole call
      }
    }
    // Cast through ArrayBuffer for compat with TS lib.dom's BodyInit shape
    // (some TS versions reject Uint8Array<ArrayBufferLike>).
    const bodyForResponse: ArrayBuffer = bodyBytes.buffer.slice(
      bodyBytes.byteOffset,
      bodyBytes.byteOffset + bodyBytes.byteLength,
    ) as ArrayBuffer;
    return new Response(bodyForResponse, {
      status,
      headers,
    });
  } finally {
    lib.symbols.mochi_net_response_free(respPtr);
  }
}

/**
 * One-shot fetch convenience. Opens a Ctx, issues the request, closes the
 * Ctx. Useful for ad-hoc calls; for repeated calls under one Session, prefer
 * {@link openCtx} + {@link requestOnCtx} so the wreq client pool is reused.
 */
export async function fetch(url: string, init: NetFetchInit): Promise<Response> {
  const ctx = openCtx({
    preset: init.preset,
    ...(init.proxy !== undefined ? { proxy: init.proxy } : {}),
  });
  try {
    return requestOnCtx(ctx, url, init);
  } finally {
    ctx.close();
  }
}

/** Diagnostic — return the cdylib's own version string. */
export function nativeVersion(): string {
  const lib = loadLib();
  const p = lib.symbols.mochi_net_version();
  return readAndFreeCString(p as Pointer | null) ?? "";
}

/** Diagnostic — surface the resolved cdylib path (for error reports). */
export function nativeDylibPath(): string {
  return resolveDylibPath();
}
