/**
 * `mochi.launch()` — entry point for opening a Session.
 *
 * v0.2 wires `@mochi.js/consistency`'s `deriveMatrix` into the launch path:
 * the input `(profile, seed)` flows through the rule DAG and the resolved
 * `MatrixV1` is stamped on the Session. The Matrix is **not** yet injected
 * into the page — that's phase 0.3 (`@mochi.js/inject`). The browser still
 * sees its native fingerprints; only `Session.profile` carries the spoof.
 *
 * @see PLAN.md §5.1 / §7 / §14
 */

import { deriveMatrix, type ProfileV1 } from "@mochi.js/consistency";
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
 * v0.2 behavior of fields:
 *   - `profile`, `seed`: drive `@mochi.js/consistency.deriveMatrix` to
 *     produce a relationally-locked `MatrixV1`. The Matrix is exposed via
 *     `Session.profile` but **not yet injected** into the page (phase 0.3).
 *   - `binary`: explicit override. Highest-priority resolution path.
 *   - `headless`: passes `--headless=new` to Chromium.
 *   - `proxy`: passes `--proxy-server=<value>` to Chromium. ProxyConfig auth
 *     is currently ignored (Chromium needs proxy-auth-extension). Document
 *     in docs/limits.md when we land it.
 *   - `args`: appended after the default flag set.
 *   - `out.traceDir`: not yet honored at v0.1.
 *   - `timeout`: per-CDP-request default; defaults to 30000ms.
 *   - `bypassInject`: short-circuits the inject payload entirely (see field
 *     JSDoc). Intended for `mochi capture` and similar baseline-collection
 *     flows — never enable in production.
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
  /**
   * When `true`, the {@link Session} skips both `buildPayload` (no payload
   * is compiled) and `Page.addScriptToEvaluateOnNewDocument` on every new
   * page. Auto-attached worker / service-worker / audio-worklet targets
   * are likewise NOT injected — the browser reports its bare, un-spoofed
   * fingerprints.
   *
   * Intended for `mochi capture` and similar baseline-collection flows;
   * **do not enable in production**. The whole point of mochi is the
   * inject pipeline; bypassing it produces a session that will be
   * trivially fingerprinted as Chromium-for-Testing.
   *
   * Defaults to `false`. PLAN.md §12.1 (capture must run against bare
   * Chromium); task 0040.
   */
  bypassInject?: boolean;
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

  // Resolve the `MatrixV1` for this session via the consistency engine.
  // Inline `ProfileV1` objects flow straight through; string profile ids
  // are resolved against a placeholder profile until `@mochi.js/profiles`
  // ships its first capture (phase 0.4). The matrix is bit-stable per
  // `(profile, seed)` excluding the `derivedAt` timestamp.
  const profile = resolveProfile(opts.profile);
  const matrix = deriveMatrix(profile, opts.seed);

  const session = new Session({
    proc,
    matrix,
    seed: opts.seed,
    ...(opts.timeout !== undefined ? { defaultTimeoutMs: opts.timeout } : {}),
    ...(opts.bypassInject === true ? { bypassInject: true } : {}),
    // Forward the same proxy used for the browser to the net FFI so
    // out-of-band Session.fetch traffic shares the apparent egress.
    ...(proxyArg !== undefined ? { netProxy: proxyArg } : {}),
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

/**
 * Resolve `LaunchOptions.profile` into a concrete `ProfileV1`. Inline
 * profiles flow through unchanged. String profile ids — until
 * `@mochi.js/profiles` ships (phase 0.4) — resolve to a generic placeholder
 * stamped with the id; the consistency engine still produces a real,
 * relationally-locked Matrix from it.
 */
function resolveProfile(profile: ProfileId | ProfileV1): ProfileV1 {
  if (typeof profile === "object") return profile;
  return {
    id: profile,
    version: "0.0.0-placeholder",
    engine: "chromium",
    browser: { name: "chrome", channel: "stable", minVersion: "131", maxVersion: "133" },
    os: { name: "linux", version: "22", arch: "x64" },
    device: {
      vendor: "generic",
      model: "generic-x64",
      cpuFamily: "intel-core-i7",
      cores: 8,
      memoryGB: 16,
    },
    display: { width: 1920, height: 1080, dpr: 1, colorDepth: 24, pixelDepth: 24 },
    gpu: {
      vendor: "Intel Inc.",
      renderer: "Intel Iris Xe Graphics",
      webglUnmaskedVendor: "Google Inc. (Intel Inc.)",
      webglUnmaskedRenderer: "ANGLE (Intel Inc., Intel Iris Xe Graphics, OpenGL 4.1)",
      webglMaxTextureSize: 16384,
      webglMaxColorAttachments: 8,
      webglExtensions: [],
    },
    audio: { contextSampleRate: 48000, audioWorkletLatency: 0.005, destinationMaxChannelCount: 2 },
    fonts: { family: "linux-baseline", list: ["DejaVu Sans"] },
    timezone: "UTC",
    locale: "en-US",
    languages: ["en-US", "en"],
    behavior: { hand: "right", tremor: 0.18, wpm: 60, scrollStyle: "smooth" },
    wreqPreset: "chrome_131_linux",
    userAgent:
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    uaCh: {},
    entropyBudget: { fixed: [], perSeed: [] },
  };
}
