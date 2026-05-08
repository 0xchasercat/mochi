# 0070: consistency engine full — phase 0.7 JS rules

**Package:** `consistency` (with `inject` for new spoof modules)
**Phase:** `0.7` (JS portion; 0071 ships the audio/canvas blob fixtures)
**Estimated size:** L
**Dependencies:** 0001, 0011, 0020 (v0.2 30 rules), 0030 (inject), 0050 (harness — your gate), 0051 (fully Zero-Diff at 30-rule level)

## Goal

Drive the harness intentional count from 15 → ≤ 2 by adding ~30 more JS-derivable rules + their inject-side wiring. After this lands, the only intentional divergences against `mac-m4-chrome-stable` are `audio.*` and `canvas.*` (precomputed blob fixtures, deferred to task 0071) plus a tiny set of fundamentally-impossible-from-JS surfaces.

The audit is empirical: run `bun harness:diff mac-m4-chrome-stable`, identify the 15 remaining intentional paths, fix each. The harness IS the oracle — when it stops listing a path, that path is correctly spoofed.

## Success criteria

### Drive the gate down

- [ ] After this task lands, `bun harness:diff mac-m4-chrome-stable` reports `intentional ≤ 2` (the audio/canvas deferrals from 0071) AND `material === 0` AND `structuralMatchPct ≥ 99%`.
- [ ] Every entry removed from `expected-divergences.json` corresponds to a real fix in the consistency engine + inject pipeline. Do NOT silently move bugs to a different category.
- [ ] If the harness surfaces NEW material divergences while you work, fix them or surface them in your report — don't paper over.

### Concrete rules to add (the 15 remaining intentionals at 0051-merge)

The harness gate at end-of-0051 listed these as intentional. Each one becomes a real rule + inject module change:

1. **`bot.headlessChrome` / `bot.webdriver` / `bot.webdriverType`** — three derived booleans from the chaser-recon bot-detection probe. Chrome's natural values: `headlessChrome: false`, `webdriver: false`, `webdriverType: "normal"`. Mochi already strips automation globals (phase 0.3 bot-globals module); these surfaces are the EFFECT of that. Add a rule R-NN that documents the assertion and an inject test that verifies the probe reports `false` after stripping.
2. **`navigator.appVersion` / `navigator.userAgent`** (HeadlessChrome leak) — already handled by R-004 + R-026 producing clean strings. The intentional entry exists because the BASELINE has the leak; the spoofed values are correct. Keep these as intentional with comment, OR collapse into a single rule with documentation.
3. **`navigator.deviceMemory`** — Chrome's published value is capped at 8 (per spec). Profile may declare 64 (real M4 Max). Inject must publish `min(profile.device.memoryGB, 8)` since that's what real Chrome does. New rule: `R-NN [device.memoryGB] → navigator.deviceMemory = min(memoryGB, 8)`.
4. **`navigator.userAgentDataHighEntropy.fullVersionList[0..2].version`** — Chrome's tip is `147.0.7727.138` (real); seed-derived is `147.0.6409.194` (R-023 + R-004 chain). Either match the patch number to the captured tip (lookup table for known browser-major → tip-patch), OR continue using seed-derived and document. Brief recommends match-tip via lookup, which closes the divergence cleanly.
5. **`webgl.unmaskedRenderer`** — already in scope of R-002 from 0020, but the captured baseline contains the FULL Apple ANGLE renderer string including angle-version and unspecified-version. R-002 may produce a partial match. Inspect the captured baseline; tighten R-002 to match.
6. **`webgpu.features[15..18]`** + the `webgpu.**` glob — full WebGPU adapter info, features array, limits. New module `inject/webgpu.ts` + new rules in `consistency`.
7. **`mediaDevices.devices[*]`** — devices with deterministic `deviceId` + `groupId` per (profile, seed). Lookup table per OS gives the typical device shape (default microphone/speakers/webcam on macOS), then xoshiro derives stable IDs from seed.
8. **`speech.voices[*]`** — full SpeechSynthesis voice list per OS+locale. Curated baseline lists from the captured manifest are the source of truth. Per-profile override via lookup.
9. **`fonts.list[*]`** — full per-OS-device font list. v0.2 had a curated subset; expand to match captured baseline length and content for `mac-m4-chrome-stable`.
10. **`storage.**` (estimate)** — `navigator.storage.estimate()` returns `{quota, usage}`. Real Chrome reports a profile-stable quota and a tiny usage. Spoof both via lookup + seeded jitter.
11. **`navigator.permissions.**`** — `Permissions.query({name})` for each tracked permission. Default Chrome behavior: most return `{state: "prompt"}`; some are `"granted"` automatically. Curated default-state map.
12. **`navigator.connection.effectiveType` / downlink / rtt / saveData** — Network Information API. Chrome desktop typically reports `4g` for effectiveType, ~10mbps downlink, ~50ms rtt. Spoof with seeded jitter within plausible ranges.
13. **`screen.orientation.{type, angle}`** — `landscape-primary` on desktop with angle 0. Add module if absent.
14. **`screen.mediaQueries.**`** — `matchMedia` for prefers-color-scheme, prefers-reduced-motion, color-gamut, etc. Chrome desktop defaults: `prefers-color-scheme: light` (or system; pick one), `prefers-reduced-motion: no-preference`. Document the picked default.
15. **`timing.timerPrecision` / `timing.**`** — `performance.now()` stepping. Real Chrome rounds to 100µs cross-origin, 5µs same-origin. Document; the captured baseline reflects whichever capture-page setup got. Likely an intentional we keep.

