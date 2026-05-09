/**
 * `Session` — the per-(profile, seed) browser lifecycle.
 *
 * Owns one Chromium process, one CDP transport+router, and one or more
 * `Page` objects. Closing the session kills the browser and removes the
 * ephemeral user-data-dir. PLAN.md §5.1 / §7.
 *
 * v0.2 exposes a real, relationally-locked `MatrixV1` derived by
 * `@mochi.js/consistency.deriveMatrix(profile, seed)`. The Matrix is
 * deterministic per `(profile, seed)` (excluding `derivedAt`).
 *
 * @see PLAN.md §7
 */

import {
  type Disposable as ChallengeHandle,
  installTurnstileAutoClick,
  type TurnstileEscalationReason,
} from "@mochi.js/challenges";
import type { MatrixV1 } from "@mochi.js/consistency";
import { buildPayload, type PayloadResult } from "@mochi.js/inject";
import {
  type InitInjectorHandle,
  installInitInjector,
  wrapSelfRemovingPayload,
} from "./cdp/init-injector";
import { MessageRouter } from "./cdp/router";
import type { AttachedToTargetEvent } from "./cdp/types";
import { Page } from "./page";
import type { ChromiumProcess } from "./proc";
import { VERSION } from "./version";

/**
 * Per-call timeout for the worker idOnly inject roundtrip. 5s, not the
 * router's 30s default — workers spawned by sites like sannysoft,
 * bot.incolumitas, fingerprintjs probes routinely die between
 * `Target.attachedToTarget` and our reply. Without a tight cap, every
 * orphan worker stalls the route loop for the full 30s. Real workers
 * resolve in single-digit ms; 5s is generous.
 *
 * If you ever see a legitimate worker fail at 5s, raise this — but the
 * symptom would be a missing inject on a long-running worker, which is
 * separate from the orphan-worker race we're sizing for.
 */
const WORKER_INJECT_TIMEOUT_MS = 5_000;

/**
 * Predicate: is this an "expected" failure from the worker idOnly inject
 * race (worker died between attach and our roundtrip)? Recognized:
 *   - `CdpTimeoutError` — router gave up after WORKER_INJECT_TIMEOUT_MS
 *     because the target stopped responding. Most common path.
 *   - CDP `Session with given id not found` — target detached mid-call.
 *   - CDP `Target closed` — same race, different message variant.
 *
 * All three are routine and silent. A genuine bug (bad contextId,
 * wrong serialization, schema drift) surfaces as anything else and
 * still warns through the console.
 */
function isTransientWorkerError(err: unknown): boolean {
  if (err === null || typeof err !== "object") return false;
  const name = (err as { name?: string }).name;
  if (name === "CdpTimeoutError") return true;
  const msg = (err as { message?: string }).message ?? "";
  return msg.includes("Session with given id not found") || msg.includes("Target closed");
}

export interface SessionInit {
  proc: ChromiumProcess;
  matrix: MatrixV1;
  seed: string;
  /** Optional overrides for the underlying message-router timeout. */
  defaultTimeoutMs?: number;
  /**
   * When true, skip {@link buildPayload} AND skip the init-injector install
   * (no `Fetch.fulfillRequest` body splice on documents); worker targets
   * receive no inject either. Intended for `mochi capture` and similar
   * baseline-collection flows. PLAN.md §12.1,
   */
  bypassInject?: boolean;
  /**
   * Optional proxy credentials. When set, the Session attaches a CDP
   * `Fetch.authRequired` listener so HTTP / SOCKS5 proxy auth challenges
   * are answered transparently. Undefined when no proxy is configured or
   * the proxy doesn't require auth — in that case `Fetch.enable` is never
   * sent and the protocol surface stays untouched.
   *
   * @see proxy-auth.ts for the §8.2 invariant rationale.
   */
  proxyAuth?: { username: string; password: string };
  /**
   * Convenience layer toggles surfaced via
   * `LaunchOptions.challenges`. When `challenges.turnstile.autoClick` is
   * `true`, every page returned by `Session.newPage` has
   * `installTurnstileAutoClick(page, opts)` wired automatically.
   * See `@mochi.js/challenges`.
   */
  challenges?: {
    turnstile?: {
      autoClick?: boolean;
      timeout?: number;
      humanize?: boolean;
      onSolved?: (token: string) => void;
      onEscalation?: (reason: TurnstileEscalationReason) => void;
      pollIntervalMs?: number;
    };
  };
}

/** Public Cookie shape (re-exported from page.ts). */
export type { Cookie } from "./page";

/** Storage snapshot — placeholder shape; full surface lands later. */
export interface StorageSnapshot {
  cookies: import("./page").Cookie[];
  /** localStorage entries, keyed by origin. v0.1: empty placeholder. */
  localStorage: Record<string, Record<string, string>>;
  /** sessionStorage entries, keyed by origin. v0.1: empty placeholder. */
  sessionStorage: Record<string, Record<string, string>>;
}

// ---- cookie-jar persistence -------------------------------------

/**
 * Current on-disk cookie-file format version. Bumped on incompatible header
 * changes. The reader refuses unknown majors with a precise diagnostic so a
 * stale jar doesn't silently load with the wrong shape.
 */
export const COOKIE_JAR_FORMAT_VERSION = 1 as const;

/**
 * On-disk shape for {@link Session.cookies.save}. The `cookies` array is the
 * verbatim `Storage.getCookies` payload — every shipped Chromium revision
 * agrees on this shape, so loading on a newer Chromium round-trips losslessly.
 *
 * @see https://chromedevtools.github.io/devtools-protocol/tot/Storage/#method-getCookies
 */
export interface CookieJarFile {
  /** Format version (currently `1`). */
  version: typeof COOKIE_JAR_FORMAT_VERSION;
  /** ISO-8601 UTC timestamp of `save()` (ends in `Z`). */
  savedAt: string;
  /** Mochi core version that produced the file. */
  mochiVersion: string;
  /** The regex source that filtered the saved set (default `".*"`). */
  pattern: string;
  /** Number of cookies in the `cookies` array — redundant with `cookies.length`, kept for trace logs. */
  count: number;
  /** Raw `Storage.getCookies` cookies, optionally filtered by `pattern`. */
  cookies: import("./page").Cookie[];
}

/** Options shared by `cookies.save` / `cookies.load`. */
export interface CookieJarOptions {
  /**
   * Optional regex matched against each cookie's `domain`. Default `.*`
   * (everything). Cookies failing the match are skipped on save AND on load
   * (so a saved-with-everything jar can be partially restored).
   */
  pattern?: RegExp;
}

/**
 * `Session.cookies` namespace — exposes the read/write/persist surface for the
 * session's cookie jar. The legacy `Session.cookies(filter)` and
 * `Session.setCookies(...)` shapes are gone; callers go through this object.
 *
 * The whole namespace is bound to a Session instance via the `Session.cookies`
 * getter — every method routes through `Storage.getCookies` /
 * `Storage.setCookies` on the root browser target (the only domain that
 * exposes a global cookie reader without a per-page Network domain).
 */
export interface CookieJar {
  /**
   * All cookies the browser is aware of, optionally filtered by url. The url
   * filter is a coarse hostname match (no path / secure / sameSite handling) —
   * sufficient for "scope down to a session" use cases.
   */
  get(filter?: { url?: string }): Promise<import("./page").Cookie[]>;
  /** Set cookies via the root-target Storage domain. */
  set(cookies: import("./page").Cookie[]): Promise<void>;
  /**
   * Persist cookies to a JSON file at `path`. Cookies whose `domain` does NOT
   * match `opts.pattern` (default: every domain) are skipped. The file format
   * is {@link CookieJarFile}.
   */
  save(path: string, opts?: CookieJarOptions): Promise<void>;
  /**
   * Read a JSON file written by {@link save} and replay every cookie back into
   * the browser via `Storage.setCookies`. Cookies whose `domain` does NOT
   * match `opts.pattern` (default: everything) are skipped — useful when one
   * jar holds multi-domain state but only a slice should be re-installed for
   * the current run.
   *
   * Throws on missing/corrupt files or version mismatch with a diagnostic that
   * pins the exact failure point.
   */
  load(path: string, opts?: CookieJarOptions): Promise<void>;
}

