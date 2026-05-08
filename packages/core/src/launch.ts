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
import { parseProxyUrl } from "./proxy-auth";
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
 * Per-challenge convenience options surfaced via `LaunchOptions.challenges`.
 *
 * v0.2 implements `turnstile.autoClick` only. Other entries (hCaptcha,
 * reCAPTCHA, etc.) are reserved for v0.3+ — see `@mochi.js/challenges`
 * README.
 *
 * When `turnstile.autoClick: true`, the `Session` calls
 * `installTurnstileAutoClick(page)` on every page returned by `newPage`.
 * The handle is disposed automatically on page close.
 *
 * The full `TurnstileOptions` (timeout / humanize / onSolved / onEscalation)
 * are passed through unchanged. See
 * `@mochi.js/challenges#TurnstileOptions`.
 */
export interface ChallengeLaunchOptions {
  turnstile?: {
    /** When `true`, auto-install Turnstile detection + click on every newPage. */
    autoClick?: boolean;
    /** Override the per-widget post-click timeout (ms). Default 30_000. */
    timeout?: number;
    /** When `false`, use a fast non-humanized click path. Default `true`. */
    humanize?: boolean;
    /** Fired when a widget reports a token. */
    onSolved?: (token: string) => void;
    /** Fired on image-challenge / managed-variant / timeout. */
    onEscalation?: (reason: "image-challenge" | "managed" | "timeout") => void;
    /** Override the DOM-poll cadence (ms). Default 500. */
    pollIntervalMs?: number;
  };
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
 *   - `proxy`: passes `--proxy-server=<server>` to Chromium with credentials
 *     stripped (Chromium rejects inline auth on that flag). When credentials
 *     are present (either in the URL form `http://user:pass@host:port` or
 *     via `ProxyConfig.username`/`password`) the Session installs a CDP
 *     `Fetch.authRequired` handler so HTTP / HTTPS / SOCKS5 / SOCKS4 proxy
 *     auth challenges are answered transparently. See
 *     `packages/core/src/proxy-auth.ts` for the invariant rationale.
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
   * Opt out of mochi's "auto-add `--no-sandbox` when running as root on
   * Linux" fallback. Default `false` (the fallback is on). When `true`,
   * mochi will NOT inject `--no-sandbox` even under root + Linux — useful
   * if you've configured a SUID `chrome-sandbox` helper and want to keep
   * the user-namespace sandbox active. The launch will crash with EPIPE
   * if the SUID setup is wrong, but you keep stealth posture intact
   * (`--no-sandbox` is a fingerprint leak per PLAN.md §8.6).
   */
  allowRootWithSandbox?: boolean;
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
  /**
   * When `true`, re-applies the harness/CI-only Chromium flags
   * (`--disable-component-update`, `--disable-default-apps`,
   * `--disable-background-networking`, `--disable-sync`, plus a noise-
   * reduction `--disable-features=` block) on top of the production
   * default flag set. Used by `@mochi.js/harness`, CI runs, and
   * `mochi capture` flows where update traffic, default-apps auto-install,
   * sync, and feed prefetches would inject non-determinism into baseline
   * collection or stealth conformance.
   *
   * Defaults to `false` — production users get a cleaner flag set without
   * the passive command-line bot-tells that patchright explicitly removes
   * from its Playwright fork (`chromiumSwitchesPatch.ts:20-34`) and that
   * `puppeteer-real-browser` strips for the same reason
   * (`lib/cjs/index.js:57-58`).
   *
   * Pairs with — but is independent of — {@link bypassInject}. Capture
   * flows set both `true`; harness conformance runs set `hermetic: true`
   * with full inject pipeline active. PLAN.md §8.6 + task 0256.
   */
  hermetic?: boolean;
  /**
   * Convenience layer toggles for common bot-defense widgets. When
   * `challenges.turnstile.autoClick` is `true`, every page returned by
   * `Session.newPage` has `installTurnstileAutoClick(page, opts)` wired
   * automatically — the Bezier+Fitts behavioral synth handles the click,
   * an optional `onSolved` callback fires when the response token appears,
   * and `onEscalation` fires on image-challenge / managed-variant / timeout.
   *
   * See `@mochi.js/challenges` for the full surface and the limits page
   * for the v0.2 scope (visible-checkbox variants only — image/audio
   * solving is v0.3+).
   */
  challenges?: ChallengeLaunchOptions;
}

/**
 * Launch a Session: spawn Chromium with `--remote-debugging-pipe`, attach the
 * CDP transport, and return a configured `Session`.
 */
