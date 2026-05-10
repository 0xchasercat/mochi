---
"@mochi.js/cli": patch
"@mochi.js/consistency": patch
---

Hotfix: `PINNED_FALLBACK_VERSION` shipped as `147.0.7727.138` in the previous release, but that exact build is not in the CfT catalog — it was the patch the captured `mac-m4-chrome-stable` profile happened to record (real Chrome ships patches CfT doesn't always publish). Result: `bunx mochi browsers install` failed with `version 147.0.7727.138 not found in CfT catalog for platform linux64`.

Re-pinned to `147.0.7727.117` — the latest 147.x build the CfT catalog actually publishes for all five platforms (linux64, mac-arm64, mac-x64, win32, win64). The captured profile's UA still reads `.138` because that's what was observed at capture time; the patch-level drift between the spoof (.138) and the binary (.117) is below most fingerprinters' resolution and far smaller than the 147→148 major drift this rollback closes.

`BROWSER_TIP_FULL_VERSION.chrome["147"]` and `.brave["147"]` updated to mirror.