export class Session {
  /**
   * The resolved Matrix for this session — a relationally-locked snapshot
   * of `(profile, seed)` produced by `@mochi.js/consistency.deriveMatrix`.
   */
  readonly profile: MatrixV1;
  readonly seed: string;

  private readonly proc: ChromiumProcess;
  private readonly router: MessageRouter;
  private readonly _pages: Page[] = [];
  private closed = false;
  /**
   * Lazily-created scratch frame used by {@link fetch} to satisfy the
   * `frameId` requirement of `Network.loadNetworkResource` AND to host the
   * `page.evaluate("fetch(...)")` path for non-GET calls. The frame
   * navigates `about:blank` once and is reused across every `Session.fetch`
   * call. Closed on {@link close}.
   *
   * @internal
   */
  private scratchFrame: { targetId: string; sessionId: string; frameId: string } | undefined;
  /**
   * Mutex for {@link ensureScratchFrame} — without it, two concurrent
   * `Session.fetch` calls race on `Target.createTarget` and produce two
   * scratch frames (only one tracked). The promise resolves once the first
   * caller has finished setup; subsequent callers reuse the cached frame.
   *
   * @internal
   */
  private scratchFramePromise:
    | Promise<{
        targetId: string;
        sessionId: string;
        frameId: string;
      }>
    | undefined;
  /**
   * The compiled inject payload for this session. Built once at construction
   * from the resolved {@link MatrixV1}; reused across every new page and
   * every auto-attached worker target. PLAN.md §5.3 / §8.4.
   *
   * `null` when {@link SessionInit.bypassInject} is `true` (PLAN.md §12.1):
   * the capture flow needs the bare browser fingerprint, so we skip both
   * the build and the per-page install.
   *
   * @internal — exposed via {@link _internalPayload} for tests/diagnostics.
   */
  private readonly _payload: PayloadResult | null;
  /**
   * Whether this session bypasses the inject pipeline (no `buildPayload`,
   * no body splice via `Fetch.fulfillRequest`, no worker injection). Set
   * from {@link SessionInit.bypassInject}. PLAN.md §12.1,
   *
   * @internal
   */
  private readonly bypassInject: boolean;
  /**
   * Live handle for the unified `Fetch` domain owner — installs once on
   * construction and tears down on `Session.close`. Owns BOTH the
   * Document-body splice (init-script delivery, task 0266) AND the
   * `Fetch.authRequired` listener for proxy creds. Undefined when neither
   * inject nor proxy auth is in play (capture-with-no-proxy short-circuit).
   *
   * @see PLAN.md §8.4, tasks/0266-fetch-fulfill-init-script.md
   */
  private initInjectorHandle: InitInjectorHandle | undefined;
  /**
   * Snapshot of the `challenges` launch option, retained so
   * {@link newPage} can install the per-page auto-click handler. Undefined
   * when no challenge convenience layer is enabled. Each page gets its
   * own {@link ChallengeHandle} tracked here for disposal on
   * {@link close}.
   */
  private readonly challengesOpts: SessionInit["challenges"] | undefined;
  private readonly challengeHandles: ChallengeHandle[] = [];
  /**
   * Cache of resolved execution-context ids for worker-style targets,
   * keyed by the worker session id. Populated by
   * {@link extractWorkerExecutionContextId} on first attach and reused by
   * any later worker CDP op that needs an `executionContextId`. Patchright
   * keeps this on a per-target `CRExecutionContext`; mochi keeps the
   * Session-local map until we grow a real worker-target abstraction.
   *
   * @see crServiceWorkerPatch.ts:32-43, crPagePatch.ts:404-417
   * @internal
   */
  private readonly workerExecutionContextIds = new Map<string, number>();
  /**
   * The `CookieJar` instance returned by the {@link cookies} getter. Created
   * once at construction and bound to this Session — every call routes
   * through `Storage.getCookies` / `Storage.setCookies` on the root browser
   * target. See {@link CookieJar} for the surface contract.
   */
  private readonly cookieJar: CookieJar;

  constructor(init: SessionInit) {
    this.proc = init.proc;
    this.profile = init.matrix;
    this.seed = init.seed;
    this.bypassInject = init.bypassInject === true;
    this.challengesOpts = init.challenges;
    // Skip payload compilation entirely when bypassed — capture flows must
    // not pay the build cost AND must not see the matrix-derived bytes.
    this._payload = this.bypassInject ? null : buildPayload(init.matrix);
    this.router = new MessageRouter(this.proc.reader, this.proc.writer, {
      defaultTimeoutMs: init.defaultTimeoutMs,
    });
    this.router.start();
    this.cookieJar = createCookieJar(this);
    this.installAutoAttach();
    this.installCrashGuard();
    // Task 0266: unified Fetch.enable owner — handles both Document-body
    // splice (init-script delivery via Fetch.fulfillRequest, replacing
    // Page.addScriptToEvaluateOnNewDocument) AND the proxy-auth handler
    // when credentials are supplied. Single Fetch.enable per session.
    //
    // The injector skips Fetch.enable entirely when both are inactive
    // (capture flow with no proxy) so we keep the §8.2-clean
    // "no extra protocol surface" property of the v0.1 baseline for that
    // narrow case.
    const payloadCode = this._payload?.code ?? null;
    const auth = init.proxyAuth;
    if (payloadCode !== null || auth !== undefined) {
      // Fire-and-forget: surface failures via console.warn but don't reject
      // the constructor. The init-script path means a failure to install
      // breaks inject delivery (the page still loads with the bare
      // browser fingerprint), so we log loudly to keep the failure
      // visible.
      void installInitInjector(this.router, {
        payloadCode,
        ...(auth !== undefined ? { auth } : {}),
      })
        .then((handle) => {
          if (this.closed) {
            void handle.dispose();
            return;
          }
          this.initInjectorHandle = handle;
        })
        .catch((err: unknown) => {
          if (!this.closed) {
            console.warn("[mochi] init-injector installation failed:", err);
          }
        });
    }
  }

