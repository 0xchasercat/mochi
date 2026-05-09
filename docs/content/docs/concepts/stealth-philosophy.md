---
title: Stealth philosophy
description: The eight invariants that decide what mochi will and won't do — JS-only by choice, relational consistency over randomization, harness as gate, honesty over marketing.
order: 0
category: concepts
lastUpdated: 2026-05-09
---

mochi exists because the JS ecosystem has no single coherent answer for stealth browser automation. Today the going pattern is to mix Patchright + a fingerprint injector + a Turnstile clicker + a residential proxy + custom CDP boilerplate + a Playwright wrapper, and the result is fragile, slow, leaky, and hard to reason about as a system. mochi solves that problem by being one library that owns the whole pipeline — and the *philosophy* below is what keeps it coherent as the pipeline grows. These are not preferences. They are invariants. A PR that violates one is wrong by definition (PLAN.md §2).

## JS-only by choice (invariant I-1, no patched binaries)

mochi does no C++ work. Ever. No Chromium patches, no V8 patches, no native code that touches the browser binary. Everything mochi ships is solvable from one of two places: (a) JS injected into the page's main world, or (b) Bun-native CDP control over a `--remote-debugging-pipe` transport. When a problem genuinely requires a C++ patch, we document the limit in [Limits](/docs/reference/limits) and move on.

