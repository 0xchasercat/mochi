# Limits — what mochi does not cover

> A living document. Every entry must be added in the same PR that creates the limit.
> Each entry: what's not covered, why, what a user can do about it (if anything).

This is the architectural-honesty page. mochi gives you the best possible JS-layer answer for stealth automation against Chromium-family WAFs. There are things the JS layer cannot do; this page enumerates them. Users who need more should expect to look beyond mochi.

---

## v0 placeholder

This file will populate as the framework lands. Entries follow this template:

```markdown
### <vector name>

**Status:** known limit | partial coverage | covered (verify)
**Root cause:** <why JS-only can't fix this>
**Affected probes:** <which probe families notice it>
**Mitigation:** <what we do about it> | <none>
**User workaround:** <if any>
**Tracking:** <issue link, or "none — fundamental">
```

---

## Anticipated v1 entries (will be populated as discovered during development)

The following are **expected** limits we'll formalize as the framework is built. Listed here for awareness; each will get a full entry when it lands in code.

- **`Runtime.enable` detection** — some scripts side-channel detect whether DevTools-style runtime hooks are active. Avoiding `Runtime.enable` entirely (PLAN.md §8.2) reduces but doesn't eliminate the surface.
- **WebRTC local IP leak** — mDNS-obfuscated since Chrome 84, but original IP recoverable via STUN if no proxy is configured. mochi delegates to user-configured proxy; we don't override at JS layer because it's brittle.
- **Cross-engine FPU/JIT divergence** — out of v1 scope (Chromium-only profiles). Documented here for v2 readers who try to spoof Safari from Chromium.
- **Canvas randomness for non-fixture payloads** — we precompute hash maps for known canvas-fingerprint test payloads; for site-randomized canvas paint, we add per-pixel noise scaled by profile noise budget. A determined adversary may detect the noise.
- **Audio fingerprint on novel sample rates** — we ship precomputed fingerprint bytes for the sample rates each profile's hardware naturally exposes. If a probe forces an unusual sample rate, fallback fidelity is reduced.
- **performance.now() timing under cross-origin isolation** — Chrome's natural 100µs coarsening differs by origin-isolation state; we don't actively spoof this and accept it as Chrome-natural.
- **Trust Tokens / Topics / FedCM** — passthrough; we don't actively answer these probes with fake values, we let Chrome answer naturally.
- **Sensor APIs on desktop** — Chrome doesn't expose them on desktop; nothing to spoof. Mobile profiles (v2) will need real handling.

---

*This file is owned collectively by every contributor. Add to it the moment you discover a limit; the framework's credibility lives here.*
