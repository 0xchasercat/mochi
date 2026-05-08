# 0050: harness MVP

**Package:** `harness` (with `cli` for `mochi harness` subcommand + tiny `core` reuse for the bypass-inject path)
**Phase:** `0.5`
**Estimated size:** L
**Dependencies:** 0001, 0011 (CDP transport), 0020 (consistency), 0030 (inject — to drive a Mochi session for the diff-target), 0040 (capture tool + tests/fixtures/probe-page.html), real `mac-m4-chrome-stable` baseline merged at `1d2b6cc`

## Goal

Implement `@mochi.js/harness` per PLAN.md §5.7 + §13. Closes the framework's correctness loop: drive a Mochi-spoofed session against the same `tests/fixtures/probe-page.html` that produced the captured baseline; capture the Mochi-driven probe output; normalize per-session entropy; structurally diff vs. baseline; categorize each divergence as `guid-class | intentional | material`; gate on `material === 0`. After this lands, `bun harness:diff mac-m4-chrome-stable` produces a verdict, and `bun harness:smoke` runs as the PR-fast gate (already a placeholder script in root package.json since 0001).

This task IS the framework's correctness contract. It tells us, empirically, whether phases 0.2 (Matrix derivation) + 0.3 (inject) actually produce a Mochi-driven session whose probe output matches a real bare-browser baseline. v0.5 covers the 30 rules from v0.2; the remaining 50+ surfaces (audio bytes, full canvas, full WebGL extensions, etc.) will surface as `intentional` divergences (out of scope per phase 0.7) until they land.

## Success criteria

### `@mochi.js/harness` public surface

- [ ] `capture(session: Session, opts?: { fixtureUrl?: string }): Promise<ProbeManifestV1>` — drive an existing Mochi `Session` to the probe-page fixture, wait for `__probesReady`, read `#probes`, parse + return as `ProbeManifestV1`. Default `fixtureUrl` is `file://${repoRoot}/tests/fixtures/probe-page.html`.
- [ ] `normalize(m: ProbeManifestV1): NormalizedManifest` — strip per-session entropy: visitor IDs, install IDs, MUID-class GUIDs, per-run timestamps, CSP nonces. Mirror Peekaboo's normalize patterns from `Peekaboo/peekaboo/research/62-equivalence-harness.md` (§"What gets normalized" table). Replace stripped values with sentinel placeholders (`<HEX32_GUID>`, `<EVENT_ID>`, `<TS>`, etc.).
- [ ] `diff(a: NormalizedManifest, b: NormalizedManifest): DiffEntry[]` — structural deep-equality producing a flat `DiffEntry[]`. Each entry: `{ path: string; left: JsonValue | undefined; right: JsonValue | undefined; }`.
- [ ] `categorize(d: DiffEntry, expectedDivergences?: string[]): "guid-class" | "intentional" | "material"` — per the rules in PLAN.md §13.3:
  - `guid-class`: both sides carry sentinel placeholders that, when collapsed to `<G>`, are equal. Allowlisted per-session entropy.
  - `intentional`: path matches an entry in `packages/profiles/data/<id>/expected-divergences.json` (a file we ship per profile), or matches a category from `docs/limits.md`'s explicit-deferral list (audio bytes, canvas hash, full WebGL extensions). PLAN.md §13.4.
  - `material`: everything else. The PR-blocking class.
