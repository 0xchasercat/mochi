/**
 * Recipe: Multi-session pool.
 *
 * Fan out N parallel sessions with deterministic seeds (`pool-${i}-${RUN_ID}`)
 * draining a shared URL queue. Each session = one Chromium child = one
 * relationally-locked Matrix. Per-session error isolation via
 * `Promise.allSettled` at the worker level so a single failure doesn't
 * stall the queue.
 *
 * Memory caveat: each session is ~150–300 MB resident. Pool of 8 ≈ 1.5–2.5 GB.
 * On a 4 GB CI runner cap at 4–6.
 *
 * @see https://mochijs.com/docs/guides/recipe-multi-session-pool
 */

import { mochi } from "@mochi.js/core";

interface JobResult {
  url: string;
  status: "ok" | "error";
  bytes?: number;
  error?: string;
}

const POOL_SIZE = Number(process.env.POOL_SIZE ?? "4");
const RUN_ID = process.env.RUN_ID ?? new Date().toISOString();
const PROFILE = "linux-chrome-stable";

// Demo input. In production read from `Bun.file("./input/urls.txt").text()`.
const URLS: readonly string[] = [
  "https://example.com/one",
  "https://example.com/two",
  "https://example.com/three",
  "https://example.com/four",
];

async function visit(workerId: number, url: string): Promise<JobResult> {
  // One launch per visit — fresh Chromium child, fresh user-data-dir, fresh
  // matrix. Sharing one session across the pool would leak cookies / TLS
  // session / proxy egress across URLs.
  const session = await mochi.launch({
    profile: PROFILE,
    seed: `pool-${workerId}-${RUN_ID}`,
  });
  try {
    const page = await session.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    const html = await page.content();
    return { url, status: "ok", bytes: html.length };
  } catch (err) {
    return { url, status: "error", error: String(err) };
  } finally {
    // Idempotent. Always-close in finally so a throw doesn't leak Chromium.
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
// Promise.allSettled at the worker level — one worker crash doesn't void the
// rest. Per-visit errors are already caught inside `visit`.
const settled = await Promise.allSettled(
  Array.from({ length: POOL_SIZE }, (_, i) => worker(i, queue)),
);

const results: JobResult[] = settled.flatMap((s) =>
  s.status === "fulfilled"
    ? s.value
    : [{ url: "<worker-crash>", status: "error", error: String(s.reason) }],
);

const ok = results.filter((r) => r.status === "ok").length;
const err = results.filter((r) => r.status === "error").length;
console.log(`pool=${POOL_SIZE} ok=${ok} err=${err}`);
await Bun.write("./out/results.json", JSON.stringify(results, null, 2));
