# 0160: proxy auth (HTTP + SOCKS5) + CI proxy wire-up + incolumitas hot-fix

**Package:** primarily `core` + `harness` + repo-level CI
**Phase:** `0.5.x` (slot between conformance gates and v0.1.0 release)
**Estimated size:** L
**Dependencies:** 0011 (CDP transport), 0140 (stealth conformance)

## Goal

Make `mochi.launch({ proxy: "http://user:pass@host:port" })` (and the SOCKS5 equivalent) **just work**, without the user shipping an extension or running a local relay. Wire CI to consume `${{ secrets.HTTP_PROXY }}` so the live `conformance:stealth:online` gate runs from a residential IP — the failure mode that just blew the v0.1.0 release run on incolumitas was driven by GH-runner-IP rate-limiting + anti-debugger trap escalation.

After this lands the release pipeline gets unblocked: PR-fast + release.yml both run online stealth through the proxy, and the incolumitas test short-circuits to expected-failure if the page hangs anyway.

## Success criteria

### Core proxy auth

- [ ] `parseProxyUrl(url: string): { server: string; auth?: { username: string; password: string }; protocol: "http" | "https" | "socks5" | "socks4" }` — exported from `@mochi.js/core` (or internal helper, but tested). Splits `http://user:pass@host:port` into `{ server: "http://host:port", auth: { ... }, protocol: "http" }`. URL-encoded creds are decoded. Tests cover all 4 protocols, with-and-without auth, edge cases (missing port, IPv6 host, percent-encoded creds, empty password).
- [ ] `LaunchOptions.proxy` (string | ProxyConfig) — both forms feed the same auth path. The string form auto-parses; ProxyConfig stays explicit. Update the JSDoc that currently says auth is "ignored".
- [ ] `proc.ts` continues to pass `--proxy-server=` with auth-stripped server URL to Chromium (Chromium does NOT accept inline auth in `--proxy-server`; passing it strips/breaks).
- [ ] `Session` (or a new `proxy-auth.ts` attached during launch) registers a CDP listener:
  - `await router.send("Fetch.enable", { handleAuthRequests: true, patterns: [] })` — empty patterns means we don't intercept normal requests, only auth challenges. **Do NOT enable patterns on broad URL globs — that intercepts every request and tanks page perf.**
  - `router.on("Fetch.authRequired", ...)` → respond with `Fetch.continueWithAuth` providing the parsed credentials.
  - `router.on("Fetch.requestPaused", ...)` → forward via `Fetch.continueRequest` (defensive — should be unreachable with empty patterns, but if Chromium pauses we don't want to hang).
  - On session close: `Fetch.disable`.
- [ ] **PLAN.md §8.2 invariant check**: `Fetch.enable` is acceptable per the invariant — only `Runtime.enable` and `Page.createIsolatedWorld` are forbidden. `Fetch.enable` does not produce execution-context-creation events visible to page scripts. Add a comment in the auth handler citing this so a future reader doesn't get nervous.
- [ ] Auth handler is no-op when `auth` is absent (skip `Fetch.enable` entirely — don't pay the protocol-attach cost).

### Harness env wiring

- [ ] `packages/harness/src/conformance/stealth/helpers.ts` — `launchSharedSession()` reads `process.env.MOCHI_PROXY` and passes it to `mochi.launch({ proxy })` if set. Single env var, string form (auto-parsed). Document in JSDoc.

### CI

- [ ] `.github/workflows/release.yml` — add `MOCHI_PROXY: ${{ secrets.HTTP_PROXY }}` to the `Conformance gate — stealth Layer 2 (online)` step env block.
- [ ] `.github/workflows/pr-fast.yml` — **add a new step** `Stealth conformance — Layer 2 (online)`, gated `if: github.event_name == 'pull_request'`, env block matching release.yml (incl. MOCHI_PROXY, MOCHI_E2E, MOCHI_ONLINE, MOCHI_EXTRA_ARGS). Decision per orchestrator: yes, mirror the online gate to PR-fast.
- [ ] Both workflows: do NOT log the env. The secret is automatically masked in GitHub's log redactor but defense-in-depth — never `echo $MOCHI_PROXY`.
- [ ] If the secret is empty or missing, the test should still run (just without proxy) and not error. Sanity for forks / dev envs without the secret.

### Incolumitas test resilience

- [ ] `packages/harness/src/conformance/stealth/__tests__/bot-detection-sites.test.ts` — when `bestEffortGoto(...)` returns `goto.navigated === false` AND `expected !== undefined`, **short-circuit to expected-failure return** instead of running the 12s sleep + 30s evaluate + worker timeout pile-up. Logs as expected failure, returns from the `it()` body cleanly. Belt-and-suspenders behind the proxy fix.
- [ ] When `goto.navigated === true` (the proxy made the goto succeed), behavior is unchanged — still runs the full evaluate + assertion path. Don't make the test artificially weaker on the happy path.

### Tests

- [ ] Unit tests for `parseProxyUrl` covering all 4 protocols × auth/no-auth × edge cases.
- [ ] Unit test for the auth handler that constructs a fake CDP router, fires a `Fetch.authRequired` event, asserts `Fetch.continueWithAuth` was sent with the right creds.
- [ ] Cross-package contract test: `mochi.launch({ proxy: "http://u:p@host:8080" })` calls `Fetch.enable`, but `mochi.launch({ proxy: "http://host:8080" })` does NOT. Mock the CDP transport.

### Other

- [ ] Update `docs/limits.md`: replace the "ProxyConfig auth ignored" line (see launch.ts:38-40 JSDoc) with a v0.5 entry naming the supported auth modes (HTTP basic auth, SOCKS5 user/pass via Chromium's CDP path) and known limitation (proxy_pac scripts not yet supported).
- [ ] Changeset: minor on `@mochi.js/core` (new auth path) + patch on `@mochi.js/harness` (env consumption + test resilience).

## Out of scope

- WPAD / proxy-PAC script support — separate task, low priority.
- Per-page-tab independent proxy (`Network.setRequestInterception` on a single Page) — different surface; current scope is session-wide.
- Changing the worker payload-inject 30s timeout — separate hygiene task; the short-circuit makes incolumitas robust without it.
- Bumping `TEST_TIMEOUT_MS` — papering over the symptom; rejected.
- Adding extension-based proxy auth (`--load-extension`) — extensions are a fingerprint leak (chrome.runtime weirdness); CDP path is invariant-clean.

## Implementation notes

- See `PLAN.md` §8.2 (forbidden CDP methods — Fetch.enable is NOT on the list, but document the reasoning), §8.6 (default flags — don't add anything), §10 (network FFI — already gets `netProxy` from launch.ts:105; verify auth is preserved in that path or surface the gap).
- Look at how `Session` already wires CDP event listeners (probably `packages/core/src/session.ts`) — register the auth handler the same way.
- The router's `on()` API: confirm how subscribe/unsubscribe works. The auth handler must unsubscribe on close to avoid leaking listeners.
- `Fetch.continueWithAuth` request shape:
  ```
  {
    requestId: <from event>,
    authChallengeResponse: {
      response: "ProvideCredentials",
      username: <parsed>,
      password: <parsed>
    }
  }
  ```
- Don't wire MOCHI_PROXY into the Probe Manifest harness:smoke — that runs against a local fixture file and doesn't need a proxy. Verify it doesn't accidentally consume it (probably already doesn't).

## Validation

```sh
bun run typecheck            # 9/9 packages
bun run lint                 # biome
bun run test                 # all unit tests including new parseProxyUrl + auth handler
bun run test:contract        # cross-package contracts incl. proxy
# Skip conformance:stealth:online locally (needs proxy + Chromium) — CI runs it
```

## Submission

Worktree is at `worktrees/0160`. Submit via:

```sh
bun work submit 0160 --draft
```

**Known issue**: `bun work submit` has a bug writing PR body to `${worktree}/.git/MOCHI_PR_BODY.md` (`.git` is a file in worktrees, not a dir). If submit crashes, the branch push will have succeeded — just open the PR manually:

```sh
gh pr create --draft \
  --title "feat(core,harness): proxy auth (HTTP + SOCKS5) + CI proxy + incolumitas resilience" \
  --body "$(cat tasks/0160-proxy-auth-and-ci-fix.md | head -40)"
```

Reporting expectation per AGENTS.md — under 300 words, named files + line counts, what you skipped + why, PR URL.
