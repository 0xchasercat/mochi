import { describe, expect, it } from "bun:test";
import type { JsonValue } from "../generated/diff-report";
import { isNormalized, normalize, SENTINELS } from "../normalize";

describe("@mochi.js/harness — normalize()", () => {
  it("flags the output object as normalized", () => {
    const out = normalize({ x: 1 } as Record<string, JsonValue>);
    expect(isNormalized(out)).toBe(true);
  });

  it("strips __meta.capturedAt onto the timestamp sentinel", () => {
    const out = normalize({
      __meta: { capturedAt: "2026-05-08T02:02:42.251Z" },
    } as unknown as Record<string, JsonValue>);
    const meta = (out as unknown as { __meta: { capturedAt: string } }).__meta;
    expect(meta.capturedAt).toBe(SENTINELS.timestamp);
  });

  it("strips __meta.elapsedMs onto the elapsed sentinel", () => {
    const out = normalize({
      __meta: { elapsedMs: 1246 },
    } as unknown as Record<string, JsonValue>);
    const meta = (out as unknown as { __meta: { elapsedMs: string } }).__meta;
    expect(meta.elapsedMs).toBe(SENTINELS.elapsedMs);
  });

  it("strips __meta.href onto the file-path sentinel", () => {
    const out = normalize({
      __meta: { href: "file:///Users/x/mochi/tests/fixtures/probe-page.html" },
    } as unknown as Record<string, JsonValue>);
    const meta = (out as unknown as { __meta: { href: string } }).__meta;
    expect(meta.href).toBe(SENTINELS.filePath);
  });

  it("strips mediaDevices.devices[*].{deviceId,groupId} onto the GUID sentinel", () => {
    const out = normalize({
      mediaDevices: {
        devices: [
          { deviceId: "abc123", groupId: "xyz789", kind: "audioinput" },
          { deviceId: "qwertyuiop", groupId: "0123456789", kind: "videoinput" },
        ],
      },
    } as unknown as Record<string, JsonValue>);
    const devs = (
      out as unknown as {
        mediaDevices: {
          devices: Array<{
            deviceId: string;
            groupId: string;
            kind: string;
          }>;
        };
      }
    ).mediaDevices.devices;
    expect(devs[0]?.deviceId).toBe(SENTINELS.hex32Guid);
    expect(devs[0]?.groupId).toBe(SENTINELS.hex32Guid);
    expect(devs[1]?.deviceId).toBe(SENTINELS.hex32Guid);
    // `kind` is unaffected.
    expect(devs[0]?.kind).toBe("audioinput");
  });

  it("regex-strips a HEX32 GUID inside a free-form string", () => {
    const out = normalize({
      cookies: ["MUID=ABCDEF0123456789ABCDEF0123456789;"],
    } as unknown as Record<string, JsonValue>);
    const cookies = (out as unknown as { cookies: string[] }).cookies;
    expect(cookies[0]).toContain(SENTINELS.hex32Guid);
  });

  it("regex-strips a UUIDv4 inside a free-form string", () => {
    const out = normalize({
      eventId: "12345678-1234-4abc-9def-012345678901",
    } as unknown as Record<string, JsonValue>);
    expect((out as unknown as { eventId: string }).eventId).toBe(SENTINELS.eventId);
  });

  it("regex-strips an RFC3339 timestamp inside a free-form string", () => {
    const out = normalize({
      blob: "issued at 2026-05-08T02:02:42.251Z to user",
    } as unknown as Record<string, JsonValue>);
    expect((out as unknown as { blob: string }).blob).toContain(SENTINELS.timestamp);
  });

  it("regex-strips a CSP nonce inside a free-form string", () => {
    const out = normalize({
      h: "Content-Security-Policy: script-src 'nonce=Xy7AB12CDeFGHJklmnOPQRstuv'",
    } as unknown as Record<string, JsonValue>);
    expect((out as unknown as { h: string }).h).toContain(`nonce=${SENTINELS.cspNonce}`);
  });

  it("preserves structure (same keys, same array lengths)", () => {
    const input = {
      a: {
        b: [
          { c: 1, d: "hi" },
          { c: 2, d: "there" },
        ],
      },
      e: null,
    };
    const out = normalize(input as unknown as Record<string, JsonValue>);
    const a = (out as unknown as typeof input).a;
    expect(Array.isArray(a.b)).toBe(true);
    expect(a.b.length).toBe(2);
    expect(a.b[0]?.c).toBe(1);
    expect((out as unknown as typeof input).e).toBeNull();
  });

  it("is idempotent", () => {
    const input = {
      __meta: { capturedAt: "2026-05-08T02:02:42.251Z", elapsedMs: 100 },
      foo: "ABCDEF0123456789ABCDEF0123456789",
    };
    const once = normalize(input as unknown as Record<string, JsonValue>);
    const twice = normalize({ ...once } as unknown as Record<string, JsonValue>);
    expect(JSON.stringify(once)).toBe(JSON.stringify(twice));
  });
});
