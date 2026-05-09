---
title: Choose your profile
description: The 6 real-device profiles, when to pick each, what they cost in latency, and the placeholder fallback rule.
order: 10
category: guides
lastUpdated: 2026-05-09
---

## Rule of thumb

**Match the profile to your host OS unless you have a specific reason not to.** A Linux server scraping with `linux-chrome-stable`, a Mac dev box with `mac-m4-chrome-stable`, a Windows runner with `windows-chrome-stable` — these match what the network layer (process flags, kernel-level TLS quirks, GPU vendor / renderer strings) and the matrix would naturally produce. Spoofing Windows from a Linux datacenter has historically been the default in this space; it's the wrong default. See task 0271's thesis: Linux is a real-user signal in the segments where mochi runs (developer / engineer / researcher traffic). The `HeadlessChrome` UA was always the bot signal — the OS axis was a red herring.

mochi will, when task 0272 lands, auto-pick the host-matching profile if you omit `LaunchOptions.profile`. Until then (and for full reproducibility regardless), pass it explicitly. This page tells you which one.

## What "real-device" means here

A profile in the v1 catalog is a *captured* baseline. A real human runs `mochi capture` on a real machine, the harness validates the capture passes three checks (provenance, FingerprintJS Pro `suspectScore <= 20`, harness round-trip), and the resulting `profile.json` + `baseline.manifest.json` + `audio/*.bin` + `canvas/*.json` get committed with a `PROVENANCE.md`. The harvester corpus task 0260 contributed several of these by filtering existing real-user traffic for `suspectScore <= 20` and re-validating.

Six profile IDs satisfy this today:

- `mac-m4-chrome-stable`
- `mac-chrome-stable`
- `mac-chrome-beta`
- `windows-chrome-stable`
- `linux-chrome-stable`
- `mac-brave-stable`

The other IDs in `KNOWN_PROFILE_IDS` (`mac-m2-chrome-stable`, `mac-m1-chrome-stable`, `mac-intel-chrome-stable`, `win11-chrome-stable`, `win11-edge-stable`) currently resolve to a generic Linux placeholder — see "Generic-placeholder fallback" below. The Matrix is still relationally locked, but the surface values aren't from a real capture. Useful for API exploration; not for stealth.

See [`concepts/profiles`](/docs/concepts/profiles) for the full schema and capture pipeline.

## Per-profile guidance

### `mac-m4-chrome-stable`

