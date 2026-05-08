---
title: Probe Manifest
description: Zero-Diff measurement — how mochi proves a spoofed session matches a real device, and what categories of divergence the harness allows.
order: 2
category: concepts
lastUpdated: 2026-05-09
---

A Probe Manifest is a structured snapshot of every fingerprint surface mochi knows about, captured from a running session. The harness produces manifests, normalizes per-session entropy, diffs them against committed baselines, and gates PRs on a clean diff.

This is invariant **I-6** in PLAN.md: *the Probe Manifest is the truth*. If a surface isn't in the manifest, it's not a tracked surface; if it's in the manifest and we don't cover it, that's a gap with an issue number.

## The capture pipeline

```
mochi.launch → drive to probe page → wait for probes settled →
  CDP DOM scrape + Page.captureScreenshot + (selected) network bodies →
  build ProbeManifestV1 → write manifest.json
```

`tests/fixtures/probe-page.html` is vendored locally — every PR runs this fixture against the changed profiles. The full online suite (creep.js, sannysoft, browserleaks/*, brotector, FingerprintJS) runs nightly.

```ts
import { capture } from "@mochi.js/harness";

const manifest = await capture(session, {
  fixturePath: "tests/fixtures/probe-page.html",
});
```

## The diff pipeline

Mirrors Peekaboo's `recon/equivalence/`:

1. **Normalize.** Strip GUIDs (visitor IDs, install IDs, MUID-class), CSP nonces, timestamps, bundle URLs, hostnames. These vary per-session; comparing them is noise.
2. **Diff.** Structural deep-equality with path-based output.
3. **Categorize.** Each diff entry → `guid-class | intentional | material`.
4. **Report.** HTML + JSON; gate on `material > 0`.

The categorization is the load-bearing step. `guid-class` is normalized away. `intentional` matches the per-profile `expected-divergences.json` — these are surfaces we know we don't cover and have written down why. `material` is everything else: an unexpected divergence between the live session and the baseline.

## Per-profile expected divergences

Each profile carries a `packages/profiles/data/<id>/expected-divergences.json` that lists known JS-only-uncoverable divergences (e.g., `["webrtc.localIp"]`). Anything in this list is categorized as `intentional`. Adding to it requires a corresponding entry in [`docs/limits.md`](/docs/reference/limits) — the document is written so that pretending we don't know about a gap is harder than admitting it.

## The "Zero-Diff" definition

A profile is **Zero-Diff certified** when:

1. PR-fast harness against the local probe page produces 0 material diffs.
2. Nightly harness against creepjs + sannysoft + browserleaks-canvas + browserleaks-webgl + browserleaks-fonts + brotector produces 0 material diffs (intentional + guid-class only).

The profile cannot be marked `production: true` in the catalog without Zero-Diff certification.

## PR-fast vs nightly

- **PR-fast (~10s).** Runs the local probe-page fixture for the *changed* profiles only — detected via path-based diff in CI. Surfaces regressions per commit.
- **Nightly (~10min).** Runs all profiles against the full online suite. Failures open issues automatically. Catches drift in third-party probe sites that wouldn't surface on a single PR.

## Why this matters

Without the Probe Manifest gate, "stealth" is a vibe. With it, a regression is a precise structural diff with a path and a categorization. A PR that adds a new fingerprint vector to the inject pipeline has to either match the baseline or move an entry from `material` to `intentional` — and the second option requires a written `expected-divergences.json` line and a `docs/limits.md` entry.

It is the single biggest reason mochi.js is structurally different from the JS-layer stealth-automation tools it competes with.
