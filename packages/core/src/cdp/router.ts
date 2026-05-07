/**
 * CDP message router.
 *
 * Sits between {@link CdpTransport} (raw frames) and the higher-level
 * Session/Page code (typed `send` + event subscriptions). Owns:
 *
 *   - request-id correlation: every `send(method, params)` returns a Promise
 *     that resolves with `result` or rejects with the CDP error.
 *   - per-method event dispatch: `on(method, handler)` / `off(method, handler)`.
 *   - per-call timeout: default 30s, override per request.
 *   - shutdown: rejects all pending requests with a stable error.
 *
 * The router does NOT spawn the browser, parse flags, or know about pages.
 * It's a pure JSON-RPC dispatcher with a §8.2-aware transport underneath.
 *
 * @see PLAN.md §8
 */

import { CdpTransport, type PipeReader, type PipeWriter } from "./transport";
import type { CdpRequest, CdpResponse, CdpSessionId } from "./types";

const DEFAULT_TIMEOUT_MS = 30_000;

/** A handler invoked when a CDP event arrives. */
export type CdpEventHandler = (params: unknown, sessionId?: CdpSessionId) => void;

/** A subscription token returned by `on()`; call to unsubscribe. */
export type Unsubscribe = () => void;

/**
 * Generic CDP error surfaced when a method returns `{error: ...}`.
 */
export class CdpRemoteError extends Error {
  readonly method: string;
  readonly code: number;
  readonly data: unknown;
  constructor(method: string, code: number, message: string, data?: unknown) {
    super(`[mochi] CDP error from ${method} (${code}): ${message}`);
    this.name = "CdpRemoteError";
    this.method = method;
    this.code = code;
    this.data = data;
  }
}

/**
 * Thrown when the underlying child process exits unexpectedly while a CDP
 * request is in flight, or when the pipe terminates abnormally.
 */
export class BrowserCrashedError extends Error {
  override readonly cause?: Error;
  constructor(message = "browser process exited or pipe closed unexpectedly", cause?: Error) {
    super(`[mochi] ${message}`);
    this.name = "BrowserCrashedError";
    if (cause !== undefined) {
      this.cause = cause;
    }
  }
}

/** Thrown when a CDP request exceeds its per-call timeout. */
export class CdpTimeoutError extends Error {
  readonly method: string;
  readonly timeoutMs: number;
  constructor(method: string, timeoutMs: number) {
    super(`[mochi] CDP method ${method} timed out after ${timeoutMs}ms`);
    this.name = "CdpTimeoutError";
    this.method = method;
    this.timeoutMs = timeoutMs;
  }
}

interface PendingCall {
  method: string;
  resolve: (result: unknown) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/** Optional knobs for `MessageRouter.send()`. */
export interface SendOptions {
  /** Override the default 30s timeout. */
  timeoutMs?: number;
  /** Route to a sub-target session (worker, OOPIF). */
  sessionId?: CdpSessionId;
}

/**
 * Couples a transport with request/response correlation + event dispatch.
 */
export class MessageRouter {
  readonly transport: CdpTransport;
  private readonly pending = new Map<number, PendingCall>();
  private readonly handlers = new Map<string, Set<CdpEventHandler>>();
  private readonly defaultTimeoutMs: number;
  private closeCause: Error | undefined;

  constructor(reader: PipeReader, writer: PipeWriter, opts: { defaultTimeoutMs?: number } = {}) {
    this.defaultTimeoutMs = opts.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.transport = new CdpTransport(reader, writer, {
      onFrame: (json) => this.dispatch(json),
      onClose: (reason) => this.onTransportClosed(reason),
    });
  }

  /** Begin reading from the underlying transport. */
  start(): void {
    this.transport.start();
  }

