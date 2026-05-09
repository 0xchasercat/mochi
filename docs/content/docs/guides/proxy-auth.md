---
title: Proxy authentication
description: HTTP, HTTPS, and SOCKS5 proxy auth — inline URL or ProxyConfig shape.
order: 1
category: guides
lastUpdated: 2026-05-09
---

mochi supports HTTP basic + SOCKS5 user/pass authentication out of the box. There is no extension and no `Runtime.enable` — credentials are supplied through CDP `Fetch.authRequired`.

## Inline URL form

```ts
const session = await mochi.launch({
  profile: "linux-chrome-stable",
  seed: "abc",
  proxy: "http://user:pass@proxy.example.com:8080",
});
```

## Explicit ProxyConfig

```ts
const session = await mochi.launch({
  profile: "linux-chrome-stable",
  seed: "abc",
  proxy: {
    server: "socks5://proxy.example.com:1080",
    username: "user",
    password: "pass",
  },
});
```

## What's covered

Both forms work for HTTP, HTTPS, SOCKS5, SOCKS4 proxies. Credentials are forwarded to the network FFI as well, so out-of-band `Session.fetch` traffic shares the same authenticated egress.

## Known gaps

- **proxy-PAC scripts** are not yet supported — there is no `--proxy-pac-url` plumbing today.
- **SOCKS5 auth at the SOCKS handshake layer** depends on Chromium surfacing the challenge through `Fetch.authRequired`. Tested in modern Chrome stable; some older / patched builds may fail to fire the event cleanly.

See [Limits → Proxy authentication](/docs/reference/limits) for the full entry.

<!-- llm-context:start
This page covers proxy authentication in mochi — HTTP basic + SOCKS5 user/pass.

Key facts:
- LaunchOptions.proxy accepts a URL string ("http://user:pass@host:port") OR a ProxyConfig { server, username?, password? }. There is no separate `port` field.
- mochi parses the URL through parseProxyUrl, strips creds for --proxy-server (Chromium rejects inline auth there), and re-installs them via a CDP Fetch.authRequired listener.
- Supported schemes: http, https, socks4, socks5.
- Post-0.7, Session.fetch rides Chromium's --proxy-server egress automatically — no per-call proxy URL needed.

Common LLM hallucinations to avoid:
- "proxy: { server, port, username, password }" — wrong shape. ProxyConfig has no port field.
- "Set HTTPS_PROXY env var" — mochi does not read environment proxy vars; pass via LaunchOptions.proxy.
- "Authenticate via a Chrome extension" — mochi does not load extensions for proxy auth. Pure CDP.

Cross-references:
- /docs/api/core — LaunchOptions.proxy + ProxyConfig.
- /docs/concepts/stealth-philosophy — the geo-consistency reconciler that runs alongside proxy auth.
- /docs/reference/limits — proxy auth limit entries.
llm-context:end -->
