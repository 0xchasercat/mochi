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
import { getProfile, ProfileBaselineMissingError, UnknownProfileIdError } from "@mochi.js/profiles";
import { resolveBinary } from "./binary";
import { connect } from "./connect";
import { defaultProfileForHost, unsupportedHostMessage } from "./default-profile";
import { type GeoConsistencyMode, reconcileGeoConsistency } from "./geo-consistency";
import { probeExitGeo } from "./geo-probe";
import { type LinuxServerEnv, probeLinuxServerEnv } from "./linux-server";
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
  /**
   * Profile to derive the fingerprint matrix from. Either a `ProfileId`
   * string (looked up against `KNOWN_PROFILE_IDS`) or an inline `ProfileV1`
   * object.
   *
   * **Optional** — when omitted, mochi auto-picks the
   * profile whose declared OS matches the host's `process.platform` /
   * `process.arch` pair via {@link defaultProfileForHost}:
   *
   *   - `linux/x64`     → `linux-chrome-stable`
   *   - `darwin/arm64`  → `mac-m4-chrome-stable`
   *   - `darwin/x64`    → `mac-chrome-stable`
   *   - `win32/x64`     → `windows-chrome-stable`
   *
   * On any unsupported host (FreeBSD, Linux arm64 today, Windows arm64,
   * Alpine musl), launch throws with a precise diagnostic listing the six
   * explicit profile IDs the user can choose from. The default never
   * silently overrides an explicit choice.
   *
   * Strategic rationale: a Linux server defaulting to a Linux profile
   * removes the entire class of "user accidentally spoofed Windows from a
   * Linux DC and looked weird to the WAF" failures. Linux is a real-user
   * signal, not a bot signal — see `concepts/stealth-philosophy` for the
   * thesis + production evidence.
   */
  /**
   * Pass `null` to opt OUT of the spoof entirely — see "No-spoof mode" below.
   */
  profile?: ProfileId | ProfileV1 | null;
  /**
   * Required when `profile` is set to a string id, an inline `ProfileV1`, or
   * left undefined (auto-pick). Unused when `profile === null` (no-spoof
   * mode); a `console.warn` fires if `seed` is supplied alongside a `null`
   * profile to flag the apparent confusion without blocking the launch.
   */
  seed?: string;
  proxy?: string | ProxyConfig;
  /**
   * Legacy boolean knob — `true` runs Chromium under `--headless=new`,
   * `false` (default in v0.1) runs headful. New code should prefer
   * {@link headlessMode}, which is more expressive AND env-aware.
   *
   * Resolution priority:
   *
   *   1. `headlessMode` if set.
   *   2. Else `headless: true → "new"`, `headless: false → "off"`.
   *   3. Else env-aware default — Linux without DISPLAY / WAYLAND_DISPLAY
   *      auto-resolves to `"new"` (the common server case); everywhere else
   *      defaults to `"off"` (headful, requires a display).
   */
  headless?: boolean;
  /**
   * Headless dispatch mode. One of:
   *
   *   - `"new"`    — modern Chromium headless (`--headless=new`). Full
   *                  rendering, near-byte-identical to headful for
   *                  fingerprinting. The right default on a server.
   *   - `"legacy"` — legacy `--headless` (no `=new`). Separate, more-
   *                  detectable code path; only useful for parity with
   *                  older tooling. Documented but not recommended.
   *   - `"off"`    — run headful. Requires a real display server (DISPLAY
   *                  on X11, WAYLAND_DISPLAY on Wayland) or xvfb.
   *
   * When unset, mochi infers the default from the live env: Linux without
   * DISPLAY / WAYLAND_DISPLAY → `"new"`; otherwise `"off"`. The legacy
   * `headless: boolean` knob (when set) overrides the env default but is
   * itself overridden by an explicit `headlessMode`.
   *
   * Use `mochi.detectLinuxServerEnv()` to introspect what mochi inferred.
   *
   * @see docs/getting-started/linux-server.md
   */
  headlessMode?: "new" | "legacy" | "off";
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
   * Chromium);
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
   * with full inject pipeline active. PLAN.md §8.6 +
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
  /**
   * Reconcile `(matrix.timezone, matrix.locale)` against the proxy's
   * exit-IP geolocation. Closes the cross-layer leak where a US profile
   * over an EU proxy would have `Date.getTimezoneOffset()` reporting PT
   * while the IP geolocates to UTC+1 — the canonical bot signature.
   *
   * - `"privacy-fallback"` *(default)* — on mismatch (or probe failure),
   *   override the matrix to UTC + `en-US`. The session fingerprints as
   *   a privacy-conscious user (Tor / Brave / hardened-FF style), which
   *   is benign in most threat models.
   * - `"auto-correct"` — on mismatch, override the matrix's timezone
   *   with the IP's timezone and the locale with a primary-locale
   *   guess for the IP's country. Most "stealth" but trusts mochi's
   *   IP-derived defaults over the user's declared profile.
   * - `"strict"` — throw `GeoMismatchError` on mismatch. The user must
   *   change profile or change proxy. Probe failure (null) does NOT
   *   throw under strict — that's a network blip, not a mismatch.
   * - `"off"` — skip the probe entirely. Use in offline tests / when
   *   the probe service is rate-limited.
   *
   * The probe is a single GET through Chromium itself (Session.fetch via
   * CDP `Network.loadNetworkResource`), so the geo service sees the same
   * JA4 / headers as user traffic by definition. 4-attempt cap, 2s per
   * endpoint. Probe results are NOT cached across sessions — proxy IPs
   * rotate.
   *
   * @see PLAN.md §9 (relational consistency, IP/TZ/Locale axis)
   */
  geoConsistency?: GeoConsistencyMode;
}

