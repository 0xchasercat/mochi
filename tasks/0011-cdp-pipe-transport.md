# 0011: pipe-mode CDP transport + minimal Session/Page

**Package:** `core`
**Phase:** `0.1`
**Estimated size:** L
**Dependencies:** 0001 (merged). Loose dep on 0010 (uses `resolveChromiumBinary` from `@mochi.js/cli` if available; falls back to `MOCHI_CHROMIUM_PATH` env var so the two tasks are independently testable).

## Goal

Land the Bun-native CDP pipe-mode transport and minimal Session/Page in `@mochi.js/core` per PLAN.md §5.1 + §8. After this task lands, `mochi.launch({...})` actually launches Chromium-for-Testing, navigates to a URL, reads page state, and closes cleanly. **No spoofing yet** — that's phases 0.2 → 0.3 — but the entire control plane is real.

This is the linchpin task. Every PLAN.md §8 design constraint must be honored. The CDP wrapper itself enforces the constraints with assertions (per PLAN.md §8.2: "the CDP wrapper has runtime asserts that refuse these").

## Success criteria

### Public API surface (PLAN.md §7 — must match exactly)

- [ ] `mochi.launch(opts)` returns a `Session` instance.
- [ ] `LaunchOptions` accepts: `profile`, `seed`, `proxy?`, `headless?`, `binary?`, `args?`, `out?`, `timeout?`. **Behavior at v0.1**: `profile` and `seed` are accepted but unused (no spoofing yet); `binary` overrides discovery; everything else honored. Document this in JSDoc on `LaunchOptions`.
- [ ] `Session` exposes: `profile` (a stub MatrixV1 derived trivially from the input — this is *fine* at 0.1; phase 0.2 wires the real consistency engine), `seed`, `newPage()`, `pages()`, `cookies(filter?)`, `setCookies()`, `storage()`, `fetch()`, `close()`. The methods that aren't implemented yet (`fetch` etc.) keep their `NotImplementedError` placeholders unchanged.
- [ ] `Page` exposes: `url`, `goto(url, opts?)`, `content()`, `text(selector)`, `evaluate(fn)`, `waitFor(selector, opts?)`, `humanClick`, `humanType`, `humanScroll`, `cookies()`, `screenshot()`, `close()`. Implemented at 0.1: `goto`, `content`, `text`, `evaluate`, `waitFor`, `cookies` (basic), `close`. Placeholders unchanged: `humanClick`/`humanType`/`humanScroll` (phase 0.8), `screenshot` (later).
- [ ] All return types match PLAN.md §7 verbatim.

### Transport (PLAN.md §8.1 + §8.2 — non-negotiable)

- [ ] Pipe-mode default. `Bun.spawn` with `stdio: ["pipe", "pipe", "pipe", "pipe", "pipe"]` so stdin/stdout/stderr + FD 3 (browser → us, read) + FD 4 (us → browser, write). Chromium flag: `--remote-debugging-pipe`.
- [ ] No TCP fallback. No `--remote-debugging-port`. Anywhere.
- [ ] CDP framing: newline-delimited JSON on each pipe; messages are NUL-terminated (`\0`) per the CDP pipe spec. Implement a streaming framer that handles partial reads and split messages.
- [ ] Each `Session` spawns its own Chromium with its own pipes. Sessions never share a process.

### Forbidden CDP commands (PLAN.md §8.2 — runtime assertions)

The transport's `send(method, params)` MUST throw synchronously when called with any of:

- [ ] `Runtime.enable` (any target)
- [ ] `Page.createIsolatedWorld`
- [ ] `Runtime.evaluate` with `params.includeCommandLineAPI === true`

A test must verify each rejection. The error type is `ForbiddenCdpMethodError` extending `Error`, with `method` + `reason` fields. Reason text references the PLAN.md §8.2 line for that constraint.

### Execution-context tracking without `Runtime.enable` (PLAN.md §8.3)

