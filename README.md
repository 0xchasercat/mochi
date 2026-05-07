# mochi

> Sticky on the outside. Untouchable on the inside.

A zero-footprint, Bun-native browser automation framework. Drives stock Chromium with relationally-locked fingerprint spoofing, profile-fingerprinted out-of-band networking via Rust+wreq, and human-shaped behavioral playback — all behind a dead-simple TypeScript API.

```sh
bun add @mochi.js/core
```

```ts
import { mochi } from "@mochi.js/core";

const session = await mochi.launch({
  profile: "mac-m2-chrome-stable",
  seed: "user-12345",
});

const page = await session.newPage();
await page.goto("https://example.com");
await page.humanClick("#submit");
await session.close();
```

## Status

**Pre-v0.** This repo is in active foundation work. The design is locked in `PLAN.md`; implementation begins with task 0001.

If you found this from somewhere and you're wondering whether to depend on it: not yet. Watch for v1.0.

## Philosophy

mochi solves three things at once:

1. **Relational locking** instead of randomization. Every fingerprint surface (canvas, WebGL, audio, fonts, timing, etc.) derives from a single `(profile, seed)` pair. No Frankenstein fingerprints.
2. **Zero-jitter spoofing** at native V8 speeds. JIT-friendly proxies installed before any page script runs. No async round-trips when a WAF probes timing.
3. **Behavioral playback** from biomechanical models. `humanClick`, `humanType`, `humanScroll` synthesize Bezier paths with Fitts-law durations and Gaussian jitter, parameterized per profile.

It does not patch Chromium. It does not depend on proprietary infrastructure. It works against stock Chromium-for-Testing on a developer's laptop. When the JS-only ceiling is binding (Runtime.enable detection, FPU/JIT divergence in cross-engine spoofing), the docs say so plainly.

## Why Bun-only?

- `Bun:FFI` lets us bridge to Rust (`wreq`) without N-API overhead.
- Pipe-mode CDP via Bun's native FD APIs — no TCP listener for WAFs to scan.
- Faster cold start, smaller install, modern toolchain.
- Engines: `bun >= 1.1`. Node is not a target. Deno is not a target.

## Reading the codebase

Start with `PLAN.md` (the design contract). Then `AGENTS.md` (how subagents work). Then pick a package under `packages/`.

## License

MIT. The Rust crate (`@mochi.js/net-rs`) wraps [wreq](https://github.com/0x676e67/wreq) (Apache-2.0/MIT).

## Acknowledgements

Stands on the shoulders of:
- [nodriver](https://github.com/ultrafunkamsterdam/nodriver) — for the no-`Runtime.enable` philosophy
- [rebrowser-patches](https://github.com/rebrowser/rebrowser-patches) — for documenting the leak vectors
- [patchright](https://github.com/Kaliiiiiiiiii-Vinyzu/patchright) — prior art on CDP-level stealth
- [Peekaboo](#) — for the Probe Manifest schema
- [wreq](https://github.com/0x676e67/wreq) — for the Rust HTTP impersonation backend
