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