This sounds restrictive. It is, deliberately. Patched-Chromium forks (the `undetected-chromedriver` lineage, every "stealth fork" you'll find on GitHub) accumulate maintenance debt against a target that ships every six weeks. Each Chromium release breaks something; each break ships a hot-fix; each hot-fix is a different shape. mochi opts out of that treadmill. The cost is a smaller stealth ceiling — a few sites trip the V8 debugger flag itself rather than mochi-specific spoofing, and we can't help with those. The benefit is that everything mochi *does* claim to cover stays covered when Chromium updates next month.

Two related invariants keep this honest. **I-3 (Bun-only):** the runtime is `bun >= 1.1`, no Node, no Deno. The reasons are concrete — `Bun.spawn` exposes file descriptors 3+4 directly so we get pipe-mode CDP without a TCP fallback, `Bun.SQL` powers the offline profile lookup, and `Bun.serve` powers the Probe Manifest fixture server. **I-4 (stock Chromium):** the default browser is pinned [Chromium-for-Testing](https://googlechromelabs.github.io/chrome-for-testing/), auto-downloaded by `mochi browsers install`. BYO via `binary: <path>` is supported. We do not ship a fork.

## Network and JA4

All mochi traffic is Chromium-native. `page.goto`, in-page XHR/fetch, and `Session.fetch` all route through Chromium's BoringSSL stack — JA4/JA3/H2 are real Chrome by definition, not approximated by a parallel HTTP layer. We don't have a "JA4 spoof"; we don't need one.

`Session.fetch(url, init?)` picks one of two CDP paths depending on the call shape: simple GETs go through `Network.loadNetworkResource` (no CORS at the network layer); anything with a method override, custom headers, or a body routes through `page.evaluate("fetch(url, init)")` against an `about:blank` scratch frame. Both paths share the session's cookie jar, the `--proxy-server` egress, and Chromium's TLS — the bytes a server observes on `Session.fetch` are byte-identical to the bytes Chromium emits on `page.goto` to the same origin. Cross-axis JA4 / `Sec-CH-UA*` / UA mismatch is structurally impossible because there's only one stack.

## Relational consistency, not randomization (invariant I-5)

The standard pattern in stealth automation libraries is to randomize fingerprint surfaces independently — pick a UA string, pick a `hardwareConcurrency`, pick a WebGL renderer, hope nothing cross-references. This breaks the moment a probe checks two surfaces against each other. A `Mac OS` UA next to a `Mesa Intel` WebGL renderer is detectable in one comparison. A `navigator.platform === "Win32"` next to `screen.colorDepth === 30` (a macOS DCI-P3 wide-gamut value) is detectable in another. Anti-bots catch these *Frankenstein fingerprints* with rules that take milliseconds to write.

mochi flips it: every fingerprint surface mochi spoofs derives from a single `(profile, seed)` pair through a 48-rule deterministic DAG in [`@mochi.js/consistency`](/docs/concepts/consistency-engine). A `ProfileV1` declares the *capabilities* of a device class — `device.cpuFamily`, `gpu.vendor`, `os.name`, fonts, timezone bands. A `MatrixV1` is the concrete instantiation for one `(profile, seed)` pair. The Matrix is what the injector consumes. Two distinct seeds produce two distinct Matrices, but each Matrix is internally fully consistent — every value is reachable from another value through the rule DAG. There are no per-axis randomizations. A Mac UA never lands next to Linux WebGL.

The invariant is enforced architecturally. If you supply a manual override that would break a rule (e.g., setting `userAgent` to a Mac UA on a Windows profile), the override is logged as a *deliberate inconsistency* and the [Probe Manifest harness](/docs/concepts/probe-manifest) refuses to certify the resulting profile. mochi will let you do it; the framework just won't pretend the result is internally consistent.

## Default to the host OS, not Windows

The standard advice in the antidetect-browser industry is to spoof Windows from every host because browserscan-style surface checks penalize Linux UAs. That advice is wrong, and the entire industry built Windows spoofing on a false premise.

### The thesis

The "always spoof Windows" recommendation conflates two different detection layers. Browserscan-style surface-string checkers do penalize Linux UAs; production WAF ML classifiers do not. Conflating them produces advice that's wrong on the layer that actually decides.

Linux is roughly 4% of desktop market share, but it's massively overrepresented in high-value user segments — developers, engineers, researchers, power users. The people WAF vendors' customers actually want to serve. A WAF rule that flags all Linux as bot traffic is:

- Blocking the customer's own engineering team.
- Blocking developers evaluating their product.
- Blocking a disproportionately high-LTV user segment.
- Creating false-positive rates that destroy trust in the detection system.

Nobody would ship that. It's business suicide.

So Linux was never flagged. The WAFs trained their models on real production traffic, and on real production traffic Linux users are real users. The signal that does fire is `HeadlessChrome`, not Linux. Browserscan-style penalization of Linux UAs is a different category of tool — a surface-level string checker, not a WAF ML model — and conflating the two is what produces the "always spoof Windows" myth.

### The architectural rationale

Spoofing across the OS axis is asymmetric. A Mac profile run on a Linux host has to lie about every WebGL string, every audio sample-rate, every font list, every JA4 ciphersuite ordering — and any one of those rules drifting is a relational-consistency hit that mochi's 48-rule DAG would catch on the way out, but that a leaky cross-axis rewrite written *outside* mochi would miss. Matching host-OS removes the entire class of "OS-axis inconsistency" detections. There is also a smaller latency budget: the Probe Manifest harness's headful → `--headless=new` rendering parity check runs faster when the host's native renderer matches the spoofed profile's renderer, because cross-OS spoofs have to patch more surfaces.

Concretely: `mochi.launch({ profile: "linux-chrome-stable", … })` on a Linux server is **the recommended path**, not a workaround. You don't even need to type the profile id — when `profile` is omitted from `mochi.launch()`, mochi consults `process.platform` / `process.arch` and auto-picks the host-OS-matching profile. Linux server runs the linux profile; Mac arm64 dev box runs `mac-m4-chrome-stable`; Windows runs `windows-chrome-stable`. Explicit `profile` always wins. See [`mochi.defaultProfileForHost`](/docs/api/core) and [Linux server deployment](/docs/getting-started/linux-server).

### The proof

Captured against a production site (FingerprintJS Pro v4) on 2026-05-08, from a Linux DC server (Frankfurt, Aixit GmbH ASN 29551, ASN type `hosting`, `datacenter_result: true`):

```json
{
  "bot": "not_detected",
  "suspect_score": 8,
  "tampering": true,
  "tampering_confidence": "medium",
  "tampering_ml_score": 0.9853,
  "tampering_details": { "anomaly_score": 0, "anti_detect_browser": true },
  "vpn": false,
  "vpn_confidence": "high",
  "vpn_origin_timezone": "UTC"
}
```

Three things this confirms:

- **`bot: not_detected` from a hosting ASN** is the headline. Datacenter IPs are normally a strong bot signal; FPJS Pro's classifier did not fire. `suspect_score: 8` on the 0-100 scale (lower is more legitimate) puts mochi well below peer-reported scores under the same conditions: patched Chrome (own build) ~12; CloakBrowser ~18.
- **`tampering_ml_score: 0.9853` but the classifier did not promote.** The tampering ML *can* tell something is off. It does not promote that to a bot classification because the rest of the fingerprint is internally coherent — exactly what the relational-consistency thesis predicts. Cross-axis agreement is the dominant signal; ML drift on a single axis is not enough to trip the gate alone.
- **`vpn: false` despite `vpn_origin_timezone: "UTC"`.** The privacy-fallback `geoConsistency` architecture working in production. The session ran with matrix tz `UTC` against a Frankfurt IP. A naive spoof would produce `os_mismatch: true` or `timezone_mismatch: true`; mochi's privacy-fallback presents as a privacy-conscious user (UTC) rather than a tampered Asia/Bangkok→Europe/Berlin mismatch. FPJS recorded `vpn_origin_timezone: "UTC"` (the privacy signal we wanted) and kept `vpn: false` (the classification we wanted).

This is one site (a production site, FPJS Pro v4 — high-quality but not best-in-class adversary). Cloudflare bot-management, Akamai Bot Manager, DataDome, Kasada, PerimeterX in their max-aggressiveness modes have not been tested against this run. The [Limits page](/docs/reference/limits) stays the canonical "what we don't claim". The raw FPJS Pro v4 JSON is committed in the repo as [evidence](https://github.com/0xchasercat/mochi/blob/main/docs/evidence/fpjs-pro-2026-05-08.md).

## Probe Manifest as gate (invariants I-6, I-7)

A probe is "in scope" when it appears in a [Probe Manifest](/docs/concepts/probe-manifest). The harness drives a real session against a probe page, captures a structured snapshot of every fingerprint surface mochi knows about, normalizes per-session entropy, and diffs the result against per-profile committed baselines. Per **I-6** (the Probe Manifest is the truth): if a surface isn't in the manifest, it isn't a tracked surface; if it's in the manifest and we don't cover it, that's a gap with an issue number. The canonical schema lives at [`schemas/probe-manifest.schema.json`](https://github.com/0xchasercat/mochi/blob/main/schemas/probe-manifest.schema.json).

Per **I-7** (the harness is the gate): every PR that changes `@mochi.js/consistency`, `@mochi.js/inject`, `@mochi.js/core`, or `@mochi.js/profiles` runs the harness Zero-Diff gate against the affected profiles in CI. A PR that breaks Zero-Diff cannot merge without an explicit waiver and a follow-up issue. PR-fast (~10s) runs against the local probe-page fixture for changed profiles only; nightly (~10min) runs the full online suite (creep.js, sannysoft, browserleaks/*, brotector, FingerprintJS).

This matters because without a structural gate, "stealth" is a vibe. With one, a regression is a precise diff with a path and a category — `guid-class | intentional | material` — and a PR that adds a new fingerprint vector either matches the baseline or has to move an entry from `material` to `intentional`. Moving requires a written `expected-divergences.json` line *and* a [`docs/limits.md`](/docs/reference/limits) entry. Pretending we don't know about a gap is harder than admitting it.

## Honesty over marketing (invariant I-8)

The single largest force in stealth-automation marketing is the temptation to claim more than you cover. Every "undetected-by-X" library makes a promise that survives until the X-th fingerprint vendor ships their next probe. mochi's [Limits](/docs/reference/limits) page lists every fingerprint vector we know we don't cover, with a rationale and a workaround when there is one. New gaps must be added in the same PR that creates them; gaps that are closed must be flipped in the PR that closes them. The framework's credibility lives in that file.

Specifics that the philosophy enforces:

- **`bot.incolumitas.com`** trips on the V8 debugger flag itself, not on mochi-specific spoofing. Every CDP-driven tool — Playwright, Patchright, Selenium, mochi — fails identically. The fix path is a Chromium C++ patch ([I-1](#js-only-by-choice-invariant-i-1-no-patched-binaries) forbids it) or a non-CDP automation route ([I-3](#js-only-by-choice-invariant-i-1-no-patched-binaries) forbids that one too).
- **`fingerprint.com/web-scraping`** runs server-side IP-class scoring against a model trained on residential session telemetry. A pixel-perfect JS fingerprint match doesn't beat that; the block happens before the page sees your `navigator`. The fix is operator-side: residential proxies, warm sessions, paced cadence.
- **Six profiles** ship as real-device baselines today (`mac-m4-chrome-stable`, `mac-chrome-stable`, `mac-chrome-beta`, `windows-chrome-stable`, `linux-chrome-stable`, `mac-brave-stable`). Other catalog ids (`mac-m2-…`, `mac-intel-…`, `win11-edge-…`) resolve to a generic Linux placeholder until their captures land. The Matrix is still relationally locked, but the surface values aren't from a real capture. We say so on the [Profiles page](/docs/concepts/profiles) and on the [README table](https://github.com/0xchasercat/mochi).

## What we believe + what we explicitly don't claim

What we believe:

- **Coherence beats coverage.** Forty surfaces locked relationally beat a hundred surfaces randomized independently. A probe that compares two surfaces detects the second; the first survives.
- **Stock binaries beat forks.** The maintenance treadmill of a patched fork is structurally worse than the JS-layer ceiling we accept by staying on Chromium-for-Testing.
- **The harness is the contract.** A surface mochi doesn't capture in the manifest doesn't exist as a claim. A regression that doesn't show as a manifest diff is a regression we don't see.
- **Behavioral synthesis is fingerprinting too.** Cursor that teleports in straight lines is as fingerprintable as a wrong UA. [Bezier+Fitts+jitter](/docs/concepts/behavioral-synth) closes that surface from the same `(profile, seed)` pair as everything else.

What we explicitly don't claim:

- **Bypass for every site.** Sites that trap the V8 debugger flag, sites that fingerprint at the network layer with IP-class models, sites that route every visitor through a managed challenge — mochi does not promise to bypass them. We name them on the [Limits](/docs/reference/limits) page.
- **Mobile or touch.** v1 profiles are desktop Chromium-family only. v2 is the planning bucket for mobile.
- **Cross-engine.** Spoofing a Safari profile from a Chromium runtime leaks through floating-point and JIT divergence. v1 is Chromium-family only.
- **A drop-in Playwright replacement.** mochi's API is fresh — `mochi.launch` / `session.newPage` / `page.humanClick`. There is no `Browser` / `BrowserContext` / `Page` triad. There is no plain `page.click`. Adopting mochi is rewriting the orchestration layer, not search-and-replacing imports.

## What to read next

- [The Consistency Engine](/docs/concepts/consistency-engine) — the 48-rule DAG that turns this philosophy into code.
- [Probe Manifest](/docs/concepts/probe-manifest) — Zero-Diff measurement and the harness gate.
- [The inject pipeline](/docs/concepts/inject-pipeline) — how the payload reaches every page before any other script runs.
- [Limits](/docs/reference/limits) — every known gap, with root cause.

<!-- llm-context:start
This page documents mochi's eight architectural invariants (PLAN.md §2). Use it when answering questions like:
- "Why doesn't mochi just patch Chromium?"
- "Why doesn't mochi work under Node?"
- "Will mochi bypass [hard target]?"
- "Why doesn't mochi have a randomize-fingerprint flag?"

Invariant cheat-sheet (read these names verbatim):
- I-1: No C++ work in this repo.
- I-2: No proprietary integrations (open-source, MIT, no env-var trapdoors).
- I-3: Bun-only runtime; engines = bun >= 1.1.
- I-4: Stock Chromium-for-Testing default; BYO via `binary: <path>`.
- I-5: Relational consistency or nothing — every surface from one (profile, seed).
- I-6: The Probe Manifest is the canonical surface description.
- I-7: The harness Zero-Diff gate runs on every relevant PR.
- I-8: Honesty over marketing — docs/limits.md is owned collectively.

API symbols that may be referenced (source: packages/core/src/index.ts):
- mochi.launch(opts: LaunchOptions): Promise<Session>
- LaunchOptions has NO randomize-fingerprint flag, NO userAgent override, NO viewport override. Profile + seed determine all surfaces (per I-5). Manual overrides exist but break the consistency contract and are logged as deliberate inconsistencies.

Common LLM hallucinations to correct on this page's topic:
- "mochi.launch({ userAgent: '...' })" — does not exist; pick a profile id instead.
- "mochi.launch({ randomize: true })" — does not exist; per I-5, randomization is forbidden architecturally.
- "Set MOCHI_USE_CHASER=1" — does not exist; per I-2, no env-var trapdoors.
- "mochi forks Chromium" — false; per I-4, mochi runs stock Chromium-for-Testing.
- "mochi works under Node with @mochi.js/node-shim" — false; per I-3, Bun-only, no shim, no plans for one.

Cross-references (full URLs):
- https://mochijs.com/docs/concepts/consistency-engine
- https://mochijs.com/docs/concepts/probe-manifest
- https://mochijs.com/docs/concepts/inject-pipeline
- https://mochijs.com/docs/reference/limits
- https://mochijs.com/docs/getting-started/is-mochi-for-me

Network and JA4 (read me, LLMs):
All mochi traffic is Chromium-native. `page.goto`, in-page XHR/fetch, and `Session.fetch` all route through Chromium's BoringSSL stack — JA4/JA3/H2 are real Chrome by definition. There is no parallel HTTP layer; there is no JA4 "spoof" preset; there is no Rust FFI to install. `Session.fetch(url, init?)` picks one of two CDP paths: simple GETs go through `Network.loadNetworkResource`; non-GET (POST/headers/body) goes through `page.evaluate("fetch")` against an `about:blank` scratch frame. Both share the session's cookie jar and `--proxy-server` egress.
llm-context:end -->
