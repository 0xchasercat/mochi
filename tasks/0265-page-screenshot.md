# 0265: `Page.screenshot` implementation

**Package:** `core`
**Phase:** `0.2`
**Estimated size:** S
**Dependencies:** none

## Goal

Replace the `NotImplementedError` thrown by `Page.screenshot` with a real implementation. Currently every consumer hits a `NotImplementedError` ("page.screenshot") — a baseline puppeteer/playwright feature. CDP `Page.captureScreenshot` is the canonical mechanism; ~30 lines.

## Success criteria

- [ ] `packages/core/src/page.ts` — replace the rejection with `Runtime.callFunctionOn`-free CDP `Page.captureScreenshot` send. Returns `Uint8Array` (decoded base64) by default; opts can override.
- [ ] `ScreenshotOptions` interface:
  ```ts
  interface ScreenshotOptions {
    format?: "png" | "jpeg" | "webp";   // default: "png"
    quality?: number;                     // 0-100, JPEG/WebP only
    fullPage?: boolean;                   // capture beyond viewport
    clip?: { x: number; y: number; width: number; height: number; scale?: number };
    omitBackground?: boolean;             // transparent PNG bg
    encoding?: "binary" | "base64";       // default "binary" → Uint8Array
  }
  ```
- [ ] Returns `Uint8Array` for `encoding === "binary"` (default), `string` for `encoding === "base64"`. TypeScript-discriminated.
- [ ] `fullPage: true` requires Layout/Emulation tweaks: get full content size via `Page.getLayoutMetrics`, set viewport to that size via `Emulation.setDeviceMetricsOverride`, capture, restore. Document the visited-state restore.
- [ ] Verify `Page.captureScreenshot` is NOT on the PLAN.md §8.2 forbidden list (it isn't — only `Runtime.enable` and `Page.createIsolatedWorld`).
- [ ] Unit test against mocked CDP capturing the params + Uint8Array decode.
- [ ] Live conformance test (gated `MOCHI_E2E=1`): launch session, `goto` a fixture, `screenshot()`, assert the returned `Uint8Array` starts with `[0x89, 0x50, 0x4E, 0x47]` (PNG magic).
- [ ] Update README's "what works/doesn't" matrix — flip `Page.screenshot` to `works`.
- [ ] Changeset: minor on `@mochi.js/core`.

## Out of scope

- Element-bounded screenshot (`page.screenshot({ element: handle })`) — separate brief; needs `DOM.getBoxModel` integration.
- PDF generation (`Page.printToPDF`) — separate brief.
- Screen recording / video capture — separate.

## Implementation notes

- See `packages/core/src/page.ts:870` for the current `NotImplementedError` rejection.
- CDP `Page.captureScreenshot` returns `{ data: <base64> }`. Decode via `Uint8Array.from(atob(data), c => c.charCodeAt(0))` or `Buffer.from(data, "base64")` (Bun has both).
- For `fullPage`: `Page.getLayoutMetrics` returns `{ contentSize, layoutViewport, ... }`. Use `contentSize.width / .height` for the viewport override; restore via `Emulation.clearDeviceMetricsOverride`.

## Validation

```sh
bun run typecheck && bun run lint && bun run test && bun run test:contract
# Live: MOCHI_E2E=1 bun test packages/core/src/__tests__/screenshot.e2e.test.ts
```
