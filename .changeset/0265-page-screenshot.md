---
"@mochi.js/core": minor
---

Implement `Page.screenshot` via CDP `Page.captureScreenshot` (task 0265).

The placeholder `NotImplementedError` rejection is replaced with a real
implementation that supports the standard puppeteer/playwright option
surface:

```ts
interface ScreenshotOptions {
  format?: "png" | "jpeg" | "webp";   // default: "png"
  quality?: number;                     // 0-100, JPEG/WebP only
  fullPage?: boolean;                   // capture beyond viewport
  clip?: { x; y; width; height; scale? };
  omitBackground?: boolean;             // transparent PNG bg
  encoding?: "binary" | "base64";       // default "binary" → Uint8Array
}
```

Return type is discriminated by `encoding`: `Uint8Array` for the default
binary mode, `string` for the raw base64 passthrough.

`fullPage: true` reads the document size via `Page.getLayoutMetrics`,
overrides the device metrics via `Emulation.setDeviceMetricsOverride`,
captures with `captureBeyondViewport: true`, then clears the override via
`Emulation.clearDeviceMetricsOverride`. The override clear runs in a
`finally` block so a capture failure does not leave the page wedged at an
oversized viewport.

`Page.captureScreenshot` is verified absent from the PLAN.md §8.2
forbidden list — only `Runtime.enable` and `Page.createIsolatedWorld` are
disallowed unconditionally.

Out of scope (separate briefs): element-bounded capture (`{ element }`,
needs `DOM.getBoxModel` integration) and PDF generation
(`Page.printToPDF`).
