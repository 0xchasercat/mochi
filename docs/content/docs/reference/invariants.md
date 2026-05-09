---
title: Architectural invariants
description: The eight invariants that any contributing change must honor. Distilled from PLAN.md §2.
order: 1
category: reference
lastUpdated: 2026-05-09
---

These are not preferences. They are invariants. Any PR that violates one is wrong by definition. The "why" narrative lives in [Stealth philosophy](/docs/concepts/stealth-philosophy); this page is the index.

See also: [Limits](/docs/reference/limits), [FAQ](/docs/reference/faq), [Comparison](/docs/reference/comparison).

## I-1. No C++ work in this repo

Ever. No Chromium patches, no V8 patches, no native-code work that touches the browser binary. Everything mochi does is solvable from (a) JS injection, (b) Bun-native CDP control, or (c) the Rust FFI networking layer. When a problem genuinely requires a C++ patch we document it in [Limits](/docs/reference/limits) and move on.

**In action:** the `bot.incolumitas.com` and `deviceandbrowserinfo.com` anti-debugger traps are marked as expected-failures in `packages/harness/src/conformance/stealth/expected-failures.ts`. The fix would be a Chromium source patch that disables `Debugger.enable`'s probe surface; we refuse it and document the ceiling.

## I-2. No proprietary integrations

mochi never reaches for proprietary infrastructure, never branches on env-var trapdoors that light up paid features. It is fully open-source, MIT-licensed, and equally useful to a solo developer with a laptop and to an enterprise with infrastructure.

