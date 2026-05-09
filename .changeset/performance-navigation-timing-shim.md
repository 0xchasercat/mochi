---
"@mochi.js/inject": minor
"@mochi.js/core": patch
---

Add `PerformanceNavigationTiming` spoof module — closes the `dns:0 / tcp:0 / nextHopProtocol:""` headless-browser tell.

**The leak.** Chrome launched via `--remote-debugging-pipe` (mochi's launch path) sometimes emits `PerformanceNavigationTiming` entries with `domainLookupStart === domainLookupEnd`, `connectStart === connectEnd`, and `nextHopProtocol === ""` even on cold cross-origin loads. Real Chrome on a real cold load shows nonzero DNS / TCP times and a populated `nextHopProtocol` (typically `"h2"` for HTTPS/2 origins). The empty/zero triad is a documented headless tell that FPJS's tampering ML has been observed reading.

**The fix.** New `packages/inject/src/modules/performance-timing.ts`. Wraps each navigation entry returned by `performance.getEntriesByType("navigation")`, `performance.getEntries()`, and `performance.getEntriesByName()` in a `Proxy` that overrides only the four leaky fields (`domainLookupEnd`, `connectEnd`, `secureConnectionStart`, `nextHopProtocol`) when their live values are zero/empty. Every other property (`responseStart`, `responseEnd`, `transferSize`, etc.) passes through unchanged so legitimate timing fidelity is preserved. `instanceof PerformanceNavigationTiming` checks pass through the Proxy transparently.

Handshake durations are derived from the matrix's `uaCh.connection.rtt` (clamped to 200ms): `tcp ≈ 0.55 × rtt`, `tls ≈ 0.1 × rtt`, with sensible defaults when `connection` is absent. DNS is a fixed 30ms.

Idempotent: only patches when the live entry has the leaky shape (`end <= start` for the relevant phase). Browsers that populate real values (e.g. non-CDP launch paths) get them through unchanged.

`toJSON()` is also overridden so `JSON.stringify(entry)` sees the patched values rather than the raw zeroes.

Discovered empirically against `wrkx.app`'s FingerprintJS panel during the 2026-05-09 chaser-vs-Aixit suspect-score investigation: containerised mochi runs always emitted `dns:0, tcp:0, protocol:""` while a known-good real-Chrome run on the same fingerprint stack emitted `dns:30, tcp:28, protocol:"h2"`. The shim closes that observable gap.
