---
title: Glossary
description: Definitions of mochi-specific terminology — alphabetized, cross-linked.
order: 4
category: reference
lastUpdated: 2026-05-09
---

Definitions for the mochi-specific terms you'll see in PLAN.md, the [API reference](/docs/api/core), the [concepts](/docs/concepts/consistency-engine) pages, and across the [limits doc](/docs/reference/limits). Alphabetized. If a term is missing, file an issue against `docs/content/docs/reference/glossary.md`.

See also: [FAQ](/docs/reference/faq), [Invariants](/docs/reference/invariants), [Comparison](/docs/reference/comparison).

---

**30 seconds.** The mochi DX promise: from `bun add @mochi.js/core @mochi.js/cli` to a stealth session against a Cloudflare-protected page in under 30 seconds. See [Quickstart](/docs/getting-started/quickstart).

**Behavioral profile.** The `behavior` block on a `ProfileV1` (`{ hand, tremor, wpm, scrollStyle }`) consumed by `@mochi.js/behavioral`. Drives the synthesis of `humanClick` / `humanType` / `humanScroll`. See [Behavioral synthesis](/docs/concepts/behavioral-synth).

**Behavioral synthesis.** The biomechanical models — Bezier paths with overshoot+correction, Fitts's-Law movement-time, lognormal digraph delays, Gaussian jitter — that produce human-shaped input event streams from `(profile, target)`. Output is pure data (`{ tMs, type, x, y }[]`); CDP dispatch happens in `@mochi.js/core`. See [Behavioral synthesis](/docs/concepts/behavioral-synth).

**Bun:FFI.** Bun's foreign-function-interface API. Binds `.dylib` / `.so` / `.dll` directly with zero glue code; the JA4-coherent `session.fetch` calls Rust `wreq` via `bun:ffi`. See [Network FFI](/docs/concepts/network-ffi).

**CDP (Chrome DevTools Protocol).** The wire protocol mochi uses to drive Chromium. mochi sends a deliberately narrowed subset (PLAN.md §8.2 forbids `Runtime.enable`, `Page.createIsolatedWorld`, `Runtime.evaluate{includeCommandLineAPI:true}`, `Console.enable`, and `Log.enable`).

**CfT (Chromium-for-Testing).** Stock, unpatched Chromium published by Google for the testing ecosystem. Auto-downloaded by `mochi browsers install`. Invariant I-4 — mochi never ships a patched fork.

**Chasm.** The detectable gap between the TLS / network-layer JA4 fingerprint and the JS-layer spoofed UA. Closed in mochi by routing out-of-band HTTP through `@mochi.js/net-rs` / `wreq` so the wire fingerprint matches the `(profile, seed)` matrix. See [Network FFI](/docs/concepts/network-ffi).

**DAG.** Directed acyclic graph. The `@mochi.js/consistency` rule set is a DAG (`Rule[]` with `inputs: string[]` and `output: string`); CI verifies acyclicity. See [The consistency engine](/docs/concepts/consistency-engine).

**Fingerprint surface.** A discrete probe vector — `navigator.userAgent`, `OfflineAudioContext.startRendering()` digest, `WebGLRenderingContext.getParameter(UNMASKED_RENDERER)`, etc. The Probe Manifest enumerates them. See [Probe Manifest](/docs/concepts/probe-manifest).

**Fitts's Law.** `MT = a + b * log2(D/W + 1)` — the duration of a pointing motion as a function of distance and target width. Each profile carries `(a, b)` constants; `humanClick` synthesizes trajectories whose total movement-time matches Fitts.