  /**
   * Open a new page. Internally:
   *   1. `Target.createTarget` opens a new browser tab.
   *   2. `Target.attachToTarget({ flatten: true })` returns a flat-mode session
   *      id we'll use to address page-level CDP methods.
   *   3. The inject payload is delivered NOT via
   *      `Page.addScriptToEvaluateOnNewDocument` but via the always-on
   *      `Fetch` domain handler installed once at session-construction time
   *      (`installInitInjector`). When this page navigates, the document
   *      response is intercepted, its CSP rewritten, and the payload
   *      spliced as an inline `<script>` at end-of-`<head>` before the
   *      first non-comment `<script>`. See PLAN.md §8.4 / task 0266 for
   *      the rationale (closes the source-attribution leak that
   *      `addScriptToEvaluateOnNewDocument` otherwise carries).
   *
   * `flatten: true` is critical — without it, page CDP messages would need to
   * be wrapped in `Target.sendMessageToTarget` envelopes. Flat mode lets us
   * just attach `sessionId` to the request.
   */
  async newPage(): Promise<Page> {
    this.assertOpen();
    const created = await this.router.send<{ targetId: string }>("Target.createTarget", {
      url: "about:blank",
    });
    const attached = await this.router.send<{ sessionId: string }>("Target.attachToTarget", {
      targetId: created.targetId,
      flatten: true,
    });
    // Page.enable is required for lifecycle events but does NOT trip §8.2
    // (only Runtime.enable is forbidden). We enable here so subsequent
    // addScriptToEvaluateOnNewDocument is honoured by the page domain.
    await this.router.send("Page.enable", undefined, { sessionId: attached.sessionId });
    // Task 0262: timezone spoof via CDP `Emulation.setTimezoneOverride`.
    //
    // Drives BOTH `Intl.DateTimeFormat().resolvedOptions().timeZone` AND
    // `Date.getTimezoneOffset()` because Chromium's V8 reads from the same
    // internal timezone source. We do NOT manually rewrite
    // `Date.prototype.getTimezoneOffset` in inject — that's detectable via
    // prototype-shape checks. The CDP override is the canonical
    // mechanism.
    //
    // Per the CDP docs (`tot/Emulation/#method-setTimezoneOverride`),
    // this method does NOT require `Emulation.enable` (it stores override
    // state directly on the target's `EmulationAgent`). §8.2's bans are
    // unaffected. Sent per-target before any navigation so the very first
    // document JS already sees the spoofed zone.
    //
    // The empty-string sentinel in the protocol means "clear override";
    // we never send empty here because that would defeat the purpose.
    //
    // Skipped under `bypassInject:true` (PLAN.md §12.1) — capture flows
    // record the bare browser timezone.
    if (!this.bypassInject) {
      await this.router.send(
        "Emulation.setTimezoneOverride",
        { timezoneId: this.profile.timezone },
        { sessionId: attached.sessionId },
      );
    }
    // Task 0255: defensive UA override at the network layer.
    //
    // The inject payload (Page.addScriptToEvaluateOnNewDocument) spoofs
    // `navigator.userAgent` and `navigator.userAgentData` in the JS
    // surface, but `Network.requestWillBeSent` events (and the request
    // line itself) carry the BARE browser UA — which under `--headless=new`
    // still contains the substring "HeadlessChrome" — AND the bare
    // `Sec-CH-UA*` request-header set. The inject can never reach those
    // bytes because they're emitted before any document script runs.
    //
    // 0255 plumbed `userAgent`. 0261 closes the cross-layer leak that left
    // open: without `userAgentMetadata`, the request `Sec-CH-UA*` headers
    // carry CfT defaults instead of the matrix, so a fingerprinter doing
    // `getHighEntropyValues()` and comparing against the request headers
    // sees a mismatch (direct PLAN.md I-5 violation). The metadata struct
    // is the CDP-canonical UA-CH descriptor; Chromium derives every
    // `Sec-CH-UA*` header from it. Both surfaces (this network call and
    // the inject's `client-hints.ts` getHighEntropyValues) read the SAME
    // matrix fields, so they cannot drift.
    //
    // `Network.setUserAgentOverride` is a per-target setter that does NOT
    // require `Network.enable` (it only stores override state); §8.2's ban
    // on `Network.enable` is therefore unaffected, with or without the
    // metadata payload. Sent immediately after attach and before any
    // navigation so the very first request the page issues already carries
    // the matrix UA + UA-CH headers.
    //
    // Skipped under `bypassInject:true` (PLAN.md §12.1) — capture flows must
    // record the bare browser fingerprint, including its raw UA AND raw
    // `Sec-CH-UA*` headers.
    if (!this.bypassInject) {
      await this.router.send(
        "Network.setUserAgentOverride",
        {
          userAgent: this.profile.userAgent,
          userAgentMetadata: buildUserAgentMetadata(this.profile),
        },
        { sessionId: attached.sessionId },
      );
    }
    // Task 0266: the inject payload is delivered via a TWO-MECHANISM strategy:
    //
    //   1. Session-level `installInitInjector` (constructor) — listens on
    //      `Fetch.requestPaused`, splices the wrapped payload into every
    //      HTTP/HTTPS Document response. This is the load-bearing path for
    //      real navigations: closes the `addScriptToEvaluateOnNewDocument`
    //      source-attribution leak.
    //
    //   2. Per-page `Page.addScriptToEvaluateOnNewDocument` (this block) —
    //      registers the SAME wrapped payload as a fallback for URL schemes
    //      that the Fetch domain does NOT intercept: `about:blank`,
    //      `data:`, `blob:`. Without this, an `await page.goto("about:blank")`
    //      followed by an inject-dependent assertion (e.g. `navigator.
    //      webdriver` patched via R-022) would fail because the inject
    //      never fired.
    //
    // The wrapper sets `__mochi_inject_marker = true` on globalThis and
    // checks for it at entry, so when both paths fire on the same realm
    // (a normal HTTP nav has Fetch splice + new-document fire), the second
    // invocation early-returns before any side effect. PLAN.md §8.4
    // documents this dual-mechanism design and the trade-off it accepts:
    // the source-attribution leak is closed for every URL scheme that
    // matters (HTTP/HTTPS — i.e. every fingerprinter-relevant page) but
    // remains for transitional URLs (about:blank/data:/blob:) where no
    // fingerprinter typically reads.
    let injectScriptIdentifier: string | undefined;
    if (!this.bypassInject && this._payload !== null) {
      const wrapped = wrapSelfRemovingPayload(this._payload.code);
      const installed = await this.router.send<{ identifier: string }>(
        "Page.addScriptToEvaluateOnNewDocument",
        {
          source: wrapped,
          // Run before the first script in the document — same timing the
          // Fetch.fulfillRequest splice achieves on HTTP nav.
          runImmediately: true,
          // Empty `worldName` MUST be the literal empty string — naming any
          // world creates a fingerprintable isolated world (PLAN.md §8.4).
          worldName: "",
        },
        { sessionId: attached.sessionId },
      );
      injectScriptIdentifier = installed.identifier;
    }
    const page = new Page({
      router: this.router,
      targetId: created.targetId,
      sessionId: attached.sessionId,
      initialUrl: "about:blank",
      ...(injectScriptIdentifier !== undefined ? { injectScriptIdentifier } : {}),
      // PLAN.md I-5: behavior comes from MatrixV1.behavior (the matrix is
      // the single source of truth — `Session.profile` is the resolved
      // MatrixV1). Per-call opts may override individual fields.
      behavior: this.profile.behavior,
      seed: this.seed,
      // Initial cursor at the display center — a real human's pointer is
      // never at (0, 0). The matrix's display dimensions are the canonical
      // source (PLAN.md I-5).
      initialCursor: {
        x: Math.floor(this.profile.display.width / 2),
        y: Math.floor(this.profile.display.height / 2),
      },
    });
    this._pages.push(page);
    // Wire the Turnstile auto-click convenience layer if the session was
    // launched with `challenges.turnstile.autoClick: true`. The handle is
    // tracked on the Session so it disposes on close (and the page-close
    // path also cleans up via the disposable's idempotent dispose).
    const ts = this.challengesOpts?.turnstile;
    if (ts !== undefined && ts.autoClick === true) {
      const tsOpts: Parameters<typeof installTurnstileAutoClick>[1] = {};
      if (ts.timeout !== undefined) tsOpts.timeout = ts.timeout;
      if (ts.humanize !== undefined) tsOpts.humanize = ts.humanize;
      if (ts.onSolved !== undefined) tsOpts.onSolved = ts.onSolved;
      if (ts.onEscalation !== undefined) tsOpts.onEscalation = ts.onEscalation;
      if (ts.pollIntervalMs !== undefined) tsOpts.pollIntervalMs = ts.pollIntervalMs;
      const handle = installTurnstileAutoClick(page, tsOpts);
      this.challengeHandles.push(handle);
    }
    return page;
  }

  /** Snapshot of currently open pages. */
  pages(): Page[] {
    return [...this._pages];
  }

  /**
   * Cookie-jar surface: `get`, `set`, `save`, `load`. See {@link CookieJar}.
   *
   * All four methods route through `Storage.getCookies` /
   * `Storage.setCookies` on the *root* browser target — the only domain that
   * exposes a global cookie reader/writer without a per-page Network domain.
   *
   * The persistence layer (`save`/`load`) is JSON, NOT pickle (per audit:
   * `docs/audits/nodriver.md` LOW finding 2 — Bun-native code uses JSON).
   * Format pinned by {@link CookieJarFile}; a small header (`version`,
   * `savedAt`, `mochiVersion`, `pattern`, `count`) lets a future incompatible
   * change be detected before any cookie touches the browser.
   */
  get cookies(): CookieJar {
    return this.cookieJar;
  }

  /** Storage snapshot. v0.1: cookies only. localStorage/sessionStorage are empty placeholders pending phase 0.7. */
  async storage(): Promise<StorageSnapshot> {
    this.assertOpen();
    const c = await this.cookieJar.get();
    return { cookies: c, localStorage: {}, sessionStorage: {} };
  }

