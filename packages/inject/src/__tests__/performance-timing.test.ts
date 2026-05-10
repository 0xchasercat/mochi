/**
 * Unit: performance-timing module — `PerformanceNavigationTiming` shim.
 *
 * Empirically discovered leak: Chrome launched via `--remote-debugging-pipe`
 * (mochi's path) sometimes emits navigation entries with `dns: 0`, `tcp: 0`,
 * `nextHopProtocol: ""` even on cold loads — a known headless tell that
 * FPJS's tampering ML reads. The module wraps each navigation entry in a
 * Proxy that injects realistic handshake durations only when the live
 * values are zero.
 *
 * The sandbox in `sandbox.ts` doesn't stand up a real `performance` object
 * with navigation entries, so these tests assert the SHAPE of the emitted
 * JS — the same pattern `phase07-modules.test.ts` uses for webgpu / network
 * info / etc. Runtime semantics are exercised by the harness E2E gate
 * against real Chromium.
 *
 */

import { describe, expect, it } from "bun:test";
import { emitPerformanceTimingModule } from "../modules/performance-timing";
import { FIXTURE_MATRIX } from "./fixtures";

describe("performance-timing — PerformanceNavigationTiming shim", () => {
  it("emits a Proxy-wrapping override for getEntriesByType('navigation')", () => {
    const code = emitPerformanceTimingModule(FIXTURE_MATRIX);
    expect(code).toContain("performance-timing spoof");
    expect(code).toContain("getEntriesByType");
    expect(code).toContain("getEntries");
    expect(code).toContain("getEntriesByName");
    expect(code).toContain('entry.entryType !== "navigation"');
    expect(code).toContain("new Proxy(entry,");
  });

  it("only patches the four leaky fields; other props pass through Reflect.get", () => {
    const code = emitPerformanceTimingModule(FIXTURE_MATRIX);
    expect(code).toContain('prop === "domainLookupEnd"');
    expect(code).toContain('prop === "connectEnd"');
    expect(code).toContain('prop === "secureConnectionStart"');
    expect(code).toContain('prop === "nextHopProtocol"');
    // The fall-through Reflect.get must pass `target` (the real entry)
    // as receiver — NOT `receiver` (the proxy). Native getters on
    // PerformanceNavigationTiming.prototype brand-check `this` and
    // throw "Illegal invocation" against the proxy. See issue #47.
    expect(code).toContain("Reflect.get(target, prop, target)");
    expect(code).not.toContain("Reflect.get(target, prop, receiver)");
  });

  it("uses idempotent patching — only injects when end <= start", () => {
    const code = emitPerformanceTimingModule(FIXTURE_MATRIX);
    // domainLookupEnd: only adds DNS_MS when end <= start (i.e. zero/coalesced)
    expect(code).toMatch(/\(e <= s\) \? s \+ DNS_MS : e/);
    // connectEnd similarly
    expect(code).toMatch(/\(ce <= cs\) \? cs \+ TCP_MS \+ TLS_MS : ce/);
  });

  it("provides a toJSON override so JSON.stringify(entry) sees the patched values", () => {
    const code = emitPerformanceTimingModule(FIXTURE_MATRIX);
    expect(code).toContain('prop === "toJSON"');
    expect(code).toContain("orig.domainLookupEnd");
    expect(code).toContain("orig.nextHopProtocol");
  });

  it("derives TCP/TLS budgets from matrix.uaCh.connection.rtt when present", () => {
    const matrix = {
      ...FIXTURE_MATRIX,
      uaCh: {
        ...FIXTURE_MATRIX.uaCh,
        connection: JSON.stringify({ rtt: 100, downlink: 10 }),
      },
    };
    const code = emitPerformanceTimingModule(matrix);
    // rtt=100 → tcp = round(100 * 0.55) = 55ms, tls = round(100 * 0.1) = 10ms
    expect(code).toContain("var TCP_MS = 55;");
    expect(code).toContain("var TLS_MS = 10;");
  });

  it("falls back to safe defaults when matrix.uaCh.connection is missing", () => {
    const matrix = {
      ...FIXTURE_MATRIX,
      uaCh: { ...FIXTURE_MATRIX.uaCh, connection: "" },
    };
    const code = emitPerformanceTimingModule(matrix);
    // rtt absent → baseRtt = 50ms → tcp = 28ms, tls = 5ms (the values
    // empirically observed on real Chrome on a real Aixit Frankfurt
    // server, suspect score 8 — see investigation 2026-05-09).
    expect(code).toContain("var TCP_MS = 28;");
    expect(code).toContain("var TLS_MS = 5;");
  });

  it("clamps absurd RTT values so misconfigured matrices don't produce slow handshakes", () => {
    const matrix = {
      ...FIXTURE_MATRIX,
      uaCh: {
        ...FIXTURE_MATRIX.uaCh,
        connection: JSON.stringify({ rtt: 5000 }),
      },
    };
    const code = emitPerformanceTimingModule(matrix);
    // rtt clamped to 200 → tcp = round(200 * 0.55) = 110ms
    expect(code).toContain("var TCP_MS = 110;");
  });

  it("hardcodes nextHopProtocol fallback to h2", () => {
    const code = emitPerformanceTimingModule(FIXTURE_MATRIX);
    expect(code).toContain('var DEFAULT_PROTOCOL = "h2";');
  });
});
