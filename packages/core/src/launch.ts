/**
 * `mochi.launch()` — entry point for opening a Session.
 *
 * v0.1 wires the full CDP control plane: binary resolution → Chromium spawn
 * with pipe FDs → CDP transport + router → Session/Page surface. **No
 * spoofing** — `profile`/`seed` are accepted and stamped on a placeholder
 * MatrixV1, but no payload injection happens. Phase 0.2 wires
 * `@mochi.js/consistency`; phase 0.3 wires `@mochi.js/inject`.
 *
 * @see PLAN.md §5.1 / §7 / §14
 */

import type { MatrixV1, ProfileV1 } from "@mochi.js/consistency";
import { resolveBinary } from "./binary";
import { spawnChromium } from "./proc";
import { Session } from "./session";
import { VERSION } from "./version";

/** Profile reference accepted by `mochi.launch`. */
export type ProfileId = string;

/** Proxy spec accepted by `mochi.launch`. */
export interface ProxyConfig {
  server: string;
  username?: string;
  password?: string;
}

/**
 * Options accepted by `mochi.launch`.
 *
 * v0.1 behavior of fields:
 *   - `profile`, `seed`: accepted and recorded; **no spoofing wired yet**.
 *     Phase 0.2 / 0.3 will plug `@mochi.js/consistency` + `@mochi.js/inject`.
 *   - `binary`: explicit override. Highest-priority resolution path.
 *   - `headless`: passes `--headless=new` to Chromium.
 *   - `proxy`: passes `--proxy-server=<value>` to Chromium. ProxyConfig auth
 *     is currently ignored (Chromium needs proxy-auth-extension). Document
 *     in docs/limits.md when we land it.
 *   - `args`: appended after the default flag set.
 *   - `out.traceDir`: not yet honored at v0.1.
 *   - `timeout`: per-CDP-request default; defaults to 30000ms.
 */
export interface LaunchOptions {
  profile: ProfileId | ProfileV1;
  seed: string;
  proxy?: string | ProxyConfig;
  headless?: boolean;
  binary?: string;
  args?: string[];
  out?: { traceDir?: string };
  timeout?: number;
}

/**
 * Launch a Session: spawn Chromium with `--remote-debugging-pipe`, attach the
 * CDP transport, and return a configured `Session`.
 */
export async function launch(opts: LaunchOptions): Promise<Session> {
  const binary = await resolveBinary(opts.binary);
  const proxyArg = normalizeProxy(opts.proxy);
  const proc = await spawnChromium({
    binary,
    extraArgs: opts.args,
    headless: opts.headless ?? false,
    ...(proxyArg !== undefined ? { proxy: proxyArg } : {}),
  });

  // v0.1 stub MatrixV1. Phase 0.2 will replace this with the real derive call.
  // We construct a minimum-viable shape that satisfies the typed contract;
  // every field is a placeholder marked via `derivedAt` and the engine version.
  const matrix = makeStubMatrix(opts.profile, opts.seed);

  const session = new Session({
    proc,
    matrix,
    seed: opts.seed,
    ...(opts.timeout !== undefined ? { defaultTimeoutMs: opts.timeout } : {}),
  });
  return session;
}

/**
 * The public namespace exposed via `import { mochi } from "@mochi.js/core"`.
 */
export const mochi = {
  /** Framework version. */
  version: VERSION,
  /** Launch a browser session. */
  launch,
} as const;

export type Mochi = typeof mochi;

// ---- helpers ----------------------------------------------------------------

function normalizeProxy(p: LaunchOptions["proxy"]): string | undefined {
  if (p === undefined) return undefined;
  if (typeof p === "string") return p;
  return p.server;
}

function makeStubMatrix(profile: ProfileId | ProfileV1, seed: string): MatrixV1 {
  if (typeof profile === "object") {
    return {
      ...profile,
      seed,
      derivedAt: new Date().toISOString(),
      consistencyEngineVersion: `stub-${VERSION}`,
    };
  }
  // String profile id → tiny placeholder ProfileV1 stamped with the id. The
  // values are *intentionally generic* — phase 0.2 replaces this entirely.
  return {
    id: profile,
    version: "0.0.0-stub",
    engine: "chromium",
    browser: { name: "chrome", channel: "stable", minVersion: "0", maxVersion: "9999" },
    os: { name: "linux", version: "0", arch: "x64" },
    device: { vendor: "stub", model: "stub", cpuFamily: "stub", cores: 1, memoryGB: 1 },
    display: { width: 1920, height: 1080, dpr: 1, colorDepth: 24, pixelDepth: 24 },
    gpu: {
      vendor: "stub",
      renderer: "stub",
      webglUnmaskedVendor: "stub",
      webglUnmaskedRenderer: "stub",
      webglMaxTextureSize: 0,
      webglMaxColorAttachments: 0,
      webglExtensions: [],
    },
    audio: { contextSampleRate: 48000, audioWorkletLatency: 0, destinationMaxChannelCount: 2 },
    fonts: { family: "stub", list: ["stub"] },
    timezone: "UTC",
    locale: "en-US",
    languages: ["en-US"],
    behavior: { hand: "right", tremor: 0, wpm: 60, scrollStyle: "smooth" },
    wreqPreset: "stub",
    userAgent: "stub",
    uaCh: {},
    entropyBudget: { fixed: [], perSeed: [] },
    seed,
    derivedAt: new Date().toISOString(),
    consistencyEngineVersion: `stub-${VERSION}`,
  };
}
