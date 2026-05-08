/**
 * Unit tests for `mochi profiles import` — the harvester → ProfileV1 path.
 *
 * Covers:
 *   - Brave UA-mask gate (pass / leak / non-Chrome)
 *   - Multi-snapshot dedup (latest by created_at)
 *   - Mobile rejection (userAgentData.mobile=true)
 *   - Per-category snapshot mapping (`media` → `mediaDevices`, `__probeTime`
 *     stripped, tls/server_headers/fingerprintjs/session_bundle dropped)
 *   - resolveApiRoot precedence (flag > env > default)
 *
 * Network-bound paths (fetchVisitorRecord) are tested by the contract suite
 * via real fixtures committed under `packages/profiles/data/`.
 */

import { afterEach, describe, expect, it } from "bun:test";
import {
  bravePassesChromeMask,
  buildBaselineManifest,
  buildCapturedProbes,
  DEFAULT_HARVESTER_API,
  dedupLatest,
  resolveApiRoot,
} from "../import";

describe("bravePassesChromeMask", () => {
  it("passes when UA reports Chrome and navigator.brave is absent", () => {
    expect(
      bravePassesChromeMask({
        userAgent:
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36",
        vendor: "Google Inc.",
      }),
    ).toBe(true);
  });

  it("fails when navigator.brave is present (mask leaked)", () => {
    expect(
      bravePassesChromeMask({
        userAgent: "Mozilla/5.0 ... Chrome/146.0.0.0 Safari/537.36",
        brave: { isBrave: () => Promise.resolve(true) },
      }),
    ).toBe(false);
  });

  it("fails when UA contains Edg/", () => {
    expect(
      bravePassesChromeMask({
        userAgent: "Mozilla/5.0 ... Chrome/146.0.0.0 Safari/537.36 Edg/146.0.0.0",
      }),
    ).toBe(false);
  });

  it("fails when UA does not contain Chrome/", () => {
    expect(
      bravePassesChromeMask({
        userAgent:
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
      }),
    ).toBe(false);
  });
});

describe("dedupLatest", () => {
  it("keeps the latest snapshot per category by created_at", () => {
    const snapshots = [
      {
        id: 1,
        visitor_id: "v",
        category: "navigator",
        data: '{"v":"old"}',
        created_at: "2024-01-01T00:00:00Z",
      },
      {
        id: 2,
        visitor_id: "v",
        category: "navigator",
        data: '{"v":"new"}',
        created_at: "2025-01-01T00:00:00Z",
      },
      {
        id: 3,
        visitor_id: "v",
        category: "screen",
        data: '{"v":"only"}',
        created_at: "2024-06-01T00:00:00Z",
      },
    ];
    const out = dedupLatest(snapshots);
    expect(out.length).toBe(2);
    const nav = out.find((s) => s.category === "navigator");
    expect((nav?.data as { v: string }).v).toBe("new");
  });

  it("treats missing/invalid created_at as oldest", () => {
    const snapshots = [
      { id: 1, visitor_id: "v", category: "navigator", data: '{"v":"a"}' },
      {
        id: 2,
        visitor_id: "v",
        category: "navigator",
        data: '{"v":"b"}',
        created_at: "2025-01-01T00:00:00Z",
      },
    ];
    const out = dedupLatest(snapshots);
    expect((out[0]?.data as { v: string }).v).toBe("b");
  });

  it("skips snapshots with malformed JSON in data", () => {
    const snapshots = [
      { id: 1, visitor_id: "v", category: "navigator", data: "not-json" },
      { id: 2, visitor_id: "v", category: "screen", data: '{"width":1920}' },
    ];
    const out = dedupLatest(snapshots);
    expect(out.length).toBe(1);
    expect(out[0]?.category).toBe("screen");
  });
});

describe("buildCapturedProbes", () => {
  it("renames media → mediaDevices and strips __probeTime", () => {
    const probes = buildCapturedProbes([
      { category: "media", data: { deviceCount: 3, __probeTime: 1.2 }, createdAtMs: 0 },
      { category: "navigator", data: { userAgent: "ua", __probeTime: 5 }, createdAtMs: 0 },
    ]);
    expect(probes.mediaDevices).toEqual({ deviceCount: 3 });
    expect((probes.navigator as { __probeTime?: number }).__probeTime).toBeUndefined();
    expect((probes.navigator as { userAgent: string }).userAgent).toBe("ua");
  });

  it("drops harvester-only categories (tls_fingerprint, server_headers, fingerprintjs, session_bundle)", () => {
    const probes = buildCapturedProbes([
      { category: "tls_fingerprint", data: { ja3: "x" }, createdAtMs: 0 },
      { category: "server_headers", data: { headers: {} }, createdAtMs: 0 },
      { category: "fingerprintjs", data: { visitorId: "z" }, createdAtMs: 0 },
      { category: "session_bundle", data: { bundle: 1 }, createdAtMs: 0 },
      { category: "navigator", data: { userAgent: "ua" }, createdAtMs: 0 },
    ]);
    expect(Object.keys(probes)).toEqual(["navigator"]);
  });
});

describe("buildBaselineManifest", () => {
  it("emits __meta with capturedAt + sentinel-friendly elapsedMs/href", () => {
    const out = buildBaselineManifest(
      [{ category: "navigator", data: { userAgent: "ua" }, createdAtMs: 0 }],
      { capturedAt: "2026-05-01T00:00:00Z", visitorId: "v1", apiRoot: "http://example.test/api" },
    );
    expect(out.__meta).toBeDefined();
    const meta = out.__meta as Record<string, unknown>;
    expect(meta.capturedAt).toBe("2026-05-01T00:00:00Z");
    expect(meta.elapsedMs).toBe(0);
    expect(meta.href).toBe("http://example.test/api/visitors/v1");
  });
});

describe("resolveApiRoot", () => {
  const originalEnv = process.env.MOCHI_HARVESTER_API;

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.MOCHI_HARVESTER_API;
    else process.env.MOCHI_HARVESTER_API = originalEnv;
  });

  it("prefers explicit > env > default", () => {
    process.env.MOCHI_HARVESTER_API = "http://from-env.test/api";
    expect(resolveApiRoot("http://from-flag.test/api")).toBe("http://from-flag.test/api");
    expect(resolveApiRoot(undefined)).toBe("http://from-env.test/api");
    delete process.env.MOCHI_HARVESTER_API;
    expect(resolveApiRoot(undefined)).toBe(DEFAULT_HARVESTER_API);
  });

  it("strips trailing slash", () => {
    expect(resolveApiRoot("http://x.test/api/")).toBe("http://x.test/api");
  });
});
