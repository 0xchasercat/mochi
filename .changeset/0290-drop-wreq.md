---
"@mochi.js/core": minor
---

Drop the Rust `wreq` HTTP layer; route `Session.fetch` through Chromium itself via CDP.

`Session.fetch(url, init?)` now goes through the browser's own network stack rather than a parallel Rust HTTP layer. JA4 / JA3 / H2 are real Chrome by definition because Chromium is the client — there is no impersonator to keep in lockstep with the spoofed profile, no preset table to maintain, and no cdylib to install.

**Breaking changes**

- **Cookies inherit from the browser session.** A cookie set via `Page.goto` or `session.cookies.set` is sent on the next `session.fetch` call to the same origin automatically. The pre-0.7 wreq path was cookieless — callers that relied on a cookie-free out-of-band fetch should explicitly clear the jar (`session.cookies.set([])`) before the call, or set `init.credentials = "omit"` for the page-evaluate path.
- **Non-GET routes through `page.evaluate("fetch")`; CORS applies.** Simple GETs (no `init`, no method override, no headers, no body) take a fast path through `Network.loadNetworkResource` which bypasses CORS at the network layer. Anything else (POST, custom headers, body) routes through a scratch-frame `fetch` call from `about:blank`, so cross-origin requests obey the same CORS rules a user's browser would.
- **`Session.fetch` `Blob` / `FormData` / `ReadableStream` bodies throw with a clear diagnostic.** `string` / `ArrayBuffer` / typed arrays / `URLSearchParams` are supported; richer bodies will land in a follow-up PR.

**Deprecations**

- The `@mochi.js/net` and `@mochi.js/net-rs` packages are deprecated and no longer published. The cdylib install friction (`bunx mochi pm trust @mochi.js/net-rs`, the cross-platform prebuild matrix, the `cargo build` fallback) is gone with them.
- `ProfileV1.wreqPreset` and `MatrixV1.wreqPreset` are deprecated. The runtime no longer reads either field; the schema retains them for one release for migration and will drop them in 0.8.

**`ALL_BROWSER_PERMISSIONS` retuned for Chromium 148**

The constant now matches `Browser.PermissionType` on Chromium 148. Removed entries no longer accepted by the runtime: `accessibilityEvents`, `captureHandle`, `flash`, `videoCapturePanTiltZoom`. Added entries: `ar`, `vr`, `handTracking`, `automaticFullscreen`, `cameraPanTiltZoom`, `capturedSurfaceControl`, `keyboardLock`, `pointerLock`, `localNetwork`, `localNetworkAccess`, `loopbackNetwork`, `smartCard`, `webPrinting`. Calls to `page.grantAllPermissions()` against an older Chromium will fall through with no behavior change; calls against 148 stop tripping the `Unknown permission type: accessibilityEvents` runtime error.
