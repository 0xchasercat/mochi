/**
 * WebSocket-mode CDP transport.
 *
 * Sibling of {@link ./transport.ts} (pipe-mode). Used by `mochi.connect`
 * to drive a Chromium that's already running and exposing a CDP browser
 * endpoint over a WebSocket — typical of BrowserBase, dockerised
 * Chromium, or any user-managed browser. The pipe-mode transport stays
 * the load-bearing path for `mochi.launch` and remains untouched.
 *
 * # Framing
 *
 * Pipe mode uses NUL-delimited records (see `framer.ts`); WebSocket has
 * native frame boundaries and carries one CDP JSON message per frame.
 * To avoid forking `CdpTransport` we adapt the WebSocket back onto the
 * `PipeReader` / `PipeWriter` interface the existing transport already
 * speaks: each incoming WS message is emitted as `<utf8-json>\0` into a
 * `ReadableStream<Uint8Array>` so the existing framer recovers exactly
 * one frame per WS message; each outgoing pipe-write strips the
 * trailing NUL and forwards the JSON via `WebSocket.send(string)`.
 *
 * The adapter is a thin shim — every §8.2 forbidden-method assertion,
 * timeout / error-translation surface, and event subscription path in
 * `CdpTransport` + `MessageRouter` continues to apply unchanged.
 *
 * # Lifecycle
 *
 * Connection failures (DNS, ECONNREFUSED, TLS, 4xx upgrade rejection)
 * surface synchronously from the awaited `connectWebSocketCdp` call as
 * a {@link ConnectionLostError}. Once connected, an unexpected close /
 * error event closes the underlying ReadableStream — `CdpTransport`'s
 * read-loop notices EOF and tells the router. The router rejects every
 * pending call with `BrowserCrashedError` (which we re-export here as
 * the more accurate `ConnectionLostError` alias for connect-mode).
 *
 * # Headers
 *
 * `connectWebSocketCdp({ headers })` lets callers pass extra HTTP
 * headers on the WebSocket upgrade — useful for proxied / authenticated
 * CDP gateways (BrowserBase tokens, auth-mTLS in front of a docker
 * Chromium, etc.). Bun's native `WebSocket` constructor accepts a
 * `headers` option in the second-arg `BunSocketOptions` object.
 *
 * @see ./transport.ts (pipe-mode sibling)
 * @see ../connect.ts (consumer)
 */

import type { PipeReader, PipeWriter } from "./transport";

/**
 * Thrown when the connect-mode transport could not be established or
 * the live socket dropped without a clean close. Mirrors
 * {@link BrowserCrashedError} for the launch-mode path; we expose a
 * connect-flavoured alias so the on-the-tin name matches what actually
 * went wrong.
 */
export class ConnectionLostError extends Error {
  override readonly cause?: Error;
  /** The endpoint mochi was talking to, included in the message for diagnostics. */
  readonly endpoint: string;
  constructor(message: string, endpoint: string, cause?: Error) {
    super(`[mochi] ${message} (endpoint=${endpoint})`);
    this.name = "ConnectionLostError";
    this.endpoint = endpoint;
    if (cause !== undefined) {
      this.cause = cause;
    }
  }
}

/** Knobs for {@link connectWebSocketCdp}. */
export interface ConnectWebSocketCdpOptions {
  /** WebSocket URL of the Chromium browser endpoint (`ws://…/devtools/browser/<id>`). */
  wsEndpoint: string;
  /** Optional extra headers for the upgrade request (auth tokens, etc.). */
  headers?: Record<string, string>;
  /** Connection timeout in ms. Default 30000. */
  timeoutMs?: number;
}

/**
 * What {@link connectWebSocketCdp} returns: the `PipeReader` / `PipeWriter`
 * pair the existing `MessageRouter` constructor accepts, plus a `close()`
 * helper the connect-mode lifecycle calls when `session.close()` runs.
 */
export interface WebSocketCdpAdapter {
  reader: PipeReader;
  writer: PipeWriter;
  /**
   * Close the underlying WebSocket. Idempotent. Resolves once the socket
   * has reached `CLOSED` or after a 1s grace, whichever comes first —
   * `session.close()` should not block on a slow remote endpoint.
   */
  close(): Promise<void>;
  /**
   * The live WebSocket. Exposed for tests; production callers should
   * close via {@link close} above (which handles idempotency + grace).
   *
   * @internal
   */
  socket: WebSocket;
}

const NUL = 0x00;

/**
 * Open a WebSocket to a CDP browser endpoint and adapt it onto the
 * `PipeReader` / `PipeWriter` interface the rest of `@mochi.js/core`
 * already speaks. Resolves once the socket is `OPEN`; rejects with
 * {@link ConnectionLostError} on upgrade failure or timeout.
 */
