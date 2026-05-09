---
title: Probe Manifest
description: Zero-Diff measurement — how mochi proves a spoofed session matches a real device, and what categories of divergence the harness allows.
order: 2
category: concepts
lastUpdated: 2026-05-09
---

A Probe Manifest is a structured snapshot of every fingerprint surface mochi knows about, captured from a running session. The harness produces manifests, normalizes per-session entropy, diffs them against committed baselines, and gates PRs on a clean diff.

This is invariant **I-6** in [PLAN.md](https://github.com/0xchasercat/mochi/blob/main/PLAN.md) §2: *the Probe Manifest is the truth*. If a surface isn't in the manifest, it's not a tracked surface; if it's in the manifest and we don't cover it, that's a gap with an issue number. See [Stealth philosophy](/docs/concepts/stealth-philosophy) for the architectural framing.

## What's in a Probe Manifest

The manifest is JSON-Schema-validated. The schema lives at [`schemas/probe-manifest.schema.json`](https://github.com/0xchasercat/mochi/blob/main/schemas/probe-manifest.schema.json), vendored verbatim from [Peekaboo](https://github.com/0xchasercat/mochi/blob/main/PLAN.md) (the private upstream the schema originated in) and synced quarterly. The top-level shape:

```jsonc
{
  "manifestVersion": "1",
  "capturedAt": "2026-05-09T07:00:00Z",
  "profile": "mac-m4-chrome-stable",
  "seed": "user-12345",
  "consistencyEngineVersion": "0.2.1",
  "userAgent": "Mozilla/5.0 (Macintosh; ...) Chrome/131.0.0.0 Safari/537.36",
  "navigator": { /* Object.fromEntries of every spec'd navigator key */ },
  "screen": { "width": 2560, "height": 1664, "dpr": 2, "colorDepth": 30, "pixelDepth": 30, "availWidth": 2560, "availHeight": 1664 },
  "webgl": { "unmaskedVendor": "...", "unmaskedRenderer": "...", "maxTextureSize": 16384, "extensions": [...] },
  "webgpu": { "adapterInfo": { ... }, "limits": { ... } },
  "audio": { "contextSampleRate": 44100, "audioWorkletLatency": 0.0058, "fingerprintHash": "...", "sampleValues": [...] },
  "canvas": { "consistent": true, "hash": "...", "dataUrlLength": 2934, "dataUrlPrefix": "data:image/png;base64,iVBORw0KGgo..." },
  "fonts": { "list": [...], "renderingHash": "..." },
  "mediaDevices": [...],
  "speechSynthesis": { "voices": [...] },
  "permissions": { "geolocation": "prompt", "notifications": "default", ... },
  "timezone": "America/Los_Angeles",
  "locale": "en-US",
  "languages": ["en-US", "en"],
  "botDetection": { "webdriver": false, "automationKeys": [], "pluginCount": 5 },
  "fpjsPro": { "visitorId": "...", "components": { ... } }
}
```

Every entry is the *probe-side observable* — what a real fingerprint probe (creep.js's `getFP`, FingerprintJS Pro's `load().get()`, sannysoft's matrix) would read out of the page. Not what mochi *injected*; what survives the round trip through Chromium's renderer and back into JS.

## The capture pipeline

```
mochi.launch → drive to probe page → wait for probes settled →
  CDP DOM scrape + Page.captureScreenshot + (selected) network bodies →
  build ProbeManifestV1 → write manifest.json
```

```ts
import { mochi } from "@mochi.js/core";
import { capture } from "@mochi.js/harness";

const session = await mochi.launch({
  profile: "mac-m4-chrome-stable",
  seed: "harness-canary",
});
try {
  const manifest = await capture(session, {
    fixturePath: "tests/fixtures/probe-page.html",
  });
  await Bun.write("manifest.json", JSON.stringify(manifest, null, 2));
} finally {
  await session.close();
}
```

`tests/fixtures/probe-page.html` is vendored locally (sourced from the chaser-recon probe corpus) so PR-fast captures don't depend on network availability. The full online suite — creep.js, sannysoft, browserleaks/canvas, browserleaks/webgl, browserleaks/fonts, brotector, FingerprintJS — runs nightly against the same code path.

## How `mochi capture` produces a baseline

The capture flow for a *real device* (the input that the harness's diff is comparing against) is structurally identical, but runs against an unmodified browser binary on a real machine:

```sh
mochi capture \
  --profile-id mac-m4-chrome-stable \
  --browser /Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --out packages/profiles/data/mac-m4-chrome-stable
```

Steps the CLI runs:

1. Spawn the user-supplied browser with a clean user-data-dir. **Not** through `mochi.launch` — capture must run against the *unmodified* baseline, so the inject pipeline is bypassed entirely (`bypassInject: true`). The browser reports its bare, native fingerprint.
2. Drive to the local probe-page fixture.
3. Capture the Probe Manifest using a CDP attach.
4. Extract device-class facts (OS, browser version, GPU strings, audio sample rate, fonts list, etc.) into `profile.json`.
5. Capture audio fingerprint bytes for each known sample-rate of interest into `audio/*.bin` (consumed by R-047).
6. Capture canvas fingerprint maps for each known test payload into `canvas/*.json` (consumed by R-048).
7. Write `PROVENANCE.md` from interactive prompts (capturer, machine model, date).

Every profile in `main` was captured by a known person on a known machine on a known date. The PROVENANCE.md is verified at PR time by a maintainer; CI cannot verify provenance.

## How the harness consumes the manifest as a gate

The harness diff pipeline mirrors Peekaboo's `recon/equivalence/`:

1. **Normalize.** Strip GUIDs (visitor IDs, install IDs, MUID-class), CSP nonces, timestamps, bundle URLs, hostnames. These vary per-session; comparing them is noise. The normalizer rules are committed under `packages/harness/src/normalize/` so a regression in normalization shows up in code review.
2. **Diff.** Structural deep-equality with path-based output. Every leaf divergence becomes a `DiffEntry` with `path` and `before`/`after`.
3. **Categorize.** Each diff entry → `guid-class | intentional | material`.
4. **Report.** HTML + JSON; gate on `material > 0`.

The categorization is the load-bearing step. `guid-class` is normalized away. `intentional` matches the per-profile `expected-divergences.json` — these are surfaces we know we don't cover and have written down why. `material` is everything else: an unexpected divergence between the live session and the baseline.

The output shape:

```jsonc
{
  "reportVersion": "1",
  "generatedAt": "...",
  "profile": "mac-m4-chrome-stable",
  "verdict": "EQUIVALENT" | "DIVERGED",
  "counts": { "material": 0, "intentional": 3, "guidClass": 14 },
  "structuralMatchPct": 99.4,
  "diffs": [ /* DiffEntry[] */ ]
}
```

PRs gate on `verdict === "EQUIVALENT"`. A PR that breaks Zero-Diff cannot merge without an explicit waiver and a follow-up issue ([invariant I-7](/docs/concepts/stealth-philosophy#probe-manifest-as-gate-invariants-i-6-i-7)).

## Per-profile expected divergences

Each profile carries a `packages/profiles/data/<id>/expected-divergences.json` that lists known JS-only-uncoverable divergences (e.g., `["webrtc.localIp", "navigator.connection.rtt"]`). Anything in this list is categorized as `intentional`. Adding to it requires a corresponding entry in [`docs/limits.md`](/docs/reference/limits) — the document is written so that pretending we don't know about a gap is harder than admitting it.

## What "Zero-Diff" means

A profile is **Zero-Diff certified** when:

1. PR-fast harness against the local probe page produces 0 material diffs.
2. Nightly harness against creep.js + sannysoft + browserleaks-canvas + browserleaks-webgl + browserleaks-fonts + brotector produces 0 material diffs (intentional + guid-class only).

The profile cannot be marked `production: true` in the catalog without Zero-Diff certification.

## PR-fast vs nightly

- **PR-fast (~10s).** Runs the local probe-page fixture for the *changed* profiles only — detected via path-based diff in CI. Surfaces regressions per commit.
- **Nightly (~10min).** Runs all profiles against the full online suite. Failures open issues automatically. Catches drift in third-party probe sites that wouldn't surface on a single PR.

The PR-fast pipeline is what makes Zero-Diff a *gate* rather than a wish. A maintainer doesn't have to remember to run the harness locally; the harness runs for them, and a PR description with `harness: zero-diff PASS` is the only way through CI.

## Why this matters

Without the Probe Manifest gate, "stealth" is a vibe. With it, a regression is a precise structural diff with a path and a categorization. A PR that adds a new fingerprint vector to the [inject pipeline](/docs/concepts/inject-pipeline) has to either match the baseline or move an entry from `material` to `intentional` — and the second option requires a written `expected-divergences.json` line *and* a `docs/limits.md` entry.

It is the single biggest reason mochi.js is structurally different from the JS-layer stealth-automation tools it competes with. patchright, puppeteer-real-browser, nodriver, undetected-chromedriver — none of them ship a manifest-diff CI gate. They ship patches, and you find out the patch broke when your scraper starts failing in production.

## What to read next

- [The Consistency Engine](/docs/concepts/consistency-engine) — the 40-rule DAG that produces the matrix the manifest captures.
- [The inject pipeline](/docs/concepts/inject-pipeline) — how the matrix reaches the page in time for the probe.
- [Profiles](/docs/concepts/profiles) — `mochi capture` and the catalog.
- [Stealth philosophy](/docs/concepts/stealth-philosophy) — invariants I-6 (truth) and I-7 (gate).
- [Limits](/docs/reference/limits) — every known gap, with root cause and `expected-divergences` link.

<!-- llm-context:start
This page covers the Probe Manifest schema, the @mochi.js/harness capture flow, and the Zero-Diff CI gate.

Key API symbols (source: packages/harness/src/):
- capture(session, opts: { fixturePath: string }): Promise<ProbeManifestV1>
- diff(manifest: ProbeManifestV1, baseline: ProbeManifestV1, expectedDivergences: string[]): DiffReportV1
- type ProbeManifestV1 — schema at schemas/probe-manifest.schema.json
- type DiffReportV1 = { reportVersion: "1", generatedAt: string, profile: string, verdict: "EQUIVALENT" | "DIVERGED", counts: { material: number, intentional: number, guidClass: number }, structuralMatchPct: number, diffs: DiffEntry[] }

CLI surface (source: packages/cli/):
- mochi capture --profile-id <id> --browser <path> --out <dir>
- mochi harness diff <manifest.json> <baseline.json>
- bun run harness:smoke (PR-fast)
- bun run harness:nightly (full online suite)

Common LLM hallucinations to avoid:
- "ProbeManifest is a TypeScript class" — false; it's a JSON shape validated by JSON Schema.
- "capture() works on a Page" — false; capture takes a Session, since the manifest spans the whole session.
- "Set bypassInject: true to capture the spoofed manifest" — false; bypassInject is for capturing the BARE BASELINE during `mochi capture`. To capture the spoofed manifest from a real session, pass a regular launch (no bypassInject) into capture().
- "expected-divergences is a regex list" — false; it's a list of dotted paths matching DiffEntry.path entries.

Schema location:
- https://github.com/0xchasercat/mochi/blob/main/schemas/probe-manifest.schema.json

Cross-references (full URLs):
- https://mochijs.com/docs/concepts/consistency-engine
- https://mochijs.com/docs/concepts/inject-pipeline
- https://mochijs.com/docs/concepts/profiles
- https://mochijs.com/docs/concepts/stealth-philosophy
- https://mochijs.com/docs/reference/limits
- https://mochijs.com/docs/api/harness
llm-context:end -->