/**
 * Launch a Session: spawn Chromium with `--remote-debugging-pipe`, attach the
 * CDP transport, and return a configured `Session`.
 */
export async function launch(opts: LaunchOptions): Promise<Session> {
  const binary = await resolveBinary(opts.binary);
  const normalized = normalizeProxy(opts.proxy);

  // Resolve the `MatrixV1` BEFORE spawning so matrix-derived values flow
  // into both the `--lang` flag and `--window-size` flag
  //. The matrix is otherwise read post-spawn for inject;
  // deriving early is cheap (~µs, pure function) and lets us close the
  // I-5 leaks between Chromium's native network/OS-window state and the
  // JS-layer spoof.
  //
  // Inline `ProfileV1` objects flow straight through; string profile ids
  // resolve to the captured `data/<id>/profile.json` baseline shipped by
  // `@mochi.js/profiles`. When the catalog declares an id but no captured
  // baseline ships yet (e.g. `mac-m2-chrome-stable`), we fall back to a
  // synthesized placeholder so the launch still succeeds. The matrix is
  // bit-stable per `(profile, seed)` excluding the `derivedAt` timestamp.
  //
  // Task 0272 — when `profile` is omitted, auto-pick the host-OS-matching
  // profile id. Throws with a precise diagnostic if the host is one of the
  // unsupported ones (FreeBSD, Linux arm64 today, Windows arm64, Alpine
  // musl). Explicit `profile:` always wins; the auto-pick never overrides.
  //
  // Explicit `profile: null` opts out of every override entirely — no
  // matrix is derived, no inject is built, no UA / locale / TZ /
  // viewport CDP calls fire. The user wants mochi's API surface only.
  const profileSource = await resolveProfileSource(opts.profile);
  if (profileSource.profile === null && opts.seed !== undefined && opts.seed.length > 0) {
    console.warn(
      "[mochi] launch: `seed` was supplied alongside `profile: null`. " +
        "Seeds are only consumed when a profile is set; ignoring.",
    );
  }
  if (profileSource.profile !== null && (opts.seed === undefined || opts.seed.length === 0)) {
    throw new Error(
      "[mochi] launch: `seed` is required when `profile` is set " +
        "(string id, inline ProfileV1, or auto-picked). Pass `profile: null` " +
        "if you want to skip the spoof entirely.",
    );
  }
  const matrix =
    profileSource.profile === null
      ? null
      : deriveMatrix(profileSource.profile, opts.seed as string);
  if (profileSource.autoPicked) {
    // One info-level log line so users can see what mochi inferred without
    // calling `defaultProfileForHost()` themselves. Wording is pinned by
    // — keep stable so docs + LLM-context blocks stay correct.
    // (Routed through `console.warn` to match the existing diagnostic
    // channel for `geoConsistency` / Linux-server inference; `console.info`
    // is gated by the workspace lint config — `noConsole` only allows
    // `error` and `warn` at the moment.)
    console.warn(
      `[mochi] no profile supplied; auto-picked ${profileSource.id} for host ` +
        `${process.platform}/${process.arch}. To override: pass ` +
        `profile: "${profileSource.id}" explicitly.`,
    );
  }

  // Task 0262 — exit-IP / TZ / locale reconciliation.
  //
  // Probe the apparent exit IP through the configured proxy. Post-0.7
  // the probe runs through Chromium itself (Session.fetch via CDP
  // `Network.loadNetworkResource`), so the geo service sees the same
  // JA4 / headers as user traffic by definition. Cross-reference against
  // `(matrix.timezone, matrix.locale)` and apply `geoConsistency`. The
  // adjusted matrix flows into BOTH `spawnChromium` (so `--lang` reflects
  // any override) AND `Session` (so inject + the CDP `Emulation.set
  // TimezoneOverride` send pick it up). PLAN.md §9.
  //
  // `"off"` short-circuits the probe — the probe call itself respects
  // the mode so we don't pay the network round-trip in offline tests.
  const geoMode: GeoConsistencyMode = opts.geoConsistency ?? "privacy-fallback";
  let adjustedMatrix = matrix;
  if (matrix !== null && geoMode !== "off") {
    const geo = await probeExitGeo({
      ...(normalized?.proxy !== undefined ? { proxy: normalized.proxy } : {}),
      matrix,
    });
    // Strict mode throws GeoMismatchError on real mismatch; let it
    // propagate up so callers can recover (the orchestrator surfaced
    // it as the canonical failure mode for "wrong proxy for profile").
    const result = reconcileGeoConsistency(matrix, geo, geoMode);
    adjustedMatrix = result.matrix;
    if (result.action === "privacy-fallback" || result.action === "auto-correct") {
      console.warn(
        `[mochi] geoConsistency=${geoMode}: ${result.action} applied — ${result.reason ?? "(no reason)"}`,
      );
    }
  }

  // Resolve headless dispatch BEFORE the spawn call so we can log the
  // env-derived default and let the user introspect via
  // `mochi.detectLinuxServerEnv()`. Task 0258 — the "Linux server, no
  // DISPLAY" case is the common deployment failure mode for `mochi.launch()`,
  // and the previous default (`opts.headless ?? false` → headful) crashed
  // immediately on a fresh Ubuntu / Debian host because there was no display
  // to attach to. We now infer `"new"` on that environment.
  const linuxEnv = probeLinuxServerEnv();
  const resolvedHeadlessMode = resolveHeadlessMode(opts, linuxEnv);
  if (
    resolvedHeadlessMode === "new" &&
    opts.headlessMode === undefined &&
    opts.headless === undefined
  ) {
    // Only chatter when the launcher had to infer (caller said nothing). An
    // explicit `headlessMode: "new"` from the caller is silent — they know
    // what they asked for. The container/root signals are surfaced too so
    // the diagnostic is one log line, not three.
    console.warn(
      `[mochi] Linux server detected (no DISPLAY / WAYLAND_DISPLAY) — defaulting to ` +
        `--headless=new. ${linuxEnv.rationale}. Set headlessMode: "off" to override; ` +
        `see docs/getting-started/linux-server.md for the xvfb path.`,
    );
  }

  const proc = await spawnChromium({
    binary,
    extraArgs: opts.args,
    headless: opts.headless ?? false,
    headlessMode: resolvedHeadlessMode,
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
    // automatically.
    //
    // Skipped under no-spoof mode (`profile: null`) — the user wants the
    // host's native locale on the wire.
    ...(adjustedMatrix !== null ? { locale: adjustedMatrix.locale } : {}),
    // Pin OS-level outer window from the matrix's display geometry so
    // `window.outerWidth/outerHeight` (which reads from the OS window,
    // NOT the JS-spoofed `screen.*`) matches the spoof. Closes the
    // `fingerprint-scan.com` 800×600 leak under `--headless=new`.
    // UDC fixes the same issue at `__init__.py:410-411`.
    //
    // (`adjustedMatrix.display` === `matrix.display` since geo reconcile
    // only touches timezone/locale/languages — but we use the adjusted
    // ref for forward-compat.)
    //
    // Skipped under no-spoof mode — the OS-level window geometry is
    // whatever Chromium picks by default.
    ...(adjustedMatrix !== null &&
    Number.isInteger(adjustedMatrix.display.width) &&
    Number.isInteger(adjustedMatrix.display.height) &&
    adjustedMatrix.display.width > 0 &&
    adjustedMatrix.display.height > 0
      ? {
          windowSize: {
            width: adjustedMatrix.display.width,
            height: adjustedMatrix.display.height,
          },
        }
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
    matrix: adjustedMatrix,
    seed: opts.seed ?? "",
    ...(opts.timeout !== undefined ? { defaultTimeoutMs: opts.timeout } : {}),
    ...(opts.bypassInject === true ? { bypassInject: true } : {}),
    // Proxy auth is the only piece that needs explicit Session-side
    // wiring (the `--proxy-server` flag is already on Chromium's command
    // line above). Out-of-band `Session.fetch` traffic rides Chromium's
    // network stack post-0.7, so it inherits the `--proxy-server` egress
    // automatically — no per-call proxy URL needed.
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
  /**
   * Attach to a CDP browser endpoint mochi did NOT spawn (BrowserBase,
   * dockerised Chromium, user-managed patched Chrome, re-attach). Mirrors
   * `puppeteer.connect`'s shape; supports `profile: null` for no-spoof
   * mode. `session.close()` disconnects the WebSocket but leaves the
   * browser running.
   */
  connect,
  /**
   * Inspect what mochi would infer about the current process environment for
   * Linux-server detection (drives `headlessMode` defaulting). Pure read of
   * `process.platform`, `process.env.DISPLAY`, `process.env.WAYLAND_DISPLAY`,
   * `process.getuid?.()`, and the container probe paths.
   */
  detectLinuxServerEnv: probeLinuxServerEnv,
  /**
   * Inspect which profile id `mochi.launch` would auto-pick on the current
   * host when `profile` is omitted. Pure read of `process.platform` /
   * `process.arch`. Returns `null` on unsupported hosts — the launcher
   * throws on that path with a list of explicit profile IDs.
   *
   * @see https://mochijs.com/docs/concepts/stealth-philosophy
   */
  defaultProfileForHost,
} as const;

export type Mochi = typeof mochi;

// ---- helpers ----------------------------------------------------------------

/**
 * Resolve the effective {@link LaunchOptions.headlessMode} given a snapshot
 * of `(opts, env)`. Pure / synchronous so tests can drive both axes without
 * stubbing globals. Resolution order — task 0258:
 *
 *   1. Explicit `opts.headlessMode` wins.
 *   2. Else legacy `opts.headless: true | false` maps to `"new"` / `"off"`.
 *   3. Else env-aware default — Linux without DISPLAY / WAYLAND_DISPLAY →
 *      `"new"`; otherwise `"off"`.
 *
 * Exported so the unit tests can lock the resolution table without spawning
 * a Chromium or stubbing `process.platform`.
 */
export function resolveHeadlessMode(
  opts: Pick<LaunchOptions, "headless" | "headlessMode">,
  env: LinuxServerEnv,
): "new" | "legacy" | "off" {
  if (opts.headlessMode !== undefined) return opts.headlessMode;
  if (opts.headless === true) return "new";
  if (opts.headless === false) return "off";
  return env.serverNoDisplay ? "new" : "off";
}

/**
 * Reconcile the two `LaunchOptions.proxy` shapes (URL string and
 * `ProxyConfig` record) into a single normalized record carrying:
 *   - `server`: auth-stripped URL safe to feed `--proxy-server=`.
 *   - `proxy`: the auth-stripped URL forwarded to the geo-probe so it
 *     can record the egress on diagnostics. (Kept for API parity even
 *     though the probe now rides Session.fetch + Chromium's network
 *     stack — i.e. picks up `--proxy-server` automatically.)
 *   - `auth`: parsed credentials for the CDP auth handler. Undefined when
 *     no creds were supplied.
 *
 * Returns `undefined` only when no proxy was configured at all.
 */
function normalizeProxy(p: LaunchOptions["proxy"]):
  | {
      server: string;
      proxy: string;
      auth?: { username: string; password: string };
    }
  | undefined {
  if (p === undefined) return undefined;
  if (typeof p === "string") {
    if (p.length === 0) return undefined;
    const parsed = parseProxyUrl(p);
    return {
      server: parsed.server,
      proxy: parsed.server,
      ...(parsed.auth !== undefined ? { auth: parsed.auth } : {}),
    };
  }
  // ProxyConfig form. `server` may itself include credentials; if so we
  // strip them. Explicit username/password fields take precedence.
  const parsed = parseProxyUrl(p.server);
  const auth =
    p.username !== undefined ? { username: p.username, password: p.password ?? "" } : parsed.auth;
  return {
    server: parsed.server,
    proxy: parsed.server,
    ...(auth !== undefined ? { auth } : {}),
  };
}

/**
 * Resolve `LaunchOptions.profile` into a concrete `ProfileV1` plus the
 * meta-flag the launcher needs to decide whether to log the auto-pick
 * INFO line. Three branches:
 *
 *   1. Explicit `ProfileV1` object — flows through unchanged. `autoPicked`
 *      false; `id` taken from the inline object.
 *   2. Explicit `ProfileId` string — load the captured baseline from
 *      `@mochi.js/profiles`. If the id is known to the catalog but no
 *      captured baseline ships, fall back to a placeholder synthesis so
 *      the launch still succeeds (and the consistency engine still locks
 *      a relationally-consistent Matrix from the skeleton). Unknown ids
 *      propagate as a hard error. `autoPicked` false.
 *   3. `undefined` — task 0272: call `defaultProfileForHost()`. Throw with
 *      the unsupported-host diagnostic when the resolver returns `null`.
 *      `autoPicked` true; same captured-vs-placeholder fallback as branch
 *      2.
 *
 * Async because `getProfile` reads `data/<id>/profile.json` from disk via
 * `Bun.file().json()`. The launcher does not log here — the INFO line for
 * `autoPicked === true` is emitted at the call-site so test fixtures can
 * assert the resolution without intercepting `console`.
 */
export async function resolveProfileSource(
  profile: ProfileId | ProfileV1 | null | undefined,
): Promise<{
  profile: ProfileV1 | null;
  id: ProfileId | null;
  autoPicked: boolean;
}> {
  // Explicit `null` — no-spoof mode. The launcher / connect path will
  // skip every CDP override that depends on a derived matrix.
  if (profile === null) {
    return { profile: null, id: null, autoPicked: false };
  }
  if (typeof profile === "object") {
    return { profile, id: profile.id, autoPicked: false };
  }
  if (typeof profile === "string") {
    return {
      profile: await loadProfileWithFallback(profile),
      id: profile,
      autoPicked: false,
    };
  }
  // Auto-pick branch —
  const picked = defaultProfileForHost();
  if (picked === null) {
    throw new Error(unsupportedHostMessage(process.platform, process.arch));
  }
  return {
    profile: await loadProfileWithFallback(picked),
    id: picked,
    autoPicked: true,
  };
}

/**
 * Load a `ProfileV1` for `id` from `@mochi.js/profiles` if a captured
 * baseline ships, otherwise synthesize a placeholder. Unknown ids also fall
 * back to the placeholder (with a console.warn) — preserving the
 * pre-getProfile() contract that any string id produces a working session.
 * E2E test fixtures rely on synthetic ids like "test-humanize".
 *
 * Critical correctness path: the captured baselines pin tip-of-stable Chrome
 * majors (147+ as of 2026-05). The pre-fix code path called
 * `synthesizePlaceholderProfile` for every string id, which hardcoded
 * Chrome 131 and produced a UA mismatch with the actual Chromium-for-Testing
 * binary.
 */
async function loadProfileWithFallback(id: ProfileId): Promise<ProfileV1> {
  try {
    // `ProfileId` here is the loose `string` alias the launcher accepts
    // (see comment near the type definition). `getProfile` narrows it
    // back to the catalog union at runtime and throws
    // `UnknownProfileIdError` for ids outside the catalog.
    return await getProfile(id as Parameters<typeof getProfile>[0]);
  } catch (err) {
    if (err instanceof ProfileBaselineMissingError) {
      // Known catalog entry, no baseline shipped yet — fall back to the
      // synthesized placeholder so the launch still succeeds.
      return synthesizePlaceholderProfile(id);
    }
    if (err instanceof UnknownProfileIdError) {
      // Caller passed an id that isn't in `KNOWN_PROFILE_IDS`. Surface a
      // warning so typos are visible, but fall back to the placeholder so
      // synthetic test-fixture ids (e.g. "test-humanize") keep working.
      // biome-ignore lint/suspicious/noConsole: dev-facing diagnostic
      console.warn(
        `[mochi] profile id "${id}" is not in @mochi.js/profiles.KNOWN_PROFILE_IDS; ` +
          "falling back to a synthesized placeholder. Pass a ProfileV1 object directly " +
          "or use one of the catalog ids to silence this warning.",
      );
      return synthesizePlaceholderProfile(id);
    }
    throw err;
  }
}

/**
 * Pattern-match a profile id to the OS axis it implies. Used by
 * {@link synthesizePlaceholderProfile} so a `mac-*` / `win11-*` id
 * doesn't synthesize a Linux profile, which produced the "Linux profile
 * forced on macOS / Windows" bug for the 5 catalog ids that lack a
 * captured baseline (`mac-m2-`, `mac-m1-`, `mac-intel-`, `win11-`,
 * `win11-edge-`).
 *
 * The mapping is conservative — anything that doesn't match a known
 * prefix falls back to Linux to preserve the long-standing default.
 *
 * Exported as `@internal` for unit tests; not part of the public surface.
 *
 * @internal
 */
export function inferPlaceholderOsFromId(id: string): "macos" | "windows" | "linux" {
  if (id.startsWith("mac-") || id.startsWith("macos-")) return "macos";
  if (id.startsWith("win11-") || id.startsWith("windows-") || id.startsWith("win10-"))
    return "windows";
  return "linux";
}

/**
 * Synthesize a generic placeholder `ProfileV1` from a profile id, used as
 * a fallback when the catalog declares an id but no captured baseline
 * ships in `@mochi.js/profiles` yet. The consistency engine still produces
 * a real, relationally-locked Matrix from this skeleton — the id is what
 * flows into `sha256(profile.id + seed)`.
 *
 * The OS axis derives from the id (see {@link inferPlaceholderOsFromId})
 * so a `mac-*` or `win11-*` id never lands a Linux profile. Pre-fix: the
 * placeholder was unconditionally Linux, which silently broke the 5
 * catalog ids that lack captured baselines (`mac-m2-`, `mac-m1-`,
 * `mac-intel-`, `win11-`, `win11-edge-`). Users on macOS or Windows
 * passing one of those ids saw a Linux UA against their host's actual
 * Chromium-for-Testing binary — the canonical R-004 mismatch.
 *
 * The major version pinned here MUST track the live Chromium-for-Testing
 * pin (`packages/cli/src/browsers/manifest.ts:PINNED_FALLBACK_VERSION`)
 * and the tip entry in
 * `packages/consistency/src/rules/lookups/browser.ts:BROWSER_TIP_FULL_VERSION`.
 * A drift between these surfaces ships a UA whose major doesn't match the
 * installed binary — the canonical fingerprint-mismatch bug R-004 was
 * meant to prevent. Bump all three together.
 */
function synthesizePlaceholderProfile(profile: ProfileId): ProfileV1 {
  const os = inferPlaceholderOsFromId(profile);

  // Per-OS skeletons — every field that varies by OS axis is bound here so
  // the matrix the consistency engine produces stays self-coherent.
  // (Display / audio / locale / behavior stay platform-neutral; the
  // consistency DAG handles per-rule cross-references downstream.)
  if (os === "macos") {
    // arm64 is the modern default — Apple Silicon has been shipping since
    // 2020 and the catalog's tip captures (mac-m4, mac-chrome-stable) are
    // arm64. Intel Mac users should pass an inline ProfileV1 if they want
    // strict x64 placement.
    return {
      id: profile,
      version: "0.0.0-placeholder",
      engine: "chromium",
      browser: { name: "chrome", channel: "stable", minVersion: "147", maxVersion: "147" },
      os: { name: "macos", version: "14", arch: "arm64" },
      device: {
        vendor: "Apple",
        model: "Mac15,3",
        cpuFamily: "apple-silicon-m3",
        cores: 8,
        memoryGB: 16,
      },
      display: { width: 1728, height: 1117, dpr: 2, colorDepth: 30, pixelDepth: 30 },
      gpu: {
        vendor: "Apple Inc.",
        renderer: "Apple M3",
        webglUnmaskedVendor: "Google Inc. (Apple)",
        webglUnmaskedRenderer: "ANGLE (Apple, ANGLE Metal Renderer: Apple M3, Unspecified Version)",
        webglMaxTextureSize: 16384,
        webglMaxColorAttachments: 8,
        webglExtensions: [],
      },
      audio: {
        contextSampleRate: 48000,
        audioWorkletLatency: 0.005,
        destinationMaxChannelCount: 2,
      },
      fonts: { family: "macos-baseline", list: ["Helvetica"] },
      timezone: "America/Los_Angeles",
      locale: "en-US",
      languages: ["en-US", "en"],
      behavior: { hand: "right", tremor: 0.18, wpm: 60, scrollStyle: "smooth" },
      wreqPreset: "chrome_147_macos",
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36",
      uaCh: {},
      entropyBudget: { fixed: [], perSeed: [] },
    };
  }

  if (os === "windows") {
    return {
      id: profile,
      version: "0.0.0-placeholder",
      engine: "chromium",
      browser: { name: "chrome", channel: "stable", minVersion: "147", maxVersion: "147" },
      os: { name: "windows", version: "11", arch: "x64" },
      device: {
        vendor: "generic",
        model: "generic-x64",
        cpuFamily: "intel-core-i7",
        cores: 8,
        memoryGB: 16,
      },
      display: { width: 1920, height: 1080, dpr: 1, colorDepth: 24, pixelDepth: 24 },
      gpu: {
        vendor: "Google Inc. (Intel)",
        renderer:
          "ANGLE (Intel, Intel(R) UHD Graphics 770 (0x00004680) Direct3D11 vs_5_0 ps_5_0, D3D11)",
        webglUnmaskedVendor: "Google Inc. (Intel)",
        webglUnmaskedRenderer:
          "ANGLE (Intel, Intel(R) UHD Graphics 770 (0x00004680) Direct3D11 vs_5_0 ps_5_0, D3D11)",
        webglMaxTextureSize: 16384,
        webglMaxColorAttachments: 8,
        webglExtensions: [],
      },
      audio: {
        contextSampleRate: 48000,
        audioWorkletLatency: 0.005,
        destinationMaxChannelCount: 2,
      },
      fonts: { family: "windows-baseline", list: ["Segoe UI"] },
      timezone: "America/New_York",
      locale: "en-US",
      languages: ["en-US", "en"],
      behavior: { hand: "right", tremor: 0.18, wpm: 60, scrollStyle: "smooth" },
      wreqPreset: "chrome_147_windows",
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36",
      uaCh: {},
      entropyBudget: { fixed: [], perSeed: [] },
    };
  }

  // Linux fallback (also catches anything that didn't match macos/windows).
  return {
    id: profile,
    version: "0.0.0-placeholder",
    engine: "chromium",
    browser: { name: "chrome", channel: "stable", minVersion: "147", maxVersion: "147" },
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
    // `wreqPreset` is required by the ProfileV1 schema for one release of
    // back-compat (see `schemas/profile.schema.json`). The runtime no
    // longer reads it — `Session.fetch` rides Chromium's network stack via
    // CDP, so JA4 is real Chrome by definition. Drops in a future major.
    wreqPreset: "chrome_147_linux",
    userAgent:
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36",
    uaCh: {},
    entropyBudget: { fixed: [], perSeed: [] },
  };
}
