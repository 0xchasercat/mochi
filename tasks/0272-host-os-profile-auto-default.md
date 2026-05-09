# 0272 — Auto-pick host-OS-matching profile when `profile` is omitted

**Status:** queued (engineering follow-up to task 0271 strategic positioning)
**Owner:** unassigned (dispatch when phase-1 docs land; one subagent)
**Touches:** `packages/core/src/launch.ts`, `packages/core/src/index.ts`,
  `packages/profiles/src/index.ts`, `packages/core/src/__tests__/launch-default-profile.test.ts`
  (new), `docs/content/docs/getting-started/install.md` (one-line note),
  `docs/content/docs/getting-started/linux-server.md` (one-line note —
  already exists from task 0259/engineering agent commit `5705d38`).
**Blocked by:** task 0271 thesis lock-in (so the doc copy referencing
  this default is consistent with the thesis).

## Goal

When the user calls `mochi.launch({ seed })` without specifying
`profile`, mochi auto-picks a profile from `KNOWN_PROFILE_IDS` whose
declared OS matches the host's OS. The auto-pick is deterministic
(same host → same default), logged at INFO so users see what was
chosen, and overridable by passing `profile` explicitly.

## Why

Task 0271 documents the strategic thesis: spoofing Windows from a
Linux server is the wrong default. Today users must type
`profile: "linux-chrome-stable"` themselves. Lifting it into the
default removes the entire class of "user accidentally spoofed Windows
from a Linux DC and looked weird to the WAF" failures.

This is the same argument that drove task 0259/`detectLinuxServerEnv`
for headless mode — the framework should make the obviously-correct
choice automatic.

## Success criteria

- [ ] `mochi.launch({ seed: "x" })` (no `profile`) succeeds on Linux,
      Mac, and Windows hosts; picks the matching OS profile.
- [ ] On Linux: defaults to `linux-chrome-stable`.
- [ ] On macOS arm64: defaults to `mac-m4-chrome-stable`.
- [ ] On macOS x64: defaults to `mac-chrome-stable` (or
      `mac-m4-chrome-stable` with a documented caveat — investigate
      which is more honest given the captured profiles).
- [ ] On Windows x64: defaults to `windows-chrome-stable`.
- [ ] On any unsupported host (FreeBSD, Linux arm64 today, Windows arm64,
      Alpine musl): launch fails with a precise diagnostic and the list of
      explicit profile IDs the user can choose from. Do NOT silently fall
      back to a placeholder.
- [ ] Passing `profile` explicitly always wins; the auto-default never
      overrides an explicit choice.
- [ ] One INFO-level log line at launch time: `[mochi] no profile
      supplied; auto-picked <id> for host <os/arch>. To override: pass
      profile: "<id>" explicitly.`
- [ ] New unit test file `packages/core/src/__tests__/launch-default-profile.test.ts`
      stubs `process.platform` + `process.arch` and asserts the picked
      profile for each host case + the unsupported-host failure mode.
- [ ] Public API surface: export a pure helper
      `mochi.defaultProfileForHost(): ProfileId | null` so users can
      introspect what mochi would pick. Pure function, easy to test.
- [ ] Exported from `packages/core/src/index.ts`.
- [ ] Documented in the LLM-context block in `README.md` (so LLMs
      generating mochi code know the new default).
- [ ] Changeset added (`@mochi.js/core` minor bump) — additive feature.

## Out of scope

- Adding new profiles to `KNOWN_PROFILE_IDS` (e.g., a Linux arm64
  capture). Separate brief; this task only routes between the existing 6.
- Auto-picking based on locale, timezone, or proxy egress IP. Profile
  is OS-axis only.
- Changing the `profile: ProfileV1` shape — only adds an "omitted"
  branch.

## Implementation notes

- Read `packages/profiles/src/index.ts` for `KNOWN_PROFILE_IDS` and the
  per-profile metadata (especially the `os` and `arch` fields on each
  `ProfileV1`).
- Read `packages/core/src/launch.ts` for the existing `LaunchOptions`
  shape and the `resolveHeadlessMode` pattern (task 0259) — same
  pattern: a pure helper + a launch-time call that fills in the gap.
- Detection: `process.platform` is `"linux"` | `"darwin"` | `"win32"` |
  `"freebsd"` | etc. `process.arch` is `"x64"` | `"arm64"` | etc. The
  combinator picks the matching profile.
- For darwin x64 vs darwin arm64: today we have `mac-chrome-stable`
  (which one?), `mac-m4-chrome-stable` (M-series), `mac-chrome-beta`,
  `mac-brave-stable`. Read `profiles/<id>/profile.json` for each to
  confirm. Default rule: `darwin-arm64 → mac-m4-chrome-stable`,
  `darwin-x64 → mac-chrome-stable`. If `mac-chrome-stable` is actually
  Mac arm64 (which it might be, given the wave-2 capture history), the
  rule flips. Don't guess; read the profiles.
- Failure-mode diagnostic format:
  ```
  [mochi] launch: no profile supplied and no host-matching default for
    platform=<os> arch=<arch>. Pick one explicitly:
      - mac-m4-chrome-stable
      - mac-chrome-stable
      - mac-chrome-beta
      - windows-chrome-stable
      - linux-chrome-stable
      - mac-brave-stable
    See https://mochijs.com/docs/guides/choose-your-profile for the
    decision aid.
  ```
- The `defaultProfileForHost()` helper is exposed for two reasons:
  (1) introspection ("what would mochi pick?"), (2) testability (we can
  unit-test it with stubs without spinning a Chromium).
- The auto-pick is documented in:
  - `docs/content/docs/getting-started/install.md` — one paragraph.
  - `docs/content/docs/getting-started/linux-server.md` — one line
    cross-linking back to install for the rationale (don't re-write).
  - `docs/content/docs/api/core.md` — the LaunchOptions section's note
    about `profile` becoming optional + the new `defaultProfileForHost`
    helper.

## Validation

```sh
# 1. Unit tests for the auto-pick helper.
bun test packages/core/src/__tests__/launch-default-profile.test.ts

# 2. Full type/lint/test sweep.
bun run typecheck
bun run lint
bun run test
bun run test:contract

# 3. Manual smoke (from each host the team has access to):
#    `bun run -e 'import { mochi } from "@mochi.js/core";
#     console.log(mochi.defaultProfileForHost());'`
#    On Linux: linux-chrome-stable.
#    On Mac arm64: mac-m4-chrome-stable.
#    On Windows x64: windows-chrome-stable.
```

## Notes for the subagent

- Conventional commit: `feat(core): auto-pick host-OS-matching profile
  when profile is omitted from mochi.launch()`. Refs: tasks/0271
  (thesis), tasks/0272 (this brief).
- Do NOT modify the tone of the INFO log line — it's user-facing and
  task 0271 specifies the wording. If you need to change it, surface in
  the PR for orchestrator approval.
- The pre-push hook gates everything; don't bypass.
- Coordinate with the running `task 0270` doc writers if any scope
  overlap surfaces (specifically `api/core.md` is owned by writer-2).
  Cleanest path: this task lands AFTER writer-2's `api/core.md` is on
  main, and edits the LaunchOptions section in a follow-up commit.
