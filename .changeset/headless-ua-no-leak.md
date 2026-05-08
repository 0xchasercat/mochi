---
"@mochi.js/core": patch
---

Defensive UA override at the network layer (task 0255).

`Session.newPage` now sends `Network.setUserAgentOverride` on every page
session immediately after `Target.attachToTarget` and before
`Page.addScriptToEvaluateOnNewDocument`. Closes a real defensive gap: under
`--headless=new` (task 0220) Chromium's bare User-Agent header still contains
`"HeadlessChrome"`. The inject module patches `navigator.userAgent` in JS,
but early subresource / preload / navigation `Network.requestWillBeSent`
events fire BEFORE any document script can run — only a CDP-level UA
override on the page session catches those bytes.

`Network.setUserAgentOverride` is a stateless setter that does NOT require
`Network.enable`, so the §8.2 invariant (no global `Network.enable`) is
unaffected. Skipped under `bypassInject:true` because capture flows must
record the bare browser fingerprint.

Pinned by a new two-layer contract test
(`tests/contract/headless-ua-no-leak.contract.test.ts`):

1. The built inject payload bundle contains no `"Headless"` substring.
2. `Session.newPage` sends `Network.setUserAgentOverride(matrix.userAgent)`
   on the page session before the inject install, and the simulated
   `Network.requestWillBeSent` UA is the matrix UA — never `"HeadlessChrome"`.

Sources: udc `__init__.py:519-527`, nodriver `tab.py:203-222` (both flag
the same defensive gap as LOW).