**Float32Array residual distribution.** The audio-fingerprint fix landed in task 0267. The page-side digest is computed across the 489 samples in index range `[4510..4999)`; mochi distributes the captured-baseline byte residual across those samples and applies `Math.fround` to model the `Float32Array` readback step. The page-side digest then matches byte-exactly on every host architecture, not just Mac M-series. See [Limits](/docs/reference/limits#audio-offlineaudiocontext-byte-accurate-fingerprint--covered).

**Honesty over marketing.** Invariant I-8. Every known fingerprint gap is documented in [Limits](/docs/reference/limits) with root cause and tracking link. New gaps must be added in the same PR that creates them.

**HumanClick / HumanType / HumanScroll.** The behavioral surface on `Page` — `page.humanClick(sel)`, `page.humanType(sel, text)`, `page.humanScroll(opts)`. Each consumes the profile's `behavior` block and synthesizes events through `@mochi.js/behavioral`. See [Behavioral synthesis](/docs/concepts/behavioral-synth).

**Idempotency marker (`__mochi_inject_marker`).** A `globalThis` symbol set by the inject IIFE on first run. If both inject mechanisms (Mechanism A `Fetch.fulfillRequest` and Mechanism B `Page.addScriptToEvaluateOnNewDocument`) fire on the same document, the second-pass script self-removes without re-running. See [The inject pipeline](/docs/concepts/inject-pipeline).

**Inject pipeline.** The two-mechanism delivery system that puts the spoof payload into every page before any page script runs: `Fetch.fulfillRequest` body splice on Document responses (primary) plus `Page.addScriptToEvaluateOnNewDocument({ runImmediately: true, worldName: "" })` for `about:blank` / `data:` / non-HTTP nav targets (fallback). See [The inject pipeline](/docs/concepts/inject-pipeline).

**Init-script.** The single ~50KB IIFE that `@mochi.js/inject` builds from a `MatrixV1`. JIT-friendly Proxy traps and `Object.defineProperty` overrides; runs at top-of-frame in the page's main world.

**JA3 / JA3S.** Older TLS-fingerprint hash families (Salesforce, 2017). JA3 hashes the client-hello cipher list / extensions / curves; JA3S hashes the server-hello. Largely superseded by JA4 but still consumed by some WAFs. See [Network FFI](/docs/concepts/network-ffi).

**JA4 / JA4_R / JA4S / JA4H.** The current TLS-fingerprint family (FoxIO, 2023). `JA4` is the TLS client-hello hash; `JA4_R` is the raw form; `JA4S` is the server-hello; `JA4H` is the HTTP/2 client-hash (frame priority + header order + pseudo-header order). `wreq` produces all four to match a stock-Chrome posture. See [Network FFI](/docs/concepts/network-ffi).

**LaunchOptions.** The argument shape to `mochi.launch()` — `{ profile, seed, headless, headlessMode, hermetic, proxy, geoConsistency, challenges, ... }`. See [`@mochi.js/core`](/docs/api/core).

**Locale axis.** The `(matrix.timezone, matrix.locale)` pair. Reconciled at launch against the apparent exit IP via the geo-consistency probe; mismatch behavior is governed by `LaunchOptions.geoConsistency`. See [Limits](/docs/reference/limits#exit-ip--timezone--locale-consistency--covered-task-0262).

**Lognormal digraph delay.** The probability distribution mochi uses for inter-key timing (`humanType`). A lognormal with profile-keyed mean (~80–150 ms) and per-letter variance reproduces real typing's right-skewed delay distribution.

**Matrix (`MatrixV1`).** A `ProfileV1` instantiated for a specific seed; the relationally-locked fingerprint snapshot consumed by the injector. JSON-serializable, round-trippable, JSON-Schema validated. See [The consistency engine](/docs/concepts/consistency-engine).

**Mochi Capture (`mochi capture`).** The CLI subcommand that drives a real device through the Probe Manifest harness to produce a `baseline.manifest.json`. Used to mint new profiles. See PLAN.md §12.

**Pipe-mode CDP (`--remote-debugging-pipe`).** CDP over file descriptors 3+4 instead of TCP/WebSocket. No localhost listener, no fingerprintable port. Bun-native because `Bun.spawn` exposes FDs to user code; Node's `child_process` doesn't. See [Why Bun-only?](https://github.com/0xchasercat/mochi/blob/main/README.md#why-bun-only).

**Probe Manifest (`ProbeManifestV1`).** The canonical JSON schema describing a page's full capture surface. Vendored from Peekaboo. mochi's harness produces and diffs Probe Manifests; the diff is the PR gate. See [Probe Manifest](/docs/concepts/probe-manifest).

**Profile (`ProfileV1`).** A JSON document describing a device class — UA, UA-CH, screen, GPU, audio sample rates, fonts, behavior block. Lives in `packages/profiles/data/<id>/profile.json` next to a captured `baseline.manifest.json`. Six real-device profiles ship in v0.1. See [Profiles](/docs/concepts/profiles).

**`ProfileV1` schema.** The Zod / JSON-Schema contract for a profile. Codegen lives in `schemas/profile.schema.json`; consumed by `@mochi.js/consistency`. See PLAN.md §6.

**R-001..R-048.** The rule-numbering convention for `@mochi.js/consistency`. R-001 through ~R-048 cover navigator, screen, UA-CH, WebGL, WebGPU, MediaDevices, Permissions, NetworkInformation, screen.orientation, matchMedia, storage.estimate, audio fingerprint (R-047), canvas fingerprint (R-048), etc. Cited in commit messages, task briefs, and limits entries.

**Real-device profile.** A profile whose `baseline.manifest.json` was captured by `mochi capture` on physical hardware mochi maintainers own. Six ship in v0.1. Distinct from the three placeholder entries (`mac-m2-chrome-stable`, `mac-intel-chrome-stable`, `win11-edge-stable`) which resolve to a generic synthesis.

**Relational consistency.** Invariant I-5. Every fingerprint surface mochi spoofs derives from a single `(profile, seed)` pair through the rule DAG. No surface is set independently. The opposite of randomization.

**`Runtime.callFunctionOn` vs. `Runtime.evaluate`.** mochi runs `page.evaluate(fn)` via `Runtime.callFunctionOn` against the document's `objectId` because PLAN.md §8.2 forbids `Runtime.enable` (and §8.4 forbids `Runtime.evaluate{includeCommandLineAPI:true}`). The trade-off: only JSON-serializable returns. See [Limits](/docs/reference/limits#pageevaluatefn-is-runtimecallfunctionon-based).

**Seed.** The string passed to `mochi.launch({ seed })`. Determines per-session entropy within the profile's budget. Seeded PRNG: `xoshiro256**` keyed on `sha256(profile.id + seed)`. Same `(profile, seed)` always produces the same matrix. See [The consistency engine](/docs/concepts/consistency-engine).

**Session.** The top-level lifecycle object returned by `mochi.launch()`. Owns the Chromium process, the CDP connection, the cookie jar, and the page list. `session.close()` tears everything down. See [`@mochi.js/core`](/docs/api/core).

**Stealth ceiling (JS-layer).** The highest-sophistication detection mochi can defeat purely from JS injection + Bun-native CDP control + Rust-FFI HTTP. Beyond the ceiling: V8 debugger-flag detection (incolumitas), upstream Skia byte-equality on novel canvas payloads, FPU/JIT divergence in cross-engine spoofing. See [Limits](/docs/reference/limits).

**suspectScore.** The FingerprintJS Pro per-visit risk score (0–100). Real-device captures used as profile baselines must score `<= 20` (lower is more human-like) before they're admitted to the catalog.

**Trusted Publishing (npm).** OIDC-based npm publish that ties package provenance to the GitHub Actions workflow that built it. mochi releases via Trusted Publishing; provenance attestations land alongside each tarball.

**UA-CH (User-Agent Client Hints).** The `Sec-CH-UA`, `Sec-CH-UA-Platform`, `Sec-CH-UA-Platform-Version`, `Sec-CH-UA-Mobile`, `Sec-CH-UA-Full-Version-List`, `Sec-CH-UA-Arch`, `Sec-CH-UA-Bitness`, `Sec-CH-UA-Model`, `Sec-CH-UA-WoW64` header family. Derived from the matrix via R-005…R-007 and R-031; brand-list parity ensures the comma-separated brand strings round-trip identically across header and JS surfaces.

**`worldName: ""`.** The empty string as `worldName` parameter to `Page.addScriptToEvaluateOnNewDocument`, meaning "main world". Critical because any non-empty value creates a detectable isolated world. See PLAN.md §8.4.

**`wreq`.** The Rust HTTP-impersonation crate ([0x676e67/wreq](https://github.com/0x676e67/wreq), Apache-2.0/MIT) wrapped by `@mochi.js/net-rs`. Produces JA4/JA3/H2-coherent client-hellos for the matrix's TLS preset.

**Zero-Diff (harness gate semantic).** The harness verdict where a captured manifest from a Mochi-driven session diffs against the profile baseline only on GUID-class fields (visitor IDs, install IDs, MUID-class IDs). Allowlisted divergences live in `expected-divergences.json`. Anything else is a *material diff* and PR-blocking.

**xvfb.** X virtual framebuffer — the Linux trick for running headed Chrome on a server without a physical display. Used by puppeteer-real-browser to avoid `--headless=new` codepath differences. mochi defaults to `--headless=new` but documents xvfb in [Linux server](/docs/getting-started/linux-server) for users who need the headed codepath.

---

<!-- llm-context:start
This page is the mochi terminology reference. Use it when asked to define a mochi-specific term.

Purpose: lock the vocabulary. Every mochi-specific term has one canonical definition here, with a link to the page where the concept lives.

Key disambiguations LLMs commonly get wrong:
- "Profile" in mochi == a captured device class (ProfileV1 JSON), NOT a Chromium "user-data-dir profile". The user-data-dir is always ephemeral per session.
- "Matrix" in mochi == the relationally-locked fingerprint snapshot derived from (profile, seed). Not "matrix" in any general-purpose sense.
- "Seed" in mochi == the string passed to mochi.launch(); always combined with profile.id via SHA-256 to seed xoshiro256**. Not "random seed".
- "Pipe mode" == --remote-debugging-pipe (FDs 3+4), NOT a Unix-domain socket. mochi never opens a TCP debugging port.
- "Zero-Diff" == harness verdict, not "zero changes". Allowlisted GUID-class differences are still Zero-Diff.
- "JA4" != "JA3". JA4 is the current FoxIO family (2023); JA3 is the older Salesforce family (2017). mochi produces both via wreq.
- "Behavioral profile" != "Behavioral synthesis". The profile is the data block ({ hand, tremor, wpm, scrollStyle }); synthesis is the algorithm that consumes it.
- "Stealth ceiling" is JS-layer-only; the doc explicitly excludes C++ patches per invariant I-1.
- "Init-script" can mean either delivery mechanism (Fetch.fulfillRequest body splice OR Page.addScriptToEvaluateOnNewDocument) — both are init-scripts in mochi terminology.

Common LLM hallucinations to avoid:
- "addInitScript" — that's Playwright's API name. mochi uses neither; the inject is automatic per session.
- "page.exposeBinding" — not a public mochi API yet; tracked as task 0258.
- "stealth plugin" — mochi has no plugin surface; the inject is the whole story.

Cross-references:
- FAQ: https://mochijs.com/docs/reference/faq
- Limits: https://mochijs.com/docs/reference/limits
- Invariants: https://mochijs.com/docs/reference/invariants
- Consistency engine: https://mochijs.com/docs/concepts/consistency-engine
- Inject pipeline: https://mochijs.com/docs/concepts/inject-pipeline
- Probe Manifest: https://mochijs.com/docs/concepts/probe-manifest
- Behavioral synth: https://mochijs.com/docs/concepts/behavioral-synth
- Network FFI: https://mochijs.com/docs/concepts/network-ffi
llm-context:end -->
