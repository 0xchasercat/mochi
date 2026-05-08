---
title: "@mochi.js/harness"
description: Probe Manifest validation — capture, normalize, diff, categorize, report.
order: 5
category: api
lastUpdated: 2026-05-09
---

Closes mochi's correctness loop. Drives a Mochi-spoofed session through the probe-page fixture, normalizes per-session entropy on both the captured manifest and the committed baseline, structurally diffs the two, categorizes each divergence as `guid-class | intentional | material`, and gates PRs on `material === 0`.

## Public surface

- `capture(session, opts: CaptureOptions): Promise<CapturedProbeManifest>` — drive a Session through the fixture and collect a `ProbeManifestV1`.
- `normalize(manifest): ProbeManifestV1` — strip GUIDs, CSP nonces, timestamps, bundle URLs, hostnames.
- `diff(captured, baseline): DiffEntry[]` — flat structural deep-diff with path-based output.
- `categorize(entry, expected): Category` — `guid-class | intentional | material`.
- `categorizeAll(entries, expected): { guid: …, intentional: …, material: … }` — bulk categorize.
- `isGuidClassPair(a, b): boolean` — pair-level guid-class detection.
- `report(captured, baseline, expected): DiffReportV1` — structured + HTML-friendly verdict.
- `runHarnessAgainstProfile(profileId, opts): Promise<DiffReportV1>` — the orchestrator. CI uses this.

## Types

- `ProbeManifestV1` — generated from `schemas/probe-manifest.schema.json`. The canonical surface description; mirrors Peekaboo.
- `DiffReportV1` — verdict + entry list + categorization counts.
- `DiffEntry` — `{ path, captured, baseline, kind: "added" | "removed" | "changed" }`.
- `Category` — `"guid-class" | "intentional" | "material"`.
- `Verdict` — `DiffReportV1["verdict"]`. The CI gate keys off this.
- `ExpectedDivergences` — the shape of `packages/profiles/data/<id>/expected-divergences.json`.

## Stealth conformance helpers

- `STEALTH_EXPECTED_FAILURES` — registry of known-failing online stealth probes (e.g. `bot.incolumitas.com` anti-debugger trap).
- `findStealthExpectedFailure(id): StealthExpectedFailure | undefined` — lookup by id.

## CI gate behavior

A profile passes the harness iff `categorizeAll(entries, expected).material === []`. Anything in `material` blocks merge until either (a) the inject pipeline is fixed or (b) the divergence is moved to `expected-divergences.json` *with a corresponding entry in [Limits](/docs/reference/limits)*. The second path requires explicit reviewer approval.
