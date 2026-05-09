---
"@mochi.js/core": minor
---

Auto-pick the host-OS-matching profile when `LaunchOptions.profile` is omitted.

`mochi.launch({ seed })` (no `profile`) now succeeds on Linux, Mac, and Windows hosts — mochi consults the host's `(process.platform, process.arch)` pair and routes to the matching real-device baseline:

- `linux/x64` → `linux-chrome-stable`
- `darwin/arm64` → `mac-m4-chrome-stable`
- `darwin/x64` → `mac-chrome-stable`
- `win32/x64` → `windows-chrome-stable`

On any unsupported host (FreeBSD, Linux arm64 today, Windows arm64, Alpine musl), launch throws with a precise diagnostic listing the six explicit profile IDs and a pointer to the `choose-your-profile` guide. We never silently fall back to a placeholder. Passing `profile` explicitly always wins; the auto-pick never overrides an explicit choice.

`LaunchOptions.profile` is now optional (`profile?: ProfileId | ProfileV1`). When the auto-pick fires, mochi logs one INFO line so the inferred id is visible without an extra introspection call:

```
[mochi] no profile supplied; auto-picked linux-chrome-stable for host linux/x64. To override: pass profile: "linux-chrome-stable" explicitly.
```

New helper:

- **`mochi.defaultProfileForHost(): ProfileId | null`** (and the named export `defaultProfileForHost` / `resolveDefaultProfileForHost`) — pure read of `process.platform` / `process.arch`. Returns `null` on unsupported hosts. Use it to introspect what mochi would pick before launching.

The strategic rationale: spoofing Windows from a Linux server is the wrong default. Linux is a real-user signal in WAFs trained on real traffic, not a bot signal — high-value user segments (developers, engineers, researchers) are heavily Linux-skewed and CTOs do not flag their own engineering team. Production validation: `aone.gg` / FingerprintJS Pro v4 / Linux DC IP / `bot: not_detected` / `suspect_score: 8` (vs patched Chrome 14-18, CloakBrowser 20+) on 2026-05-08. See `concepts/stealth-philosophy` for the full thesis + evidence.

Docs: README "Proof" subsection, `concepts/stealth-philosophy` ("Default to the host OS, not Windows"), `reference/comparison` ("Default profile strategy" axis), `reference/faq` ("Should I spoof Windows even when running on a Linux server?"), `reference/glossary` (host-OS asymmetry, privacy-fallback, tampering ML score), and inline notes on `getting-started/install` + `getting-started/linux-server`.
