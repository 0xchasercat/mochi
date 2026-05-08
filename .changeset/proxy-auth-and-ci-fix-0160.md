---
"@mochi.js/core": minor
"@mochi.js/harness": patch
---

Land proxy authentication for HTTP / HTTPS / SOCKS5 / SOCKS4 proxies, wire
the live `conformance:stealth:online` gate to a residential proxy via the
`HTTP_PROXY` repo secret, and harden the `bot.incolumitas.com` test against
goto soft-fail timeouts.

- **`@mochi.js/core`** ships a new `proxy-auth.ts` that attaches a CDP
  `Fetch.authRequired` listener on session start when credentials are
  present, answering proxy auth challenges with `Fetch.continueWithAuth`.
  No extension, no `Runtime.enable`, no `Page.createIsolatedWorld` —
  PLAN.md §8.2 invariants preserved (`Fetch.enable` is not on the
  forbidden list and produces no page-observable signals). The handler is
  wired with empty `patterns` so regular request flow is unaffected; a
  defensive `Fetch.requestPaused` handler short-circuits via
  `Fetch.continueRequest` if Chromium ever pauses a request despite the
  empty pattern set. `Fetch.disable` runs on session close.

  `parseProxyUrl(url)` is exported and handles the four protocols, with
  and without auth, percent-encoded credentials, IPv6 hosts, and missing
  ports (defaults: HTTP=80, HTTPS=443, SOCKS5/4=1080).
  `LaunchOptions.proxy` accepts both the string form
  (`http://user:pass@host:port`) and the `ProxyConfig` record shape; both
  feed the same auth path. Credentials are forwarded to the network FFI
  too, so `Session.fetch` shares the same authenticated egress as the
  browser.

- **`@mochi.js/harness`** — `launchSharedSession()` now reads
  `MOCHI_PROXY` and feeds it to `mochi.launch({ proxy })` when set.
  Empty / unset = unproxied (fork PRs without secrets still run cleanly).
  The `bot.incolumitas.com` test short-circuits to its registered
  expected-failure when `bestEffortGoto` reports `navigated: false`,
  preventing the 12s sleep + 30s evaluate + worker-injection cascade
  from eating the 90s test budget.

- **CI** — both `release.yml` (existing Layer 2 step) and `pr-fast.yml`
  (newly added Layer 2 step, gated `if: github.event_name == 'pull_request'`)
  now pass `MOCHI_PROXY: ${{ secrets.HTTP_PROXY }}` so the live runs
  egress from a residential IP. The secret value is never echoed.
