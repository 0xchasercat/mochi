# 0252: derive `--window-size=<W>,<H>` Chromium flag from matrix.display

**Package:** `core`
**Phase:** `0.2`
**Estimated size:** XS
**Dependencies:** v0.1.2 shipped, audits 0200–0203 merged
**Source:** `docs/audits/undetected-chromedriver.md` MED finding + UDC issue #2242
**Source-cited reference:** udc `__init__.py:410-411`

## Goal

Close a confirmed leak: under `--headless=new`, Chromium's outer-window geometry defaults to **800×600** regardless of what `screen.*` is spoofed to. `fingerprint-scan.com` flags this exact mismatch (real `window.outerWidth/outerHeight` reads from the OS-level window, not the JS-spoofed `screen.width/height`). UDC fixes by passing `--window-size=1920,1080`; mochi should derive from `matrix.display.{width,height}` so the outer geometry matches the spoofed `screen.*`.

## Success criteria

- [ ] `packages/core/src/proc.ts` — `spawnChromium` derives `--window-size=<width>,<height>` from `matrix.display` (or whichever field carries the resolution; verify `packages/consistency/src/rules/screen.ts` and `packages/profiles/data/<profile>/profile.json`). Append to args array.
- [ ] If matrix.display has no `width`/`height` (some test fixtures might leave it undefined), the flag is omitted (don't fall back to a hardcoded value — the matrix is canonical).
- [ ] **Drop `--start-maximized`**. UDC adds it; mochi shouldn't — `--window-size` is precise, `--start-maximized` is host-OS-dependent and produces non-deterministic geometry that can mismatch the spoof.
- [ ] Add a consistency rule (or extend an existing screen-related rule, R-010..R-012 area) that asserts `window.outerWidth === matrix.display.width` and `window.outerHeight === matrix.display.height` at probe time.
- [ ] Probe Manifest schema: surface `window.outerWidth/outerHeight` if not already there; verify and add the row.
- [ ] Conformance test: probe reports outer dimensions equal to matrix's display values. Gate with `MOCHI_E2E=1`.
- [ ] Changeset: patch on `@mochi.js/core`.

## Out of scope

- Changing `screen.*` or `window.inner*` JS-layer spoofing — already done by `inject/screen.ts`. This is purely about the OS-window outer geometry.
- Multi-monitor setup or `window.screenX/screenY` — separate concern, may surface in 0250 (mouse event screen coords) follow-up.
- Resizing during a session via `Browser.setWindowBounds` — out of scope; flag-only at launch.

## Implementation notes

- Read PLAN.md §8.6 + the existing screen rules in `packages/consistency/src/rules/screen.ts`.
- Verify under `--headless=new` that `--window-size` is honored. UDC issue #2242 says it IS honored at the OS level but the `outerWidth`/`outerHeight` JS API may not pick it up under headless without extra steps. Test before claiming the leak is closed; if it doesn't work, we may also need a CDP `Browser.setWindowBounds` call post-launch. Document either way.
- Mochi's existing `proc.ts` ephemeral user-data-dir is fine; window-size is independent.

## Validation

```sh
bun run typecheck && bun run lint && bun run test && bun run test:contract
# Conformance gated on MOCHI_E2E=1; the harness diff catches this row.
```