- [ ] Subscribe to `Page.frameAttached` and `Page.frameNavigated` for frame topology.
- [ ] Resolve frame → execution context via `DOM.resolveNode({ backendNodeId: documentNode })` returning a `RemoteObject` with `objectId`. Use `Runtime.callFunctionOn({objectId, functionDeclaration})` for evaluation. **Never** use `Runtime.executionContextCreated`.
- [ ] For workers/service-workers/audio-worklets: `Target.setAutoAttach({autoAttach: true, waitForDebuggerOnStart: true, flatten: true})`. Each new target gets its own session via `Target.attachedToTarget`. v0.1 just acknowledges them and resumes; full worker handling lands later.

### Process lifecycle (PLAN.md §8.5)

- [ ] Ephemeral user-data-dir per session (`mkdtemp("mochi-")` in `os.tmpdir()`).
- [ ] Default Chromium flags from PLAN.md §8.6 (the entire list).
- [ ] `Session.close()`: SIGTERM → 2-second grace → SIGKILL → `rm -rf` user-data-dir. All idempotent.
- [ ] On unexpected child exit: pending CDP promises reject with `BrowserCrashedError`. All open `Page`s close. Sessions do not auto-restart.

### Binary resolution

- [ ] Resolution order: `LaunchOptions.binary` > `process.env.MOCHI_CHROMIUM_PATH` > `@mochi.js/cli`'s `resolveChromiumBinary()` if available > error message pointing at `mochi browsers install`.
- [ ] Import `resolveChromiumBinary` from `@mochi.js/cli` lazily (dynamic `await import(...)`) so the cli isn't a hard runtime dep — when 0010 hasn't been published or installed, the env var path still works. If neither is available, error friendly.

### Tests

- [ ] Unit tests: CDP framer (partial reads, multi-message reads, NUL boundaries), `MessageRouter` (request/response correlation, event dispatch, timeout), `ForbiddenCdpMethodError` enforcement (one test per forbidden method).
- [ ] Integration test, gated by `MOCHI_E2E=1`:
  - Resolves Chromium binary (env var or 0010-installed).
  - `mochi.launch({profile: "test", seed: "x"})` → session.
  - `session.newPage()` → page.
  - `page.goto("data:text/html,<title>hi</title><h1>world</h1>")`.
  - `expect(await page.text("h1")).toBe("world")`.
  - `expect(await page.content()).toContain("<title>hi</title>")`.
  - `await session.close()` — assert process exited, user-data-dir gone.
  - Total runtime budget: < 10 seconds.
  - Skipped in default `bun test` runs (so the unit suite stays fast).
- [ ] Contract test verifying that the runtime assertions are emitted from public API (e.g., calling `Runtime.enable` via an internal escape hatch in tests gets the expected error).

### Other

- [ ] All package gates green: `bun typecheck`, `bun lint`, `bun test`, `bun test:contract --pkg=core`.
- [ ] No new runtime deps. Devdeps only if essential (and explain in commit body).
- [ ] Public API JSDoc complete. Every exported function/class/interface has a 1-3 sentence doc comment.

## Out of scope

Deferred to later phases:

- **Spoofing of any kind.** No injection. No fingerprint payload. No consistency engine wiring at runtime. Phase 0.2 wires `@mochi.js/consistency`; phase 0.3 wires `@mochi.js/inject`. At 0.1 the page sees the bare browser.
- `Session.fetch` — phase 0.6 (`@mochi.js/net` + `@mochi.js/net-rs`). Keeps its `NotImplementedError`.
- `humanClick` / `humanType` / `humanScroll` — phase 0.8 (`@mochi.js/behavioral`).
- `screenshot` — later micro-task, not 0.1.
- Cross-machine WebSocket transport (v2 per PLAN.md §16).
- Multi-Page-per-Chromium beyond `Target.setAutoAttach` plumbing — full worker fan-out is later.
- Cookie/storage filtering edge cases — basic shape only.

## Implementation notes

