# 0060: network FFI — `@mochi.js/net-rs` + `@mochi.js/net`

**Package:** `net-rs` (Rust crate) + `net` (TS facade) + a tiny `core` wiring
**Phase:** `0.6`
**Estimated size:** XL
**Dependencies:** 0001, 0011 (Session class exists)

## Goal

Implement the Bun-native FFI bridge to Rust+wreq per PLAN.md §10. After this lands, `Session.fetch(url, init)` issues out-of-band HTTP requests with the configured profile's TLS/H2/HTTP fingerprint via wreq, returning a standard Web `Response`.

The browser handles its own navigation/XHR/fetch using its native Chromium TLS — that already matches a Chrome profile. `@mochi.js/net` is for **additional requests** the user makes from Bun (pre-flight token fetches, captcha API calls, auxiliary requests) that need to share the browser's apparent identity.

## Success criteria

### Rust crate (`packages/net-rs/`)

- [ ] `Cargo.toml` adds `wreq = { version = "<latest stable>", default-features = true }` (Apache-2.0/MIT — verify license at the version pin).
- [ ] `src/lib.rs` exposes the C ABI per PLAN.md §10.1:
  ```c
  mochi_net_open(preset_json: *const c_char) -> *mut mochi_net_ctx
  mochi_net_request(ctx, request_json) -> *mut mochi_net_response  /* response handle */
  mochi_net_response_status(res) -> i32
  mochi_net_response_headers_json(res) -> *mut c_char  /* heap-owned, free with mochi_net_string_free */
  mochi_net_response_body(res, *out_len: *mut usize) -> *const u8
  mochi_net_response_free(res)
  mochi_net_close(ctx)
  mochi_net_last_error() -> *mut c_char  /* heap-owned, thread-local */
  mochi_net_string_free(ptr) -> void  /* exists from v0.0.1; keep */
  ```
- [ ] `preset_json` shape: `{"preset": "chrome_131_macos", "proxy": "http://..." | null}`. Translates `preset` to `wreq::Impersonate` enum value via a small lookup table; falls back to `Impersonate::Chrome` if unknown (with a `last_error` warning the caller can read).
- [ ] `request_json` shape: `{"method": "GET", "url": "https://...", "headers": {"k": "v", ...}, "body": "..." | null}`. `body` is a UTF-8 string at v0.6; binary bodies / streams deferred.
- [ ] One Tokio runtime per `Ctx` (single-threaded, multi-task). The runtime lives for the Ctx's lifetime. `mochi_net_close` shuts it down cleanly.
- [ ] `mochi_net_request` blocks the calling thread on the runtime's `block_on`. Bun:FFI calls FFI functions on a worker thread (per Bun's docs) so this doesn't block Bun's main event loop.
- [ ] All error paths populate `mochi_net_last_error` (thread-local `RefCell<Option<CString>>`) before returning a null/error sentinel.
- [ ] `cargo build --release --manifest-path packages/net-rs/Cargo.toml` produces a cdylib at `packages/net-rs/target/release/{libmochi_net.dylib,.so,.dll}` depending on platform.
- [ ] `cargo test --manifest-path packages/net-rs/Cargo.toml` runs 8+ Rust unit tests covering: ctx lifecycle, preset translation, request encoding, response handle lifecycle, error propagation, null-pointer safety, string-free idempotency, multi-request reuse.
- [ ] No `unsafe` blocks beyond the FFI boundary itself. Inside-Rust code is safe.

### TS facade (`packages/net/`)

- [ ] `packages/net/src/ffi.ts` — `bun:ffi` binding loading the cdylib from `packages/net-rs/target/release/`. Resolution order: `MOCHI_NET_DYLIB` env override > computed path. Errors clearly when the dylib isn't built.
- [ ] `packages/net/src/index.ts` — `export async function fetch(url: string, init: NetFetchInit & { preset: string; proxy?: string }): Promise<Response>`. Returns a standard Web `Response` object so consumers can `await res.json()` etc.
- [ ] Per-call: marshal `request_json` → call `mochi_net_request` → unmarshal status + headers + body → construct `Response`. Free the response handle on `Response.body` consumption (or eagerly, since body is fully buffered at v0.6).
- [ ] `Ctx` lifecycle: one Ctx per `Session`. Created on `Session.start()`, closed on `Session.close()`. Reuses for multiple `fetch` calls.
- [ ] Unit tests with a fake/stub FFI (Bun lets you mock dlopen via test scaffolding, OR use a separate `__tests__/internal.test.ts` that calls the binding directly against the real built cdylib gated on `MOCHI_NET_E2E=1`).

### `@mochi.js/core` integration