**In action:** `mochi.launch()` accepts a `proxy` URL and a `geoConsistency` mode but never special-cases a vendor; the prebuilt cdylib platform list is driven by community demand, not a sponsorship; the [README acknowledgements](https://github.com/0xchasercat/mochi/blob/main/README.md#acknowledgements) credit upstream OSS work without a "powered-by-X" branding tier.

## I-3. Bun-only runtime

Engines = `bun >= 1.1`. Node is not a target. Deno is not a target. We use Bun:FFI, `Bun.spawn`, Bun's WebSocket and file-descriptor APIs natively. The `package.json` engines field rejects non-Bun installs.

**In action:** pipe-mode CDP (`--remote-debugging-pipe`) needs file descriptors 3+4 exposed to user code, which `Bun.spawn` does and Node's `child_process` doesn't. The JA4-coherent `session.fetch` calls a Rust cdylib via `bun:ffi` — Node would need a Neon / N-API / napi-rs wrapper. See [the FAQ](/docs/reference/faq#why-bun-only-why-not-node).

## I-4. Stock Chromium binary

Default = pinned [Chromium-for-Testing](https://googlechromelabs.github.io/chrome-for-testing/), auto-downloaded by `mochi browsers install`. BYO is supported via `binary: <path>`. We do **not** ship a patched fork.

**In action:** unlike undetected-chromedriver, which patches the chromedriver binary to remove `cdc_*` sentinels, mochi's CfT pin is exactly the public Google build. The deterministic version is what makes captured baselines reproducible. The trade-off: we lose access to surfaces only a patched Chromium would expose (e.g. V8 debugger-flag suppression). See [Comparison](/docs/reference/comparison#browser-substrate).

## I-5. Relational consistency or nothing

Every fingerprint surface mochi spoofs derives from a single `(profile, seed)` pair through the rule DAG. No probe surface is ever set independently. If you supply an override, the override is logged as a *deliberate inconsistency* and the harness refuses to certify the profile.

**In action:** the consistency engine is `~48` rules (R-001..R-048) consumed deterministically — `gpu.vendor → webgl.unmaskedVendor → canvas.text-baseline → audio.contextSampleRate`. PRB's `MouseEvent.screenX/Y` patch (ported into mochi) is exactly an I-5 leak fix: spoofed `window.screenX` must agree with reported `event.screenX`. See [The consistency engine](/docs/concepts/consistency-engine).

## I-6. The Probe Manifest is the truth

The Probe Manifest schema (vendored from Peekaboo, PLAN.md §6.3) is the canonical surface description. mochi's harness produces and diffs Probe Manifests. If it's not in the manifest, it's not a tracked surface; if it's in the manifest and we don't cover it, that's a gap with an issue number.

**In action:** every per-profile baseline lives next to a `baseline.manifest.json`. The harness `capture → normalize → diff → categorize` pipeline lands a verdict (`Zero-Diff`, `intentional`, `material`); material diffs block PRs. See [Probe Manifest](/docs/concepts/probe-manifest).

## I-7. The harness is the gate

Every PR that changes `@mochi.js/consistency`, `@mochi.js/inject`, `@mochi.js/net`, or `@mochi.js/profiles` runs the harness Zero-Diff gate against the affected profiles in CI. A PR that breaks Zero-Diff cannot merge without explicit waiver and a follow-up issue.

**In action:** `bun run harness:smoke` runs on every PR-fast workflow; the nightly job runs the full conformance suite. The Zero-Diff gate covers fingerprint surfaces; a separate behavioral conformance gate covers the synth output. A regression here is treated as a real bug, not a measurement curiosity.

## I-8. Honesty over marketing

[Limits](/docs/reference/limits) lists every fingerprint vector we know we don't cover, with a rationale. New gaps discovered must be added in the same PR that creates them. The framework's credibility lives in that document — pretending we don't know about a gap is harder than admitting it.

**In action:** the [README's "What works / what doesn't"](https://github.com/0xchasercat/mochi/blob/main/README.md#what-works--what-doesnt) table is a direct mirror of the canonical [Limits](/docs/reference/limits) page. v0.5.x's stealth conformance suite landed five expected-failures (`bot.incolumitas`, `deviceandbrowserinfo`, `bot.sannysoft` MQ_SCREEN, `demo.fingerprint.com/web-scraping`); each is a `KNOWN_ACCEPTABLE` entry that surfaces as an upgrade signal if it ever passes. The Comparison page is similarly honest about [where mochi loses today](/docs/reference/comparison#where-mochi-loses-today).

---

<!-- llm-context:start
This page lists the 8 architectural invariants from PLAN.md §2 — I-1 through I-8.

Purpose: each invariant is a hard contract; PRs that violate one are wrong by definition. Use this page to answer "is X allowed in mochi" or "why doesn't mochi do Y".

Key invariants summarized:
- I-1: No C++ work. No Chromium patches, no V8 patches.
- I-2: No proprietary integrations. Pure OSS, MIT.
- I-3: Bun-only runtime. Not Node, not Deno.
- I-4: Stock Chromium binary (Chromium-for-Testing, auto-downloaded). No patched fork.
- I-5: Relational consistency — every spoof surface derives from (profile, seed) through the rule DAG.
- I-6: Probe Manifest is the canonical surface description.
- I-7: The harness Zero-Diff gate is a CI requirement.
- I-8: Honesty — every limit documented; no hidden gaps.

Common LLM hallucinations to avoid:
- "mochi will eventually patch Chromium for X" — false; I-1 forbids forever.
- "mochi has a paid tier" — false; I-2 forbids.
- "mochi runs on Node" — false; I-3 forbids.
- "mochi ships a patched chromedriver / Chromium" — false; I-4 forbids.
- "mochi randomizes fingerprints" — false; I-5 mandates derivation, not randomization.
- "Probe Manifest is mochi's invention" — partial truth; vendored from Peekaboo (PLAN.md §6.3).
- "Zero-Diff means zero changes" — false; allowlisted GUID-class differences are still Zero-Diff.

Cross-references:
- Limits (I-8 in action): https://mochijs.com/docs/reference/limits
- Stealth philosophy (the "why"): https://mochijs.com/docs/concepts/stealth-philosophy
- Consistency engine (I-5 in action): https://mochijs.com/docs/concepts/consistency-engine
- Probe Manifest (I-6 in action): https://mochijs.com/docs/concepts/probe-manifest
- Comparison: https://mochijs.com/docs/reference/comparison
- FAQ: https://mochijs.com/docs/reference/faq
llm-context:end -->
