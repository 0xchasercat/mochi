# 0256: default Chromium flags audit + trim

**Package:** `core`
**Phase:** `0.2`
**Estimated size:** S
**Dependencies:** v0.1.2 shipped
**Source:** `docs/audits/patchright.md` MED finding + `docs/audits/puppeteer-real-browser.md` LOW finding
**Source-cited reference:** patchright `chromiumSwitchesPatch.ts:20-34` (their trim list); mochi's current default at `packages/core/src/proc.ts:20-34`

## Goal

Re-audit every flag in `DEFAULT_CHROMIUM_FLAGS` against patchright's trim philosophy. Patchright explicitly REMOVES flags that act as passive bot-tells (Playwright defaults that any anti-bot can string-match). Mochi inherited some of these via PLAN.md §8.6's pragmatic list; the audit will identify which to drop, which to keep, and amend §8.6 accordingly.

Specifically called out by the audit:
- **`--disable-component-update`** — patchright drops it; passive command-line tell. Mochi keeps it for "hermetic harness runs" but it leaks to production sessions too.
- **`--disable-default-apps`** — same shape.
- **`--disable-features=…IsolateOrigins,site-per-process`** — patchright trims aggressively; verify mochi's list isn't a fingerprintable subset.
- **`--enable-unsafe-swiftshader`** removal — patchright strips Playwright's headless SwiftShader fallback that produces a distinct GL fingerprint. Verify nothing downstream pulls it in.
- **`--headless=new` always** — verify mochi never falls back to legacy `--headless` (sannysoft trivially detects).

## Success criteria

- [ ] Audit `packages/core/src/proc.ts:DEFAULT_CHROMIUM_FLAGS` line-by-line. For each flag, document in the audit table:
  - Why it's there (PR / PLAN reference)
  - Is it a passive bot-tell? (patchright criterion)
  - Is it load-bearing for our use case? (e.g. `--remote-debugging-pipe` is non-negotiable; `--no-first-run` is convenience)
  - Decision: keep / drop / replace
- [ ] **Drop** the flags that pass two tests: (a) patchright explicitly removes them and (b) we have no concrete reason to keep them. Specifically expected: `--disable-component-update`, `--disable-default-apps`. Verify via local launch that nothing breaks (no popup nag, no extension auto-install, no update check stalling startup).
- [ ] Add a `LaunchOptions.hermetic?: boolean` (default `false`) — when true, re-applies the dropped flags for harness/CI/test scenarios where update-checks would inject network noise. Default false because production users want the cleanest possible flag set.
- [ ] Verify `--headless=new` is the only headless mode mochi emits. Search for any `--headless` emission that doesn't have `=new`.
- [ ] Verify nothing downstream emits `--enable-unsafe-swiftshader` (a Playwright leak we don't need).
- [ ] Update PLAN.md §8.6 with the new flag list + the hermetic-mode escape hatch.
- [ ] Update `docs/limits.md` with any flag-related limit you uncover during the audit (e.g. "Chromium 131+ requires X to suppress Y leak").
- [ ] Conformance test: a contract test that asserts the spawned-args list matches the expected flag set for both `hermetic: true` and `hermetic: false` modes.
- [ ] Changeset: patch on `@mochi.js/core`.

## Out of scope

- `--no-sandbox` — already documented as a CI-only env-var passthrough (`MOCHI_EXTRA_ARGS`) and explicitly NOT in defaults per PLAN §8.6. Don't touch.
- `--disable-blink-features=AutomationControlled` — explicitly REJECTED by PLAN §8.6 (we patch `navigator.webdriver` from JS via R-022 instead). Don't add. If audit discovers a new reason to revisit, surface it but don't change the default.
- Profile-specific flags — out of scope; profile rules can override at launch.

## Implementation notes

- See `PLAN.md` §8.6 (current decision ledger for chosen flags).
- Patchright's source: `chromiumSwitchesPatch.ts:20-34` lists the exact removals + the `--disable-features=` block they keep. Don't blind-port — read the rationale, decide per-flag.
- Test the actual launch in headed AND headless modes after each removal. Some flags suppress real UI (welcome screen, update bar) that affects headed tests but not headless.
- The `hermetic` knob's mode is similar to `bypassInject` (already in LaunchOptions for capture flows); follow that pattern.

## Validation

```sh
bun run typecheck && bun run lint && bun run test && bun run test:contract
# Conformance still runs unchanged — this brief should produce zero
# regressions on existing tests.
```