  /**
   * Send a CDP method and resolve with its `result` payload. Rejects with
   * {@link CdpRemoteError}, {@link CdpTimeoutError}, or
   * {@link BrowserCrashedError} on failure modes.
   *
   * Calls {@link assertNotForbidden} via the transport before any I/O — for
   * forbidden methods this rejects synchronously (well, on next microtask)
   * with {@link ForbiddenCdpMethodError}.
   */
  send<T = unknown>(method: string, params?: unknown, opts: SendOptions = {}): Promise<T> {
    if (this.transport.isClosed) {
      return Promise.reject(this.closeCause ?? new BrowserCrashedError("transport already closed"));
    }
    const id = this.transport.nextRequestId();
    const timeoutMs = opts.timeoutMs ?? this.defaultTimeoutMs;
    const request: CdpRequest = { id, method, params };
    if (opts.sessionId !== undefined) {
      request.sessionId = opts.sessionId;
    }
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        const entry = this.pending.get(id);
        if (entry !== undefined) {
          this.pending.delete(id);
          entry.reject(new CdpTimeoutError(method, timeoutMs));
        }
      }, timeoutMs);
      this.pending.set(id, {
        method,
        resolve: resolve as (v: unknown) => void,
        reject,
        timer,
      });
      try {
        this.transport.send(request);
      } catch (err) {
        // Synchronous rejection (e.g. ForbiddenCdpMethodError, closed pipe).
        clearTimeout(timer);
        this.pending.delete(id);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  /**
   * Subscribe to CDP events of a given method name (e.g. `Page.frameNavigated`).
   * Returns an unsubscribe function. Multiple handlers per method are supported.
   */
  on(method: string, handler: CdpEventHandler): Unsubscribe {
    let set = this.handlers.get(method);
    if (set === undefined) {
      set = new Set();
      this.handlers.set(method, set);
    }
    set.add(handler);
    return () => {
      const current = this.handlers.get(method);
      if (current !== undefined) {
        current.delete(handler);
        if (current.size === 0) this.handlers.delete(method);
      }
    };
  }

  /** Subscribe once; auto-unsubscribes after the first event. */
  once(method: string, handler: CdpEventHandler): Unsubscribe {
    const wrapped: CdpEventHandler = (params, sessionId) => {
      unsubscribe();
      handler(params, sessionId);
    };
    const unsubscribe = this.on(method, wrapped);
    return unsubscribe;
  }

  /** Tear down. Pending calls reject with `BrowserCrashedError`. Idempotent. */
  async close(reason?: Error): Promise<void> {
    if (this.transport.isClosed) return;
    await this.transport.close(reason);
  }

  /** Decode an incoming JSON frame and dispatch to pending caller or event listeners. */
  private dispatch(json: string): void {
    let msg: CdpResponse;
    try {
      msg = JSON.parse(json) as CdpResponse;
    } catch (err) {
      console.error("[mochi] failed to parse CDP frame:", err, json.slice(0, 200));
      return;
    }
    if (typeof msg.id === "number") {
      const entry = this.pending.get(msg.id);
      if (entry === undefined) {
        // Stale response (e.g. timed-out call). Drop silently.
        return;
      }
      this.pending.delete(msg.id);
      clearTimeout(entry.timer);
      if (msg.error !== undefined) {
        entry.reject(
          new CdpRemoteError(entry.method, msg.error.code, msg.error.message, msg.error.data),
        );
      } else {
        entry.resolve(msg.result);
      }
      return;
    }
    if (typeof msg.method === "string") {
      const set = this.handlers.get(msg.method);
      if (set === undefined) return;
      for (const handler of set) {
        try {
          handler(msg.params, msg.sessionId);
        } catch (err) {
          console.error(`[mochi] CDP event handler for ${msg.method} threw:`, err);
        }
      }
    }
  }

  private onTransportClosed(reason?: Error): void {
    const cause = reason ?? new BrowserCrashedError();
    this.closeCause = cause;
    for (const [, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(cause);
    }
    this.pending.clear();
    // Event handlers stay registered — a future re-attach is a v2 concern.
  }
}
