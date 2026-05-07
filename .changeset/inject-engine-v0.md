---
"@mochi.js/inject": minor
"@mochi.js/core": minor
---

Land phase 0.3 — the zero-jitter inject engine. `@mochi.js/inject` exposes
`buildPayload(matrix)` which composes a single IIFE of TurboFan-friendly
`Object.defineProperty` proxies covering the v0.2-rule surface: navigator,
screen + window viewport, WebGL `getParameter` (UNMASKED_VENDOR/RENDERER,
MAX_TEXTURE_SIZE, MAX_COLOR_ATTACHMENTS), `navigator.userAgentData`
(brands + `getHighEntropyValues`), `Intl.DateTimeFormat` timezone,
`document.fonts` enumeration, and bot-detection sentinel cleanup. Every
spoofed function answers `.toString()` with the native shape via a
shared `Function.prototype.toString` cloak. `@mochi.js/core` wires the
payload at session construction and installs it via
`Page.addScriptToEvaluateOnNewDocument({runImmediately:true, worldName:""})`
on each new page; worker targets receive the payload via
`Runtime.evaluate` from the auto-attached paused session, then resume.
No `Runtime.enable` is ever sent — verified by
`tests/contract/inject-no-runtime-enable.contract.test.ts` and the
existing §8.2 forbidden-method assertions.
