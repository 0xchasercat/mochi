---
"@mochi.js/core": minor
---

Land the phase 0.1 CDP control plane: pipe-mode transport (`Bun.spawn` with extra
FDs 3+4, NUL-delimited JSON-RPC framing, no TCP), `MessageRouter` with request/
response correlation + per-method event bus, minimal `Session` and `Page` (`goto`,
`content`, `text`, `evaluate`, `waitFor`, `cookies`, `close`), and runtime
assertions for the §8.2 forbidden CDP methods (`Runtime.enable`,
`Page.createIsolatedWorld`, `Runtime.evaluate{includeCommandLineAPI:true}`).

Spoofing is deliberately deferred to phase 0.2/0.3; `Session.fetch`,
`humanClick/Type/Scroll`, and `screenshot` remain `NotImplementedError`
placeholders per the task brief.
