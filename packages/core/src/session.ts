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
  openCtx as defaultOpenCtx,
  requestOnCtx as defaultRequestOnCtx,
  type NetCtx,
  type NetFetchInit,
} from "@mochi.js/net";
import { MessageRouter } from "./cdp/router";
import type { AttachedToTargetEvent } from "./cdp/types";
import { Page } from "./page";
import type { ChromiumProcess } from "./proc";
import { installProxyAuth, type ProxyAuthHandle } from "./proxy-auth";
import { VERSION } from "./version";

/**
 * Injection seam for the network FFI. Session uses this internally so tests
 * can stub the FFI layer without spinning up the cdylib. Production code
 * defaults to `@mochi.js/net`.
 *
 * @internal
 */
export interface NetAdapter {
  openCtx(spec: { preset: string; proxy?: string }): NetCtx;
  requestOnCtx(ctx: NetCtx, url: string, init: NetFetchInit): Response;
}

const defaultNetAdapter: NetAdapter = {
  openCtx: defaultOpenCtx,
  requestOnCtx: defaultRequestOnCtx,
};

export interface SessionInit {
  proc: ChromiumProcess;
  matrix: MatrixV1;
  seed: string;
  /** Optional overrides for the underlying message-router timeout. */
  defaultTimeoutMs?: number;
  /**
   * When true, skip {@link buildPayload} AND skip
   * `Page.addScriptToEvaluateOnNewDocument` on every new page; worker
   * targets receive no inject either. Intended for `mochi capture` and
   * similar baseline-collection flows. PLAN.md §12.1, task 0040.
   */
  bypassInject?: boolean;
  /**
   * Optional outbound proxy URL forwarded to the network FFI for
   * `Session.fetch` requests. Out-of-band requests honour this independently
   * of the browser's `--proxy-server` flag (which already sees the proxy via
   * the CDP launch path).
   */
  netProxy?: string;
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
   * Network adapter override — tests inject a stub here to exercise the
   * `Session.fetch` wiring without loading the cdylib. Production code does
   * not pass this; the default uses `@mochi.js/net`.
   *
   * @internal
   */
  netAdapter?: NetAdapter;
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
   * Proxy URL forwarded to `@mochi.js/net` for out-of-band fetches. Mirrors
   * the launch-time `proxy` option but is held here because the net Ctx is
   * created lazily on first `fetch`.
   */
  private readonly netProxy: string | undefined;
  /**
   * Lazily-opened Net Ctx for `Session.fetch`. One per Session — wreq's
   * client pool inside the Rust crate handles connection reuse for repeated
   * calls. Closed on `Session.close`.
   */
  private netCtx: NetCtx | undefined;
  /**
   * Pluggable seam for the network FFI. Defaults to `@mochi.js/net`.
   * Tests inject a stub here.
   *
   * @internal
   */
  private readonly netAdapter: NetAdapter;
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
   * no `Page.addScriptToEvaluateOnNewDocument`, no worker injection).
   * Set from {@link SessionInit.bypassInject}. PLAN.md §12.1, task 0040.
   *
   * @internal
   */
  private readonly bypassInject: boolean;
  /**
   * Live handle for the CDP `Fetch.authRequired` subscription. Created
   * lazily on construction when `init.proxyAuth` is set; disposed on
   * `Session.close`. Undefined when the session has no proxy auth.
   */
  private proxyAuthHandle: ProxyAuthHandle | undefined;
  /**
   * Snapshot of the `challenges` launch option, retained so
   * {@link newPage} can install the per-page auto-click handler. Undefined
   * when no challenge convenience layer is enabled. Each page gets its
   * own {@link ChallengeHandle} tracked here for disposal on
   * {@link close}.
   */
  private readonly challengesOpts: SessionInit["challenges"] | undefined;
  private readonly challengeHandles: ChallengeHandle[] = [];

  constructor(init: SessionInit) {
    this.proc = init.proc;
    this.profile = init.matrix;
    this.seed = init.seed;
    this.bypassInject = init.bypassInject === true;
    this.netProxy = init.netProxy;
    this.netAdapter = init.netAdapter ?? defaultNetAdapter;
    this.challengesOpts = init.challenges;
    // Skip payload compilation entirely when bypassed — capture flows must
    // not pay the build cost AND must not see the matrix-derived bytes.
    this._payload = this.bypassInject ? null : buildPayload(init.matrix);
    this.router = new MessageRouter(this.proc.reader, this.proc.writer, {
      defaultTimeoutMs: init.defaultTimeoutMs,
    });
    this.router.start();
    this.installAutoAttach();
    this.installCrashGuard();
    // Wire CDP-driven proxy auth only when credentials were supplied. The
    // no-auth path skips Fetch.enable entirely so we don't pay the
    // protocol-attach cost or surface any extra CDP traffic.
    if (init.proxyAuth !== undefined) {
      // Fire-and-forget: surface failures via console.warn but don't reject
      // the constructor — pages still launch and unauthenticated traffic
      // will simply 407, giving callers a recoverable signal.
      void installProxyAuth(this.router, init.proxyAuth)
        .then((handle) => {
          if (this.closed) {
            void handle.dispose();
            return;
          }
          this.proxyAuthHandle = handle;
        })
        .catch((err: unknown) => {
          if (!this.closed) {
            console.warn("[mochi] proxy-auth installation failed:", err);
          }
        });
    }
  }

  /**
   * Open a new page. Internally:
   *   1. `Target.createTarget` opens a new browser tab.
   *   2. `Target.attachToTarget({ flatten: true })` returns a flat-mode session
   *      id we'll use to address page-level CDP methods.
   *   3. `Page.addScriptToEvaluateOnNewDocument({ source, runImmediately: true,
   *      worldName: "" })` installs the inject payload to run main-world,
   *      before any page script, on every navigation. The returned identifier
   *      is tracked on the {@link Page} so it can be removed on close.
   *      Critical: `worldName: ""` — any non-empty string creates an isolated
   *      world (PLAN.md §8.4) which is detectable.
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
    // Task 0255: defensive UA override at the network layer.
    //
    // The inject payload (Page.addScriptToEvaluateOnNewDocument) spoofs
    // `navigator.userAgent` in the JS surface, but `Network.requestWillBeSent`
    // events (and the request line itself) carry the BARE browser UA — which
    // under `--headless=new` still contains the substring "HeadlessChrome".
    // The inject can never reach those bytes because they're emitted before
    // any document script runs.
    //
    // `Network.setUserAgentOverride` is a per-target setter that does NOT
    // require `Network.enable` (it only stores override state); §8.2's ban
    // on `Network.enable` is therefore unaffected. Sent immediately after
    // attach and before any navigation so the very first request the page
    // issues already carries the matrix UA.
    //
    // Skipped under `bypassInject:true` (PLAN.md §12.1) — capture flows must
    // record the bare browser fingerprint, including its raw UA.
    if (!this.bypassInject) {
      await this.router.send(
        "Network.setUserAgentOverride",
        { userAgent: this.profile.userAgent },
        { sessionId: attached.sessionId },
      );
    }
    // PLAN.md §12.1 / task 0040 — capture flow short-circuits inject so the
    // browser reports its bare fingerprint. Otherwise install the payload
    // main-world via §8.4. worldName MUST be the empty string.
    let injectScriptIdentifier: string | undefined;
    if (!this.bypassInject && this._payload !== null) {
      const installed = await this.router.send<{ identifier: string }>(
        "Page.addScriptToEvaluateOnNewDocument",
        {
          source: this._payload.code,
          runImmediately: true,
          worldName: "",
          // includeCommandLineAPI defaults to false; we don't set it.
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
   * All cookies the browser is aware of, optionally filtered by url.
   *
   * Uses `Storage.getCookies` on the *root* browser target (the only domain
   * that exposes a global cookie reader without a per-page Network domain).
   */
  async cookies(filter: { url?: string } = {}): Promise<import("./page").Cookie[]> {
    this.assertOpen();
    const result = await this.router.send<{ cookies: import("./page").Cookie[] }>(
      "Storage.getCookies",
    );
    if (filter.url === undefined) return result.cookies;
    // v0.1 only supports a coarse host-string filter — full URL matching with
    // path, secure, etc. is out of scope per the brief.
    let host: string;
    try {
      host = new URL(filter.url).hostname;
    } catch {
      return [];
    }
    return result.cookies.filter((c) => c.domain.endsWith(host) || host.endsWith(c.domain));
  }

  /** Set cookies via the root-target Storage domain. */
  async setCookies(cookies: import("./page").Cookie[]): Promise<void> {
    this.assertOpen();
    await this.router.send("Storage.setCookies", { cookies });
  }

  /** Storage snapshot. v0.1: cookies only. localStorage/sessionStorage are empty placeholders pending phase 0.7. */
  async storage(): Promise<StorageSnapshot> {
    this.assertOpen();
    const c = await this.cookies();
    return { cookies: c, localStorage: {}, sessionStorage: {} };
  }

  /**
   * Out-of-band fetch — issues a request via the Rust `wreq` cdylib so the
   * wire fingerprint matches the session's profile preset. The browser's
   * own navigation/XHR/fetch are unaffected (they use Chromium's native
   * TLS, which already matches a Chrome profile). Returns a standard Web
   * `Response`. PLAN.md §5.4 / §10.
   *
   * Lazy: the per-Session `NetCtx` (Tokio runtime + wreq Client) is created
   * on the first call and reused for subsequent calls. Closed on
   * {@link close}.
   */
  async fetch(url: string, init?: RequestInit): Promise<Response> {
    this.assertOpen();
    const ctx = this.ensureNetCtx();
    const headers = this.headersToRecord(init?.headers);
    const body = this.bodyToString(init?.body);
    return this.netAdapter.requestOnCtx(ctx, url, {
      method: init?.method ?? "GET",
      headers,
      body,
      preset: this.profile.wreqPreset,
      ...(this.netProxy !== undefined ? { proxy: this.netProxy } : {}),
    });
  }

  /** Lazy-create the per-Session Net Ctx (one Tokio runtime + wreq client). */
  private ensureNetCtx(): NetCtx {
    if (this.netCtx === undefined) {
      this.netCtx = this.netAdapter.openCtx({
        preset: this.profile.wreqPreset,
        ...(this.netProxy !== undefined ? { proxy: this.netProxy } : {}),
      });
    }
    return this.netCtx;
  }

  /** Coerce a Web `Headers` / record / array-pair shape into a plain record. */
  private headersToRecord(h: HeadersInit | undefined): Record<string, string> {
    if (h === undefined) return {};
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

  /**
   * Coerce a `RequestInit.body` to a UTF-8 string (the only shape the v0.6
   * FFI surface accepts). `null`/`undefined` map to `null`. ArrayBuffer-style
   * inputs are decoded as UTF-8; binary bodies are deferred per task brief.
   */
  private bodyToString(b: BodyInit | null | undefined): string | null {
    if (b === undefined || b === null) return null;
    if (typeof b === "string") return b;
    if (b instanceof ArrayBuffer) return new TextDecoder().decode(b);
    if (ArrayBuffer.isView(b)) {
      // Includes Uint8Array, Buffer, etc.
      return new TextDecoder().decode(b as ArrayBufferView);
    }
    if (b instanceof URLSearchParams) return b.toString();
    // Blob / FormData / ReadableStream — out of v0.6 scope.
    throw new Error(
      "[mochi] Session.fetch: only string, ArrayBuffer/View, and URLSearchParams bodies are supported in v0.6",
    );
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
    // Tear down the per-Session Net Ctx if one was opened. `close()` is
    // idempotent on the Net Ctx as well; calling on never-opened sessions
    // is a no-op since `netCtx` stays undefined.
    if (this.netCtx !== undefined) {
      try {
        this.netCtx.close();
      } catch (err) {
        console.warn("[mochi] net ctx close failed:", err);
      }
      this.netCtx = undefined;
    }
    // Drop the proxy-auth subscription + Fetch.disable BEFORE we tear down
    // the router so the disable round-trip can still complete.
    if (this.proxyAuthHandle !== undefined) {
      try {
        await this.proxyAuthHandle.dispose();
      } catch (err) {
        console.warn("[mochi] proxy-auth dispose failed:", err);
      }
      this.proxyAuthHandle = undefined;
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
   * style target (dedicated worker, shared worker, service worker, audio
   * worklet, etc.), then resume it.
   *
   * Worker targets do NOT support `Page.addScriptToEvaluateOnNewDocument`
   * (no Page domain). PLAN.md §8.4 calls out that we use `Runtime.evaluate`
   * against the paused worker session before issuing
   * `Runtime.runIfWaitingForDebugger`. The §8.2 forbidden-method assertion
   * does NOT trip because we never send `Runtime.enable` — only
   * `Runtime.evaluate` against an already-paused worker target.
   *
   * Caveat: worker injection has a smaller stealth ceiling than main-
   * world Page injection. Documented in `docs/limits.md`.
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
        await this.router.send(
          "Runtime.evaluate",
          {
            expression: this._payload.code,
            awaitPromise: false,
            returnByValue: false,
            // includeCommandLineAPI must remain false (§8.2).
          },
          { sessionId: childSessionId },
        );
      } catch (err: unknown) {
        if (!this.closed) {
          console.warn(`[mochi] payload inject into worker ${ev.targetInfo.targetId} failed:`, err);
        }
      }
    }

    if (ev.waitingForDebugger) {
      try {
        await this.router.send("Runtime.runIfWaitingForDebugger", undefined, {
          sessionId: childSessionId,
        });
      } catch (err: unknown) {
        if (!this.closed) {
          console.warn(
            `[mochi] Runtime.runIfWaitingForDebugger on target ${ev.targetInfo.targetId} failed:`,
            err,
          );
        }
      }
    }
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
