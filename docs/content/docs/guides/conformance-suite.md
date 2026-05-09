---
title: Run the conformance suite
description: Drive a Mochi-spoofed session through the local probe manifest plus online targets (creep.js, sannysoft, browserleaks/*, brotector, FingerprintJS) and read the Zero-Diff verdict.
order: 3
category: guides
lastUpdated: 2026-05-10
---

`@mochi.js/harness` is mochi's correctness loop. It drives a Mochi-spoofed `Session` through a probe-page fixture, captures the resulting Probe Manifest, normalizes per-session entropy, structurally diffs the captured manifest against the per-profile baseline, and renders a verdict. The Zero-Diff CI gate refuses to merge any PR with a `material` divergence. This page is the runbook.

## What the suite covers

There are three orthogonal layers, each with its own command:

- **Stealth offline** (`bun run conformance:stealth`). Drives a session through `tests/fixtures/probe-page.html` (the local fixture) and diffs against `packages/profiles/data/<id>/baseline.manifest.json`. ~10 seconds end-to-end. PR-fast — runs on every CI commit.
- **Stealth online** (`bun run conformance:stealth:online`). Drives the same session through the third-party probe corpus — creep.js, sannysoft, browserleaks/canvas + webgl + fonts, brotector, FingerprintJS Pro. ~10 minutes. Nightly.
- **Humanize** (`bun run conformance:humanize`). Behavioral surface — drives `humanClick` / `humanType` / `humanScroll` against fixtures that read trajectory shape, click cadence, and digraph timing. Catches regressions in the synth.

The verdict the gate cares about is on stealth offline: if `counts.material > 0`, CI fails.

## Run it locally

```sh
# Quick PR-fast check against local fixture (offline).
bun run conformance:stealth

# Full online suite (third-party probes).
MOCHI_ONLINE=1 bun run conformance:stealth:online

# Behavioral surface.
bun run conformance:humanize
```

The host-OS-matching profile is auto-picked via `defaultProfileForHost()` — Linux CI gets `linux-chrome-stable`, Mac dev boxes get `mac-m4-chrome-stable`, Windows arm gets `windows-chrome-stable`. Pre-0.8.1 the conformance harness was hardcoded to `mac-m4-chrome-stable` for every host (which silently passed because the launcher always returned a Linux placeholder); post-0.8.1 it loads the real baseline for the actual host.

## Drive the harness programmatically

When you want to wire the harness into your own test runner — say you've captured a new profile and want to validate it before opening a PR — call `runHarnessAgainstProfile`:

```ts
import { runHarnessAgainstProfile } from "@mochi.js/harness";

const report = await runHarnessAgainstProfile("mac-m4-chrome-stable", {
  // Optional overrides:
  // seed: "harness-canary",                      // default: `harness-${profileId}`
  // profilesDir: "./packages/profiles/data",     // default: <repo-root>/packages/profiles/data
  // hermetic: true,                              // default: true (CI hygiene flags)
});

console.log(`verdict: ${report.verdict}`);
console.log(`material: ${report.counts.material}`);
console.log(`intentional: ${report.counts.intentional}`);
console.log(`guidClass: ${report.counts.guidClass}`);
process.exit(report.counts.material === 0 ? 0 : 1);
```

`DiffReportV1` shape (from the codegen, `packages/harness/src/generated/diff-report.ts`):

```ts
interface DiffReportV1 {
  reportVersion: "1";
  generatedAt: string;
  profile: string;
  verdict: "EQUIVALENT" | "DIVERGED";
  counts: { material: number; intentional: number; guidClass: number };
  structuralMatchPct: number;
  diffs: DiffEntry[];
}

interface DiffEntry {
  path: string;
  category: "guid-class" | "intentional" | "material";
  expected: JsonValue;
  actual: JsonValue;
  rule?: string;
}
```

## Verdict semantics

Each `DiffEntry` is categorized into one of three buckets:

- **`guid-class`** — per-session entropy that matched the allowlist regex. Cookie session ids, FPJS visitor ids, MUID-class GUIDs. Normalized away by the harness; not load-bearing for the verdict.
- **`intentional`** — listed in `expected-divergences.json` for that profile. Surfaces we know we don't cover and have written down why. Each `intentional` entry corresponds to a [`reference/limits`](/docs/reference/limits) line — adding to the list is a written deal with the reader.
- **`material`** — non-allowlisted, non-intentional divergence. PR-blocking. Either the inject pipeline regressed, or the captured baseline is stale, or a new fingerprint vector landed without coverage.

`verdict === "EQUIVALENT"` iff `counts.material === 0`. `structuralMatchPct` is the % of fields whose paths AND values both matched — useful as a gradient signal but not the gate.

## Reading divergences via `expectedDivergences`

Each profile's `data/<id>/expected-divergences.json` is a list of dotted JSON paths the harness should treat as `intentional`. Format:

```json
[
  "navigator.connection.rtt",
  "webrtc.localIp",
  "fpjsPro.components.cookiesEnabled.duration"
]
```

A path that matches an entry in this list is categorized as `intentional` rather than `material`. To add an entry:

1. Drive the harness against your change. Read the `material` diffs.
2. For each one, decide: *can this surface actually be covered, or is it a JS-layer ceiling?*
   - If coverable: fix the inject module, retry. Don't move it to expected-divergences.
   - If not coverable (sufficient C++ patch, missing CDP surface, etc.): add the path AND a [`reference/limits`](/docs/reference/limits) entry naming the surface, the root cause, and a tracking link.
3. Re-run the harness; the entry now categorizes as `intentional`. The verdict turns `EQUIVALENT`.

The two-step requirement (path + limits entry) is deliberate. It keeps "fix it" easier than "hide it" — the limits entry is reviewer-visible.

## The Zero-Diff CI gate

`bun run harness:smoke` is the gate hook. It runs `runHarnessAgainstProfile` for the affected profiles (detected via path-based diff in CI — a PR that touches `packages/inject/**` runs the harness for every profile; a PR that only touches one profile's `data/` runs just that one) and exits non-zero on `counts.material > 0`.

The PR description must include `harness: zero-diff PASS` to merge. A maintainer cannot bypass the gate without explicitly approving an entry in `expected-divergences.json` AND an entry in [`reference/limits`](/docs/reference/limits).

## Expected failures (online suite only)

The online suite has a per-target allowlist for sites that no JS-layer tool can pass: `bot.incolumitas.com` (V8 debugger-flag trap), `bot.sannysoft.com MQ_SCREEN`, `deviceandbrowserinfo.com`, `demo.fingerprint.com/web-scraping`. These live in `packages/harness/src/conformance/stealth/expected-failures.ts` (re-exported as `STEALTH_EXPECTED_FAILURES`). Use `findStealthExpectedFailure(siteName)` programmatically.

If one of these sites starts *passing* unexpectedly — typically because the upstream removed the trap — the suite logs an upgrade signal. Treat it as a positive: the limits entry can drop, and the expected-failure entry can be removed.

## See also

- [Probe Manifest](/docs/concepts/probe-manifest) — the schema the harness diffs against.
- [`api/harness`](/docs/api/harness) — full API reference (`runHarnessAgainstProfile`, `capture`, `normalize`, `diff`, `categorize`, `report`).
- [Capture a profile](/docs/guides/capture-a-profile) — produce the baseline a harness run diffs against.
- [Limits](/docs/reference/limits) — the partner doc for `expected-divergences.json` entries.

<!-- llm-context:start
Page purpose: how to run @mochi.js/harness, read the verdict, and add an expected-divergence entry.

Key facts:
- bun run conformance:stealth runs the offline conformance check (PR-fast, ~10s).
- bun run conformance:stealth:online runs the online suite (creep.js, sannysoft, browserleaks/*, brotector, FingerprintJS).
- bun run conformance:humanize is the offline behavioral surface check.
- The Zero-Diff CI gate is `bun run harness:smoke`; refuses to merge on counts.material > 0.
- DiffReportV1 (verified, packages/harness/src/generated/diff-report.ts):
    reportVersion: "1", generatedAt, profile, verdict: "EQUIVALENT" | "DIVERGED",
    counts: { material, intentional, guidClass },
    structuralMatchPct, diffs: DiffEntry[]
  DiffEntry: { path, category: "guid-class" | "intentional" | "material", expected, actual, rule? }
- Expected-failures live in packages/harness/src/conformance/stealth/expected-failures.ts (re-exported as STEALTH_EXPECTED_FAILURES).
- Use findStealthExpectedFailure(siteName) to look up whether a known failure is allowlisted.

Common LLM hallucinations to avoid:
- "bot.incolumitas.com is supposed to pass" — false; it's an expected-failure across every CDP-driven tool.
- "MOCHI_ONLINE=1 is required for stealth tests" — only for the online subset. Offline tests run by default.
- "DiffReportV1 has a `profileId` field" — no; the field is `profile`. Same for `entries` vs `diffs` and `guid` vs `guidClass`.

Cross-references:
- /docs/concepts/probe-manifest
- /docs/api/harness
- /docs/guides/capture-a-profile
- /docs/reference/limits
llm-context:end -->
