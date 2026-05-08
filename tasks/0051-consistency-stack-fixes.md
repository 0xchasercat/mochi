# 0051: consistency + inject fixes for harness-surfaced bugs

**Package:** primarily `consistency`; secondary touches in `inject` and `profiles` (mac-m4-chrome-stable's `uaCh.sec-ch-ua-model`).
**Phase:** `0.5.x` (the harness MVP that lands as 0050 surfaced these; this task closes them out before phase 0.6 starts.)
**Estimated size:** S
**Dependencies:** 0050 (the harness MVP — the gate that surfaced these).

## Goal

Close out the 14 material divergences the phase 0.5 harness surfaces for `mac-m4-chrome-stable`. These are real bugs in the v0.2 consistency engine + v0.3 inject layer that 0050's empirical gate caught. They are NOT phase-0.7-deferred surfaces (audio, canvas, webgl extensions, etc.); they are bugs in the surfaces v0.2 already claims to cover.

## The 14 material divergences (from `bun harness:diff mac-m4-chrome-stable`)

### Group A — `navigator.hardwareConcurrency` (1 diff)

**Symptom:** baseline reports 14 (M4 Max), Mochi-driven session reports 10.
**Root cause:** `packages/consistency/src/rules/navigator.ts` — R-008 derives `device.cores` from `cpuFamily` via a coarse lookup (`apple-silicon-m4 → 10`). The lookup is wrong for M4 Pro (12-14) / M4 Max (14-16), and more importantly, it OVERWRITES the profile's declared `device.cores` value.
**Fix:** Either (a) make R-008 a passthrough that respects the profile's declared `device.cores` (preferred — the profile is the source of truth per PLAN.md §6.1), or (b) refine the lookup to handle M-series Pro/Max variants. Option (a) is cleaner and matches PLAN.md §9.2's intent (`R-009 [device.cores] → navigator.hardwareConcurrency` is documented as a passthrough).
**Note on PLAN.md mismatch:** PLAN.md §9.2 documents the rule as `R-009 [device.cores] → navigator.hardwareConcurrency` (passthrough); the implementation labels it `R-008 [device.cpuFamily] → device.cores` (derive-from-coarse-input). The implementation drifted; bring it back to PLAN's intent.

### Group B — `navigator.userAgentData.brands` ordering + brand strings (10 diffs)

**Symptom:** baseline produces `[Google Chrome:147, Not.A/Brand:8, Chromium:147]` (real Chrome 147's actual output). Mochi-driven session produces `[Chromium:147, Google Chrome:147, Not_A Brand:147]`.
**Root cause:** `packages/consistency/src/rules/lookups/browser.ts` — `SEC_CH_UA_BRANDS_BY_BROWSER` has the wrong order (`["Chromium", "Google Chrome", "Not_A Brand"]` for `chrome`) AND the wrong GREASE label (`Not_A Brand` should be `Not.A/Brand` — underscore vs. dot, slash vs. space) AND the GREASE entry uses the same major version as Chrome instead of its own pinned `8`.
**Fix:**
- Reorder `chrome` brands to `["Google Chrome", "Not.A/Brand", "Chromium"]` (and parallel reorderings for Edge/Brave/Arc/Opera).
- Update `formatBrand` / `deriveSecChUa` to use a separate version for the GREASE entry (`8` per Chrome 110+).
- Update `packages/consistency/src/__tests__/rules.test.ts` R-005 golden assertion.
- Update `packages/inject/src/__tests__/fixtures.ts` `sec-ch-ua` fixture to match Chrome's real output.
- Re-run `bun harness:diff mac-m4-chrome-stable` to verify the 10 brand-related diffs collapse.

### Group C — `userAgentDataHighEntropy.formFactor` (1 diff)

**Symptom:** baseline reports `null`, Mochi reports `[]`.
**Root cause:** `packages/inject/src/modules/client-hints.ts:163` — `out.formFactor = SPOOF_MOBILE ? ["Mobile"] : []`. Real Chrome desktop returns `null` for `formFactor`, not `[]`.
**Fix:** Change to `out.formFactor = SPOOF_MOBILE ? ["Mobile"] : null`. (Or omit the field entirely on desktop; check Chrome 147 behavior in the baseline — `null` is what the captured baseline shows.)

### Group D — `userAgentDataHighEntropy.model` (1 diff)

**Symptom:** baseline reports `""`, Mochi reports `"Mac"`.
**Root cause:** `packages/profiles/data/mac-m4-chrome-stable/profile.json:170` declares `"sec-ch-ua-model": "\"Mac\""`. Real Chrome 147 desktop returns `""` for `model`. The `mochi capture` derive step incorrectly stamped `"Mac"` from somewhere.
**Fix:** Change the profile's `uaCh.sec-ch-ua-model` to `"\"\""` (empty quoted string). Investigate `packages/cli/src/capture/derive-profile.ts` for the source — likely a fallback that picked up `device.model: "Mac"` and stuffed it into the uaCh slot. Fix the derivation so future captures don't repeat it.

## Success criteria

- [ ] `bun typecheck && bun lint && bun test && bun test:contract` clean.
- [ ] `MOCHI_E2E=1 MOCHI_CHROMIUM_PATH=… bun harness:diff mac-m4-chrome-stable` produces `verdict: EQUIVALENT` with `counts.material === 0`.
- [ ] `intentional` count drops as the previously-pending phase-0.7 surfaces remain on the list (audio, canvas, webgl extensions, fonts, mediaDevices, speech) but the v0.2 surface is fully Zero-Diff.
- [ ] No new entries in `expected-divergences.json`.

## Out of scope

- Phase-0.7 surfaces (audio bytes, canvas hash, full WebGL extensions, full font lists, MediaDevices, SpeechSynthesis voices). Those remain in `expected-divergences.json` until phase 0.7 lands.

## Validation

Same as 0050 — but expects `EQUIVALENT` instead of the residual-material verdict 0050 ships with.

## Touch list (rough)

- `packages/consistency/src/rules/navigator.ts` (R-008 passthrough)
- `packages/consistency/src/rules/lookups/browser.ts` (`SEC_CH_UA_BRANDS_BY_BROWSER` reorder + GREASE label/version)
- `packages/consistency/src/__tests__/rules.test.ts` (R-005 golden update)
- `packages/inject/src/__tests__/fixtures.ts` (sec-ch-ua fixture)
- `packages/inject/src/modules/client-hints.ts` (`formFactor: null` on desktop)
- `packages/profiles/data/mac-m4-chrome-stable/profile.json` (`sec-ch-ua-model` empty string)
- `packages/cli/src/capture/derive-profile.ts` (sec-ch-ua-model derivation fallback)
- `packages/profiles/data/mac-m4-chrome-stable/PROVENANCE.md` (re-capture note)
