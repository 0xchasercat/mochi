---
"@mochi.js/profiles": minor
"@mochi.js/core": patch
"@mochi.js/consistency": patch
"@mochi.js/cli": patch
"@mochi.js/harness": patch
---

Wire real captured profile baselines into `mochi.launch` and bump the placeholder + CfT pin to Chrome 148.

**The bug.** Every user shipping a string `profile:` got the hardcoded Chrome/131 placeholder UA against an installed Chromium-for-Testing v148. R-004's relational matrix dutifully emitted `Chrome/131.0.6778.110` (canonical for the bogus `minVersion: "131"` the placeholder hardcoded), but the binary serving TLS, fonts, and media-device IDs is real Chromium 148. Fingerprint validators that compare the spoofed UA against the actual binary's behavior caught the mismatch.

**Three compounding causes, fixed in one pass.**

- `@mochi.js/profiles.getProfile()` was a `throw new Error("not yet implemented")` stub. The six captured baselines on disk under `data/<id>/profile.json` (Chrome/146–147 UAs, Mac M4 / Mac Intel / Linux / Windows / mac-brave / mac-beta) were never read by the runtime. **Now**: `getProfile(id)` reads the captured `profile.json` via `Bun.file()`. New error classes `UnknownProfileIdError` (id outside `KNOWN_PROFILE_IDS`) and `ProfileBaselineMissingError` (id known but no baseline shipped yet) let callers distinguish the two failure modes. `hasProfile(id)` helper added.
- `synthesizePlaceholderProfile()` in `@mochi.js/core/launch.ts` was hardcoded `minVersion: "131"`, `Chrome/131.0.0.0` UA. The launcher always called the placeholder for string ids, never `getProfile()`. **Now**: the launcher tries `getProfile(id)` first and only falls back to `synthesizePlaceholderProfile` on `ProfileBaselineMissingError` (catalog ids without captures yet) or on truly unknown ids (with a `console.warn` so typos stay visible — preserves the pre-0.8 contract that any string id produces a working session, important for synthetic test-fixture ids). The placeholder itself bumps `131 → 148`.
- `@mochi.js/consistency`'s `BROWSER_TIP_FULL_VERSION` table topped out at `"147"` for chrome / edge / brave / arc. **Now**: adds `"148": "148.0.7778.97"` so R-004's tip-locked lookup resolves the new placeholder major to a real published patch.
- `@mochi.js/cli` `PINNED_FALLBACK_VERSION` was `131.0.6778.85` (very stale). **Now**: `148.0.7778.97`, the live CfT stable pin verified in manifest tests. Capture-flow defaults that hardcoded Chrome/131 in `derive-profile.ts`, `capture/index.ts`, and `provenance.ts` JSDoc also bump to Chrome/148 so a fresh `mochi capture` produces a profile whose UA major matches the running binary.

**Profile data fix — `linux-chrome-stable`.** The captured Linux baseline shipped with degraded GPU/display values that read as headless-server (SwiftShader) to Cloudflare Turnstile: `gpu.renderer: "Generic Renderer"`, `webglUnmaskedRenderer: "ANGLE (Generic)"`, 1280×800 display, 32 cores / 64GB, and a `sec-ch-ua` missing the branded "Google Chrome" entry (only `"Chromium";v="147"`). **Now**: realistic Intel Iris Xe values (`Intel Iris Xe Graphics` / `ANGLE (Intel Inc., Intel Iris Xe Graphics, OpenGL 4.1)`), 1920×1080, 8 cores / 16GB, and `sec-ch-ua: "Google Chrome";v="147", "Not.A/Brand";v="8", "Chromium";v="147"` — empirically validated as passing FingerprintJS Pro (bot=notDetected) and Cloudflare Turnstile in the wild.

**Harness conformance — host-OS-matched profile + per-baseline asserts.** `CONFORMANCE_PROFILE` was hardcoded to `mac-m4-chrome-stable` for every host; this was silently masked pre-0.8 because the placeholder always returned a Linux profile regardless of id. Post-0.8 it loads the real Mac baseline on Linux CI, producing an OS mismatch that Cloudflare Turnstile catches. **Now**: `CONFORMANCE_PROFILE` resolves via `defaultProfileForHost()` (same decision table the launcher uses) — Linux CI gets `linux-chrome-stable`, Mac dev gets `mac-m4-chrome-stable`, etc. The audio + canvas fingerprint conformance test loads expected byte-exact hashes from the host-matched profile's `baseline.manifest.json` instead of hardcoding Mac M4's values, so it passes for any profile in the catalog with a captured baseline.
