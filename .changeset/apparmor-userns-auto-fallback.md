---
"@mochi.js/core": patch
---

Auto-`--no-sandbox` fallback now fires when AppArmor blocks unprivileged user namespaces — the Ubuntu 23.10+ / Kubuntu 25.10+ default. Before this fix, any non-root user on those distros hit `FATAL: ... No usable sandbox!` on first launch ([issue #52](https://github.com/0xchasercat/mochi/issues/52)); the existing auto-fallback only triggered under root.

`spawnChromium` now probes `/proc/sys/kernel/apparmor_restrict_unprivileged_userns` before spawning. When the value is `1`, mochi adds `--no-sandbox` with a one-line warning naming the fingerprint cost — same shape as the existing root-fallback path. Users who want the sandbox honored can install an AppArmor profile for the Chromium binary, lift the restriction via `sysctl`, or pass `allowRootWithSandbox: true` to opt out.

`diagnoseEarlyExitTail` also learned the "No usable sandbox" stderr pattern so users on hosts where the proactive probe misses (e.g., AppArmor on without the `apparmor_restrict_unprivileged_userns` sysctl set) still get an actionable error rather than the bare CDP-pipe-never-opened message.

Docs: linux-server.md gains an "Ubuntu 23.10+ / Kubuntu 25.10+" section spelling out the restriction, the fallback behavior, and the three remediation paths.
