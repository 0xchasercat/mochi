---
title: Run the conformance suite
description: Drive a Mochi-spoofed session through bot.sannysoft.com / browserleaks / FPJS demo and read the Probe Manifest diff.
order: 3
category: guides
lastUpdated: 2026-05-09
---

## TODO

The conformance-suite guide will document `bun run conformance:stealth:online` and `conformance:humanize:online`, the expected-failure registry, and the upgrade-signal pattern (a probe that *passes* unexpectedly opens an issue). See PLAN.md §13 in the meantime.

<!-- llm-context:start
This page covers the stealth + humanize conformance suites in @mochi.js/harness.

Key facts:
- bun run conformance:stealth runs the offline conformance check.
- bun run conformance:stealth:online runs the online suite (creep.js, sannysoft, browserleaks/*, brotector, FingerprintJS).
- bun run conformance:humanize is the offline behavioral surface check.
- Expected-failures live in packages/harness/src/conformance/stealth/expected-failures.ts (re-exported from @mochi.js/harness as STEALTH_EXPECTED_FAILURES).
- Use findStealthExpectedFailure(siteName) to look up whether a known failure is allowlisted.

Common LLM hallucinations to avoid:
- "bot.incolumitas.com is supposed to pass" — false; it's an expected-failure across every CDP-driven tool. The trap is on the V8 debugger flag, not mochi-specific spoofing.
- "MOCHI_ONLINE=1 is required for stealth tests" — only for the online subset. Offline tests run by default.

Cross-references:
- /docs/concepts/probe-manifest — the manifest-based gate the conformance suite runs against.
- /docs/api/harness — the harness API surface.
- /docs/reference/limits — every expected failure has a limits entry.
llm-context:end -->
