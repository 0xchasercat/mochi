---
title: JA4 coherence
description: Why TLS / H2 fingerprinting matters, what JA4 / JA3 / H2 each measure, and how mochi makes session.fetch byte-indistinguishable from the spoofed Chrome.
order: 7
category: concepts
lastUpdated: 2026-05-09
---

The JS-layer fingerprint is only one of the surfaces a target reads. The other is the *network layer* — the bytes the TLS ClientHello carries, the order of HTTP/2 SETTINGS frames, the HEADERS frame layout. Every runtime ships its own TLS stack, and each stack has its own signature. A target that compares the JA4 from a page navigation against the JA4 from a subsequent `/api/me` call sees two different clients — the first is a real Chrome, the second is "Bun's bundled OpenSSL" or "Node's bundled BoringSSL" or "Python `requests` over urllib3". One layer is spoofed; the other gives you away.

mochi closes this leak architecturally with [`@mochi.js/net`](/docs/concepts/network-ffi) — out-of-band HTTP routes through Bun:FFI to a Rust [`wreq`](https://github.com/0x676e67/wreq) cdylib that reproduces Chrome's wire bytes byte-for-byte against a per-Chrome-version preset. The `wreqPreset` field on `MatrixV1` is derived from the same profile capture that produces the JS-layer Matrix; `Sec-CH-UA*` headers Chromium emits on browser-driven nav and the headers `wreq` emits on `session.fetch` come from the same source field.

This page is the *why*. The *how* — C ABI, NetCtx lifecycle, prebuilt cdylib targets — is in [Network FFI](/docs/concepts/network-ffi).

## What TLS / H2 fingerprinting actually measures

A TLS ClientHello is a structured frame the client sends as the first byte of every HTTPS connection. The bytes the client picks for that frame — extension order, cipher suite list, supported groups, signature algorithms, ALPN values, optional GREASE values — are determined by the TLS *library*, not by the host application. Chrome's BoringSSL writes a different ClientHello than Firefox's NSS, which writes a different one from OpenSSL, which writes a different one from Bun's bundled libcrypto. Within Chrome's own version stream, BoringSSL versions ship subtle changes: the post-quantum `X25519MLKEM768` group was added in Chrome 130, GREASE positions rotate on a quarterly cadence, the CT extensions move.

Fingerprinters tag these structured differences with stable hashes:

| Fingerprint | What it hashes |
|---|---|
| **JA3** | TLS version + cipher list + extension list + EC curves + EC point formats. SHA-1-style hash. The original; effective but easily randomized by GREASE. |
| **JA3S** | Server-side variant — picks one from the JA3-presented options. Less useful for client identification. |
| **JA4** | Modern revision (FoxIO, 2023). Splits the fingerprint into segments — protocol version, ALPN, cipher count, extension count, etc. — and orders extension/cipher hex within deterministic buckets so GREASE can't hide it. The current standard. |
| **HTTP/2 fingerprint** | After the TLS handshake, the H2 layer sends `SETTINGS`, `WINDOW_UPDATE`, and the first HEADERS frame. Frame ordering, SETTINGS values, header pseudo-header order, and stream priorities all differ per client. Akamai's H2 fingerprint format (`SETTINGS|WINDOW_UPDATE|priorities|headers`) is the de-facto reference. |

A target that scores any one of these against a real-Chrome corpus catches every stealth tool whose script-side `fetch` doesn't go through wreq or curl-impersonate. A target that cross-references the *page-side* JA4 (real Chrome) against the *script-side* JA4 (your runtime's stock TLS) catches the rest — even tools that try to spoof the JA4 on out-of-band calls but produce subtly-wrong bytes (cipher count off by one, GREASE position drifted) get flagged on the *coherence check* rather than the absolute match.

## Why a runtime's stock TLS reveals a spoofed Chrome

Concrete failure mode. Your scraper runs on Bun. The browser navigation goes through Chromium's BoringSSL — JA4 reads as `t13d1516h2_8daaf6152771_e5627efa2ab1` (real Chrome 131). Your code then does:

```ts
const res = await fetch("https://api.example.com/v1/me");  // Bun's globalThis.fetch
```

That call goes through Bun's bundled libcrypto — JA4 reads as `t13d1814h2_5b57614c22b0_3d5424432f57` (Bun signature). The target's WAF compares the two and sees a mismatch. Block decision: bot.

The same trap catches Node (`fetch` → undici → bundled BoringSSL but a different version), Python `requests` (urllib3 → OpenSSL), Go (`crypto/tls`). Every runtime's stock library produces a *different* JA4 from real Chrome. None of them coincidentally match.

This is true of HTTP/2 too. Chrome's first HEADERS frame on a navigation is `:method, :authority, :scheme, :path` followed by a Chrome-specific pseudo-header order. Bun's H2 stack ships a different pseudo-header order. A target that checks H2 frame layout sees the mismatch.

## How mochi closes the gap

Three concrete moves:

