# 0273 — Product gaps surfaced by writer-2's API doc audit

**Status:** queued (small follow-ups; not blocking docs flow)
**Source:** writer-2 (api/* docs writer for task 0270) report after pushing `af1de61`.
**Owner:** unassigned. Pick up when convenient.

## Gap list

### G-1. `runHarnessSmoke` doesn't exist; actual export is `runHarnessAgainstProfile`

The writer brief asked for `runHarnessSmoke` documentation. The actual export from `@mochi.js/harness` is `runHarnessAgainstProfile`. Either:
- (a) Rename the existing export to `runHarnessSmoke` for ergonomics, OR
- (b) Add a `runHarnessSmoke` thin wrapper that calls into `runHarnessAgainstProfile` with default options for the smoke flow, OR
- (c) Leave as-is; close the gap by ensuring all docs reference the actual name.

Recommendation: (b). The "smoke" naming is what users + the orchestrator actually expect ("smoke test"). A thin wrapper is cheap and doesn't break the existing API.

Relevant files: `packages/harness/src/index.ts`, `packages/harness/src/smoke.ts` (or wherever the existing entrypoint lives).

### G-2. `mochi work` is a monorepo-only proxy script

`packages/cli/src/index.ts#proxyToWork` proxies `mochi work` to the in-tree `scripts/mochi-work.ts`. Run from outside the monorepo, it errors. The CLI doc page (`docs/content/docs/api/cli.md`) currently documents this honestly but it's a real footgun.

Either:
- (a) Promote `mochi work` to a real CLI subcommand bundled in `@mochi.js/cli` (compile in the script), OR
- (b) Make it explicitly internal — rename to `bun run mochi-work` (developer command), drop from public CLI surface, document as "monorepo-only".

Recommendation: (b) for v0.3 (don't add public surface that's only useful in the monorepo). Write a short `tasks/0274-mochi-work-internal.md` if pursued.

### G-3. `@mochi.js/profiles.getProfile()` throws "not yet implemented"

Exported, but throws. Users hitting it get a runtime error from a v0.0.1-shaped stub. Programmatic profile loading currently has to go through `@mochi.js/harness#loadProfile`, which is the wrong abstraction (harness is a test surface).

Fix: actually implement `getProfile(id: ProfileId): Promise<ProfileV1>` in `@mochi.js/profiles`. The data already lives at `profiles/<id>/profile.json` — synthesize the loader (Bun.file → JSON.parse → validate).

Relevant files: `packages/profiles/src/index.ts`, possibly a new `packages/profiles/src/loader.ts`.

Test addition: `packages/profiles/src/__tests__/get-profile.test.ts` covering each of the 6 real profiles + the placeholder fallback.

### G-6. `darwin/x64 → mac-chrome-stable` serves arm64 profile to Intel Macs

Surfaced by integration agent (`dd9a3c9`) for task 0272. Every Mac profile
in the v1 catalog (`mac-chrome-stable`, `mac-chrome-beta`,
`mac-m4-chrome-stable`, `mac-brave-stable`) declares `os.arch: "arm64"`.
The current `defaultProfileForHost()` mapping routes `darwin/x64` to
`mac-chrome-stable` — meaning Intel Mac users get an arm64 profile.

The page-side fingerprint reports arm64 (correct, internally consistent),
but the host is running an x64 Chromium binary. Native rendering
(WebGL strings, audio f32 bytes, font fallback paths) doesn't match the
captured arm64 baseline byte-exact. Any surface that falls through to
native rendering on the Intel Mac host will leak the arch mismatch.

Fix options:
- (a) Capture `mac-intel-chrome-stable` and update the mapping. Right
  long-term answer; needs an Intel Mac to capture from.
- (b) Until (a) lands, change `darwin/x64` to return `null` from
  `defaultProfileForHost()` so Intel Mac users hit the "pick explicitly"
  diagnostic. Honest > silently wrong.
- (c) Document as a known limit in `docs/limits.md` and `reference/limits.md`
  (the integration agent left a JSDoc note on the helper).

Recommendation: ship (b) NOW (one-line change) + (c) in the same PR;
queue (a) as a separate capture-task brief once Intel Mac hardware is
available.

### G-5. CHANGELOG.md is stale (only documents 0.1.0 / 0.1.1)

`packages/core/package.json` is at v0.4.0 on local main (the npm view earlier showed 0.3.0; release pipeline keeps moving). CHANGELOG.md last documents 0.1.1. Every minor bump from 0.1.2 → 0.4.0 happened via Changesets but the rendered CHANGELOG is missing the entries for those bumps.

Fix: run `bun changeset version` against the existing pending `.changeset/*.md` files (or audit which ones were consumed and which are pending). If the pipeline's already consumed them, the CHANGELOG should have absorbed the entries — check whether the version-packages PR step is actually writing CHANGELOG or skipping it.

This is a release-pipeline hygiene issue. Likely a 1-line fix in the version-packages script, plus a one-time backfill of the CHANGELOG entries from the consumed changesets.

### G-4. `wrapSelfRemovingPayload` is exported from `@mochi.js/core/cdp/init-injector` but NOT from the core barrel

The function is useful externally (test fixtures, custom inject pipelines) but isn't on `packages/core/src/index.ts`. Users who want it import a deep path that's not part of the public API contract.

Fix: re-export from `packages/core/src/index.ts`. Add to the LLM-context block in `api/core.md`. One-line change + one doc tweak.

## Workflow when picked up

1. Open a single task brief for each gap (or bundle G-3 + G-4 — both small).
2. Dispatch a single subagent with the bundled brief.
3. Same gates, same hook, same conventional commit pattern.
4. Bump `@mochi.js/core` and/or `@mochi.js/profiles` minor versions via changeset.
