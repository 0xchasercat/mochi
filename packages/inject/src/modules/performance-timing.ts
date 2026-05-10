/**
 * Spoof module: `PerformanceNavigationTiming`.
 *
 * Reads from the matrix:
 *   - `matrix.uaCh.connection` (R-037) — `{rtt, downlink, ...}`. The `rtt`
 *     value seeds a plausible TCP handshake duration; absent → defaults.
 *
 * **What this fixes.** Chrome launched with `--remote-debugging-pipe` (the
 * mochi launch path) and certain headless / virtualised network paths emit
 * navigation entries with `dns: 0`, `tcp: 0`, `nextHopProtocol: ""` even on
 * fresh cold loads — the connection-establishment phases are coalesced or
 * never populated. That triad is a well-known headless tell. Real Chrome on
 * a real cold load shows `dns ≈ 20-50ms`, `tcp ≈ 20-40ms`, and
 * `nextHopProtocol = "h2"` (or "h3" / "http/1.1") for HTTPS/2 origins.
 *
 * **Strategy.** Wrap each `navigation` entry returned by
 * `performance.getEntriesByType("navigation")` and `performance.getEntries()`
 * in a `Proxy` that overrides only the fields known to leak (domainLookupEnd,
 * connectEnd, secureConnectionStart, nextHopProtocol). Every other property
 * (responseStart, responseEnd, transferSize, etc.) passes through unchanged
 * so cache / load-time fields stay accurate. `instanceof
 * PerformanceNavigationTiming` checks pass through the proxy transparently.
 *
 * Idempotence: only patches when the live entry has the leaky shape
 * (start === end for the relevant phase). If Chrome populated real values
 * (e.g. on a non-CDP launch path) the proxy returns them unchanged.
 *
 * Determinism: dns + tcp values derive from a constant seed (kept simple
 * for v1 — no per-call PRNG since the entry is queried multiple times by
 * the same probe and must return stable values).
 *
 * @see PLAN.md §9.6 (timing precision philosophy — same-engine v1 keeps
 *      Chrome's natural coarsening; this module only fixes the
 *      pipe-mode-specific zero-handshake leak, not timer precision).
 */

import type { MatrixV1 } from "@mochi.js/consistency";

interface Connection {
  readonly rtt?: number;
}

function tryParse<T>(s: unknown): T | null {
  if (typeof s !== "string" || s.length === 0) return null;
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
}

export function emitPerformanceTimingModule(matrix: MatrixV1): string {
  const conn = tryParse<Connection>(matrix.uaCh.connection) ?? {};
  // RTT seeds connect time; cap at 200ms so absurd values from misconfigured
  // matrices don't produce comically slow handshakes (200ms TCP+TLS is still
  // within real residential-broadband range).
  const baseRtt = typeof conn.rtt === "number" && conn.rtt > 0 ? Math.min(conn.rtt, 200) : 50;
  // DNS lookup is independent of RTT — pick a stable value in real-Chrome range.
  const dnsMs = 30;
  // TCP connect is roughly one RTT for a 3-way handshake on a warm cache.
  const tcpMs = Math.max(20, Math.round(baseRtt * 0.55));
  // TLS adds ~1 RTT after TCP for TLS 1.3 1-RTT handshake.
  const tlsMs = Math.max(5, Math.round(baseRtt * 0.1));

  return `
// ---- performance-timing spoof (PerformanceNavigationTiming) ----------------
(function() {
  if (typeof performance === "undefined") return;
  if (typeof performance.getEntriesByType !== "function") return;

  var DNS_MS = ${dnsMs};
  var TCP_MS = ${tcpMs};
  var TLS_MS = ${tlsMs};
  var DEFAULT_PROTOCOL = "h2";

  function patchEntry(entry) {
    if (entry === null || entry === undefined) return entry;
    if (entry.entryType !== "navigation") return entry;
    return new Proxy(entry, {
      get: function(target, prop, receiver) {
        if (prop === "domainLookupEnd") {
          var s = target.domainLookupStart;
          var e = target.domainLookupEnd;
          return (e <= s) ? s + DNS_MS : e;
        }
        if (prop === "connectEnd") {
          var cs = target.connectStart;
          var ce = target.connectEnd;
          return (ce <= cs) ? cs + TCP_MS + TLS_MS : ce;
        }
        if (prop === "secureConnectionStart") {
          var v = target.secureConnectionStart;
          if (v === 0 || v === undefined) {
            return target.connectStart + TCP_MS;
          }
          return v;
        }
        if (prop === "nextHopProtocol") {
          var p = target.nextHopProtocol;
          return (p === "" || p === undefined) ? DEFAULT_PROTOCOL : p;
        }
        if (prop === "toJSON") {
          // Page scripts that JSON-serialise the entry must see the same
          // patched values rather than the raw zeroes.
          return function() {
            var orig = (typeof target.toJSON === "function") ? target.toJSON() : Object.assign({}, target);
            var ds = target.domainLookupStart;
            if (orig.domainLookupEnd <= ds) orig.domainLookupEnd = ds + DNS_MS;
            var cs = target.connectStart;
            if (orig.connectEnd <= cs) orig.connectEnd = cs + TCP_MS + TLS_MS;
            if (orig.secureConnectionStart === 0 || orig.secureConnectionStart === undefined) {
              orig.secureConnectionStart = cs + TCP_MS;
            }
            if (orig.nextHopProtocol === "" || orig.nextHopProtocol === undefined) {
              orig.nextHopProtocol = DEFAULT_PROTOCOL;
            }
            return orig;
          };
        }
        // CRITICAL: receiver MUST be the real entry (target), not the
        // proxy. Native getters on PerformanceNavigationTiming.prototype
        // (responseStart, requestStart, transferSize, ...) brand-check
        // "this" and throw "TypeError: Illegal invocation" against the
        // proxy. Page scripts that read those getters (Nuxt apps,
        // React error boundaries on bbc.com/news, browserscan.net) crash
        // their own render path. See issue #47.
        return Reflect.get(target, prop, target);
      },
    });
  }

  var origByType = performance.getEntriesByType;
  function getEntriesByType(type) {
    var r = __mochi_apply__.call(origByType, this, [type]);
    if (type === "navigation" && Array.isArray(r)) {
      return r.map(patchEntry);
    }
    return r;
  }
  __mochi_register_native__(getEntriesByType, "getEntriesByType");

  var origGetEntries = performance.getEntries;
  function getEntries() {
    var r = __mochi_apply__.call(origGetEntries, this, []);
    if (Array.isArray(r)) {
      return r.map(patchEntry);
    }
    return r;
  }
  __mochi_register_native__(getEntries, "getEntries");

  var origByName = performance.getEntriesByName;
  function getEntriesByName(name, type) {
    var r = (type === undefined)
      ? __mochi_apply__.call(origByName, this, [name])
      : __mochi_apply__.call(origByName, this, [name, type]);
    if (Array.isArray(r)) {
      return r.map(patchEntry);
    }
    return r;
  }
  __mochi_register_native__(getEntriesByName, "getEntriesByName");

  try {
    __mochi_defineProperty__(performance, "getEntriesByType", {
      configurable: true, enumerable: false, writable: true, value: getEntriesByType,
    });
    __mochi_defineProperty__(performance, "getEntries", {
      configurable: true, enumerable: false, writable: true, value: getEntries,
    });
    __mochi_defineProperty__(performance, "getEntriesByName", {
      configurable: true, enumerable: false, writable: true, value: getEntriesByName,
    });
  } catch (_e) {}
})();
`;
}
