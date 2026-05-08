# 0251: derive `--lang=<matrix.locale>` Chromium flag from matrix

**Package:** `core`
**Phase:** `0.2`
**Estimated size:** XS
**Dependencies:** v0.1.2 shipped, audits 0200–0203 merged
**Source:** `docs/audits/undetected-chromedriver.md` MED finding
**Source-cited reference:** udc `__init__.py:359-369`

## Goal

Close a relational-consistency leak (PLAN.md I-5): mochi spoofs `navigator.language(s)` at the JS layer via `inject/navigator.ts` matrix-derived from the `locale` consistency rule, but Chromium's network stack sends an `Accept-Language` header derived from the *real* host locale (or Chromium's default `en-US,en;q=0.9`). A site that cross-references the network header against JS `navigator.languages` sees a mismatch.

Fix: pass `--lang=<matrix.locale.bcp47>` to Chromium so the `Accept-Language` header agrees with the JS-layer spoof.

## Success criteria

- [ ] `packages/core/src/proc.ts` — `spawnChromium` reads `matrix.locale.bcp47` (or whatever the canonical locale field is — verify) from the launch config and appends `--lang=<value>` to the args array. Locale must be derived from the matrix, NOT hardcoded.
- [ ] `packages/core/src/launch.ts` — passes the matrix's locale through to `spawnChromium`'s config struct. The locale value is already on the matrix; just plumb it.
- [ ] If the matrix's locale rule has a fallback / multi-locale field (e.g. `Accept-Language`-style q-weighted list), use the *primary* locale for `--lang` and surface the rest via the JS-side `navigator.languages` spoof (which already happens). Document the asymmetry inline if relevant.
- [ ] Existing R-005 / R-019 / R-014 (locale-related rules) gain a downstream check: `--lang` flag must equal `matrix.locale.primary`. Add to the rule's runtime assertion.
- [ ] Probe Manifest schema: surface `accept_language_header` (the network-layer value) and assert against the matrix. The harness already captures network headers via Probe Manifest; add this row.
- [ ] Conformance test in the existing stealth suite: `accept_language_header` from `Network.requestWillBeSent` matches `matrix.locale.primary`-derived expected value. Gate with `MOCHI_E2E=1`.
- [ ] Changeset: patch on `@mochi.js/core`.

## Out of scope

- Multi-locale `Accept-Language` q-weighted construction in the network layer — Chrome derives it from `--lang` automatically. We just pick the primary.
- Changing existing locale-related consistency rules — they stay; we just add the flag.
- Profile data updates — the existing `mac-m4-chrome-stable` profile has a locale field already; verify and move on.

## Implementation notes

- See `PLAN.md` §8.6 (DEFAULT_CHROMIUM_FLAGS — note that `--lang` is currently absent), §9 (relational consistency rules), I-5.
- udc's implementation: reads `locale.getdefaultlocale()` → falls back to `en-US` → passes `--lang=<value>`. We do *not* fall back to the host locale; we derive from the matrix. If matrix has no locale field (it should — verify in `packages/profiles/data/<profile>/profile.json`), that's a profile-data bug, not a launch-time fallback.
- Verify `--lang` is honored under `--headless=new` (some Chromium flags get ignored in headless modes).

## Validation

```sh
bun run typecheck && bun run lint && bun run test && bun run test:contract
# Conformance gated on MOCHI_E2E=1; CI runs the Probe Manifest harness diff.
```
