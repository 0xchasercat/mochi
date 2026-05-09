---
title: Network FFI
description: How session.fetch routes through Bun:FFI to Rust + wreq for JA4-coherent out-of-band HTTP — the C ABI, the NetCtx lifecycle, the prebuilt cdylibs.
order: 6
category: concepts
lastUpdated: 2026-05-09
---

`Session.fetch(url, init?)` is the only out-of-band HTTP path mochi guarantees is JA4-coherent with the spoofed Chrome profile. It routes through Bun:FFI → a thin Rust crate (`@mochi.js/net-rs`) → [`wreq`](https://github.com/0x676e67/wreq), an HTTP impersonation library that ships per-Chrome-version TLS / H2 fingerprint presets.

This page documents the wire (the C ABI between the crate and Bun:FFI), the lifecycle (per-Session `NetCtx`), and the prebuilt cdylib targets. The conceptual *why* — what JA4 measures, why a runtime's stock TLS stack reveals a spoofed Chrome — lives on [JA4 coherence](/docs/concepts/ja4-coherence). PLAN.md §10.

## Why JA4 coherence is the network-layer thesis

Out-of-band fetches from your script — REST APIs, telemetry endpoints, GraphQL backends — are a separate fingerprint surface from the browser's own navigation. The browser uses Chromium's native TLS, which already produces correct Chrome JA3/JA4. Your script's `fetch` does not. Whatever runtime you're on (Node, Bun, Python `requests`) ships with its own TLS stack — OpenSSL on Node and Bun, `urllib3` over OpenSSL on Python, Go's `crypto/tls` on Go — and each of those produces its own JA4. A target that compares the JA4 from the page navigation against the JA4 from a subsequent `/api/me` call sees two different clients.

mochi closes this leak with `wreq`, a Rust HTTP client whose explicit purpose is to reproduce Chrome's TLS ClientHello, ALPN order, H2 SETTINGS, and HEADERS frame ordering byte-for-byte against a `wreq::Impersonate::Chrome131` (etc.) preset. The `wreqPreset` field on `MatrixV1` (`chrome_131_macos`, `chrome_131_windows`, …) is the bridge — derived per profile + Chrome version, consumed by `wreq` to produce the matching wire bytes.

What we explicitly *do not* do:

- **MITM the browser's own connections.** Browser navigation uses Chromium's native TLS, which already matches a real Chrome. Replacing it would require either patching Chromium ([invariant I-1](/docs/concepts/stealth-philosophy) forbids it) or running a local proxy that becomes its own leak vector.
- **Implement a separate `wreq`-driven page navigator.** The browser is the browser. `Session.fetch` is the orthogonal *out-of-band* path; `Page.goto` is the in-browser path.

## The C ABI

The Rust crate exposes a stable C ABI. Breaking changes bump `@mochi.js/net-rs` major; the JS facade (`@mochi.js/net`) tracks the major.

```c
// packages/net-rs/include/mochi-net.h (sketch)
typedef struct mochi_net_ctx mochi_net_ctx;
typedef struct mochi_net_response mochi_net_response;

mochi_net_ctx*  mochi_net_open(const char* preset_json);
int             mochi_net_request(mochi_net_ctx* ctx,
                                  const char* request_json,
                                  mochi_net_response** out);
int             mochi_net_response_status(mochi_net_response* res);
const char*     mochi_net_response_headers_json(mochi_net_response* res);
const uint8_t*  mochi_net_response_body(mochi_net_response* res, size_t* out_len);
void            mochi_net_response_free(mochi_net_response* res);
void            mochi_net_close(mochi_net_ctx* ctx);
const char*     mochi_net_last_error(void);
const char*     mochi_net_version(void);
void            mochi_net_string_free(const char* p);
```

`preset_json` and `request_json` are NUL-terminated UTF-8 JSON. Returned strings are heap-owned by the Rust crate and freed by `mochi_net_string_free`. Returned response bodies are borrowed slices valid until `mochi_net_response_free` runs.

JSON shapes:

```jsonc
// preset_json — passed to mochi_net_open
{ "preset": "chrome_131_macos", "proxy": "http://user:pass@host:port" }

// request_json — passed to mochi_net_request
{ "method": "GET", "url": "https://example.com/api", "headers": { "Accept": "application/json" }, "body": null }

// response headers (as returned by mochi_net_response_headers_json)
{ "content-type": "application/json", "x-cf-ray": "..." }
```

## The Bun:FFI binding

```ts
// packages/net/src/ffi.ts (sketch)
import { dlopen, FFIType, suffix } from "bun:ffi";

const lib = dlopen(`${nativeDir}/mochi-net.${suffix}`, {
  mochi_net_open:                 { args: ["cstring"], returns: "ptr" },
  mochi_net_request:              { args: ["ptr", "cstring", "ptr"], returns: "i32" },
  mochi_net_response_status:      { args: ["ptr"], returns: "i32" },
  mochi_net_response_headers_json:{ args: ["ptr"], returns: "cstring" },
  mochi_net_response_body:        { args: ["ptr", "ptr"], returns: "ptr" },
  mochi_net_response_free:        { args: ["ptr"], returns: "void" },
  mochi_net_close:                { args: ["ptr"], returns: "void" },
  mochi_net_last_error:           { args: [], returns: "cstring" },
  mochi_net_version:              { args: [], returns: "cstring" },
  mochi_net_string_free:          { args: ["ptr"], returns: "void" },
});
```

Bun:FFI binds directly to the same `.dylib` / `.so` / `.dll` that `cargo build --release` produces. There is no Neon, no napi-rs, no node-addon-api — one of the load-bearing reasons mochi is Bun-only ([invariant I-3](/docs/concepts/stealth-philosophy)).

## Public TS surface

```ts
import { openCtx, requestOnCtx, fetch as netFetch, nativeVersion, nativeDylibPath } from "@mochi.js/net";

// Open a Ctx (one Tokio runtime + wreq Client). Reuse for multiple calls.
const ctx = openCtx({ preset: "chrome_131_macos", proxy: "http://user:pass@host:port" });

const res = await requestOnCtx(ctx, "https://api.example.com/v1/me", {
  preset: "chrome_131_macos",  // required
  method: "GET",
  headers: { Authorization: "Bearer ..." },
});
console.log(res.status, await res.text());

ctx.close();  // idempotent
```

The standard path through `Session` is `await session.fetch(url, init)` — `Session` lazily opens a `NetCtx` on first call and closes it on `Session.close`. The wreq Client inside the cdylib pools connections internally, so back-to-back `session.fetch` calls reuse the same TCP+TLS session.

`fetch(url, init)` is a one-shot convenience: opens a Ctx, issues the request, closes the Ctx. Useful for ad-hoc calls; for repeated calls under one session, prefer `openCtx` + `requestOnCtx`.

## NetCtx lifecycle

```
Session constructor
   │
   ├─ session.fetch(url, init) — first call
   │     │
   │     ├─ openCtx({ preset: matrix.wreqPreset, proxy? })
   │     │     │
   │     │     └─ mochi_net_open(presetJson) → Tokio runtime + wreq Client
   │     │
   │     └─ requestOnCtx(ctx, url, init) → Response
   │
   ├─ session.fetch(url, init) — subsequent calls
   │     │
   │     └─ requestOnCtx(reused ctx, ...)  // wreq Client pools the TCP+TLS session
   │
   └─ session.close()
        │
        └─ ctx.close() → mochi_net_close(handle) → drops Tokio runtime + Client
```

One `NetCtx` per `Session`. The Tokio runtime owns its own thread pool; opening many sessions allocates many runtimes. For a high-fanout scraper this is fine — a session is a logical user, and the connection-pooling-per-user model is what real users do anyway.

## Profile preset mapping

`MatrixV1.wreqPreset` is the bridge from the consistency engine into wreq's impersonation table. Selected mappings:

| `wreqPreset` | wreq `Impersonate` | Notes |
|---|---|---|
| `chrome_131_macos` | `Chrome131` | Stock Chrome stable on macOS. |
| `chrome_131_windows` | `Chrome131` | Stock Chrome stable on Windows. |
| `chrome_131_linux` | `Chrome131` | Stock Chrome stable on Linux. |
| `chrome_131_brave_macos` | `Chrome131` | Brave shares the upstream Chrome JA4. |
| `edge_120_windows` | `Edge120` | Edge has its own ALPN order. |

The mapping table lives in `packages/net-rs/src/preset.rs`. New Chrome / Edge majors land alongside the consistency-engine bump that exposes them — `R-006` (userAgent), `R-007` (sec-ch-ua), and `R-046` (ua-full-version) all read the same browser version, and `wreqPreset` is derived from the same source. The single source of truth is the `ProfileV1` capture; drift between the JS-API surface (`navigator.userAgent`) and the network-layer surface (`Sec-CH-UA*` headers, JA4) is an architectural error, not a runtime variable.

The launch path also drives `Network.setUserAgentOverride` with `userAgent` + `userAgentMetadata` derived from the same matrix (`packages/core/src/session.ts`'s `buildUserAgentMetadata`), so the request line and `Sec-CH-UA*` headers Chromium emits on the *browser's own* nav match what `session.fetch` emits via wreq. PLAN.md §9 calls this the cross-layer consistency invariant.

## Prebuilt cdylib targets

Postinstall downloads from GitHub Releases ship for the five tuples covering ~95% of npm install bases:

- `darwin-arm64` — macOS Apple Silicon.
- `darwin-x64` — macOS Intel.
- `linux-x64` — Linux x86_64, glibc.
- `linux-arm64` — Linux aarch64, glibc (cross-compiled with `cargo-zigbuild`).
- `win32-x64` — Windows MSVC.

**Not covered as prebuilts:** FreeBSD, OpenBSD, Alpine musl, Linux ia32, Windows arm64. The postinstall script (`packages/net-rs/scripts/install-prebuild.ts`) emits a friendly message and exits 0 on unsupported platforms; install never blocks. Set `MOCHI_NET_SKIP_POSTINSTALL=1` to bypass the download entirely.

For unsupported targets, build from source:

```sh
cargo build --release --manifest-path packages/net-rs/Cargo.toml
```

The loader (`packages/net/src/ffi.ts`) walks both the postinstall `native/` directory AND `target/release/`, so a local cargo build Just Works after a clone.

## Diagnostics

```ts
import { nativeVersion, nativeDylibPath } from "@mochi.js/net";

console.log("net-rs version:", nativeVersion());
console.log("dylib path:    ", nativeDylibPath());
```

Useful in error reports — the FFI loader logs the resolved path when `dlopen` fails, but a programmatic check is the fastest way to confirm the postinstall picked the right asset.

## What `session.fetch` doesn't do (yet)

- **Streaming bodies.** Request bodies are coerced to a UTF-8 string at the FFI boundary; `Blob`, `FormData`, and `ReadableStream` are out of v0.6 scope. Binary bodies via `ArrayBuffer` / `Uint8Array` are decoded as UTF-8 (caller's responsibility if that's wrong for your endpoint).
- **Streaming responses.** `mochi_net_response_body` returns the full body as a borrowed slice; the JS facade copies into a `Uint8Array`-backed `Response`. Large downloads block the call until complete.
- **Cookie jar integration.** `session.cookies` is the browser's cookie jar; `session.fetch` does NOT automatically forward cookies from the browser to the wreq Client. If you need a cookie on the out-of-band call, pass it via `init.headers["Cookie"]` explicitly. The two cookie surfaces will integrate in v1.x.

## What to read next

- [JA4 coherence](/docs/concepts/ja4-coherence) — the conceptual *why*: TLS / H2 fingerprinting, what JA4/JA3/H2 each measure, why mismatches reveal a spoofed Chrome.
- [The Consistency Engine](/docs/concepts/consistency-engine) — `wreqPreset` is a matrix field derived from the profile.
- [Profiles](/docs/concepts/profiles) — what `wreqPreset` looks like across the catalog.
- [Stealth philosophy](/docs/concepts/stealth-philosophy) — why Bun:FFI + Rust is the architecture (invariants I-1, I-3).

<!-- llm-context:start
This page covers @mochi.js/net (TS facade) and @mochi.js/net-rs (Rust cdylib + wreq).

Key API symbols on @mochi.js/net (source: packages/net/src/index.ts):
- openCtx(spec: { preset: string, proxy?: string }): NetCtx
- requestOnCtx(ctx: NetCtx, url: string, init: NetFetchInit): Response  // SYNCHRONOUS — returns Response, not Promise<Response>
- fetch(url: string, init: NetFetchInit): Promise<Response>  // one-shot convenience
- nativeVersion(): string
- nativeDylibPath(): string
- type NetCtx = { handle: Pointer, close(): void }
- type NetFetchInit = { method?: string, headers?: Record<string, string> | Headers, body?: string | null, preset: string, proxy?: string, connectTimeoutMs?: number, timeoutMs?: number }

Public path through Session (source: packages/core/src/session.ts):
- session.fetch(url: string, init?: RequestInit): Promise<Response>
- The session lazily opens one NetCtx on first call, reuses for subsequent calls, closes on session.close().
- Body must be string | ArrayBuffer | ArrayBufferView | URLSearchParams. Blob / FormData / ReadableStream are NOT supported in v0.6.
- The proxy URL is shared with the browser's --proxy-server flag from launch, so out-of-band traffic and in-browser nav both egress through the same proxy.

Prebuilt cdylib targets:
- darwin-arm64, darwin-x64, linux-x64, linux-arm64, win32-x64
- NOT prebuilt: FreeBSD, Alpine musl, Linux ia32, Windows arm64
- Fallback: `cargo build --release --manifest-path packages/net-rs/Cargo.toml`
- Bypass postinstall: MOCHI_NET_SKIP_POSTINSTALL=1

wreqPreset values (selected, source: packages/net-rs/src/preset.rs):
- chrome_131_macos, chrome_131_windows, chrome_131_linux, chrome_131_brave_macos, edge_120_windows

Common LLM hallucinations to avoid:
- "Use globalThis.fetch with mochi" — false; globalThis.fetch uses Bun's native TLS, not wreq. Always use session.fetch for JA4 coherence.
- "session.fetch returns Promise<NetResponse>" — false; it returns Promise<Response> (standard Web Response).
- "Pass wreqPreset directly in launch" — false; wreqPreset comes from the profile's MatrixV1.wreqPreset field, not LaunchOptions.
- "session.fetch supports streaming" — false in v0.6; full-body buffered.
- "session.fetch automatically forwards browser cookies" — false; pass via init.headers.Cookie explicitly if needed.
- "Use openCtx() with no preset" — false; preset is required.
- "requestOnCtx is async" — false; it's synchronous (the underlying mochi_net_request is blocking on the FFI thread, but the Tokio runtime inside the cdylib drives async I/O).
- "@mochi.js/net works under Node with napi" — false; Bun:FFI only, per invariant I-3.

Cross-references:
- https://mochijs.com/docs/concepts/ja4-coherence
- https://mochijs.com/docs/concepts/consistency-engine
- https://mochijs.com/docs/concepts/profiles
- https://mochijs.com/docs/concepts/stealth-philosophy
- https://mochijs.com/docs/api/net
- https://mochijs.com/docs/api/core
llm-context:end -->
