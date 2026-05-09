---
title: "@mochi.js/net"
description: "Out-of-band HTTP via Rust wreq — TLS/H2 fingerprint matches the matrix's wreqPreset."
order: 6
category: api
lastUpdated: 2026-05-09
---

`@mochi.js/net` is the Bun:FFI bridge to `@mochi.js/net-rs` — the Rust cdylib that wraps `wreq` to issue HTTP requests with a chosen TLS/H2 fingerprint preset (`chrome_147_linux`, `chrome_147_macos`, `brave_146_macos`, …). `Session.fetch(url, init)` in `@mochi.js/core` routes through this package; reach for it directly when you want to share a single `NetCtx` across multiple requests outside a Session, or when you're driving a probe that the browser tab itself shouldn't issue (e.g. an exit-IP geolocation lookup that must NOT touch Chromium's network stack).

## Installation

```sh
bun add @mochi.js/net
```

The cdylib (`libmochi_net.{dylib,so,dll}`) is shipped as a per-platform native asset alongside the JS package. `loadLib()` resolves the path via `resolveDylibPath()`; override with `MOCHI_NET_DYLIB_PATH` if you've built the cdylib yourself.

## Public exports

### `function openCtx(spec): NetCtx`

```ts
function openCtx(spec: { preset: string; proxy?: string }): NetCtx;
```

Open a per-Session FFI handle: a fresh Tokio runtime + a `wreq::Client` configured for the named preset (and optional outbound proxy). Connections pool inside the Rust crate across `requestOnCtx` calls on the same Ctx. Throws on FFI failure with `mochi_net_last_error()` appended to the message.

```ts
import { openCtx, requestOnCtx } from "@mochi.js/net";

const ctx = openCtx({ preset: "chrome_147_linux" });
try {
  const r = await requestOnCtx(ctx, "https://api.example.com/me", {
    method: "GET",
    preset: "chrome_147_linux",
    headers: { authorization: `Bearer ${token}` },
  });
  console.log(r.status, await r.json());
} finally {
  ctx.close();
}
```

### `interface NetCtx`

```ts
interface NetCtx {
  readonly handle: Pointer;  // Bun:FFI opaque pointer; do not dereference
  close(): void;             // idempotent; frees the Rust runtime + Client
}
```

### `function requestOnCtx(ctx, url, init): Response`

```ts
function requestOnCtx(ctx: NetCtx, url: string, init: NetFetchInit): Response;
```

Drive one request through the cdylib, marshalling the result into a standard Web `Response`. The per-call response handle is freed eagerly once the body has been copied. Synchronous-returning the Response (the FFI is sync); the `body` ArrayBuffer is fully buffered.

### `interface NetFetchInit`

```ts
interface NetFetchInit {
  readonly method?: string;                       // default "GET"
  readonly headers?: Record<string, string> | Headers;
  readonly body?: string | null;                  // UTF-8; v0.6 has no binary/streaming
  readonly preset: string;                        // required, e.g. "chrome_147_linux"
  readonly proxy?: string;                        // optional outbound proxy URL
  readonly connectTimeoutMs?: number;             // default 10_000
  readonly timeoutMs?: number;                    // default 30_000
}
```

`preset` is required on every call — even after `openCtx({ preset })`, the per-request `preset` lets you change fingerprint mid-Ctx if the workload demands. In practice you pass the same value both times.

### `function fetch(url, init): Promise<Response>`

```ts
function fetch(url: string, init: NetFetchInit): Promise<Response>;
```

One-shot convenience — opens a Ctx, issues the request, closes the Ctx. Useful for ad-hoc calls. For repeated calls under one logical session, prefer `openCtx` + `requestOnCtx` so the wreq client's connection pool is reused across requests.

```ts
import { fetch as netFetch } from "@mochi.js/net";

const r = await netFetch("https://example.com/", {
  preset: "chrome_147_macos",
});
console.log(r.status, (await r.text()).slice(0, 200));
```

### `function nativeVersion(): string`

Diagnostic — returns the cdylib's own version string via `mochi_net_version()`.

### `function nativeDylibPath(): string`

Diagnostic — surfaces the resolved cdylib path (for error reports, install verification).

### `function dylibCandidates(): string[]`

The list of paths `loadLib()` would try, in priority order. Useful when debugging a "dylib not found" error.

### `function nativeAssetFileName(platform?): string`

The expected platform-specific asset file name (`libmochi_net.dylib` on macOS, `.so` on Linux, `.dll` on Windows). Re-exported for native-asset tooling.

### `function resolveDylibPath(): string`

Resolve the path the FFI loader actually uses. Reads `MOCHI_NET_DYLIB_PATH` first, then falls through `dylibCandidates()`.

### `const VERSION: string`

The npm package version (`"0.0.1"`).

## Preset map (`wreqPreset`)

The preset string is what the Rust `resolve_preset()` matches against. Values shipped in v1 profiles:

| Preset | Used by |
| --- | --- |
| `chrome_146_macos` | `mac-chrome-stable` |
| `chrome_147_macos` | `mac-m4-chrome-stable`, `mac-chrome-beta` |
| `chrome_147_linux` | `linux-chrome-stable` |
| `chrome_146_windows` | `windows-chrome-stable` |
| `brave_146_macos` | `mac-brave-stable` |

The Rust crate matches by family (`chrome*` → Chrome handshake), so an unknown major still fingerprints as the right browser — exact-major matching is a future deliverable. See `packages/net-rs/src/ffi/preset.rs` for the canonical list.

`Session.fetch` reads `session.profile.wreqPreset` automatically; users typically don't pick presets by hand.

## Lifecycle

1. `mochi.launch` constructs the Session.
2. First `session.fetch(...)` call lazy-opens a `NetCtx` via `openCtx({ preset: matrix.wreqPreset, proxy: <launch proxy> })`.
3. Subsequent calls reuse that Ctx; wreq pools connections internally.
4. `session.close()` calls `ctx.close()`, which `mochi_net_close`s the Rust handle and drops the per-Ctx Tokio runtime. Idempotent.

## v0.6 limitations

- **No streaming bodies.** Both request and response bodies are fully buffered. A 100 MB response will allocate a 100 MB `Uint8Array`.
- **Bodies are UTF-8 strings.** `ArrayBuffer` / `Uint8Array` / `URLSearchParams` are accepted at the `Session.fetch` layer (which decodes them as UTF-8); raw binary at this layer round-trips through a `TextDecoder` (so genuine binary corrupts). `Blob` and `FormData` are out of scope.
- **No cookie jar at the FFI layer.** Cookie persistence between FFI calls is not modeled; manage cookies yourself by reading/writing `Set-Cookie` / `Cookie` headers, or route through the browser's network stack.
- **No per-request signal/AbortController integration.** Use `timeoutMs` instead.

## Common patterns

### Issue an authenticated API call sharing the session's TLS fingerprint

The standard path — `Session.fetch` does this for you:

```ts
const r = await session.fetch("https://api.example.com/v1/me", {
  method: "GET",
  headers: { authorization: `Bearer ${token}` },
});
```

### Reuse one Ctx across multiple direct calls

```ts
import { openCtx, requestOnCtx } from "@mochi.js/net";

const ctx = openCtx({
  preset: "chrome_147_linux",
  proxy: "http://user:pass@host:port",
});
try {
  for (const url of urls) {
    const r = await requestOnCtx(ctx, url, {
      preset: "chrome_147_linux",
      headers: { "user-agent": userAgent },
    });
    console.log(url, r.status);
  }
} finally {
  ctx.close();
}
```

### Diagnose a dylib resolution issue

```ts
import { dylibCandidates, nativeDylibPath, nativeVersion } from "@mochi.js/net";

console.log("candidates:", dylibCandidates());
console.log("resolved:", nativeDylibPath());
console.log("native version:", nativeVersion());
```

## Errors

The package throws plain `Error`s with a `[mochi-net]`-prefixed message; the Rust side appends `mochi_net_last_error()` for context.

| Trigger | Typical message |
| --- | --- |
| `openCtx` failure | `[mochi-net] mochi_net_open failed: <rust err>` |
| `requestOnCtx` failure | `[mochi-net] mochi_net_request failed: <rust err>` |
| Body shape unsupported | `[mochi-net] response_status returned <n>` (rare) |
| Dylib not found | Bun:FFI surfaces a load error from `loadLib()` |
| Unsupported preset | wreq returns an error; surfaced through `mochi_net_last_error` |

## See also

- [Concepts → Network FFI](/docs/concepts/network-ffi)
- [Concepts → JA4 coherence](/docs/concepts/ja4-coherence)
- [API → @mochi.js/core](/docs/api/core) — `Session.fetch` is the standard surface
- [API → @mochi.js/profiles](/docs/api/profiles) — where `wreqPreset` is set per profile
- [Reference → Limits](/docs/reference/limits)

<!-- llm-context:start
Package: @mochi.js/net
Public surface (verbatim from packages/net/src/index.ts as of 2026-05-09):

  VERSION                                          (const "0.0.1")

  openCtx(spec: { preset: string; proxy?: string }): NetCtx
  NetCtx { readonly handle: Pointer; close(): void }
  requestOnCtx(ctx: NetCtx, url: string, init: NetFetchInit): Response
  fetch(url: string, init: NetFetchInit): Promise<Response>
  NetFetchInit {
    method?: string;
    headers?: Record<string, string> | Headers;
    body?: string | null;
    preset: string;        // REQUIRED on every call
    proxy?: string;
    connectTimeoutMs?: number;
    timeoutMs?: number;
  }

  nativeVersion(): string
  nativeDylibPath(): string

  dylibCandidates(): string[]                      (re-exported from "./ffi")
  nativeAssetFileName(platform?): string
  resolveDylibPath(): string

That is the full surface. Internal-only:
  - mochi_net_open, mochi_net_close, mochi_net_request, mochi_net_response_status,
    mochi_net_response_headers_json, mochi_net_response_body, mochi_net_response_free,
    mochi_net_last_error, mochi_net_string_free, mochi_net_version
    — these are bun:ffi symbols, NOT JS exports

Function shape gotchas (LLMs often get these wrong):
- requestOnCtx returns `Response` SYNCHRONOUSLY (not Promise<Response>) — the FFI is sync,
  the JS wrapper does not await anything. The body is fully buffered.
- `fetch(url, init)` returns Promise<Response> ONLY because it wraps openCtx + requestOnCtx
  with try/finally; the underlying FFI is sync.
- `init.preset` is required on EVERY requestOnCtx call (even after openCtx({preset}))
- `init.body` is `string | null` — no ArrayBuffer, no FormData, no Blob, no ReadableStream
- response body is read eagerly into a Uint8Array; very large responses allocate the full size

Common LLM hallucinations (DO NOT USE):
- `Session.fetch` lives in @mochi.js/core, not here. The user-facing fetch is `session.fetch`
- `NetCtx.fetch(url, init)` — there is no method on the Ctx; use the free function `requestOnCtx`
- `openCtx(preset)` single-arg form — takes an object: `openCtx({ preset })`
- `init: { presetName }` — the field is `preset`, not `presetName`
- `wreqPreset(name)` factory — there is no factory; the preset is the matrix's `wreqPreset` string
- `requestOnCtx returns Promise<Response>` — it is synchronous; use without await (or await; it harmlessly resolves)
- `NetCtx.cookieJar` / `NetCtx.cookies` — no cookie surface at this layer
- `init.signal: AbortSignal` — not supported; use `timeoutMs`
- `init.body: ReadableStream` / `Uint8Array` / `Blob` / `FormData` — not supported
- `openCtx({ ja4 })` / passing JA4 strings directly — there is no JA4 input; the preset string maps to a JA4 inside the Rust crate
- Auto-cleanup of NetCtx on GC — there is none; you MUST call ctx.close() (or use `fetch()` which closes it for you)

Cross-references:
- /docs/concepts/network-ffi
- /docs/concepts/ja4-coherence
- /docs/api/core
- /docs/api/profiles
- /docs/reference/limits
llm-context:end -->