### Inject-side wiring

Each new rule's surface needs to be exposed to the page. Add inject modules where missing (`webgpu.ts`, `media-devices.ts`, `speech.ts`, `permissions.ts`, `network-info.ts`, `screen-orientation.ts`). Reuse the 0030 pattern: per-API spoof module that takes the matrix and returns a JS snippet.

### Tests

- [ ] Per-rule golden tests in `packages/consistency/src/__tests__/rules.test.ts` and per-module sandbox tests in `packages/inject/src/__tests__/`.
- [ ] Update `tests/contract/inject-payload.contract.test.ts` PINNED_SHA256 (will rotate with new payload bytes).
- [ ] All existing tests + harness gate continue to pass.

### Other

- [ ] `docs/limits.md` — UPDATE the v0.5 deferred list to reflect what's NOW spoofed (cross out audio/canvas remain for 0071) and what's NOW deferred to "fundamentally-not-from-JS" (e.g., real `performance.now` precision parity if that's our final call).
- [ ] Changesets: `@mochi.js/consistency` minor + `@mochi.js/inject` minor + `@mochi.js/core` patch (transitive).
- [ ] All gates green including the harness E2E.

## Out of scope

- **Audio precomputed bytes** — task 0071. Keep `audio.**` as intentional.
- **Canvas hash maps** — task 0071. Keep `canvas.**` as intentional.
- **Cross-engine spoofing** (Safari, Firefox) — v2.
- **Mobile profiles** — v2.
- **Profile catalog expansion** beyond mac-m4-chrome-stable — phase 0.9.
- **Real-trace behavioral recording** — v1.x.

## Implementation notes

- The harness IS your feedback loop. Run `bun harness:diff mac-m4-chrome-stable` after each rule. When a path drops off the divergence list, that rule's done. When `intentional` reaches 2 (`audio.**`, `canvas.**`), you're done with this task.
- Profile-is-source-of-truth principle (PLAN.md §6.1, I-5; lesson from 0051's R-008 fix): when a rule could either pass through a profile field OR derive from primitives, prefer passthrough. Lookups are for genuinely-derived values (e.g., os → font list, gpu → extension catalog).
- `mediaDevices.deviceId` / `groupId` MUST be deterministic per (profile, seed). Use xoshiro seeded with `sha256(profile.id + ":" + seed + ":mediaDevices")`. Document the derivation.
- `permissions.query` is a function call surface — the inject module needs to override the prototype's `query()` method, not a property. Pattern is in `packages/inject/src/modules/webgl.ts` (which overrides `getParameter`).
- For `speech.voices`: Chrome's voice list is large (~300 entries on macOS). Don't generate it from primitives; ship a curated lookup. The captured baseline.manifest.json is the source — extract the voice list, commit as a lookup table.
- For `fonts.list`: same pattern. The captured baseline has the real list; commit it as a lookup keyed by `(os, device.cpuFamily)`.

## Validation

```sh
bun typecheck
bun lint
bun test
bun test:contract --pkg=consistency
bun test:contract --pkg=inject

# THE GATE — must hit material === 0, intentional ≤ 2:
MOCHI_E2E=1 MOCHI_CHROMIUM_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  bun harness:diff mac-m4-chrome-stable
```

When everything's green: `bun work submit 0070 --draft`.

## Touch list (rough)

- `packages/consistency/src/rules/{webgpu,media-devices,speech,permissions,network-info,screen-orientation,deviceMemory-cap,fonts-full}.ts` (new)
- `packages/consistency/src/rules/lookups/{fonts-full,speech-voices,permissions-defaults,webgpu-features}.ts` (new — curated from baseline)
- `packages/consistency/src/rules/index.ts` (register new rules in DAG)
- `packages/inject/src/modules/{webgpu,media-devices,speech,permissions,network-info,screen-orientation}.ts` (new)
- `packages/inject/src/build.ts` (compose new modules)
- `packages/profiles/data/mac-m4-chrome-stable/expected-divergences.json` (drop ~13 entries)
- `tests/contract/inject-payload.contract.test.ts` (rotate sha256 pin)
- `docs/limits.md` (cross-off newly-spoofed items)
- `.changeset/consistency-rules-full.md` (new)