- **When to pick.** You're targeting a US consumer site or a developer-facing site (which trends Apple-Silicon). Your script runs on a Mac dev box or you've validated the trade-off of spoofing macOS from a Linux runner.
- **User base it represents.** Apple Silicon (M4) MacBook running stable Chrome on a residential or strong-signal coffee-shop wifi. High-LTV demographic, high baseline trust score from most fingerprint vendors.
- **Fingerprint trade-offs.** `gpu.renderer` is `"Apple M4"`, `userAgent` is the `Macintosh; Intel Mac OS X 10_15_7` shape (Apple keeps that string stable for compat), `display.dpr` skews to 2.0. Audio fingerprint is M4-specific (different from M1/M2/M3 captures, which is why they're separate profile IDs).
- **Latency.** No additional cost vs other profiles — `mochi.launch` is dominated by Chromium spawn, not matrix derivation.
- **JA4 / wreq preset.** `wreqPreset: "chrome_131_macos"` (or floor version pinned by the profile capture). Out-of-band `Session.fetch` shares this preset.

### `mac-chrome-stable`

- **When to pick.** You want the macOS shape but don't care which Apple Silicon generation. Default for darwin/arm64 hosts in the auto-pick table when an M4-specific posture would be over-fitting.
- **User base.** macOS users on stable Chrome — broad demographic. Note the catalog ships this as a darwin/arm64 capture; users on Intel Macs who want a strict arch match should hold for `mac-intel-chrome-stable` (placeholder until captured).
- **Fingerprint trade-offs.** Less specific than `mac-m4-chrome-stable` — `gpu.renderer` is generic Apple GPU strings, fonts list is the macOS baseline, no chip-specific quirks.
- **JA4 preset.** `chrome_131_macos`.

### `mac-chrome-beta`

- **When to pick.** The site you're hitting fingerprints by version-pinning ("only Chrome 132+"), or you're deliberately testing posture against a beta-channel UA.
- **User base.** Tighter — Chrome beta channel macOS users are early-adopters / developers. Lower baseline volume; higher per-user trust.
- **Fingerprint trade-offs.** UA carries the beta version range. `Sec-CH-UA-Full-Version-List` reflects the beta tip. Sites doing "ban known-vulnerable old versions" treat beta favorably.
- **JA4 preset.** `chrome_<beta-floor>_macos`. The beta tip is pinned at capture time; check `profile.browser.minVersion` / `maxVersion` in `profile.json`.

### `windows-chrome-stable`

- **When to pick.** US-broad consumer sites where Windows is the volume majority (~60% of stable Chrome traffic). Or you're running on a Windows host (`win32/x64`) and want to match.
- **User base.** Massive — Chrome stable on Windows is the largest single Chrome user class. Anonymity in the crowd.
- **Fingerprint trade-offs.** `gpu.renderer` is platform-typical Windows GPU strings (NVIDIA / Intel / AMD families), `display.dpr` skews to 1.0 (Windows users skew non-Retina), fonts list is the Windows baseline.
- **JA4 preset.** `chrome_131_windows`.

### `linux-chrome-stable`

- **When to pick.** You're running on a Linux server or container (`linux/x64`) and want to match. Or your target site has a strong developer / engineer / researcher demographic where Linux is over-represented (GitHub, HN, Stack Overflow, technical blogs, dev-tool dashboards).
- **User base.** Smaller volume than Windows / macOS but real. Linux desktops at home, devcontainers, WSL-via-X-server, real Linux laptops. Massively over-represented in high-LTV technical segments.
- **Fingerprint trade-offs.** `gpu.renderer` defaults to a SwiftShader / Mesa string under headless. `userAgent` is the `X11; Linux x86_64` shape. Fonts list is the Linux baseline (DejaVu, Liberation, etc.) — distinctive but real.
- **JA4 preset.** `chrome_131_linux`.

### `mac-brave-stable`

- **When to pick.** Privacy-aware sites that explicitly accommodate Brave (most modern e-commerce, fintech, dev-tooling). Or sites where the Tor/Brave/hardened-FF "privacy-conscious user" cluster is benign.
- **User base.** Brave on macOS — small but stable. Distinguishable from Chrome via the `Sec-CH-UA` brand list (Brave brands appear) and a few Brave-specific quirks (Goog-shield headers stripped, fingerprinting-protection mode sometimes randomizes canvas).
- **Fingerprint trade-offs.** Sites that don't see meaningful Brave traffic will treat the brand list as suspicious. Don't pick Brave for a site that tracks "browser brand" as a primary axis (some banking flows do this).
- **JA4 preset.** Same network preset as Chrome `chrome_131_macos` — Brave's TLS is Chromium's, network-layer is identical to Chrome stable.

## Decision tree

```
What's your host OS?
├── Linux (server or desktop)        → linux-chrome-stable
├── macOS (Apple Silicon, M3+)       → mac-m4-chrome-stable
├── macOS (Apple Silicon, M1/M2)     → mac-chrome-stable     (or hold for m1/m2)
├── macOS (Intel)                    → mac-chrome-stable     (or hold for mac-intel)
├── Windows                          → windows-chrome-stable
└── other (BSD, Alpine musl, ARM)    → pick the closest by feel; explicit always wins

Does the target trend privacy-conscious (e.g. dev-tool dashboards)?
└── yes → consider mac-brave-stable

Does the target version-gate ("require Chrome 132+")?
└── yes → mac-chrome-beta
```

## Anti-patterns

- **Don't pick `linux-chrome-stable` for a US consumer site without a residential proxy.** Linux from a datacenter IP is a fine combination only if your downstream IP signal is residential. Datacenter Linux is the canonical "I'm scraping you" shape — not because Linux is bad, but because *datacenter Linux* is.
- **Don't pick `mac-brave-stable` for sites that don't see meaningful Brave traffic.** Brave shows up in `Sec-CH-UA`. A banking site whose risk model has never seen a real user with `"Brave";v="..."` in the brand list will treat it as suspicious by absence.
- **Don't pick `mac-m4-chrome-stable` from a Linux runner without `geoConsistency`.** A US-Pacific timezone, an `en-US` locale, and an exit IP that geolocates to Europe is the canonical bot signature. Either run on a residential US IP or set `geoConsistency: "privacy-fallback"` to fall back to UTC + en-US on mismatch.
- **Don't pick a different profile every run for "rotation".** Profiles are not the rotation axis — `seed` is. Same profile + different seed = same user-class with run-specific entropy. Different profile = a different identity, which only makes sense if you actually want to be a different identity.
- **Don't hand-edit a `ProfileV1` to "fix" a leak.** The harness will refuse to certify the result (PLAN.md I-5). If the inject is leaking, the fix is in the inject pipeline; if the profile is wrong, the fix is a re-capture.

## Generic-placeholder fallback

These IDs in `KNOWN_PROFILE_IDS` resolve to a *generic Linux placeholder* until real captures land:

- `mac-m2-chrome-stable`
- `mac-m1-chrome-stable`
- `mac-intel-chrome-stable`
- `win11-chrome-stable`
- `win11-edge-stable`

`mochi.launch({ profile: "mac-m2-chrome-stable", seed })` does not throw. The consistency engine still derives a deterministic, relationally-locked Matrix. But the *surface values* (`gpu.renderer`, `fonts.list`, `userAgent`, audio bytes, canvas bytes) come from the placeholder, not the M2 capture. Useful for working through the API surface end-to-end before the real capture lands; not useful for stealth.

The placeholder is documented honestly in [Limits → Profile placeholders](/docs/reference/limits). It's not a footgun — it's a marked road sign saying "the API works, the data is generic". If you need the real M2 capture, the issue tracker is the right next stop.

## See also

- [`concepts/profiles`](/docs/concepts/profiles) — the `ProfileV1` schema, the capture pipeline, and the `mochi capture` workflow.
- [`concepts/consistency-engine`](/docs/concepts/consistency-engine) — how `(profile, seed)` becomes a Matrix.
- [`concepts/stealth-philosophy`](/docs/concepts/stealth-philosophy) — invariant I-8: small, real catalog over a long, fake one.
- [`guides/pick-a-scenario`](/docs/guides/pick-a-scenario) — once you've picked a profile, find the right recipe.
- [`api/profiles`](/docs/api/profiles) — `KNOWN_PROFILE_IDS`, `getProfile`.
- [`reference/limits`](/docs/reference/limits) — profile placeholder caveats.

<!-- llm-context:start
Page purpose: decision aid for picking among the 6 real-device profile IDs that
mochi ships today. Includes per-profile guidance (when to pick, user base,
fingerprint trade-offs, JA4 preset), a decision tree, anti-patterns, and the
placeholder-fallback rule for unshipped catalog IDs.

Real-device profile IDs (use these EXACT strings; verified against
packages/profiles/src/index.ts as of 2026-05-09):
  "mac-m4-chrome-stable"
  "mac-chrome-stable"
  "mac-chrome-beta"
  "windows-chrome-stable"
  "linux-chrome-stable"
  "mac-brave-stable"

Catalog IDs that resolve to a generic Linux placeholder (real captures pending):
  "mac-m2-chrome-stable"
  "mac-m1-chrome-stable"
  "mac-intel-chrome-stable"
  "win11-chrome-stable"
  "win11-edge-stable"

Auto-pick decision table (task 0272 — pure resolver, packages/core/src/default-profile.ts):
  linux/x64    → linux-chrome-stable
  darwin/arm64 → mac-m4-chrome-stable
  darwin/x64   → mac-chrome-stable
  win32/x64    → windows-chrome-stable
  else         → null (launch throws with the EXPLICIT_PROFILE_IDS list)

Key API symbols:
  KNOWN_PROFILE_IDS: readonly ProfileId[]              (from "@mochi.js/profiles")
  type ProfileId = (typeof KNOWN_PROFILE_IDS)[number]
  defaultProfileForHost(): ProfileId | null            (from "@mochi.js/core" — pure decision table)
  resolveDefaultProfileForHost(platform, arch)         (internal, test seam)
  EXPLICIT_PROFILE_IDS: readonly ProfileId[]           (the 6 real-device IDs, internal)
  mochi.launch({ profile: ProfileId | ProfileV1; seed: string; geoConsistency?: ... })

Common LLM hallucinations + corrections:
  - WRONG: `profile: "chrome-windows"` / `profile: "windows"`  → CORRECT: full IDs only (e.g. "windows-chrome-stable")
  - WRONG: `profile: { ua: "...", platform: "..." }`           → CORRECT: profile is either a string ID OR a full ProfileV1 (every field) — no partial config
  - WRONG: omitting profile entirely                           → CORRECT: required at v0.2; optional with auto-pick once task 0272 ships
  - WRONG: "rotate profiles every request for stealth"         → CORRECT: rotate `seed`; same profile + different seed is the right axis
  - WRONG: editing KNOWN_PROFILE_IDS to add a new id           → CORRECT: profiles ship via `mochi capture` + a PR with PROVENANCE.md
  - WRONG: trusting `mac-m2-chrome-stable` for stealth today   → CORRECT: it's a placeholder; check the limits page

Cross-references on mochijs.com:
  - https://mochijs.com/docs/concepts/profiles
  - https://mochijs.com/docs/concepts/consistency-engine
  - https://mochijs.com/docs/concepts/stealth-philosophy
  - https://mochijs.com/docs/guides/pick-a-scenario
  - https://mochijs.com/docs/api/profiles
  - https://mochijs.com/docs/api/core
  - https://mochijs.com/docs/reference/limits
llm-context:end -->