export async function launch(opts: LaunchOptions): Promise<Session> {
  const binary = await resolveBinary(opts.binary);
  const normalized = normalizeProxy(opts.proxy);

  // Resolve the `MatrixV1` BEFORE spawning so matrix-derived values flow
  // into both the `--lang` flag (task 0251) and `--window-size` flag
  // (task 0252). The matrix is otherwise read post-spawn for inject;
  // deriving early is cheap (~µs, pure function) and lets us close the
  // I-5 leaks between Chromium's native network/OS-window state and the
  // JS-layer spoof.
  //
  // Inline `ProfileV1` objects flow straight through; string profile ids
  // are resolved against a placeholder profile until `@mochi.js/profiles`
  // ships its first capture (phase 0.4). The matrix is bit-stable per
  // `(profile, seed)` excluding the `derivedAt` timestamp.
  const profile = resolveProfile(opts.profile);
  const matrix = deriveMatrix(profile, opts.seed);

  const proc = await spawnChromium({
    binary,
    extraArgs: opts.args,
    headless: opts.headless ?? false,
    // Opt-out for the auto-no-sandbox-as-root fallback (default: fallback
    // is on so first-run on a Linux server box doesn't crash).
    ...(opts.allowRootWithSandbox === true ? { allowRootWithSandbox: true } : {}),
    // Chromium rejects inline auth on `--proxy-server`; pass the
    // auth-stripped server URL.
    ...(normalized !== undefined ? { proxy: normalized.server } : {}),
    // Primary BCP-47 locale → `--lang=<value>`. Locks the network-layer
    // `Accept-Language` header to the JS spoof (PLAN.md I-5). The full
    // multi-locale list still flows through `matrix.languages` to the
    // inject layer's `navigator.languages` spoof; Chromium derives the
    // q-weighted `Accept-Language` value from the single `--lang` primary
    // automatically. Task 0251.
    locale: matrix.locale,
    // Pin OS-level outer window from the matrix's display geometry so
    // `window.outerWidth/outerHeight` (which reads from the OS window,
    // NOT the JS-spoofed `screen.*`) matches the spoof. Closes the
    // `fingerprint-scan.com` 800×600 leak under `--headless=new`.
    // UDC fixes the same issue at `__init__.py:410-411`. Task 0252.
    ...(Number.isInteger(matrix.display.width) &&
    Number.isInteger(matrix.display.height) &&
    matrix.display.width > 0 &&
    matrix.display.height > 0
      ? { windowSize: { width: matrix.display.width, height: matrix.display.height } }
      : {}),
    // Hermetic harness/CI escape hatch — re-applies the patchright-trim
    // flags (`--disable-component-update`, `--disable-default-apps`,
    // `--disable-background-networking`, `--disable-sync`, hermetic
    // `--disable-features=` extras). Default `false` keeps production users
    // off the passive command-line bot-tell list. Task 0256, PLAN.md §8.6.
    ...(opts.hermetic === true ? { hermetic: true } : {}),
  });

  const session = new Session({
    proc,
    matrix,
    seed: opts.seed,
    ...(opts.timeout !== undefined ? { defaultTimeoutMs: opts.timeout } : {}),
    ...(opts.bypassInject === true ? { bypassInject: true } : {}),
    // Forward the same proxy (with auth, if any) to the net FFI so
    // out-of-band Session.fetch traffic shares the apparent egress.
    // `@mochi.js/net` (wreq) accepts the full `user:pass@host` URL form.
    ...(normalized !== undefined ? { netProxy: normalized.netProxy } : {}),
    ...(normalized?.auth !== undefined ? { proxyAuth: normalized.auth } : {}),
    ...(opts.challenges !== undefined ? { challenges: opts.challenges } : {}),
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

/**
 * Reconcile the two `LaunchOptions.proxy` shapes (URL string and
 * `ProxyConfig` record) into a single normalized record carrying:
 *   - `server`: auth-stripped URL safe to feed `--proxy-server=`.
 *   - `netProxy`: the URL handed to the network FFI. Preserves credentials
 *     (wreq accepts `user:pass@host` inline) so out-of-band fetches
 *     authenticate against the same proxy.
 *   - `auth`: parsed credentials for the CDP auth handler. Undefined when
 *     no creds were supplied.
 *
 * Returns `undefined` only when no proxy was configured at all.
 */
function normalizeProxy(p: LaunchOptions["proxy"]):
  | {
      server: string;
      netProxy: string;
      auth?: { username: string; password: string };
    }
  | undefined {
  if (p === undefined) return undefined;
  if (typeof p === "string") {
    if (p.length === 0) return undefined;
    const parsed = parseProxyUrl(p);
    return {
      server: parsed.server,
      netProxy: p,
      ...(parsed.auth !== undefined ? { auth: parsed.auth } : {}),
    };
  }
  // ProxyConfig form. `server` may itself include credentials; if so we
  // strip them. Explicit username/password fields take precedence.
  const parsed = parseProxyUrl(p.server);
  const auth =
    p.username !== undefined ? { username: p.username, password: p.password ?? "" } : parsed.auth;
  // Reconstruct the netProxy URL preserving any explicit auth (wreq path).
  const netProxy = auth !== undefined ? injectAuth(parsed.server, auth) : parsed.server;
  return {
    server: parsed.server,
    netProxy,
    ...(auth !== undefined ? { auth } : {}),
  };
}

/**
 * Inject `username:password@` into a server URL, percent-encoding both
 * components so reserved characters round-trip cleanly through wreq's URL
 * parser.
 */
function injectAuth(server: string, auth: { username: string; password: string }): string {
  const u = encodeURIComponent(auth.username);
  const p = encodeURIComponent(auth.password);
  // server is `<protocol>://<host>:<port>` (per parseProxyUrl).
  const idx = server.indexOf("://");
  if (idx < 0) return server;
  const head = server.slice(0, idx + 3);
  const tail = server.slice(idx + 3);
  return `${head}${u}:${p}@${tail}`;
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