  /**
   * Out-of-band fetch — routes through Chromium itself so JA4/JA3/H2 are
   * real Chrome by definition. Returns a standard Web `Response`.
   *
   * ### Dual-mechanism routing
   *
   * The implementation picks one of two CDP paths based on the call shape.
   * Both paths run inside the browser, so both inherit the session's
   * cookie jar, proxy (`--proxy-server`), and TLS stack — the bytes a
   * server observes are byte-identical to what Chromium sends on its own
   * navigation.
   *
   *   - **Mechanism A — `Network.loadNetworkResource`.** Used when the call
   *     is a simple GET (no `init.method` other than `"GET"`, no
   *     `init.headers`, no `init.body`). The CDP method bypasses the
   *     same-origin policy at the network layer — there is no CORS preflight
   *     and no `Origin` header is sent. Body is returned as an
   *     {@link IO.StreamHandle} which we drain via `IO.read` until EOF and
   *     then close. Requires a `frameId`; we lazily allocate an
   *     `about:blank` scratch frame and reuse it across calls.
   *
   *   - **Mechanism B — `page.evaluate("fetch(url, init).then(...)")`.** Used
   *     for everything else (POST/PUT/DELETE, custom headers, request body).
   *     Full {@link RequestInit} semantics pass through: cookies inherit
   *     from the page's origin (the scratch frame is `about:blank`), CORS
   *     applies same as a real user's browser, redirects follow per
   *     `init.redirect`. Bodies are forwarded as `string` /
   *     `ArrayBuffer` / `URLSearchParams`; `Blob` / `FormData` /
   *     `ReadableStream` are not yet supported (rejected with a clear
   *     diagnostic). The response is reconstructed from a base64-encoded
   *     ArrayBuffer + a status / headers tuple.
   *
   * ### Cookie semantics (breaking change vs. 0.6)
   *
   * Both mechanisms share the browser's cookie jar. A cookie set via
   * `Page.goto` or `session.cookies.set` is sent on the next
   * `session.fetch` call to the same origin — no manual `Cookie` header
   * propagation. The pre-0.7 wreq-routed `Session.fetch` was cookieless.
   *
   * ### What changed vs. 0.6
   *
   * - **No more Rust FFI.** The `@mochi.js/net` and `@mochi.js/net-rs`
   *   packages are gone; there is no cdylib to install or trust.
   * - **Cookies inherit** (above).
   * - **Non-GET respects CORS.** Mechanism B is a real `fetch` from the
   *   page's main world; cross-origin POSTs without `Access-Control-Allow-Origin`
   *   fail the same way they would for a user.
   *
   * @see PLAN.md §5.4 / §7
   */
  async fetch(url: string, init?: RequestInit): Promise<Response> {
    this.assertOpen();
    const isSimpleGet =
      init === undefined ||
      ((init.method === undefined || init.method.toUpperCase() === "GET") &&
        init.headers === undefined &&
        init.body === undefined);
    if (isSimpleGet) return this.fetchViaLoadNetworkResource(url);
    // Mechanism B: serialize the init eagerly so unsupported body shapes
    // (FormData / Blob / ReadableStream) throw BEFORE we allocate any CDP
    // resources — a no-op on the wire if the call would have failed
    // anyway.
    const initSerialized = serializeRequestInitForFetch(init as RequestInit);
    return this.fetchViaPageEvaluate(url, initSerialized);
  }

  /**
   * Mechanism A: drive `Network.loadNetworkResource` against the scratch
   * frame, then drain the resulting `IO.StreamHandle` until EOF.
   *
   * `Network.loadNetworkResource` is exposed by the browser-side network
   * handler and runs against the host's StoragePartition rather than the
   * per-target `NetworkAgent`'s request observer. It does NOT require
   * `Network.enable` (the contract test
   * `tests/contract/session-fetch-no-network-enable.contract.test.ts`
   * pins this empirically — if Chromium ever changes its mind, the test
   * fails loudly and we fall back to mechanism B exclusively).
   *
   * Returned options are intentionally narrow: the CDP method only takes
   * `disableCache` and `includeCredentials`. We default
   * `includeCredentials: true` so cookies inherit (the whole point of a
   * shared-identity fetch).
   *
   * @internal
   */
  private async fetchViaLoadNetworkResource(url: string): Promise<Response> {
    const { frameId } = await this.ensureScratchFrame();
    const res = await this.router.send<{ resource: LoadNetworkResourcePageResult }>(
      "Network.loadNetworkResource",
      {
        frameId,
        url,
        options: { disableCache: false, includeCredentials: true },
      },
    );
    if (!res.resource.success) {
      const name = res.resource.netErrorName ?? "fetch failed";
      const httpStatus =
        res.resource.httpStatusCode !== undefined
          ? ` (httpStatus=${res.resource.httpStatusCode})`
          : "";
      throw new Error(`[mochi] Session.fetch: ${name}${httpStatus}`);
    }
    const status =
      typeof res.resource.httpStatusCode === "number" && res.resource.httpStatusCode > 0
        ? res.resource.httpStatusCode
        : 200;
    const headers = new Headers();
    if (res.resource.headers !== undefined) {
      for (const [k, v] of Object.entries(res.resource.headers)) {
        try {
          headers.append(k, String(v));
        } catch {
          // ignore unmappable header names
        }
      }
    }
    if (res.resource.stream === undefined) {
      // Empty body — no stream allocated. Common for 204 / HEAD-style
      // responses though `loadNetworkResource` is GET-only.
      return new Response(uint8ToArrayBuffer(new Uint8Array(0)), { status, headers });
    }
    const body = await this.readIoStream(res.resource.stream);
    return new Response(uint8ToArrayBuffer(body), { status, headers });
  }

  /**
   * Drain an `IO.StreamHandle` produced by `Network.loadNetworkResource`.
   *
   * The CDP `IO.read` method returns chunks tagged with a `base64Encoded`
   * boolean — text bodies arrive verbatim, binary bodies arrive base64-
   * decoded. We accumulate raw bytes (decoding base64 when needed) and
   * close the handle on EOF. `IO.close` is best-effort: a failure to
   * close doesn't prevent the response from being returned.
   *
   * Chunk size: 64 KiB — the same window the DevTools frontend uses.
   *
   * @internal
   */
  private async readIoStream(handle: string): Promise<Uint8Array> {
    const chunks: Uint8Array[] = [];
    let totalLen = 0;
    // 64 KiB per chunk — DevTools frontend uses the same window. Larger
    // values risk fragmenting the CDP frame; smaller values triple the
    // round-trip count for a realistic JSON body.
    const READ_SIZE = 64 * 1024;
    for (;;) {
      const r = await this.router.send<{ data: string; eof: boolean; base64Encoded?: boolean }>(
        "IO.read",
        { handle, size: READ_SIZE },
      );
      if (r.data.length > 0) {
        const bytes =
          r.base64Encoded === true ? base64ToBytes(r.data) : new TextEncoder().encode(r.data);
        chunks.push(bytes);
        totalLen += bytes.byteLength;
      }
      if (r.eof) break;
    }
    try {
      await this.router.send("IO.close", { handle });
    } catch {
      // best-effort — handle may have auto-released on EOF
    }
    if (chunks.length === 0) return new Uint8Array(0);
    if (chunks.length === 1) return chunks[0] as Uint8Array;
    const out = new Uint8Array(totalLen);
    let offset = 0;
    for (const c of chunks) {
      out.set(c, offset);
      offset += c.byteLength;
    }
    return out;
  }

