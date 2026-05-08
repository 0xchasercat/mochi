# 0257: DX cluster — cookie persistence + localStorage helpers + grantAllPermissions

**Package:** `core`
**Phase:** `0.2`
**Estimated size:** M
**Dependencies:** none
**Source:** `docs/audits/nodriver.md` LOW findings × 3

## Goal

Three additive convenience APIs around CDP domains we already drive. None of them are stealth-critical — they're DX wins that bring mochi to feature-parity with nodriver / puppeteer / playwright on the "warming a session, persisting state, granting permissions for tests" use cases.

## Success criteria

### `Session.cookies.{save,load}`

- [ ] New methods on `Session.cookies` (already has a `getter` per inject's R-035 rule; this adds persistence):
  ```ts
  await session.cookies.save("/path/to/cookies.json", { pattern?: RegExp });
  await session.cookies.load("/path/to/cookies.json", { pattern?: RegExp });
  ```
- [ ] Format: JSON (NOT pickle — nodriver uses pickle, Bun-native code uses JSON).
- [ ] `pattern` filter: regex match on cookie domain; only matching cookies saved/loaded. Default: `.*` (all).
- [ ] Underlying CDP: `Storage.getCookies` for save, `Storage.setCookies` for load.
- [ ] Idempotent: load + save round-trips identically.
- [ ] File format includes a small header with mochi version + timestamp + cookie count for forward-compat.

### `Page.localStorage.{get,set}`

- [ ] New methods on `Page.localStorage`:
  ```ts
  const items = await page.localStorage.get();        // Record<string, string>
  await page.localStorage.set({ foo: "bar", baz: "qux" });
  ```
- [ ] CDP: `DOMStorage.getDOMStorageItems`, `DOMStorage.setDOMStorageItem`.
- [ ] Frame scope: defaults to main frame; `{ origin: string }` opt for cross-origin.

### `Page.grantAllPermissions`

- [ ] New method on `Page`:
  ```ts
  await page.grantAllPermissions();              // grants every Browser.PermissionDescriptor
  await page.grantAllPermissions({ origin?: string });
  ```
- [ ] CDP: `Browser.grantPermissions` with the full descriptor list.
- [ ] Scope: defaults to current page's origin; `{ origin }` opt for explicit.
- [ ] Pairs with R-036 (permissions consistency rule): grants ALL at the browser level, but page-side `navigator.permissions.query()` still returns per-permission state per the matrix.

### Tests

- [ ] Unit tests for each API against mocked CDP capturing the params.
- [ ] Cross-package contract tests pinning the wire format (JSON shape for cookies, the two CDP method calls for localStorage, the `Browser.grantPermissions` send for permissions).
- [ ] Live conformance test (gated `MOCHI_E2E=1`): goto, set 3 cookies + 2 localStorage items + grant permissions, verify reads.

### Other

- [ ] Update README "what works/doesn't" matrix with the three new rows (all `works`).
- [ ] Changeset: minor on `@mochi.js/core`.

## Out of scope

- IndexedDB persistence — separate brief; needs `IndexedDB.requestData` + serialization.
- SessionStorage — same shape as localStorage (`DOMStorage.getDOMStorageItems({...isLocalStorage: false})`); add as part of this brief if scope permits.
- Cross-context permission grants — single page is scope.

## Implementation notes

- `Storage.getCookies` returns `[{ name, value, domain, path, expires, httpOnly, secure, sameSite, ...}]`. Standard shape.
- `Browser.PermissionDescriptor` enum: see CDP docs for the full list (~25 entries: geolocation, camera, microphone, notifications, ...).
- Cookie save format proposal:
  ```json
  {
    "version": 1,
    "savedAt": "2026-05-09T12:34:56Z",
    "mochiVersion": "0.1.4",
    "pattern": ".*",
    "count": 7,
    "cookies": [{...}, {...}]
  }
  ```

## Validation

```sh
bun run typecheck && bun run lint && bun run test && bun run test:contract
```
