/**
 * Pipe-mode CDP framing.
 *
 * Chromium's `--remote-debugging-pipe` writes one CDP JSON message per record,
 * each terminated by a single NUL byte (`\0`). The reader can deliver any
 * chunk size — partial messages, multiple messages in one chunk, or a single
 * message split across chunks. This framer buffers bytes until it sees a NUL,
 * yields the bytes-before-the-NUL as one frame, and continues with the
 * remainder.
 *
 * @see PLAN.md §8.1 (Transport)
 */

const NUL = 0x00;

/**
 * Stateful streaming framer for NUL-delimited CDP records. Push raw byte
 * chunks; receive complete frames (without the delimiter) in order.
 *
 * The buffer is unbounded — Chromium will not produce frames that exceed the
 * caller's available memory in normal operation; if it does, the higher-level
 * router timeout will surface the issue.
 */
export class CdpFramer {
  private buffer: Uint8Array = new Uint8Array(0);
  private decoder = new TextDecoder("utf-8", { fatal: false });

  /**
   * Append a chunk of bytes to the internal buffer and return any complete
   * frames that became available. Frames are returned as decoded UTF-8 strings
   * (CDP guarantees JSON; the framer does not validate).
   */
  push(chunk: Uint8Array): string[] {
    if (chunk.length === 0) {
      return [];
    }
    // Concatenate. We could optimize with a ring buffer, but JSON-RPC over
    // pipe never approaches the throughput where that matters.
    const next = new Uint8Array(this.buffer.length + chunk.length);
    next.set(this.buffer, 0);
    next.set(chunk, this.buffer.length);
    this.buffer = next;

    const frames: string[] = [];
    let start = 0;
    for (let i = 0; i < this.buffer.length; i++) {
      if (this.buffer[i] === NUL) {
        const frameBytes = this.buffer.subarray(start, i);
        if (frameBytes.length > 0) {
          frames.push(this.decoder.decode(frameBytes));
        }
        start = i + 1;
      }
    }
    if (start > 0) {
      this.buffer = this.buffer.subarray(start);
    }
    return frames;
  }

  /**
   * True iff the framer has no buffered bytes (i.e., no partial frame is in
   * flight). Useful for graceful-shutdown assertions.
   */
  get isEmpty(): boolean {
    return this.buffer.length === 0;
  }
}

/**
 * Encode a CDP JSON-RPC string to its on-the-wire bytes (UTF-8 + trailing NUL).
 */
export function encodeFrame(json: string): Uint8Array {
  const utf8 = new TextEncoder().encode(json);
  const out = new Uint8Array(utf8.length + 1);
  out.set(utf8, 0);
  out[utf8.length] = NUL;
  return out;
}