  /**
   * Mechanism B: forward the call into the page's main-world `fetch` via
   * `Runtime.callFunctionOn`. The function returns
   * `{ status, headers, bodyB64 }`; the body round-trips as base64 so
   * binary responses survive intact.
   *
   * Cookies inherit from the scratch page's origin (`about:blank`), which
   * means cookies set via `Page.goto` (any origin) plus
   * `Storage.setCookies` reach the call exactly as if a user typed `fetch`
   * into the browser console. CORS applies — cross-origin POSTs without
   * the right ACAO header fail the same way they would for a user.
   *
   * @internal
   */
  private async fetchViaPageEvaluate(url: string, initSerialized: string): Promise<Response> {
    const { sessionId } = await this.ensureScratchFrame();
    const documentObjectId = await this.scratchDocumentObjectId(sessionId);
    // The function source is small and self-contained. We avoid any
    // `Runtime.evaluate` (per §8.2 / `Runtime.enable` is forbidden, plus
    // we want a deterministic context) and bind to the document objectId
    // so the call lands in the page's main world.
    const fnDeclaration = `async function(urlArg, initJson) {
      const init = JSON.parse(initJson);
      let bodyOut = init.__body;
      if (init.__bodyB64 !== undefined) {
        const bin = atob(init.__bodyB64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        bodyOut = bytes;
      }
      delete init.__body;
      delete init.__bodyB64;
      if (bodyOut !== undefined) init.body = bodyOut;
      const r = await fetch(urlArg, init);
      const buf = await r.arrayBuffer();
      let b64 = "";
      const view = new Uint8Array(buf);
      // Chunked btoa to dodge call-stack overflow on big bodies.
      const CHUNK = 0x8000;
      for (let i = 0; i < view.length; i += CHUNK) {
        let s = "";
        const end = Math.min(i + CHUNK, view.length);
        for (let j = i; j < end; j++) s += String.fromCharCode(view[j]);
        b64 += btoa(s);
      }
      const headers = {};
      r.headers.forEach((v, k) => { headers[k] = v; });
      return { status: r.status, headers, bodyB64: b64 };
    }`;
    const callRes = await this.router.send<{
      result: {
        value?: { status: number; headers: Record<string, string>; bodyB64: string };
        type: string;
      };
      exceptionDetails?: { exception?: { description?: string }; text?: string };
    }>(
      "Runtime.callFunctionOn",
      {
        functionDeclaration: fnDeclaration,
        objectId: documentObjectId,
        arguments: [{ value: url }, { value: initSerialized }],
        returnByValue: true,
        awaitPromise: true,
      },
      { sessionId },
    );
    if (callRes.exceptionDetails !== undefined) {
      const desc =
        callRes.exceptionDetails.exception?.description ??
        callRes.exceptionDetails.text ??
        "page-evaluate fetch threw";
      throw new Error(`[mochi] Session.fetch: ${desc}`);
    }
    const out = callRes.result.value;
    if (out === undefined) {
      throw new Error("[mochi] Session.fetch: page-evaluate fetch returned undefined");
    }
    const headers = new Headers();
    for (const [k, v] of Object.entries(out.headers)) {
      try {
        headers.append(k, v);
      } catch {
        // ignore unmappable header names
      }
    }
    const body = base64ToBytes(out.bodyB64);
    return new Response(uint8ToArrayBuffer(body), { status: out.status, headers });
  }

  /**
   * Lazily create the scratch frame used by {@link fetch}. The first call
   * spawns an `about:blank` page (kept off the public {@link pages} list),
   * attaches a flat-mode session, enables `Page` (for the `frameNavigated`
   * event), records the main-frame id, and caches the result. Subsequent
   * calls reuse the cache. Closed on {@link close}.
   *
   * Concurrent first-callers share the same in-flight promise so we don't
   * race on `Target.createTarget`.
   *
   * @internal
   */
  private async ensureScratchFrame(): Promise<{
    targetId: string;
    sessionId: string;
    frameId: string;
  }> {
    if (this.scratchFrame !== undefined) return this.scratchFrame;
    if (this.scratchFramePromise !== undefined) return this.scratchFramePromise;
    this.scratchFramePromise = (async () => {
      const created = await this.router.send<{ targetId: string }>("Target.createTarget", {
        url: "about:blank",
      });
      const attached = await this.router.send<{ sessionId: string }>("Target.attachToTarget", {
        targetId: created.targetId,
        flatten: true,
      });
      // Page.enable surfaces `Page.frameNavigated`; we need it to capture
      // the main-frame id deterministically (`Page.getFrameTree` is also
      // an option but adds a CDP round-trip).
      await this.router.send("Page.enable", undefined, { sessionId: attached.sessionId });
      const tree = await this.router.send<{ frameTree: { frame: { id: string } } }>(
        "Page.getFrameTree",
        undefined,
        { sessionId: attached.sessionId },
      );
      this.scratchFrame = {
        targetId: created.targetId,
        sessionId: attached.sessionId,
        frameId: tree.frameTree.frame.id,
      };
      return this.scratchFrame;
    })();
    try {
      const frame = await this.scratchFramePromise;
      return frame;
    } finally {
      this.scratchFramePromise = undefined;
    }
  }

  /**
   * Resolve the scratch page's `document` objectId for `Runtime.callFunctionOn`.
   * `DOM.getDocument` is the canonical "give me a fresh root NodeId"
   * method; `DOM.resolveNode` then returns its `objectId`. Both are §8.2-
   * clean (no `Runtime.enable`, no isolated worlds).
   *
   * @internal
   */
  private async scratchDocumentObjectId(sessionId: string): Promise<string> {
    const doc = await this.router.send<{ root: { nodeId: number } }>(
      "DOM.getDocument",
      { depth: 0 },
      { sessionId },
    );
    const resolved = await this.router.send<{ object: { objectId?: string } }>(
      "DOM.resolveNode",
      { nodeId: doc.root.nodeId },
      { sessionId },
    );
    if (resolved.object.objectId === undefined) {
      throw new Error("[mochi] Session.fetch: scratch document objectId unresolved");
    }
    return resolved.object.objectId;
  }

