---
"@mochi.js/core": patch
---

Auto-add `--no-sandbox` when `mochi.launch()` detects Linux + root UID and no `--no-sandbox` is already set. Chromium refuses to start as root with the user-namespace sandbox enabled; previously this surfaced as an opaque `EPIPE: broken pipe` from the first CDP write. Now mochi logs a one-line warning naming the fingerprint trade-off and injects the flag so the launch succeeds.

Stealth-critical workloads can opt out with `allowRootWithSandbox: true` on `LaunchOptions`. PLAN.md §8.6 still excludes `--no-sandbox` from `DEFAULT_CHROMIUM_FLAGS` — this is a runtime fallback, not a default. The flag is logged so it's never silent.