export async function connectWebSocketCdp(
  opts: ConnectWebSocketCdpOptions,
): Promise<WebSocketCdpAdapter> {
  const { wsEndpoint, headers, timeoutMs = 30_000 } = opts;
  // Bun's `WebSocket` is the browser-compatible global; the second-arg
  // `headers` option is a Bun extension we use for auth / proxied CDP
  // gateways. The cast keeps both stock-DOM and Bun-typed builds happy.
  const socket: WebSocket =
    headers !== undefined
      ? new (
          WebSocket as unknown as new (
            url: string,
            opts: { headers: Record<string, string> },
          ) => WebSocket
        )(wsEndpoint, { headers })
      : new WebSocket(wsEndpoint);
  // Bun's WebSocket implementation defaults to UTF-8 strings on text
  // frames and `ArrayBuffer` on binary. CDP only sends text. Pin the
  // type so our message handler's narrowing holds.
  socket.binaryType = "arraybuffer";

  // The reader stream — we enqueue one (json + NUL) byte block per WS
  // message so the existing `CdpFramer` recovers exactly one frame per
  // message. Closed when the socket closes.
  let enqueueChunk: ((chunk: Uint8Array) => void) | null = null;
  let closeStream: (() => void) | null = null;
  const stream = new ReadableStream<Uint8Array>({
    start(ctrl) {
      enqueueChunk = (chunk) => {
        try {
          ctrl.enqueue(chunk);
        } catch {
          // Stream may already be closed; ignore.
        }
      };
      closeStream = () => {
        try {
          ctrl.close();
        } catch {
          // Already closed.
        }
      };
    },
  });

  socket.addEventListener("message", (ev: MessageEvent) => {
    if (enqueueChunk === null) return;
    let utf8: Uint8Array;
    if (typeof ev.data === "string") {
      utf8 = new TextEncoder().encode(ev.data);
    } else if (ev.data instanceof ArrayBuffer) {
      utf8 = new Uint8Array(ev.data);
    } else if (ev.data instanceof Uint8Array) {
      utf8 = ev.data;
    } else {
      // Unknown payload shape — drop. CDP only emits text frames.
      return;
    }
    const out = new Uint8Array(utf8.length + 1);
    out.set(utf8, 0);
    out[utf8.length] = NUL;
    enqueueChunk(out);
  });

  const onTerminal = (): void => {
    if (closeStream !== null) {
      closeStream();
      closeStream = null;
      enqueueChunk = null;
    }
  };
  socket.addEventListener("close", onTerminal);
  socket.addEventListener("error", onTerminal);

  // Wait for the socket to reach OPEN.
  await new Promise<void>((resolve, reject) => {
    if (socket.readyState === WebSocket.OPEN) {
      resolve();
      return;
    }
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        socket.close();
      } catch {
        // ignore
      }
      reject(
        new ConnectionLostError(
          `WebSocket upgrade to CDP endpoint timed out after ${timeoutMs}ms`,
          wsEndpoint,
        ),
      );
    }, timeoutMs);
    socket.addEventListener("open", () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve();
    });
    const onErr = (ev: Event): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const message =
        (ev as unknown as { message?: string }).message ?? "WebSocket connection failed";
      reject(new ConnectionLostError(message, wsEndpoint));
    };
    socket.addEventListener("error", onErr, { once: true });
    socket.addEventListener("close", (ev: CloseEvent) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(
        new ConnectionLostError(
          `WebSocket closed before becoming OPEN (code=${ev.code} reason=${ev.reason || "(none)"})`,
          wsEndpoint,
        ),
      );
    });
  });

  const reader: PipeReader = {
    getReader: () => stream.getReader(),
  };

  const writer: PipeWriter = {
    write(chunk) {
      const buf = chunk as Uint8Array;
      // The pipe-mode framer always appends a trailing NUL; the
      // WebSocket layer carries native frame boundaries instead, so we
      // strip the NUL before forwarding. Defensive: if a future change
      // ever drops the delimiter, we still forward the bytes we got.
      const end = buf.length > 0 && buf[buf.length - 1] === NUL ? buf.length - 1 : buf.length;
      const json = new TextDecoder().decode(buf.subarray(0, end));
      try {
        socket.send(json);
      } catch (err) {
        // Bun's WebSocket throws on send-after-close; downgrade to a
        // recognizable error so callers can branch on the connection
        // having dropped.
        throw new ConnectionLostError(
          `WebSocket send failed: ${err instanceof Error ? err.message : String(err)}`,
          wsEndpoint,
          err instanceof Error ? err : undefined,
        );
      }
    },
    flush() {
      // No buffering on the WS write path — `send` enqueues to the
      // socket-internal buffer which Bun flushes on the libuv tick.
    },
    end() {
      try {
        socket.close();
      } catch {
        // Already closed; idempotent.
      }
    },
  };

  let closed = false;
  const close = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    try {
      socket.close();
    } catch {
      // ignore
    }
    // Best-effort wait for the socket to reach CLOSED so the read-loop
    // observes EOF in a deterministic order. 1s cap so a stuck remote
    // doesn't hang `session.close()`.
    await new Promise<void>((resolve) => {
      if (socket.readyState === WebSocket.CLOSED) {
        resolve();
        return;
      }
      const timer = setTimeout(resolve, 1000);
      socket.addEventListener(
        "close",
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true },
      );
    });
  };

  return { reader, writer, close, socket };
}