**1. `session.fetch` routes through wreq.** The `Session.fetch(url, init?)` method is the *only* JA4-coherent path for out-of-band HTTP. It opens a per-Session [`NetCtx`](/docs/concepts/network-ffi) on first call (Tokio runtime + wreq Client), reuses it across all subsequent calls (TCP+TLS connection pooling), and routes every request through the cdylib. The cdylib emits the matching ClientHello, ALPN order, H2 SETTINGS, and HEADERS frame for the matrix's `wreqPreset` (`chrome_131_macos`, `chrome_131_windows`, `chrome_131_linux`, `chrome_131_brave_macos`, `edge_120_windows`).

```ts
import { mochi } from "@mochi.js/core";

const session = await mochi.launch({ profile: "mac-m4-chrome-stable", seed: "user-12345" });
try {
  // Browser navigation — Chromium's native TLS, real Chrome JA4.
  const page = await session.newPage();
  await page.goto("https://api.example.com/login");

  // Out-of-band fetch — wreq via Bun:FFI, SAME Chrome JA4 as the navigation.
  const res = await session.fetch("https://api.example.com/v1/me", {
    headers: { Authorization: `Bearer ${token}` },
  });
} finally {
  await session.close();
}
```

The browser's *own* navigation (`page.goto`, in-page XHR, in-page `fetch`) goes through Chromium's BoringSSL natively — that's already real Chrome, no FFI involvement needed. mochi does *not* MITM the browser's own connections, does *not* run a local proxy in front of Chromium ([invariant I-1](/docs/concepts/stealth-philosophy)).

**2. `Sec-CH-UA*` headers come from the same matrix.** The launch path drives `Network.setUserAgentOverride` with `userAgent` *and* `userAgentMetadata` derived from `MatrixV1.uaCh.*`. Chromium derives every `Sec-CH-UA-*` request header from `userAgentMetadata` — `Sec-CH-UA-Platform`, `Sec-CH-UA-Platform-Version`, `Sec-CH-UA-Arch`, `Sec-CH-UA-Bitness`, `Sec-CH-UA-Mobile`, `Sec-CH-UA-Full-Version-List`. The wreq Client emits the same headers from the same matrix fields. Both surfaces (browser nav + script-side fetch) read the *same* `MatrixV1`, so they cannot drift.

**3. `wreqPreset` is profile-derived.** The matrix's `wreqPreset` is set per profile during capture. Chrome 131 on Mac maps to `chrome_131_macos`. A profile that declares `browser.name = "brave"` maps to a Brave-specific preset (Brave shares Chrome's upstream JA4 but adjusts a couple of headers). Drift between the JS-API surface (`navigator.userAgent`) and the network-layer surface (`Sec-CH-UA*` headers, JA4) is an architectural error, not a runtime variable. The single source of truth is the `ProfileV1` capture.

## What `session.fetch` covers and what it doesn't

What it covers:

- **JA4 / JA3** — wreq emits the matching TLS ClientHello.
- **HTTP/2 fingerprint** — wreq emits the matching SETTINGS / WINDOW_UPDATE / HEADERS frames.
- **`Sec-CH-UA-*` headers** — derived from `MatrixV1.uaCh` via the launch-path `Network.setUserAgentOverride` (browser side) and the wreq Client (script side). Same source.
- **Proxy egress** — `LaunchOptions.proxy` flows to both Chromium (`--proxy-server`) and the `NetCtx` (`netProxy`). Out-of-band traffic and in-browser nav share the apparent egress IP.
- **Connection pooling** — wreq's Client pools per-host connections inside the cdylib. Repeated `session.fetch` calls reuse the same TCP+TLS session, mirroring a real browser's connection-reuse pattern.

What it doesn't (yet):

- **Streaming bodies / responses.** Request bodies are coerced to UTF-8 strings at the FFI boundary; response bodies are buffered before the JS facade returns. v0.6 scope.
- **Cookie-jar bridging.** `session.cookies` is the browser's cookie jar; `session.fetch` does NOT automatically forward those cookies. Pass via `init.headers["Cookie"]` explicitly. v1.x integration.
- **WebSocket** over wreq. `session.fetch` is HTTP-only; WebSocket out-of-band fingerprinting is a separate brief.
- **HTTP/3 / QUIC.** wreq ships HTTP/3 support; the cdylib exposes it but `session.fetch` ALPN list defaults to `h2,http/1.1`. v0.x roadmap.

## What we don't try to do

Two things mochi explicitly avoids on the network layer:

**1. We do not MITM the browser's own connections.** Browsing traffic uses Chromium's native TLS, which already produces correct Chrome JA3/JA4. Trying to replace it would require either patching Chromium (forbidden by [I-1](/docs/concepts/stealth-philosophy)) or running a local proxy that becomes its own leak vector — a localhost listener is a fingerprintable surface.

