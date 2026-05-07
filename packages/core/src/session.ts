/**
 * `Session` — the per-(profile, seed) browser lifecycle.
 *
 * Owns one Chromium process, one CDP transport+router, and one or more
 * `Page` objects. Closing the session kills the browser and removes the
 * ephemeral user-data-dir. PLAN.md §5.1 / §7.
 *
 * v0.1 exposes a *stub* MatrixV1 — derived trivially from `(profile, seed)`
 * with placeholder values. Phase 0.2 swaps this for the real
 * `@mochi.js/consistency` deriveMatrix() output.
 *
 * @see PLAN.md §7
 */

import type { MatrixV1 } from "@mochi.js/consistency";
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
   * The resolved Matrix for this session. v0.1 is a stub; phase 0.2 wires
   * the real `@mochi.js/consistency` engine.
   */
  readonly profile: MatrixV1;
  readonly seed: string;

  private readonly proc: ChromiumProcess;
  private readonly router: MessageRouter;
  private readonly _pages: Page[] = [];
  private closed = false;

  constructor(init: SessionInit) {
    this.proc = init.proc;
    this.profile = init.matrix;
    this.seed = init.seed;
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
    const page = new Page({
      router: this.router,
      targetId: created.targetId,
      sessionId: attached.sessionId,
      initialUrl: "about:blank",
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
   * The package version that produced this session — useful for diagnostics
   * and for the stub MatrixV1 fields.
   *
   * @internal
   */
  static readonly VERSION = VERSION;

  // ---- internals --------------------------------------------------------------

  private installAutoAttach(): void {
    // PLAN.md §8.3: Target.setAutoAttach picks up workers/service-workers/etc.
    // v0.1 just acknowledges the attach (resume the new target so it starts
    // running) — full worker handling lands later.
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
      if (!ev.waitingForDebugger) return;
      this.router
        .send("Runtime.runIfWaitingForDebugger", undefined, {
          sessionId: sessionId ?? ev.sessionId,
        })
        .catch((err: unknown) => {
          if (this.closed) return;
          console.warn(
            `[mochi] Runtime.runIfWaitingForDebugger on target ${ev.targetInfo.targetId} failed:`,
            err,
          );
        });
    });
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
