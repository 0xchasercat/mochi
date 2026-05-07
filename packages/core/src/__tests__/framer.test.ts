/**
 * Unit tests for the NUL-delimited CDP framer.
 *
 * Coverage targets:
 *   - single complete frame in one chunk
 *   - multiple frames in one chunk
 *   - one frame split across multiple chunks
 *   - mid-frame chunk boundary that lands exactly on a NUL
 *   - empty / NUL-only chunks
 *   - UTF-8 multi-byte characters spanning chunk boundaries
 */

import { describe, expect, it } from "bun:test";
import { CdpFramer, encodeFrame } from "../cdp/framer";

const ENC = new TextEncoder();
function bytes(str: string): Uint8Array {
  return ENC.encode(str);
}
function withNul(str: string): Uint8Array {
  const inner = bytes(str);
  const out = new Uint8Array(inner.length + 1);
  out.set(inner, 0);
  out[inner.length] = 0;
  return out;
}

describe("CdpFramer", () => {
  it("yields one frame from one complete chunk", () => {
    const f = new CdpFramer();
    const out = f.push(withNul('{"id":1}'));
    expect(out).toEqual(['{"id":1}']);
    expect(f.isEmpty).toBe(true);
  });

  it("yields multiple frames from a single chunk", () => {
    const f = new CdpFramer();
    const a = withNul('{"id":1}');
    const b = withNul('{"id":2}');
    const merged = new Uint8Array(a.length + b.length);
    merged.set(a, 0);
    merged.set(b, a.length);
    const out = f.push(merged);
    expect(out).toEqual(['{"id":1}', '{"id":2}']);
    expect(f.isEmpty).toBe(true);
  });

  it("buffers a partial frame and emits on the chunk that completes it", () => {
    const f = new CdpFramer();
    expect(f.push(bytes('{"id":'))).toEqual([]);
    expect(f.push(bytes('1,"method":"X"'))).toEqual([]);
    expect(f.isEmpty).toBe(false);
    expect(f.push(new Uint8Array([0x7d, 0x00]))).toEqual(['{"id":1,"method":"X"}']);
    expect(f.isEmpty).toBe(true);
  });

  it("handles a chunk that ends exactly on a NUL boundary", () => {
    const f = new CdpFramer();
    expect(f.push(withNul('{"a":1}'))).toEqual(['{"a":1}']);
    expect(f.push(withNul('{"b":2}'))).toEqual(['{"b":2}']);
    expect(f.isEmpty).toBe(true);
  });

  it("ignores empty input", () => {
    const f = new CdpFramer();
    expect(f.push(new Uint8Array(0))).toEqual([]);
  });

  it("drops empty frames between consecutive NULs", () => {
    const f = new CdpFramer();
    // <NUL><NUL>{"x":1}<NUL>
    const buf = new Uint8Array([0, 0, ...bytes('{"x":1}'), 0]);
    expect(f.push(buf)).toEqual(['{"x":1}']);
  });

  it("handles UTF-8 multi-byte chars split across chunks", () => {
    const f = new CdpFramer();
    // emoji U+1F600 = 4 bytes F0 9F 98 80
    const full = withNul('{"emoji":"😀"}');
    // Split mid-emoji.
    const splitAt = full.length - 5;
    expect(f.push(full.subarray(0, splitAt))).toEqual([]);
    const out = f.push(full.subarray(splitAt));
    expect(out).toEqual(['{"emoji":"😀"}']);
  });

  it("encodeFrame appends exactly one NUL byte", () => {
    const out = encodeFrame('{"a":1}');
    expect(out[out.length - 1]).toBe(0);
    expect(new TextDecoder().decode(out.subarray(0, out.length - 1))).toBe('{"a":1}');
  });
});