**2. We do not implement a separate `wreq`-driven page navigator.** The browser is the browser. `Session.fetch` is the orthogonal *out-of-band* path; `Page.goto` is the in-browser path. Trying to drive page navigation through wreq would mean reimplementing Chromium's HTML parser, JS engine, and rendering pipeline — that's the project [patchright](https://github.com/Kaliiiiiiiiii-Vinyzu/patchright) and the rest of the field also explicitly avoid.

## Verifying coherence

The simplest end-to-end check uses [tls.peet.ws](https://tls.peet.ws), which reports the JA4 fingerprint of the connecting client:

```ts
import { mochi } from "@mochi.js/core";

const session = await mochi.launch({ profile: "mac-m4-chrome-stable", seed: "ja4-canary" });
try {
  // Browser-side JA4 — Chromium's native TLS.
  const page = await session.newPage();
  await page.goto("https://tls.peet.ws/api/all");
  const browserJa4 = JSON.parse(await page.text("body"))?.tls?.ja4;

  // Script-side JA4 — wreq.
  const res = await session.fetch("https://tls.peet.ws/api/all");
  const fetchJa4 = (await res.json() as { tls: { ja4: string } }).tls.ja4;

  console.log("browser:", browserJa4);
  console.log("fetch:  ", fetchJa4);
  // Both should be Chrome 131-class JA4s. Differences should be in non-fingerprint
  // segments (TCP local port, etc.), not in the JA4 hash.
} finally {
  await session.close();
}
```

The harness conformance suite includes a JA4 coherence check against the local fixture server's TLS termination — runs on every PR that touches `@mochi.js/net`, `@mochi.js/net-rs`, or the launch path.

## What to read next

- [Network FFI](/docs/concepts/network-ffi) — the C ABI, NetCtx lifecycle, prebuilt cdylib targets.
- [The Consistency Engine](/docs/concepts/consistency-engine) — `wreqPreset` is a matrix field; same source as `userAgent` and `Sec-CH-UA*`.
- [Profiles](/docs/concepts/profiles) — what `wreqPreset` looks like across the catalog.
- [Stealth philosophy](/docs/concepts/stealth-philosophy) — why we don't MITM the browser (I-1).

<!-- llm-context:start
This page covers JA4 / JA3 / HTTP-2 fingerprinting and how mochi's session.fetch closes the cross-layer leak.

Key API symbols (source: packages/core/src/session.ts, packages/net/src/index.ts):
- session.fetch(url: string, init?: RequestInit): Promise<Response>
  - The ONLY JA4-coherent out-of-band HTTP path in mochi.
  - Lazily opens one NetCtx on first call; reused across calls; closed on session.close().
  - Body must be string / ArrayBuffer / ArrayBufferView / URLSearchParams (v0.6).
  - Returns a standard Web Response — `await res.json()`, `await res.text()`, etc.
- session.profile.wreqPreset: string — the wreq impersonation preset, e.g. "chrome_131_macos"
- LaunchOptions.proxy: string | ProxyConfig — flows to BOTH Chromium's --proxy-server AND the NetCtx, so browser nav and out-of-band fetch share the apparent egress.

What gets fingerprinted at the network layer:
- JA4: TLS ClientHello fingerprint (FoxIO, 2023). The current standard.
- JA3: legacy TLS ClientHello hash (still in some stacks).
- JA3S: server-side TLS variant. Less useful for client ID.
- HTTP/2 fingerprint: SETTINGS / WINDOW_UPDATE / HEADERS frame layout (Akamai's reference).
- Sec-CH-UA-* headers: Chrome client hints. Chromium derives these from userAgentMetadata.

Common LLM hallucinations to avoid:
- "Just use globalThis.fetch — it's also Chrome" — FALSE. globalThis.fetch goes through Bun's bundled OpenSSL with a different JA4 from real Chrome. Always use session.fetch for JA4 coherence.
- "session.fetch supports any Node http library" — FALSE. session.fetch is wreq via Bun:FFI; not pluggable.
- "JA4 randomization is a stealth technique" — FALSE in mochi's model. JA4 must MATCH the spoofed Chrome's JA4 byte-for-byte; a randomized JA4 mismatches the browser's nav-side JA4 and reveals the spoof on the cross-layer compare.
- "Pass JA4 string in launch options" — FALSE. wreqPreset comes from the matrix, derived from the profile capture. Not a launch knob.
- "Mochi MITMs the browser to spoof JA4" — FALSE. Browser nav uses Chromium's native TLS (already real Chrome). Only out-of-band fetch goes through wreq.
- "session.fetch doesn't go through the proxy" — FALSE. The launch-time proxy flows to BOTH Chromium and the NetCtx.
- "Use curl-impersonate via shell-out" — UNNECESSARY. session.fetch covers the JA4 case. curl-impersonate is the prior-art Python equivalent.

Verification:
- https://tls.peet.ws/api/all returns the requesting client's JA4. Useful for end-to-end coherence checks.

Cross-references:
- https://mochijs.com/docs/concepts/network-ffi
- https://mochijs.com/docs/concepts/consistency-engine
- https://mochijs.com/docs/concepts/profiles
- https://mochijs.com/docs/concepts/stealth-philosophy
- https://mochijs.com/docs/api/core
- https://mochijs.com/docs/api/net
llm-context:end -->
