/**
 * Pipe-mode CDP transport.
 *
 * Owns the read loop on FD 3 (browser → us) and the writer on FD 4 (us →
 * browser). Decodes frames via {@link CdpFramer}, hands them to a callback
 * supplied by the {@link MessageRouter}. Writes via {@link encodeFrame}.
 *
 * The transport itself is intentionally I/O-only — it does not understand
 * request/response correlation, events, or sessions. The router does that.
 * What the transport DOES do is enforce the §8.2 forbidden-method invariants
 * via {@link assertNotForbidden} on every send, before any I/O.
 *
 * @see PLAN.md §8.1 / §8.2
 */

import { assertNotForbidden } from "./forbidden";
import { CdpFramer, encodeFrame } from "./framer";
import type { CdpRequest } from "./types";

/** Minimal duplex pipe surface. Bun's `proc.stdio[3]` is a `ReadableStream` and
 * `proc.stdio[4]` is a `FileSink`. We type against the actual shapes we use so
 * the transport is unit-testable with mocks. */
export interface PipeReader {
  /**
   * Returns a `ReadableStream<Uint8Array>` reader. The transport will pull
   * chunks until the stream ends (browser exit) or `close()` is called.
   */
  getReader(): ReadableStreamDefaultReader<Uint8Array>;
}

export interface PipeWriter {
  /** Write a chunk; returns void or a promise (Bun's FileSink returns number). */
  write(chunk: Uint8Array): unknown;
  /** Flush any buffered bytes. */
  flush?(): unknown;
  /** Close the underlying FD. */
  end?(): unknown;
}

/** Callback the router supplies to receive complete JSON frames. */
export type FrameHandler = (json: string) => void;

/**
 * Transport-level events surfaced to the router. The transport never throws
 * asynchronously; it reports lifecycle changes through this channel.
 */
export interface TransportListener {
  /** Called for every complete JSON frame from the browser. */
  onFrame: FrameHandler;
  /** Called once when the pipe closes (browser exit, manual close, or read error). */
  onClose: (reason?: Error) => void;
}

/**
 * The core transport. Construct with already-opened pipe handles plus a
 * listener; call `start()` to begin the read loop, `send()` to write a CDP
 * request, `close()` to release resources.
 */
export class CdpTransport {
  private readonly framer = new CdpFramer();
  private readonly reader: PipeReader;
  private readonly writer: PipeWriter;
  private readonly listener: TransportListener;
  private nextId = 1;
  private closed = false;
  private readLoopPromise: Promise<void> | null = null;
  private currentReader: ReadableStreamDefaultReader<Uint8Array> | null = null;

  constructor(reader: PipeReader, writer: PipeWriter, listener: TransportListener) {
    this.reader = reader;
    this.writer = writer;
    this.listener = listener;
  }

  /** True after `close()` has been called or the read loop has terminated. */
  get isClosed(): boolean {
    return this.closed;
  }

  /** Mint the next monotonic CDP request id. */
  nextRequestId(): number {
    return this.nextId++;
  }

  /** Start the async read loop. Idempotent. */
  start(): void {
    if (this.readLoopPromise !== null) return;
    this.readLoopPromise = this.runReadLoop();
  }

  /**
   * Synchronously enforce §8.2 invariants, then serialize and write the
   * request to the browser pipe.
   *
   * Throws {@link ForbiddenCdpMethodError} *before* any I/O for any §8.2
   * violation.
   */
  send(request: CdpRequest): void {
    assertNotForbidden(request.method, request.params);
    if (this.closed) {
      throw new Error(`[mochi] cannot send CDP method ${request.method}: transport is closed`);
    }
    const json = JSON.stringify(request);
    const bytes = encodeFrame(json);
    this.writer.write(bytes);
    if (typeof this.writer.flush === "function") {
      // Bun's FileSink returns a promise we don't need to await; failures
      // surface on the next write or via the close listener.
      void this.writer.flush();
    }
  }

  /**
   * Tear down the transport. Idempotent. Cancels the read loop, closes the
   * writer, and notifies the listener exactly once.
   */
  async close(reason?: Error): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    try {
      if (this.currentReader !== null) {
        await this.currentReader.cancel().catch(() => {});
      }
    } catch {
      // ignore cancel failures
    }
    try {
      if (typeof this.writer.end === "function") {
        await this.writer.end();
      }
    } catch {
      // ignore writer-close failures
    }
    this.listener.onClose(reason);
  }

  private async runReadLoop(): Promise<void> {
    let closeReason: Error | undefined;
    try {
      const reader = this.reader.getReader();
      this.currentReader = reader;
      while (!this.closed) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value !== undefined && value.length > 0) {
          const frames = this.framer.push(value);
          for (const frame of frames) {
            try {
              this.listener.onFrame(frame);
            } catch (err) {
              // A handler bug should not kill the read loop.
              // Surface to listener.onClose only on truly fatal conditions.
              console.error("[mochi] CDP frame handler threw:", err);
            }
          }
        }
      }
    } catch (err) {
      closeReason = err instanceof Error ? err : new Error(String(err));
    } finally {
      if (!this.closed) {
        this.closed = true;
        this.listener.onClose(closeReason);
      }
    }
  }
}
