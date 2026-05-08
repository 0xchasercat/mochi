---
"@mochi.js/core": minor
---

DX cluster: cookie persistence + localStorage helpers + grantAllPermissions.

Three additive convenience APIs around CDP domains we already drive. None
are stealth-critical — they bring mochi to feature-parity with nodriver /
puppeteer / playwright on the "warm a session, persist state, grant
permissions for tests" use cases.

- **`Session.cookies.{save,load}`** — JSON-backed jar persistence keyed off
  `Storage.getCookies` / `Storage.setCookies` with a regex `pattern` filter
  on cookie domain. File format pinned by `CookieJarFile`: `version`,
  `savedAt` (ISO-8601 UTC), `mochiVersion`, `pattern`, `count`, `cookies`.
  Format version `1`; loaders refuse unknown versions with a precise error.
  JSON, not pickle (Bun-native runtime per PLAN.md I-3).

- **`Page.localStorage.{get,set}`** + **`Page.sessionStorage.{get,set}`** —
  thin wrappers around `DOMStorage.getDOMStorageItems` /
  `DOMStorage.setDOMStorageItem`. Returns `Record<string, string>`. Frame
  scope defaults to the page's main-frame origin; pass `{ origin }` to
  scope explicitly. The two surfaces are identical except for the
  `isLocalStorage` flag CDP receives.

- **`Page.grantAllPermissions(opts?)`** — wraps `Browser.grantPermissions`
  with the full `Browser.PermissionType` descriptor list (pinned by
  `ALL_BROWSER_PERMISSIONS`). Pairs with R-036: this method grants ALL at
  the *browser* level, but page-side `navigator.permissions.query()` still
  returns per-permission state per `matrix.uaCh["permissions-defaults"]`.
  Origin defaults to the page's main-frame origin; pass `{ origin }` for
  explicit scoping.

The pre-0257 method shape `Session.cookies(filter)` / `Session.setCookies(...)`
is gone — `Session.cookies` is now a getter returning the `CookieJar`
namespace (`get`, `set`, `save`, `load`).

nodriver-cited (`docs/audits/nodriver.md` LOW × 3).
