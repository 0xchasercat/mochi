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

import type { MatrixV1 } from "@mochi.js/consistency";
import { buildPayload, type PayloadResult } from "@mochi.js/inject";
import { MessageRouter } from "./cdp/router";
import type { AttachedToTargetEvent } from "./cdp/types";
import { NotImplementedError } from "./errors";
import { Page } from "./page";
import type { ChromiumProcess } from "./proc";
import { VERSION } from "./version";

export interface SessionInit {
  proc: ChromiumProcess;
  matrix: MatrixV1;
  seed: string;
  /** Optional overrides for the underlying message-router timeout. */
  defaultTimeoutMs?: number;
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
   * The compiled inject payload for this session. Built once at construction
   * from the resolved {@link MatrixV1}; reused across every new page and
   * every auto-attached worker target. PLAN.md §5.3 / §8.4.
   *
   * @internal — exposed via {@link _internalPayload} for tests/diagnostics.
   */
  private readonly _payload: PayloadResult;

  constructor(init: SessionInit) {
    this.proc = init.proc;
    this.profile = init.matrix;
    this.seed = init.seed;
    this._payload = buildPayload(init.matrix);
    this.router = new MessageRouter(this.proc.reader, this.proc.writer, {
      defaultTimeoutMs: init.defaultTimeoutMs,
    });
    this.router.start();
    this.installAutoAttach();
    this.installCrashGuard();
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
    // PLAN.md §8.4 — main-world inject. worldName MUST be the empty string.
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
    const page = new Page({
      router: this.router,
      targetId: created.targetId,
      sessionId: attached.sessionId,
      initialUrl: "about:blank",
      injectScriptIdentifier: installed.identifier,
    });
    this._pages.push(page);
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

  /** Out-of-band fetch — phase 0.6 (`@mochi.js/net`). */
  fetch(_url: string, _init?: RequestInit): Promise<Response> {
    return Promise.reject(new NotImplementedError("session.fetch"));
  }

  /**
   * Close the session: tear down the router, kill Chromium (SIGTERM → 2s
   * grace → SIGKILL), remove the user-data-dir. Idempotent.
   */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    // Mark all pages as closed (they'll error on further use).
    for (const p of this._pages) {
      // close() is idempotent on Page.
      try {
        await p.close();
      } catch {
        // ignore — best-effort
      }
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
   * @internal
   */
  _internalPayload(): PayloadResult {
    return this._payload;
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

    if (isWorkerLike) {
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
