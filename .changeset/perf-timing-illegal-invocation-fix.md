---
"@mochi.js/inject": patch
---

Fix `TypeError: Illegal invocation` thrown by the `performance-timing` Proxy when page scripts read brand-checked native getters (`responseStart`, `requestStart`, `transferSize`, …) on a `PerformanceNavigationTiming` entry.

The Proxy's `get` trap was forwarding `receiver === proxy` to native getters on `PerformanceNavigationTiming.prototype`. V8's brand check requires `this` to be a real instance and threw against the proxy. Real-world breakage: browserscan.net (Nuxt 500 page rendering body `Illegal invocation`), bbc.com/news (React error boundary). Fix: pass `target` (the real entry) as receiver so brand checks pass — every other module behavior is unchanged. Reported and one-line-patched by @alexschlessinger ([#47](https://github.com/0xchasercat/mochi/issues/47)).