- File layout under `packages/core/src/`:
  - `index.ts` — re-exports the public API
  - `launch.ts` — `mochi.launch` + LaunchOptions
  - `session.ts` — `Session` class
  - `page.ts` — `Page` class
  - `cdp/transport.ts` — pipe-mode I/O, framer
  - `cdp/router.ts` — `MessageRouter`, request correlation, event bus
  - `cdp/forbidden.ts` — the assertion list + `ForbiddenCdpMethodError`
  - `cdp/types.ts` — minimal CDP type surface (cherrypick — DON'T add `chrome-devtools-protocol` as a dep, the type generated for the full surface is huge; we only need a small subset)
  - `proc.ts` — Chromium spawn + lifecycle
  - `binary.ts` — resolution chain
  - `__tests__/*.test.ts` — units
  - `__tests__/integration.e2e.test.ts` — the MOCHI_E2E-gated test
- Import surfaces:
  - `@mochi.js/consistency` (types only) for `MatrixV1` placeholder shape
  - `@mochi.js/cli` (lazy dynamic import only) for `resolveChromiumBinary`
- `Bun.spawn` stdio: index 0=stdin, 1=stdout, 2=stderr, 3=CDP read (browser→us), 4=CDP write (us→browser). Bun supports indices >2 via `stdio: ["pipe", "pipe", "pipe", "pipe", "pipe"]`. Read FD 3 via `proc.stdio[3]` (a `ReadableStream` in Bun).
- For the framer: stream reads can deliver any chunk size. Buffer until you find `\0`, parse the JSON before the NUL, repeat.
- For event dispatch: `MessageRouter` exposes `on(method, handler)` and `once(method, handler)`. Internally a `Map<string, Set<handler>>`.
- For request correlation: assign monotonic `id` per send, store a `Map<id, {resolve, reject, timeout}>`, dispatch on the `id` field of incoming messages. Default timeout 30s; `LaunchOptions.timeout` overrides.
- For `Page.text(selector)`: use `DOM.querySelector` to find the node, then `DOM.resolveNode` → `Runtime.callFunctionOn` with a `function() { return this.textContent; }` — exactly the §8.3 pattern.
- For `Page.evaluate(fn)`: serialize the fn (`fn.toString()`), wrap as `Runtime.callFunctionOn` against the document object's RemoteObject. **Do NOT** use `Runtime.evaluate` directly — it requires a target world by name, and naming worlds creates an isolated world (forbidden). Use `Runtime.callFunctionOn` with the document's objectId — that runs in main world without naming.
- Friendly errors throughout. When binary resolution fails, the error message says exactly what to run (`mochi browsers install` or set `MOCHI_CHROMIUM_PATH`).
- Use the conventional-commits scope `core` for all commits in this task.

## Validation

```sh
bun typecheck
bun lint
bun test
bun test:contract --pkg=core

# E2E (requires Chromium installed via 0010 or a binary on MOCHI_CHROMIUM_PATH)
MOCHI_E2E=1 bun test packages/core/src/__tests__/integration.e2e.test.ts

# manual smoke
MOCHI_CHROMIUM_PATH="$(mochi browsers path 2>/dev/null || echo /Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome)" \
  bun -e 'import { mochi } from "@mochi.js/core"; \
  const s = await mochi.launch({profile:"x",seed:"y"}); \
  const p = await s.newPage(); \
  await p.goto("data:text/html,<h1>hi</h1>"); \
  console.log(await p.text("h1")); \
  await s.close()'
# expect: hi
```

When everything's green: `bun work submit 0011 --draft`.

## Touch list (rough)

- `packages/core/src/{launch,session,page,proc,binary}.ts` (new)
- `packages/core/src/cdp/{transport,router,forbidden,types}.ts` (new)
- `packages/core/src/index.ts` (replace placeholder body with real exports)
- `packages/core/src/__tests__/*.test.ts` (extend smoke + add unit tests)
- `packages/core/src/__tests__/integration.e2e.test.ts` (new, MOCHI_E2E-gated)
- `packages/core/package.json` (add type-only dep on `@mochi.js/consistency`; verify cli stays out of runtime deps)
- `tests/contract/cdp-forbidden.contract.test.ts` (new) — verifies forbidden-method enforcement against a fake transport
