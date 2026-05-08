---
"@mochi.js/core": patch
"@mochi.js/consistency": patch
"@mochi.js/inject": patch
---

Pass `userAgentMetadata` to `Network.setUserAgentOverride` (UA-CH parity).

Closes the cross-layer leak left open by 0255: the existing
`setUserAgentOverride` call passed `{ userAgent }` only, so the request
`Sec-CH-UA*` headers carried Chromium-for-Testing's binary defaults
instead of the matrix. A fingerprinter doing
`navigator.userAgentData.getHighEntropyValues({hints:[...]})` and
comparing against those headers saw a mismatch — direct PLAN.md I-5
violation.

`packages/core` now extends the call with the full `userAgentMetadata`
struct populated from `matrix.uaCh` + `matrix.os`. Five new consistency
rules in `@mochi.js/consistency` derive the previously-missing fields:

- R-042: `os.arch` → `uaCh.sec-ch-ua-arch`
- R-043: `os.arch` → `uaCh.sec-ch-ua-bitness` (string, NOT numeric per CDP enum)
- R-044: `os.name` → `uaCh.sec-ch-ua-mobile` (`?0` desktop / `?1` mobile)
- R-045: `os.name` → `uaCh.sec-ch-ua-model` (empty quoted string for desktop)
- R-046: `uaCh.ua-full-version-list` → `uaCh.ua-full-version` (branded entry)

`@mochi.js/inject`'s `client-hints.ts` reads the same matrix slots so the
two surfaces — the request-header path (CDP-driven) and the JS-API path
(`navigator.userAgentData`) — share a single source of truth and cannot
drift.

Note: `Network.setUserAgentOverride` is a per-target setter that does NOT
require `Network.enable`; PLAN.md §8.2's ban on `Network.enable` is
unaffected.