  /**
   * Close the session: tear down the router, kill Chromium (SIGTERM → 2s
   * grace → SIGKILL), remove the user-data-dir. Idempotent.
   */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    // Dispose any challenge convenience-layer handles first so background
    // pollers stop before pages tear down their CDP sessions.
    for (const h of this.challengeHandles) {
      try {
        h.dispose();
      } catch {
        // ignore — best-effort
      }
    }
    this.challengeHandles.length = 0;
    // Mark all pages as closed (they'll error on further use).
    for (const p of this._pages) {
      // close() is idempotent on Page.
      try {
        await p.close();
      } catch {
        // ignore — best-effort
      }
    }
    // Close the scratch frame used by Session.fetch (mechanisms A + B).
    // `Target.closeTarget` is idempotent server-side; we only call when
    // a scratch frame was actually opened.
    if (this.scratchFrame !== undefined) {
      const targetId = this.scratchFrame.targetId;
      this.scratchFrame = undefined;
      try {
        await this.router.send("Target.closeTarget", { targetId });
      } catch (err) {
        if (!this.closed) console.warn("[mochi] scratch frame close failed:", err);
      }
    }
    // Drop the unified init-injector subscription (and its `Fetch.disable`)
    // BEFORE we tear down the router so the disable round-trip can still
    // complete on the live transport.
    if (this.initInjectorHandle !== undefined) {
      try {
        await this.initInjectorHandle.dispose();
      } catch (err) {
        console.warn("[mochi] init-injector dispose failed:", err);
      }
      this.initInjectorHandle = undefined;
    }
    await this.router.close();
    await this.proc.close();
  }

  /**
   * Internal access to the router for tests (e.g. forbidden-method contract
   * test). Not part of the public API surface.
   *
   * @internal
   */
  _internalRouter(): MessageRouter {
    return this.router;
  }

  /**
   * Internal access to the user-data-dir path (for E2E cleanup verification).
   * Not part of the public API surface.
   *
   * @internal
   */
  _internalUserDataDir(): string {
    return this.proc.userDataDir;
  }

  /**
   * Internal access to the compiled inject payload (sha256 + code).
   * Used by the contract test to pin the payload bytes per matrix.
   *
   * Returns `null` when the session was constructed with
   * `bypassInject: true` — capture-style sessions never compile a payload
   * (PLAN.md §12.1, task 0040).
   *
   * @internal
   */
  _internalPayload(): PayloadResult | null {
    return this._payload;
  }

  /**
   * Whether this session has the inject pipeline disabled. True when
   * constructed with `bypassInject: true` (e.g. `mochi capture`).
   *
   * @internal
   */
  _internalBypassInject(): boolean {
    return this.bypassInject;
  }

  /**
   * The package version that produced this session — useful for diagnostics
   * and for the stub MatrixV1 fields.
   *
   * @internal
   */
  static readonly VERSION = VERSION;

  /**
   * Module-private accessor used by {@link createCookieJar}. The cookie-jar
   * factory lives in module scope (so callers can subclass via the public
   * {@link CookieJar} interface without touching the Session internals); this
   * accessor lets the factory reach the router + the open-state guard while
   * keeping both genuinely private to user code.
   *
   * @internal
   */
  _internalCookieJarPlumbing(): {
    router: MessageRouter;
    assertOpen: () => void;
  } {
    return {
      router: this.router,
      assertOpen: () => this.assertOpen(),
    };
  }

  // ---- internals --------------------------------------------------------------

  private installAutoAttach(): void {
    // PLAN.md §8.3: Target.setAutoAttach picks up workers/service-workers/
    // audio-worklets/etc. We use waitForDebuggerOnStart so we can inject
    // the payload BEFORE any worker script runs.
    this.router
      .send("Target.setAutoAttach", {
        autoAttach: true,
        waitForDebuggerOnStart: true,
        flatten: true,
      })
      .catch((err: unknown) => {
        // Suppress the noisy post-close race; surface real failures.
        if (this.closed) return;
        console.warn("[mochi] Target.setAutoAttach failed:", err);
      });
    this.router.on("Target.attachedToTarget", (params, sessionId) => {
      const ev = params as AttachedToTargetEvent;
      const childSessionId = sessionId ?? ev.sessionId;
      void this.handleAttachedTarget(ev, childSessionId);
    });
  }

  /**
   * Inject the payload into a freshly-attached target if it's a worker-
   * style target (dedicated worker, shared worker, audio worklet — service
   * workers go through the same path; see notes below), then resume it.
   *
   * Worker targets do NOT support `Page.addScriptToEvaluateOnNewDocument`
   * (no Page domain). PLAN.md §8.4 calls out that the worker target accepts
   * `Runtime.evaluate` even though `Runtime.enable` is forbidden by §8.2.
   *
   * The Patchright-cited bootstrap  (— `crServiceWorkerPatch.ts:32-43`,
   * `crPagePatch.ts:404-417`) tightens the inject race window:
   *   1. `Runtime.evaluate("globalThis", { serialization: "idOnly" })` —
   *      returns a `RemoteObject` whose `objectId` carries the worker's
   *      execution-context id. `serialization: "idOnly"` skips the value
   *      preview round-trip we don't need.
   *   2. Parse `objectId.split(".")[1]` for the contextId. The wire format
   *      is `"<runtimeAgentId>.<contextId>.<remoteObjectId>"`; we validate
   *      the split and fail loudly if Chromium has moved the goalposts.
   *   3. Inject the payload via `Runtime.callFunctionOn({ functionDeclaration,
   *      executionContextId, returnByValue: true })`. This binds the call
   *      to the worker's own context rather than relying on
   *      `Runtime.evaluate`'s implicit context resolution, which is the
   *      coarser pattern v0.1.x used.
   *   4. `Runtime.runIfWaitingForDebugger` to resume the target.
   *
   * We never send `Runtime.enable` — that's the whole point of extracting
   * the contextId via the idOnly trick instead of waiting for an
   * `Runtime.executionContextCreated` event.
   *
   * Caveat: worker injection has a smaller stealth ceiling than main-world
   * Page injection. Documented in `docs/limits.md`.
   */
  private async handleAttachedTarget(
    ev: AttachedToTargetEvent,
    childSessionId: string,
  ): Promise<void> {
    const targetType = ev.targetInfo.type;
    const isWorkerLike =
      targetType === "worker" ||
      targetType === "service_worker" ||
      targetType === "shared_worker" ||
      targetType === "audio_worklet";

    // PLAN.md §12.1 / task 0040 — capture flow skips worker injection too.
    if (isWorkerLike && !this.bypassInject && this._payload !== null) {
      try {
        const executionContextId = await this.extractWorkerExecutionContextId(childSessionId);
        this.workerExecutionContextIds.set(childSessionId, executionContextId);
        // `Runtime.callFunctionOn` requires either an `objectId` OR an
        // `executionContextId`. We use the latter — patchright's pattern —
        // so the call binds to the worker's own context, not whatever
        // `Runtime.evaluate` happens to resolve. The payload IIFE is wrapped
        // as a function declaration so `callFunctionOn` accepts it.
        //
        // Timeout: 5s, not the 30s default. Transient workers (sannysoft,
        // bot.incolumitas, etc. spawn brief workers that die between attach
        // and inject) WILL silently disappear; without a per-call cap the
        // route loop blocks for 30s waiting on a reply that's never coming,
        // adding 30s × N orphan workers per test run. 5s is plenty for a
        // real worker (callFunctionOn against a live context returns in
        // single-digit ms); anything past that, the target is dead.
        await this.router.send(
          "Runtime.callFunctionOn",
          {
            functionDeclaration: `function() { ${this._payload.code} }`,
            executionContextId,
            returnByValue: true,
            awaitPromise: false,
            // includeCommandLineAPI must remain false (§8.2).
          },
          { sessionId: childSessionId, timeoutMs: WORKER_INJECT_TIMEOUT_MS },
        );
      } catch (err: unknown) {
        if (!this.closed) {
          // Downgrade to debug for the expected race (worker died before
          // inject completed). The two error fingerprints are: our own
          // CdpTimeoutError (router gave up), or CDP's own "Session with
          // given id not found" / "Target closed" (target detached
          // mid-roundtrip). Both are routine on real-world pages with
          // short-lived workers; warning on every one is just noise. A
          // genuine bug (e.g. the idOnly extraction returning a bad
          // contextId) is anything else and still warns.
          if (isTransientWorkerError(err)) {
            // best-effort: silent. The worker is gone; nothing to do.
          } else {
            console.warn(
              `[mochi] payload inject into worker ${ev.targetInfo.targetId} failed:`,
              err,
            );
          }
        }
      }
    }

    if (ev.waitingForDebugger) {
      try {
        await this.router.send("Runtime.runIfWaitingForDebugger", undefined, {
          sessionId: childSessionId,
          timeoutMs: WORKER_INJECT_TIMEOUT_MS,
        });
      } catch (err: unknown) {
        if (!this.closed) {
          if (isTransientWorkerError(err)) {
            // best-effort: silent. Same race as the inject path above.
          } else {
            console.warn(
              `[mochi] Runtime.runIfWaitingForDebugger on target ${ev.targetInfo.targetId} failed:`,
              err,
            );
          }
        }
      }
    }
  }

  /**
   * Resolve the worker target's execution-context id WITHOUT
   * `Runtime.enable` — patchright's trick.
   *
   * Sends `Runtime.evaluate("globalThis", { serialization: "idOnly" })`
   * against the paused worker session. The returned `RemoteObject.objectId`
   * has the on-the-wire shape `"<runtimeAgentId>.<contextId>.<localId>"`
   * (Chromium >= v131; verified against patchright's parser). We extract
   * `split(".")[1]` and assert it's a positive integer.
   *
   * Throws with a precise diagnostic if Chromium changes the format —
   * silent fallback would mask a real wire-protocol shift, which we want
   * to catch in CI rather than ship as a degraded inject path.
   *
   * @see crServiceWorkerPatch.ts:32-43
   */
  private async extractWorkerExecutionContextId(childSessionId: string): Promise<number> {
    const evalRes = await this.router.send<{ result: { objectId?: string; type?: string } }>(
      "Runtime.evaluate",
      {
        expression: "globalThis",
        // idOnly skips full value serialisation — we want the objectId
        // alone. Supported on Chromium >= v124 (chrome-for-testing v131+
        // in the mochi profile floor).
        serialization: "idOnly",
        // includeCommandLineAPI must remain false (§8.2).
      },
      { sessionId: childSessionId },
    );
    const objectId = evalRes.result.objectId;
    if (typeof objectId !== "string" || objectId.length === 0) {
      throw new Error(
        `[mochi] worker idOnly bootstrap: Runtime.evaluate("globalThis") returned no objectId (got ${JSON.stringify(evalRes.result)})`,
      );
    }
    const parts = objectId.split(".");
    // Format: "<runtimeAgentId>.<contextId>.<localId>" — patchright also
    // pulls index [1]. Refuse to guess if the segment count shifts.
    if (parts.length < 2) {
      throw new Error(
        `[mochi] worker idOnly bootstrap: unexpected objectId shape "${objectId}" (expected dotted segments)`,
      );
    }
    const ctxRaw = parts[1];
    if (ctxRaw === undefined || ctxRaw.length === 0) {
      throw new Error(
        `[mochi] worker idOnly bootstrap: objectId "${objectId}" has empty contextId segment`,
      );
    }
    const contextId = Number.parseInt(ctxRaw, 10);
    if (!Number.isInteger(contextId) || contextId <= 0 || String(contextId) !== ctxRaw) {
      throw new Error(
        `[mochi] worker idOnly bootstrap: contextId segment "${ctxRaw}" of objectId "${objectId}" is not a positive integer`,
      );
    }
    return contextId;
  }

  /**
   * Snapshot of the worker → executionContextId cache. Test-only.
   *
   * @internal
   */
  _internalWorkerExecutionContextIds(): ReadonlyMap<string, number> {
    return new Map(this.workerExecutionContextIds);
  }

  private installCrashGuard(): void {
    // If Chromium dies unexpectedly, we want to mark the session closed so
    // pending and future calls reject cleanly.
    this.proc.exited
      .then(() => {
        // Fire-and-forget — close() is idempotent.
        void this.close();
      })
      .catch(() => {
        void this.close();
      });
  }

  private assertOpen(): void {
    if (this.closed) {
      throw new Error("[mochi] session is closed");
    }
  }
}

