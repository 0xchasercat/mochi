# 0040: `mochi capture` — baseline capture tool

**Package:** `cli` (touches `packages/cli/`, `packages/core/` for a bypass-inject flag, and ships a `tests/fixtures/probe-page.html`)
**Phase:** `0.4`
**Estimated size:** L
**Dependencies:** 0001, 0011 (CDP transport), 0020 (ProfileV1 type), 0030 (inject — needs a bypass flag)

## Goal

Implement `mochi capture` per PLAN.md §12. Drives a **bare, un-spoofed** Chromium against a self-contained probe-page fixture, captures every probe family, derives the device-class facts into a `ProfileV1`, writes the result to `packages/profiles/data/<id>/`. After this lands, the user can run `mochi capture --profile-id mac-m2-chrome-stable` on a real Mac M2 and produce the framework's first real baseline.

**CRITICAL:** capture must run against bare Chromium — if it ran against a Mochi session with inject active, the captured baseline would BE the spoofed values, defeating the entire point. Add a `bypassInject: true` flag to `LaunchOptions` for this single use case (and any future capture-style flow).

The same `tests/fixtures/probe-page.html` produced here is the harness fixture phase 0.5 consumes. Ship it in this task.

## Success criteria

### `tests/fixtures/probe-page.html`

- [ ] Self-contained, no external deps. Inline JS only.
- [ ] On load, runs every probe family from `chaser-recon/src/lib/fingerprint/*` (vendored idea, not a runtime dep): navigator, screen, canvas (small reproducible test image), webgl + webgpu (parameters, render hash via reproducible scene), audio (OfflineAudioContext output bytes, base64-encoded), media-devices (enumerate, persistent IDs), speech-synthesis (voices), fonts (presence detection via DOM measurement on a curated 200-font canary list), storage (localStorage/sessionStorage/indexedDB API surface), bot-detection (every key from chaser-recon's `bot-detection.ts`), timing (timezone, locale, performance.now precision sample, math constants).
- [ ] Output: `JSON.stringify({probes})` to `<pre id=probes>`. Plus a `<script>window.__probesReady = true</script>` sentinel so the capture tool can poll for completion.
- [ ] Total runtime budget: ≤ 5 seconds against bare Chromium-for-Testing.
- [ ] No network requests; everything self-contained.

### `mochi capture` CLI

- [ ] `mochi capture --profile-id <id> [--browser <path>] [--out <dir>] [--seed <s>]` works.
- [ ] Defaults: `--out` = `packages/profiles/data/<id>/`. `--browser` resolved via `resolveChromiumBinary()` (from 0010) or `MOCHI_CHROMIUM_PATH`. `--seed` = `"capture-${id}"` (deterministic for re-runs).
- [ ] Pipeline:
  1. Spawn bare Chromium (use `mochi.launch({ profile: bareProfile, seed, bypassInject: true })` — the new flag short-circuits the inject step in `Session`).
  2. Open a new page, navigate to `file://${absolute path to tests/fixtures/probe-page.html}`.
  3. Poll `window.__probesReady` until true (or 30s timeout).
  4. Read `#probes` text content; parse JSON → `ProbeManifestV1` shape (use `@mochi.js/harness`'s eventual normalize logic if present, otherwise raw JSON acceptable at v0.4).
  5. Derive `ProfileV1` from the probes:
     - `os` ← `navigator.platform` + `navigator.userAgent` parse + `navigator.userAgentData.platformVersion` if present
     - `device` ← `cpuFamily` heuristic (Apple-Silicon-MN regex on `webgl.unmaskedRenderer`; Intel/AMD on Win/Linux), `cores` from `navigator.hardwareConcurrency`, `memoryGB` from `navigator.deviceMemory * 2` (bake-in standard step)
     - `display` ← `screen.width/height/devicePixelRatio/colorDepth`
     - `gpu` ← `webgl.unmaskedVendor/Renderer`, `webgl.parameters` (max texture size, max color attachments, supported extensions)
     - `audio` ← OfflineAudioContext sample rate + measured worklet latency
     - `fonts` ← intersection of probe canary list with system-detected
     - `timezone` ← `Intl.DateTimeFormat().resolvedOptions().timeZone`
     - `locale` ← `navigator.language`
     - `languages` ← `navigator.languages`
     - `userAgent` ← raw value
     - `uaCh` ← all client-hints values
     - `wreqPreset` ← derived from os + browser version (lookup table)
- [ ] Validates derived `ProfileV1` against `schemas/profile.schema.json` (use a tiny inline JSON-Schema validator or vendor `ajv` as devDep). On validation failure, write the partial output to `packages/profiles/data/<id>/.invalid/` and exit non-zero with the validation error.
- [ ] Writes:
  - `packages/profiles/data/<id>/profile.json` (the derived ProfileV1)
  - `packages/profiles/data/<id>/baseline.manifest.json` (the full ProbeManifestV1 captured)
  - `packages/profiles/data/<id>/PROVENANCE.md` (interactive prompts: capturer name, machine model + serial-suffix-only, browser version, mochi version, capture timestamp)
- [ ] Sanity round-trip: after writing, calls `deriveMatrix(profile, seed)` and confirms `mochi.launch({profile})` would succeed (no schema errors). Skips actual launch.

### `bypassInject: true` in `LaunchOptions`

- [ ] `LaunchOptions.bypassInject?: boolean` (default `false`).
- [ ] When `true`, `Session` skips `buildPayload` AND skips `Page.addScriptToEvaluateOnNewDocument` on every new page. Workers also receive no inject.
- [ ] Documented in JSDoc as "intended for `mochi capture` and similar baseline-collection flows; do not enable in production".
- [ ] Unit test in `packages/core/src/__tests__/inject.test.ts`: with `bypassInject: true`, the recorded fake transport receives ZERO `Page.addScriptToEvaluateOnNewDocument` sends.

### Profile data — DO NOT capture in this task

The actual real-Mac-M2 capture is human work. Phase 0.4 ships the *tool*. The user (orchestrator's human partner) runs the tool on real hardware in a follow-up. Once they commit a real `packages/profiles/data/mac-m2-chrome-stable/`, phase 0.5 unlocks.

For the agent's own testing: capture against a synthesized probe-page response (mocked CDP transport) is sufficient. The E2E gate is gated on `MOCHI_E2E=1` and produces a real capture into `/tmp/<scratch>` for sanity, but does NOT commit anything.

### Other

- [ ] All gates green: typecheck, lint, test, test:contract.
- [ ] `mochi browsers` output unchanged (regression check).
- [ ] `mochi work` output unchanged (regression check).
- [ ] `docs/limits.md` updated if any probe family discovers it can't be captured cleanly from JS.
- [ ] Changeset: `@mochi.js/cli` minor + `@mochi.js/core` minor (bypassInject flag is a public API surface change).

## Out of scope

- Cross-engine capture (Safari/Firefox) — v2.
- Mobile profile capture — v2.
- Cloud-farmed captures (BrowserStack, etc.) — later.
- Automatic re-capture on Chromium version updates — manual for v1.
- Diffing two captures against each other — that's `@mochi.js/harness` (phase 0.5).
- Committing real profile data — human-driven follow-up.

## Implementation notes

- File layout under `packages/cli/src/capture/`:
  - `index.ts` — `runCapture(opts)` orchestrator + exports
  - `probe-page.ts` — derives the absolute path to the fixture
  - `derive-profile.ts` — translates probe JSON → ProfileV1
  - `validate.ts` — schema validation (or wrap a lib)
  - `provenance.ts` — interactive prompt collector
  - `subcommand.ts` — `mochi capture` dispatch
  - `__tests__/*.test.ts`
- The fixture HTML lives at `tests/fixtures/probe-page.html` (NOT under packages/cli — it's shared with phase 0.5 harness).
- Use `Bun.file().text()` to read the fixture. The capture tool spawns Chromium, navigates to `file:///absolute/path/to/probe-page.html`, polls the sentinel, reads probes via `Page.evaluate` or `Page.text("#probes")`.
- For schema validation: vendor `@cfworker/json-schema` (small, Bun-friendly, MIT) as devDep. ~30 KB. Don't add `ajv` (heavier, more setup). Rationale: validation is dev-time only at v0.4.
- For interactive provenance prompts: `Bun.stdin` reader; the existing `confirm()` helper in `scripts/mochi-work.ts` is a reference implementation pattern.
- The `bypassInject` plumbing in core: a single `if (opts.bypassInject) return;` near the top of the inject-on-new-page handler. One line in core code; the rest is JSDoc + the recorded-transport test.

## Validation

```sh
bun typecheck
bun lint
bun test
bun test:contract --pkg=cli

# E2E (real Chromium): exercises the full capture flow into a tmp dir
MOCHI_E2E=1 MOCHI_CHROMIUM_PATH=... bun test packages/cli/src/capture/__tests__/capture.e2e.test.ts

# manual smoke (DOES NOT commit anything):
mkdir -p /tmp/mochi-capture-smoke
MOCHI_CHROMIUM_PATH=... bun packages/cli/src/bin.ts capture \
  --profile-id smoke-test \
  --out /tmp/mochi-capture-smoke
ls /tmp/mochi-capture-smoke   # expect: profile.json, baseline.manifest.json, PROVENANCE.md
```

When everything's green: `bun work submit 0040 --draft`.

## Touch list (rough)

- `tests/fixtures/probe-page.html` (new — shared with phase 0.5)
- `packages/cli/src/capture/{index,probe-page,derive-profile,validate,provenance,subcommand}.ts` (new)
- `packages/cli/src/capture/__tests__/*.test.ts` + `capture.e2e.test.ts` (new, E2E gated)
- `packages/cli/src/index.ts` (route the `capture` subcommand)
- `packages/cli/src/__tests__/smoke.test.ts` (extend with `capture --help`)
- `packages/core/src/launch.ts` (add `bypassInject?: boolean` to LaunchOptions)
- `packages/core/src/session.ts` (skip inject path when bypassInject=true)
- `packages/core/src/__tests__/inject.test.ts` (extend with bypass coverage)
- `tests/contract/cli-capture.contract.test.ts` (new — pin the CLI surface phase 0.5 will consume)
- `.changeset/cli-capture.md` (new)
- `docs/limits.md` (extend if any probe family is truly non-extractable)
