---
title: Screenshots
description: Capture PNG / JPEG / WebP via CDP Page.captureScreenshot — viewport, full-page, or clipped.
order: 4
category: guides
lastUpdated: 2026-05-09
---

`page.screenshot()` wraps CDP `Page.captureScreenshot`. It returns a PNG-encoded `Uint8Array` of the visible viewport by default; the option object covers format, quality, full-page, clipping, transparent background, and base64 output.

## Visible viewport, default PNG

```ts
import { mochi } from "@mochi.js/core";
import { writeFileSync } from "node:fs";

const session = await mochi.launch({ profile: "linux-chrome-stable", seed: "abc" });
const page = await session.newPage();
await page.goto("https://example.com");

const png = await page.screenshot();
writeFileSync("./out.png", png);

await session.close();
```

`png` is a `Uint8Array` — write it to disk with Bun's `Bun.write` or Node's `writeFileSync`, attach it to a multipart upload, or hash it for diff testing.

## Full-page capture

```ts
const png = await page.screenshot({ fullPage: true });
```

mochi reads `Page.getLayoutMetrics`, sizes the device viewport up to the content height via `Emulation.setDeviceMetricsOverride`, captures, then clears the override (always — even on capture failure). The browser's actual viewport is restored before the call returns.

## JPEG / WebP with quality

```ts
const jpg = await page.screenshot({ format: "jpeg", quality: 80 });
const webp = await page.screenshot({ format: "webp", quality: 90 });
```

`quality` is silently ignored for PNG (PNG is lossless); CDP just drops the field.

## Clipped region

```ts
const tile = await page.screenshot({
  clip: { x: 0, y: 0, width: 320, height: 200 },
});
```

`clip` and `fullPage` are mutually exclusive — if both are set, `clip` wins per CDP semantics.

## Transparent background

```ts
const transparent = await page.screenshot({ omitBackground: true });
```

PNG only — JPEG has no alpha channel and the flag is a no-op there.

## Base64 string output

For inline embedding (`data:` URLs, JSON payloads) skip the byte decode and ask CDP for the raw base64:

```ts
const dataUrl = `data:image/png;base64,${await page.screenshot({ encoding: "base64" })}`;
```

The discriminated overloads narrow the return type — `encoding: "base64"` returns `Promise<string>`, default / `"binary"` returns `Promise<Uint8Array>`.

## Out of scope at v0.2

Element-bounded capture (`{ element: handle }`) is a separate brief and not yet shipped. PDF generation (`Page.printToPDF`) lives in its own brief too.