- [ ] `report(profileId: string, diffs: DiffEntry[]): DiffReportV1` — produce a `DiffReportV1` (codegen'd type from `schemas/diff-report.schema.json` from 0003) with `verdict`, counts, structuralMatchPct, full diff list. Optional `report.html()` returns a viewable HTML rendering for the orchestrator to inspect.
- [ ] `runHarnessAgainstProfile(profileId: string, opts?: { online?: boolean }): Promise<DiffReportV1>` — the orchestrator entry point. Resolves the profile from `@mochi.js/profiles`, derives the matrix, launches a Mochi session, captures, normalizes both sides, diffs, categorizes, reports. Closes the session.

### CLI integration

- [ ] `mochi harness <profile-id> [--include-online] [--out <path>]` — runs `runHarnessAgainstProfile` and prints the verdict. With `--out`, writes the full `DiffReportV1` JSON + HTML side-by-side. Without `--out`, prints just the verdict + count summary.
- [ ] `mochi harness all [--include-online]` — runs against every profile in `packages/profiles/data/`. Phase 0.5 catalog has only `mac-m4-chrome-stable`; future phases add more.

### Per-profile expected divergences

- [ ] `packages/profiles/data/<id>/expected-divergences.json` — JSON list of dotted paths (or path glob patterns) the harness treats as `intentional` for that profile. Must be human-reviewed at PR time.
- [ ] For `mac-m4-chrome-stable`: pre-populate with the v0.5-known-divergent surfaces:
  - `probes.audio.fingerprintBytes` (deferred to phase 0.7)
  - `probes.canvas.toDataURL` (deferred to phase 0.7)
  - `probes.webgl.extensions[*]` BEYOND the curated R-024 set (M4 ships extensions our v0.2 lookup doesn't know about — phase 0.7 polish)
  - `probes.fonts.list[*]` BEYOND the curated R-013 set (full per-device fonts deferred to phase 0.7)
  - `probes.media.devices[*]` (not spoofed at v0.3; phase 0.7)
  - `probes.speech.voices[*]` (not spoofed at v0.3; phase 0.7)
  - `probes.userAgent` is **NOT** an expected divergence — the consistency engine's R-004 rebuilds the UA from primitives, dropping the HeadlessChrome leak that's in the captured baseline. The harness should see the Mochi-driven UA differ from baseline (no HeadlessChrome) and that's a `material` divergence to investigate.

  WAIT. Actually reread: the baseline captures bare-Chromium HeadlessChrome UA. The Mochi session injects a clean UA via R-004. So the diff WILL show: baseline UA = "...HeadlessChrome/147.0.0.0..." vs Mochi UA = "...Chrome/147..." (or whatever R-004 produces). That IS a divergence. But it's INTENTIONAL — the spoofing is correct; the baseline includes a leak we explicitly want to suppress. Add `probes.navigator.userAgent` to the intentional list with a comment explaining: "baseline contains HeadlessChrome leak; consistency engine R-004 rebuilds clean UA from primitives".

### Harness gate wiring

- [ ] Replace the `harness:smoke`, `harness:full`, `harness:diff` placeholder echo scripts in root `package.json` with real implementations that delegate to `bun packages/cli/src/bin.ts harness ...`.
- [ ] `harness:smoke` runs against the local fixture only (PR-fast). All committed profiles. Default behavior of `bun harness:smoke`.
- [ ] `harness:full` adds the online suite (creep.js, sannysoft, browserleaks). At v0.5 this is OPT-IN via `--include-online` because we don't yet have HTML harnesses for those external probes — that's a phase 0.5.x extension. Document.
- [ ] `harness:diff <profile-id>` runs the harness for one profile and prints the verdict.
- [ ] `pr-fast.yml` workflow gains a step: `bun harness:smoke` runs after `bun test:contract`. Soft-fail at v0.5 (i.e., emit warning annotation but don't fail the build) since we have only one profile and v0.5 ships the harness mechanics, not yet 100% Zero-Diff coverage. Hard-fail at the end of phase 0.7 when full consistency lands. Document the soft-fail line in pr-fast.yml.

### Tests

- [ ] Unit tests for `normalize`/`diff`/`categorize`/`report` against synthetic ProbeManifestV1 fixtures.
- [ ] **MOCHI_E2E gated** integration test: launches a Mochi session, runs the harness against `mac-m4-chrome-stable`, asserts `report.verdict === "EQUIVALENT"` (or, if there are remaining gaps that should be `intentional`, asserts `material === 0`). This is THE phase 0.5 gate. Expected outcome: pass with maybe a handful of intentional divergences listed.
- [ ] Cross-package contract test in `tests/contract/` pinning the public harness exports.
- [ ] All other gates green.

### Docs

- [ ] Update `docs/limits.md`: add a v0.5 entry "audio fingerprint, canvas hash, full WebGL extensions, full font lists, media devices, speech voices — captured in baselines, not yet replicated by consistency engine; phase 0.7 deliverable".
- [ ] Changeset: `@mochi.js/harness` minor + `@mochi.js/cli` patch (subcommand addition is a CLI extension, not a breaking change).

## Out of scope

- The 50+ phase-0.7 rules (audio bytes, canvas hash maps, full WebGL extension catalogs per device, full font lists, media-devices spoofing, speech-synthesis voices) — those become the natural fix path for the `intentional` divergences this harness surfaces.
- Online probe pages (creep.js, sannysoft, browserleaks, brotector) — `--include-online` flag plumbed but not wired to actual remote harnesses; that's phase 0.5.x.
- VV8/FV8 trace-based diffing — we operate on the simpler ProbeManifestV1 from `tests/fixtures/probe-page.html`. Full VV8 traces are a future option.
- Profile bisection on Chrome version updates — useful but later.
- Multi-profile parallel harness runs — sequential is fine at v0.5.

## Implementation notes

- File layout under `packages/harness/src/`:
  - `index.ts` — re-exports public API
  - `capture.ts` — drive a Session through the probe-page fixture, parse the result
  - `normalize.ts` — Peekaboo-style normalization with regex strip + sentinel insertion
  - `diff.ts` — flat structural deep-diff; reuse a small in-house algorithm (no `deep-diff` dep)
  - `categorize.ts` — `guid-class | intentional | material` decision
  - `report.ts` — DiffReportV1 builder + HTML renderer (small string-template; no react)
  - `run.ts` — `runHarnessAgainstProfile` orchestrator
  - `__tests__/*.test.ts`
- For the HTML report: hand-rolled HTML string with inline CSS. ~200 LOC. Each diff entry rendered as a row with path, left, right, category (color-coded). The orchestrator opens the file with `open <path>` for review.
- For `expected-divergences.json` glob support: a tiny minimatch-like `match(pattern, path)` helper. Patterns: `probes.audio.*`, `probes.fonts.list[*]`, etc. ~20 LOC. No dep.
- The harness uses Mochi's own launch path with the real consistency engine + inject — which means it's a true end-to-end test of the spoofing stack against a known-good baseline.
- For the MOCHI_E2E integration test: same Chromium binary the user used to capture (Chrome 147 on Mac M4 Max) is ideal but not required; any Chrome that satisfies `mac-m4-chrome-stable.browser.minVersion`/`maxVersion` works. The baseline declares `147` for both, so v0.5's E2E should be tested against Chrome 147+.

## Validation

```sh
bun typecheck
bun lint
bun test
bun test:contract --pkg=harness

# Phase 0.5 gate — run the harness end-to-end against the real M4 baseline
MOCHI_E2E=1 MOCHI_CHROMIUM_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  bun harness:diff mac-m4-chrome-stable

# Should print:
#   verdict: EQUIVALENT  (or DIVERGED with only intentional+guid-class)
#   counts: { material: 0, intentional: <N>, guidClass: <M> }
#   structuralMatchPct: >= 99%
```

When everything's green: `bun work submit 0050 --draft`.

## Touch list (rough)

- `packages/harness/src/{index,capture,normalize,diff,categorize,report,run}.ts` (new)
- `packages/harness/src/__tests__/*.test.ts` (new)
- `packages/harness/package.json` (add `@mochi.js/{core,consistency,profiles}: workspace:*`)
- `packages/cli/src/harness/subcommand.ts` (new — `mochi harness` dispatch)
- `packages/cli/src/index.ts` (route `harness` subcommand)
- `packages/profiles/data/mac-m4-chrome-stable/expected-divergences.json` (new — pre-populated with phase-0.7-deferred surfaces)
- `package.json` (root): replace `harness:smoke/full/diff` placeholders with real wiring
- `.github/workflows/pr-fast.yml` (add `bun harness:smoke` step, soft-fail at v0.5)
- `tests/contract/harness-public-surface.contract.test.ts` (new)
- `docs/limits.md` (extend with phase-0.5 deferred-surface entry)
- `.changeset/harness-mvp.md` (new)