// ---- UA-CH metadata helpers -------------------------------------

/**
 * Single brand entry as accepted by `Network.setUserAgentOverride`'s
 * `userAgentMetadata.brands` / `fullVersionList`.
 *
 * @internal
 */
interface UaMetadataBrand {
  brand: string;
  version: string;
}

/**
 * Strip surrounding ASCII double-quotes (the on-the-wire form for several
 * `Sec-CH-UA*` headers — `'"macOS"'`, `'"14.0.0"'`, `'"arm"'`, `'"64"'`).
 * The CDP `userAgentMetadata` enums consume the unquoted form.
 */
function unquoteUaCh(s: string): string {
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) {
    return s.slice(1, -1);
  }
  return s;
}

/**
 * Parse a Sec-CH-UA-style header value
 * (`'"Brand A";v="123", "Not.A/Brand";v="8", "Brand B";v="456"'`) into the
 * `[{brand, version}, ...]` shape `userAgentMetadata.brands` expects.
 *
 * Hand-written state machine — Sec-CH-UA is RFC 8941 Structured Headers
 * with quoted strings, so a regex split on `,` would break on
 * `"Brand,with,commas"`. Mirrors `parseSecChUa` in
 * `@mochi.js/inject/src/modules/client-hints.ts` byte-for-byte: same
 * source field (`matrix.uaCh["sec-ch-ua"]`), same output shape, so the
 * network surface and the JS surface cannot drift.
 *
 * @internal
 */
function parseSecChUaBrandList(s: string): UaMetadataBrand[] {
  const out: UaMetadataBrand[] = [];
  // Split on `,` outside quoted segments. `depth` toggles inside `"…"`.
  const parts: string[] = [];
  let depth = 0;
  let cur = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i] as string;
    if (c === '"') {
      depth = depth === 0 ? 1 : 0;
      cur += c;
    } else if (c === "," && depth === 0) {
      parts.push(cur);
      cur = "";
    } else {
      cur += c;
    }
  }
  if (cur.length > 0) parts.push(cur);
  for (const raw of parts) {
    const piece = raw.trim();
    if (piece.length === 0) continue;
    const semi = piece.indexOf(";");
    if (semi === -1) {
      out.push({ brand: unquoteUaCh(piece), version: "" });
      continue;
    }
    const brandPart = piece.slice(0, semi).trim();
    const rest = piece.slice(semi + 1).trim();
    let version = "";
    if (rest.startsWith("v=")) {
      version = unquoteUaCh(rest.slice(2).trim());
    }
    out.push({ brand: unquoteUaCh(brandPart), version });
  }
  return out;
}

/**
 * Parse the JSON-encoded `uaCh.ua-full-version-list` (R-031) into the
 * `[{brand, version}]` shape. Falls through to the brand-list parser if
 * the matrix doesn't carry the field — every shipped profile does, so
 * the fallback is purely defensive.
 *
 * @internal
 */
function parseFullVersionList(matrix: MatrixV1): UaMetadataBrand[] {
  const raw = matrix.uaCh["ua-full-version-list"];
  if (typeof raw === "string" && raw.length > 0) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        return parsed
          .filter(
            (e): e is UaMetadataBrand =>
              typeof e === "object" &&
              e !== null &&
              typeof (e as { brand?: unknown }).brand === "string" &&
              typeof (e as { version?: unknown }).version === "string",
          )
          .map((e) => ({ brand: e.brand, version: e.version }));
      }
    } catch {
      // Fall through.
    }
  }
  // Fallback: reuse the brand-list majors. Matches the inject side's same
  // fallback in client-hints.ts.
  const secChUa = matrix.uaCh["sec-ch-ua"] ?? "";
  return parseSecChUaBrandList(secChUa);
}

/**
 * Build the `userAgentMetadata` parameter for `Network.setUserAgentOverride`
 * from a derived MatrixV1. Single source of truth = the matrix; the inject
 * `client-hints.ts` module reads the same fields, so the JS-API surface
 * (`navigator.userAgentData.getHighEntropyValues`) and the request-header
 * surface (`Sec-CH-UA*`) cannot drift.
 *
 * Field shape per CDP spec:
 *   - `brands`             — `[{brand, version}]`, brand-list majors.
 *   - `fullVersionList`    — `[{brand, version}]`, tip-locked full versions.
 *   - `fullVersion`        — string, branded entry's version (R-046).
 *   - `platform`           — unquoted Sec-CH-UA-Platform value.
 *   - `platformVersion`    — unquoted Sec-CH-UA-Platform-Version.
 *   - `architecture`       — `"arm" | "x86" | ""` (R-042 unquoted).
 *   - `model`              — free-form string, empty for desktop (R-045).
 *   - `mobile`             — boolean (R-044 → `?1` mapped to true).
 *   - `bitness`            — STRING `"64" | "32" | ""` (R-043 unquoted),
 *                            never numeric.
 *   - `wow64`              — boolean; matrix doesn't model nested-WOW64,
 *                            we always emit false (task 0261 out-of-scope).
 *
 * @internal
 */
export function buildUserAgentMetadata(matrix: MatrixV1): {
  brands: UaMetadataBrand[];
  fullVersionList: UaMetadataBrand[];
  fullVersion: string;
  platform: string;
  platformVersion: string;
  architecture: string;
  model: string;
  mobile: boolean;
  bitness: string;
  wow64: boolean;
} {
  const ua = matrix.uaCh;
  const brandsRaw = ua["sec-ch-ua"] ?? "";
  const brands = parseSecChUaBrandList(brandsRaw);
  const fullVersionList = parseFullVersionList(matrix);
  const fullVersion =
    typeof ua["ua-full-version"] === "string" && ua["ua-full-version"].length > 0
      ? ua["ua-full-version"]
      : (fullVersionList[0]?.version ?? "");
  const platform = unquoteUaCh(ua["sec-ch-ua-platform"] ?? "");
  const platformVersion = unquoteUaCh(ua["sec-ch-ua-platform-version"] ?? "");
  const architecture = unquoteUaCh(ua["sec-ch-ua-arch"] ?? "");
  const bitness = unquoteUaCh(ua["sec-ch-ua-bitness"] ?? "");
  const model = unquoteUaCh(ua["sec-ch-ua-model"] ?? "");
  // Sec-CH-UA-Mobile wire form is "?0" / "?1" (Structured-Headers boolean).
  const mobile = ua["sec-ch-ua-mobile"] === "?1";
  return {
    brands,
    fullVersionList,
    fullVersion,
    platform,
    platformVersion,
    architecture,
    model,
    mobile,
    bitness,
    wow64: false,
  };
}

// ---- cookie-jar factory -----------------------------------------

/**
 * Build the {@link CookieJar} returned by `Session.cookies`. Bound to one
 * Session instance via {@link Session._internalCookieJarPlumbing}. Module-
 * private; the public surface is the interface — instances are only created
 * by the Session constructor.
 *
 * `save`/`load` use Bun's filesystem APIs (`Bun.file`, `Bun.write`) — Bun is
 * the only supported runtime per PLAN.md I-3 so there's no Node fallback.
 *
 * @internal
 */
