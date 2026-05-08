---
"@mochi.js/core": patch
---

Pass `--lang=<matrix.locale>` to the spawned Chromium so the network-layer
`Accept-Language` header agrees with the JS-layer `navigator.language(s)`
spoof. Closes the PLAN.md I-5 leak surfaced by task 0251.

Without this flag, Chromium falls back to the host OS locale (or the
`en-US,en;q=0.9` default), and a site that cross-references the request
header against `navigator.languages` saw a mismatch. The flag is sourced
from the matrix's primary BCP-47 locale; multi-locale q-weighting is
derived by Chromium itself from this single primary, while the broader
list still flows through `matrix.languages` to the inject layer.

We deliberately do NOT fall back to the host locale (unlike
undetected-chromedriver `__init__.py:359-369`) — locale comes from the
matrix or `--lang` is omitted, surfacing a missing-locale profile bug
loudly instead of leaking the OS default.

Source-cited reference: udc `__init__.py:359-369`.
