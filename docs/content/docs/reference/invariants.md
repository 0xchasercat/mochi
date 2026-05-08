---
title: Architectural invariants
description: The eight invariants that any contributing change must honor. Distilled from PLAN.md §2.
order: 1
category: reference
lastUpdated: 2026-05-09
---

These are not preferences. They are invariants. Any PR that violates one is wrong by definition.

## I-1. No C++ work in this repo

Ever. No Chromium patches, no V8 patches, no native-code work that touches the browser binary. Everything mochi does is solvable from (a) JS injection, (b) Bun-native CDP control, or (c) the Rust FFI networking layer. When a problem genuinely requires a C++ patch, we document the limitation in [Limits](/docs/reference/limits) and move on.

## I-2. No proprietary integrations

mochi never reaches for proprietary infrastructure, never branches on env-var trapdoors that light up paid features. It is fully open-source, MIT-licensed, and equally useful to a solo developer with a laptop and to an enterprise with infrastructure.

## I-3. Bun-only runtime

`engines = bun >= 1.1`. Node is not a target. Deno is not a target. We use Bun:FFI, `Bun.spawn`, Bun's WebSocket and file-descriptor APIs natively. The `package.json` engines field rejects non-Bun installs.

## I-4. Stock Chromium binary

Default = pinned [Chromium-for-Testing](https://googlechromelabs.github.io/chrome-for-testing/), auto-downloaded by `mochi browsers install`. BYO is supported via `binary: <path>`. We do **not** ship a patched fork.

## I-5. Relational consistency or nothing

Every fingerprint surface mochi spoofs derives from a single `(profile, seed)` pair. No probe surface is ever set independently. If a user supplies an override, the override is logged as a *deliberate inconsistency* and the harness refuses to certify the profile. See [The Consistency Engine](/docs/concepts/consistency-engine).

## I-6. The Probe Manifest is the truth

The Probe Manifest schema is the canonical surface description. mochi's harness produces and diffs Probe Manifests. If it's not in the manifest, it's not a tracked surface; if it's in the manifest and we don't cover it, that's a gap with an issue number. See [Probe Manifest](/docs/concepts/probe-manifest).

## I-7. The harness is the gate

Every PR that changes `@mochi.js/consistency`, `@mochi.js/inject`, `@mochi.js/net`, or `@mochi.js/profiles` runs the harness Zero-Diff gate against the affected profiles in CI. A PR that breaks Zero-Diff cannot merge without explicit waiver and a follow-up issue.

## I-8. Honesty over marketing

[Limits](/docs/reference/limits) lists every fingerprint vector we know we don't cover, with a rationale. New gaps discovered must be added in the same PR that creates them. The framework's credibility lives in that document — pretending we don't know about a gap is harder than admitting it.