- [ ] `Session.fetch(url, init)` (currently `NotImplementedError`) is wired:
  1. Resolve preset from `session.profile.wreqPreset`.
  2. Resolve proxy from `LaunchOptions.proxy` (already accepted).
  3. Lazy-create a per-Session `NetCtx` on first fetch; reuse for subsequent.
  4. Forward to `@mochi.js/net.fetch(url, { ...init, preset, proxy })`.
  5. Close the `NetCtx` on `Session.close`.
- [ ] `@mochi.js/core`'s package.json adds `@mochi.js/net: workspace:*` as runtime dep (was type-only).
- [ ] `Session.fetch` is a public API surface from PLAN.md §7; signature must match exactly.

### Tests

- [ ] **`MOCHI_NET_E2E` gated**: `tests/contract/net-ja4.contract.test.ts` — drives `Session.fetch("https://tls.peet.ws/api/all")`, asserts the response JSON's `tls.ja4` field matches the expected value for the configured wreq preset (e.g., `chrome_131_macos` → known JA4 hash; pin in fixture). This is THE phase 0.6 gate.
- [ ] Unit + contract tests: 20+ cases covering ctx lifecycle, error paths, preset coverage, header round-trip, body handling, proxy support.
- [ ] Existing CDP forbidden-method assertions continue to hold (sanity).
- [ ] All other gates green.

### Deferred

- [ ] Prebuilt platform binaries (darwin-arm64/x64, linux-x64/arm64, windows-x64) → phase 0.10. v0.6 requires `cargo build` locally before running.
- [ ] HTTP/3 / QUIC support → later phase.
- [ ] Streaming bodies → later phase.
- [ ] Per-request fingerprint override → later (always uses session's profile preset).
- [ ] Connection pooling beyond what wreq does internally → wreq's defaults.

## Out of scope

- Replacing the browser's own TLS (PLAN.md §10.4 — that's not what this is for).
- Hiding the local proxy (we don't run one; this is direct out-of-band fetch).
- Per-request mTLS / client-cert configuration.
- WebSocket upgrade via the FFI layer.
- Header-order preservation beyond what wreq exposes (caveat: wreq does preserve order for impersonated profiles, but custom headers are appended).

## Implementation notes

- For `wreq`: pin to a specific minor (e.g. `0.51.x`) and document. The crate's API is currently fluid; pinning prevents surprise breakage.
- For Bun:FFI: `dlopen` with the symbol map. Use `cstring` for C-string args, `ptr` for handle types, `i32` for status, `usize` for length-out params.
- For the Tokio runtime: `tokio::runtime::Builder::new_current_thread().enable_all().build()`. One per Ctx. Don't share runtimes across Ctxs.
- For thread-local last_error: `thread_local! { static LAST: RefCell<Option<CString>> = ... }`.
- For tests on macOS: `dyld` may not load `.dylib` from arbitrary paths without `DYLD_LIBRARY_PATH`. Resolution: ship a small `loadDylib(absolutePath)` helper that handles the `dlopen` quirks per platform. Documented inline.
- For the JA4 E2E: `tls.peet.ws` returns `{ja3, ja4, ja4_r, ...}`. Pin to `ja4_r` (the raw, repeatable form) for stability across wreq versions. Fixture pins the value for the chosen preset.
- For the Cargo workspace: `Cargo.toml` at repo root already lists `packages/net-rs` as a member (from 0001). Just update `packages/net-rs/Cargo.toml` to add deps.
- File layout under `packages/net-rs/src/`:
  - `lib.rs` — top-level FFI exports
  - `ffi/{ctx,request,response,error,preset}.rs` — one module per concern
  - `tests.rs` — `#[cfg(test)]` integration

## Validation

```sh
# Rust side
cargo build --release --manifest-path packages/net-rs/Cargo.toml
cargo test --manifest-path packages/net-rs/Cargo.toml

# TS side
bun typecheck
bun lint
bun test
bun test:contract --pkg=net

# E2E (the gate; requires network):
MOCHI_NET_E2E=1 bun test tests/contract/net-ja4.contract.test.ts
```

When everything's green: `bun work submit 0060 --draft`.

## Touch list (rough)

- `packages/net-rs/Cargo.toml` (add wreq dep + tokio)
- `packages/net-rs/src/lib.rs` + `ffi/{ctx,request,response,error,preset}.rs` (new)
- `packages/net-rs/src/tests.rs` (Rust unit/integration tests)
- `packages/net/src/ffi.ts` (new — Bun:FFI binding)
- `packages/net/src/index.ts` (replace placeholder with real fetch)
- `packages/net/src/__tests__/*.test.ts`
- `packages/net/package.json` (depends on `@mochi.js/net-rs: workspace:*`)
- `packages/core/src/session.ts` (wire `fetch`)
- `packages/core/package.json` (depends on `@mochi.js/net: workspace:*`)
- `tests/contract/net-ja4.contract.test.ts` (new — gated E2E)
- `.changeset/net-ffi.md` (new)
- `docs/limits.md` (note: prebuilt binaries phase 0.10, h3/quic deferred, etc.)
