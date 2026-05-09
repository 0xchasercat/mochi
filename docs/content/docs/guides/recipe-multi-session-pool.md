---
title: "Recipe: Multi-session pool"
description: Fan out N concurrent sessions with deterministic per-worker seeds and per-session error isolation.
order: 22
category: guides
lastUpdated: 2026-05-09
---

## Scenario

You have a list of 200 URLs to visit. Sequential is too slow. A single tab in N parallel pages won't work — they'd share the same `(profile, seed)` Matrix, the same TLS session, the same cookie jar, the same exit IP. To a fingerprinter that looks like one user opening 200 tabs in 30 seconds, which is the wrong shape. You want N independent sessions, each with its own derived Matrix (different `display.width` jitter, different `behavior.tremor` instance, different UA-CH if you're rotating profiles), each with its own Chromium child, each isolated from the others' failures.

mochi sessions are independent by construction. One `Session` = one Chromium process = one CDP transport = one ephemeral user-data-dir. A `seed` of `pool-0`, `pool-1`, …, `pool-N` produces N distinct relationally-locked Matrices from the same profile. `Promise.all` plus `Promise.allSettled` gives you the fan-out and the per-session error isolation.

## Complete code listing

```ts
import { mochi } from "@mochi.js/core";

interface JobResult {
  url: string;
  status: "ok" | "error";
  bytes?: number;
  error?: string;
}

const URLS = await Bun.file("./input/urls.txt").text().then((t) => t.trim().split("\n"));
const POOL_SIZE = 8;
const PROFILE = "linux-chrome-stable";

async function visit(workerId: number, url: string): Promise<JobResult> {
  const session = await mochi.launch({
    profile: PROFILE,
    seed: `pool-${workerId}`,
  });
  try {
    const page = await session.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    const html = await page.content();
    return { url, status: "ok", bytes: html.length };
  } catch (err) {
    return { url, status: "error", error: String(err) };
  } finally {
    await session.close();
  }
}

async function worker(workerId: number, queue: string[]): Promise<JobResult[]> {
  const out: JobResult[] = [];
  while (queue.length > 0) {
    const url = queue.shift();
    if (url === undefined) break;
    out.push(await visit(workerId, url));
  }
  return out;
}

const queue = [...URLS];
const results = (
  await Promise.all(
    Array.from({ length: POOL_SIZE }, (_, i) => worker(i, queue)),
  )
).flat();

console.log(`ok=${results.filter((r) => r.status === "ok").length}, err=${results.filter((r) => r.status === "error").length}`);
await Bun.write("./out/results.json", JSON.stringify(results, null, 2));
```

## What's happening here

- **One launch per visit, not per pool.** Each visit gets its own `Session`. That's a fresh Chromium child, a fresh user-data-dir, a fresh derived Matrix. Sharing one session across the pool would leak cross-URL state (cookies, local cache, the same TLS session).
- **`seed: \`pool-${workerId}\``** — the seed is per *worker*, not per *URL*. That keeps the Matrix stable for the worker's lifetime: same display dimensions, same trajectory style, same `behavior.tremor` for every URL it visits. If you want per-URL seeds (rare; only for replay debugging), interpolate the URL hash instead.
- **`Promise.all([...workers])`** — N workers each draining a shared queue. The `queue.shift()` race is fine in single-threaded JS — there's no contention until you reach the empty state, and `shift() === undefined` cleanly terminates each worker.
- **`try { ... } finally { await session.close(); }`** — every session gets closed, even on throw. `Session.close` is idempotent: kills Chromium (SIGTERM → 2 s grace → SIGKILL), removes the user-data-dir, drops the net Ctx, tears down the router. Without this you leak Chromium processes and disk.
- **Per-visit try/catch returning a `JobResult`.** Errors don't propagate up — the worker keeps draining the queue. `Promise.all` would reject on the first failure; `Promise.allSettled` is an alternative if you want it at the worker level instead of the visit level.

## Things that go wrong

- **Memory budget.** Each session = one Chromium process = ~150–300 MB resident. A `POOL_SIZE` of 32 is ~5–10 GB. On a 4 GB CI runner that's an OOM. Cap the pool empirically — `bun run` doesn't limit you, the kernel does.
- **Sharing one session.** Calling `session.newPage()` N times and fanning out across pages *is* faster (no per-visit Chromium spawn cost) but every page shares the same Matrix, the same cookies, the same proxy egress. To a fingerprinter that's one user with 8 tabs. Use the per-session pool when isolation matters (separate accounts, separate proxies, separate fingerprints); use the per-page pool when throughput matters and you're inside one trust boundary.
- **`mochi.launch({ seed: workerId })` (number).** `seed` is a `string`. Number seeds throw at consistency-engine call time. Use `String(workerId)` or `\`pool-${workerId}\``.
- **Forgetting `await session.close()` in the error path.** Workers that throw without closing leave Chromium orphans. The `finally` block above is load-bearing — `process.exit(1)` from a script with 8 dangling Chromium children is the kind of thing you debug at 2 AM via `pgrep`.
- **`Promise.all` on the visit array directly.** `Promise.all(URLS.map(visit))` launches 200 Chromium children at once. The kernel will refuse, the OS X file-descriptor limit will hit before that, and you'll spend an hour wondering why the script hangs. Bound through a worker count.

## See also

- [`guides/pick-a-scenario`](/docs/guides/pick-a-scenario) — index of every recipe.
- [`guides/recipe-residential-proxy`](/docs/guides/recipe-residential-proxy) — same pool, but each worker gets a different proxy URL.
- [`guides/recipe-ci-github-actions`](/docs/guides/recipe-ci-github-actions) — how to run pool jobs in CI (memory pinning, runner sizing).
- [`api/core`](/docs/api/core) — `Session.close`, `LaunchOptions`.
- [`concepts/consistency-engine`](/docs/concepts/consistency-engine) — why seed-per-worker is sufficient and seed-per-URL is wasteful.

<!-- llm-context:start
Page purpose: cookbook recipe — pool of N concurrent mochi.launch sessions, each
with a deterministic per-worker seed (`pool-${i}`), each independently catching
and isolating errors so a single failure doesn't stall the queue.

Key API symbols + signatures (verified against packages/core/src/launch.ts as of 2026-05-09):
  mochi.launch(opts: { profile: ProfileId | ProfileV1; seed: string; ... }): Promise<Session>
    seed is REQUIRED and is typed as `string` — number seeds throw
  session.newPage(): Promise<Page>
  session.close(): Promise<void>     // idempotent, must be called in a finally
  page.goto(url: string, opts?: { waitUntil?: "load" | "domcontentloaded" | "networkidle"; timeout?: number }): Promise<void>
  page.content(): Promise<string>

Common LLM hallucinations + corrections:
  - WRONG: `mochi.launch({ profile, seed: workerId })` (number)  → CORRECT: `seed: \`pool-${workerId}\`` (string)
  - WRONG: `session.context()` / `session.contexts`              → CORRECT: there is no BrowserContext; one Session is the unit of isolation
  - WRONG: sharing a single Session across the pool for "speed"  → CORRECT: per-worker Session for fingerprint + cookie + proxy isolation; share a Session only if intent is one-trust-boundary throughput
  - WRONG: `Promise.all(URLS.map(visit))` (unbounded)            → CORRECT: bound through a fixed pool of workers each draining a shared queue
  - WRONG: omitting `await session.close()` on error              → CORRECT: always close in a `finally`; sessions own a Chromium child + ephemeral user-data-dir
  - WRONG: `mochi.launch({ pool: 8 })`                            → CORRECT: there is no built-in pool; orchestrate with Promise.all
  - VERIFIED: `mochi.connect({ wsEndpoint, profile, seed })` is a public API since 0.8.x — attach to a CDP browser mochi did NOT spawn (BrowserBase, Browserless, Docker, re-attach). See https://mochijs.com/docs/guides/connect-existing-chrome.

Cross-references on mochijs.com:
  - https://mochijs.com/docs/guides/pick-a-scenario
  - https://mochijs.com/docs/guides/recipe-residential-proxy
  - https://mochijs.com/docs/guides/recipe-ci-github-actions
  - https://mochijs.com/docs/api/core
  - https://mochijs.com/docs/concepts/consistency-engine
  - https://mochijs.com/docs/concepts/profiles
  - https://mochijs.com/docs/reference/limits
llm-context:end -->