function createCookieJar(session: Session): CookieJar {
  const { router, assertOpen } = session._internalCookieJarPlumbing();
  return {
    async get(filter: { url?: string } = {}) {
      assertOpen();
      const result = await router.send<{ cookies: import("./page").Cookie[] }>(
        "Storage.getCookies",
      );
      if (filter.url === undefined) return result.cookies;
      // Coarse host-string filter — full URL matching with path / secure /
      // sameSite is out of scope per the brief. Mirrors the pre-0257
      // behaviour of the legacy `Session.cookies(filter)` method.
      let host: string;
      try {
        host = new URL(filter.url).hostname;
      } catch {
        return [];
      }
      return result.cookies.filter((c) => c.domain.endsWith(host) || host.endsWith(c.domain));
    },
    async set(cookies: import("./page").Cookie[]) {
      assertOpen();
      await router.send("Storage.setCookies", { cookies });
    },
    async save(path: string, opts: CookieJarOptions = {}) {
      assertOpen();
      const pattern = opts.pattern ?? /.*/;
      const all = await router.send<{ cookies: import("./page").Cookie[] }>("Storage.getCookies");
      const filtered = all.cookies.filter((c) => pattern.test(c.domain));
      const file: CookieJarFile = {
        version: COOKIE_JAR_FORMAT_VERSION,
        savedAt: new Date().toISOString(),
        mochiVersion: VERSION,
        pattern: pattern.source,
        count: filtered.length,
        cookies: filtered,
      };
      // Pretty-print with 2-space indent: jars are committed by some users
      // alongside fixtures (per nodriver's `pickle` use case); pretty JSON
      // diffs cleanly. Negligible size impact for a few-kB cookie set.
      await Bun.write(path, `${JSON.stringify(file, null, 2)}\n`);
    },
    async load(path: string, opts: CookieJarOptions = {}) {
      assertOpen();
      const pattern = opts.pattern ?? /.*/;
      const file = Bun.file(path);
      const exists = await file.exists();
      if (!exists) {
        throw new Error(`[mochi] cookies.load: file not found at ${path}`);
      }
      let parsed: unknown;
      try {
        const text = await file.text();
        parsed = JSON.parse(text);
      } catch (err) {
        throw new Error(`[mochi] cookies.load: ${path} is not valid JSON: ${String(err)}`);
      }
      const jar = parsed as Partial<CookieJarFile>;
      if (typeof jar !== "object" || jar === null) {
        throw new Error(`[mochi] cookies.load: ${path} is not a JSON object`);
      }
      if (jar.version !== COOKIE_JAR_FORMAT_VERSION) {
        throw new Error(
          `[mochi] cookies.load: ${path} version ${String(jar.version)} is not supported (expected ${COOKIE_JAR_FORMAT_VERSION})`,
        );
      }
      if (!Array.isArray(jar.cookies)) {
        throw new Error(`[mochi] cookies.load: ${path} has no \`cookies\` array`);
      }
      // Filter on load too: a single saved-with-everything jar can be sliced
      // domain-wise without re-saving.
      const toLoad = jar.cookies.filter((c) => pattern.test(c.domain));
      if (toLoad.length === 0) return;
      await router.send("Storage.setCookies", { cookies: toLoad });
    },
  };
}

// ---- Session.fetch helpers --------------------------------------

/**
 * Shape of the `Network.loadNetworkResource` reply per the CDP `tot`
 * spec. The `stream` handle, when present, is an {@link IO.StreamHandle}
 * that must be drained via `IO.read` until EOF and then `IO.close`d.
 *
 * @internal
 * @see https://chromedevtools.github.io/devtools-protocol/tot/Network/#method-loadNetworkResource
 */
interface LoadNetworkResourcePageResult {
  success: boolean;
  netError?: number;
  netErrorName?: string;
  httpStatusCode?: number;
  /** `IO.StreamHandle` — drain via `IO.read` until EOF. Undefined on empty body. */
  stream?: string;
  headers?: Record<string, string>;
}

/**
 * Convert a `Uint8Array` to a fresh `ArrayBuffer` slice — TS's lib.dom
 * `BodyInit` rejects `Uint8Array<ArrayBufferLike>` in some configurations
 * (Bun ships its own DOM types here), so we hand `Response` an ArrayBuffer
 * directly. Zero-copy when possible (the underlying buffer is already a
 * plain `ArrayBuffer`); falls back to a copy slice otherwise.
 *
 * @internal
 */
function uint8ToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

/**
 * Decode a base64-encoded string into a `Uint8Array`. Used by
 * {@link Session.fetch}'s mechanisms A (when `IO.read` returns
 * `base64Encoded: true`) and B (the page-evaluate path always returns
 * base64 so binary responses round-trip intact).
 *
 * Bun ships `atob` natively; we use it for the chunked decode.
 *
 * @internal
 */
function base64ToBytes(b64: string): Uint8Array {
  if (b64.length === 0) return new Uint8Array(0);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Serialize a {@link RequestInit} into a JSON-safe shape the page-evaluate
 * fetch path can consume. Headers / method / redirect / mode / credentials
 * pass through unchanged. The body is the tricky part:
 *
 *   - `string` / `URLSearchParams` → forwarded as the `__body` string field.
 *   - `ArrayBuffer` / typed array → base64-encoded into `__bodyB64` so
 *     binary survives the JSON-only round-trip; the page-side glue
 *     decodes back to a Uint8Array before passing to `fetch`.
 *   - `null` / `undefined` → no body field.
 *   - `Blob` / `FormData` / `ReadableStream` → throws with a clear
 *     diagnostic. Future work; needs a separate channel because they're
 *     not JSON-serializable.
 *
 * @internal
 */
function serializeRequestInitForFetch(init: RequestInit): string {
  const out: Record<string, unknown> = {};
  if (init.method !== undefined) out.method = init.method;
  if (init.headers !== undefined) out.headers = headersInitToRecord(init.headers);
  if (init.redirect !== undefined) out.redirect = init.redirect;
  if (init.mode !== undefined) out.mode = init.mode;
  if (init.credentials !== undefined) out.credentials = init.credentials;
  if (init.referrer !== undefined) out.referrer = init.referrer;
  if (init.referrerPolicy !== undefined) out.referrerPolicy = init.referrerPolicy;
  if (init.cache !== undefined) out.cache = init.cache;
  if (init.integrity !== undefined) out.integrity = init.integrity;
  if (init.keepalive !== undefined) out.keepalive = init.keepalive;
  const b = init.body;
  if (b !== undefined && b !== null) {
    if (typeof b === "string") {
      out.__body = b;
    } else if (b instanceof URLSearchParams) {
      out.__body = b.toString();
    } else if (b instanceof ArrayBuffer) {
      out.__bodyB64 = bytesToBase64(new Uint8Array(b));
    } else if (ArrayBuffer.isView(b)) {
      const view = b as ArrayBufferView;
      out.__bodyB64 = bytesToBase64(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
    } else {
      // Blob / FormData / ReadableStream — would need a separate transport
      // (multipart / streaming) that the JSON-only page-evaluate seam can't
      // express today. The brief explicitly defers these to a follow-up.
      throw new Error(
        "[mochi] Session.fetch: Blob, FormData, and ReadableStream bodies are not yet supported — " +
          "use string / ArrayBuffer / URLSearchParams or wait for the streaming-body PR.",
      );
    }
  }
  return JSON.stringify(out);
}

/** Coerce a Web `Headers` / record / array-pair shape into a plain record. */
function headersInitToRecord(h: HeadersInit): Record<string, string> {
  if (h instanceof Headers) {
    const out: Record<string, string> = {};
    h.forEach((v, k) => {
      out[k] = v;
    });
    return out;
  }
  if (Array.isArray(h)) {
    const out: Record<string, string> = {};
    for (const pair of h) {
      const k = pair[0];
      const v = pair[1];
      if (typeof k === "string" && typeof v === "string") out[k] = v;
    }
    return out;
  }
  return { ...(h as Record<string, string>) };
}

/** Encode a `Uint8Array` to base64. Chunked to dodge call-stack overflow. */
function bytesToBase64(bytes: Uint8Array): string {
  let out = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    let s = "";
    const end = Math.min(i + CHUNK, bytes.length);
    for (let j = i; j < end; j++) s += String.fromCharCode(bytes[j] as number);
    out += btoa(s);
  }
  return out;
}
