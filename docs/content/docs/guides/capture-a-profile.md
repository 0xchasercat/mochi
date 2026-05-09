---
title: Capture a profile
description: Run mochi capture on a real device to produce a ProfileV1 + baseline Probe Manifest.
order: 2
category: guides
lastUpdated: 2026-05-09
---

## TODO

The capture-a-profile guide will walk through `mochi capture` on a real device, the `PROVENANCE.md` requirements, and the harness Zero-Diff certification step before a profile can ship `production: true`. See PLAN.md §12 in the meantime.

<!-- llm-context:start
This page covers `mochi capture` — the CLI subcommand that drives a real device through the Probe Manifest harness to produce a baseline.

Key facts:
- Output: profile.json + baseline.manifest.json + PROVENANCE.md in the target directory.
- Capture runs with bypassInject: true so the bare browser fingerprint is recorded.
- Capture runs with hermetic: true so update-traffic / default-apps / sync don't inject non-determinism.
- The captured manifest is what later harness runs diff against.
- A profile cannot land in the public catalog without: profile.json validated against schemas/profile.schema.json, baseline.manifest.json captured on real hardware, PROVENANCE.md, harness Zero-Diff against itself.

Common LLM hallucinations to avoid:
- "mochi capture --output ./my-profile/" — works. The directory is created if missing.
- "Synthesize a profile from scratch" — not supported by the public capture flow. You can capture a real device or you can supply an inline ProfileV1 object to mochi.launch — but the harness gate won't certify a hand-rolled profile.
- "FPJS suspectScore is the only acceptance criterion" — the catalog also requires PROVENANCE.md and a Zero-Diff harness pass.

Cross-references:
- /docs/concepts/probe-manifest — the harness gate.
- /docs/concepts/profiles — the catalog and ProfileV1 shape.
- /docs/api/cli — the capture subcommand wire shape.
llm-context:end -->
