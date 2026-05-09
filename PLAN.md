# mochi — Master Plan

> Sticky on the outside. Untouchable on the inside.

**Status:** v0 design lock — 2026-05-08. Brainstorming complete. All foundational decisions locked. This document is the design contract for every PR and CI gate. If a change conflicts with anything written here, the change is wrong; if reality has drifted from this doc, fix the doc *in the same PR*.

**Audience:** every contributor. Read top-to-bottom once, then come back to the section you need. Section 5 (Packages) and Section 7 (Public API) are the most frequently referenced.

---

## Table of contents

1. North Star
2. Architectural invariants
3. Decisions ledger
4. Architecture overview
5. Packages
6. Data schemas
7. Public API
8. CDP engine design notes
9. Consistency engine design notes
10. Network FFI design notes
11. Behavioral engine design notes
12. Profile schema and capture protocol
13. Validation harness specification
14. Implementation phases
15. Open questions deferred to v2
16. Glossary

---

## 1. North Star

mochi is the **first zero-footprint, Bun-native browser automation framework** designed to make programmatic web traffic mathematically and behaviorally indistinguishable from organic human traffic — purely from the JS layer, against stock Chromium-for-Testing.

It exists because the JS ecosystem has no single coherent answer for stealthy, reliable browser automation. Today you mix Patchright + a fingerprint injector + a Turnstile clicker + a residential proxy + custom CDP boilerplate + a Playwright state-machine wrapper, and the result is fragile, slow, leaky, and hard to reason about. mochi solves that problem once.

**Three philosophies, non-negotiable:**

1. **Relational Locking over Randomization.** Anti-bots catch the *Frankenstein fingerprint* — a Mac UA + Linux WebGL + Windows fonts. mochi locks every sub-system to a single device's manufacturing reality, derived from a `(profile, seed)` pair. Every probe surface is consistent with every other. No randomization, only deterministic relational derivation.
2. **Zero-Jitter over Proxying.** WAFs micro-time `performance.now()` deltas to catch execution overhead. mochi's spoofing must operate at native V8 speeds — synchronous JIT-optimized proxies, no async round-trips back to the Bun process when a WAF challenges. The injection happens once, before any page script runs, and is invisible thereafter.
3. **Behavioral Playback over Synthetic Paths.** Bots teleport in straight lines; humans overshoot, jitter, and correct. mochi's `humanClick`/`humanType`/`humanScroll` are derived from biomechanical models (Bezier + Fitts + Gaussian jitter) parameterized per profile, with a v1.x recording API to replay real captured traces.

**The funnel.** Some users will hit the JS-only ceiling — the things that genuinely require a Chromium patch (Runtime.enable detection, certain isolated-world boundaries, FPU/JIT divergence in cross-engine spoofing). The docs name these honestly. mochi does not point users anywhere; users find their own path. The framework's job is to be the best possible JS-layer answer.

---

## 2. Architectural invariants

These are not preferences. They are invariants. Any PR that violates one is wrong by definition.

**I-1. No C++ work in this repo.** Ever. No Chromium patches, no v8 patches, no native-code work that touches the browser binary. Everything mochi does is solvable from (a) JS injection, (b) Bun-native CDP control, or (c) the Rust FFI networking layer. When a problem genuinely requires a C++ patch, we document the limitation in `docs/limits.md` and move on.

**I-2. No proprietary integrations.** mochi never reaches for chaser, never branches on `MOCHI_USE_CHASER`, never carries env-var trapdoors that light up paid features. It is fully open-source, MIT-licensed, and equally useful to a solo developer with a laptop and to an enterprise with infrastructure.

**I-3. Bun-only runtime.** Engines = `bun >= 1.1`. Node is not a target. Deno is not a target. We use Bun:FFI, `Bun.spawn`, Bun's WebSocket and file-descriptor APIs natively. The `package.json` engines field rejects non-Bun installs.

**I-4. Stock Chromium binary.** Default = pinned [Chromium-for-Testing](https://googlechromelabs.github.io/chrome-for-testing/), auto-downloaded by `mochi browsers install`. BYO is supported via `binary: <path>`. We do **not** ship a patched fork.

**I-5. Relational consistency or nothing.** Every fingerprint surface mochi spoofs derives from a single `(profile, seed)` pair. No probe surface is ever set independently. If a user supplies an override, the override is logged as a *deliberate inconsistency* and the harness refuses to certify the profile.

**I-6. The Probe Manifest is the truth.** [Peekaboo's Probe Manifest schema](../Peekaboo/peekaboo/schemas/probe-manifest.schema.json) is the canonical surface description. mochi's harness produces and diffs Probe Manifests. If it's not in the manifest, it's not a tracked surface; if it's in the manifest and we don't cover it, that's a gap with an issue number.

**I-7. The harness is the gate.** Every PR that changes `@mochi.js/consistency`, `@mochi.js/inject`, `@mochi.js/net`, or `@mochi.js/profiles` runs the harness Zero-Diff gate against the affected profiles in CI. A PR that breaks Zero-Diff cannot merge without explicit waiver and a follow-up issue.

**I-8. Honesty over marketing.** `docs/limits.md` lists every fingerprint vector we know we don't cover, with a rationale. New gaps discovered must be added in the same PR that creates them.

---

## 3. Decisions ledger

Every locked decision, traceable to the brainstorm round that locked it. No decision in this table may be quietly reversed in a PR — if a decision needs to change, it's a discussion in a `discussion/<id>.md` doc that updates this table when concluded.

| # | Decision | Locked answer | Round |
|---|---|---|---|
| 1 | Positioning | Standalone OSS, no proprietary integrations | R1 |
| 2 | Browser binary | Stock Chromium-for-Testing (BYO + autodownload) | R1 |
| 3 | Network impersonation | Vendor `wreq` via thin Rust crate exposed to Bun:FFI | R1 + R3 |
| 4 | Engine spoofing scope (v1) | Chromium-family only (Chrome/Edge/Brave/Arc/Opera) | R1 |
| 5 | Runtime | Bun-only, ≥ 1.1 | R2 |
| 6 | Public API DX | Fresh — `mochi.launch / session.newPage / page.humanClick` | R2 |
| 7 | Repo structure | Bun-workspace monorepo, focused packages | R2 |
| 8 | Profile sourcing | Capture from real devices we own; hash-locked fixtures | R2 |
| 9 | C++ work | **Forbidden in this repo** | R1 (clarified) |
| 10 | Behavioral playback (v1) | Bezier + Fitts + jitter synthesis only; recording API in v1.x | R3 |
| 11 | Harness gate criteria | Probe Manifest diff against captured baselines; PR-fast smoke + nightly full | R3 |
| 12 | Dev harness shape | per-package contract tests + PR template + pre-push gate | R3 |
| 13 | License | MIT (entire repo, including Rust crate) | inferred from R1 |
| 14 | Versioning | Independent per-package semver via Changesets; `@mochi.js/core` is the public entry point (no umbrella package on npm) | inferred from R7 |
| 15 | Commit format | Conventional Commits with package scope (e.g. `feat(core): ...`) | R3 |

---

## 4. Architecture overview

```
                                      ┌─────────────────────────────────┐
                                      │       User code (TS)            │
                                      │  import { mochi } from           │
                                      │            "@mochi.js/core";        │
                                      └──────────────┬──────────────────┘
                                                     │
              ┌──────────────────────────────────────▼─┐      ┌──────────────────┐
              │      @mochi.js/core                       │      │  @mochi.js/cli      │
              │  - launch / spawn Chromium  │      │  mochi browsers  │
              │  - CDP pipe transport       │      │  mochi capture   │
              │  - Page / Session objects   │      │  mochi harness   │
              │  - public types             │      │  mochi work      │
              └──┬─────────────┬─────────┬──┘      └──────────────────┘
                 │             │         │
       ┌─────────▼─┐  ┌────────▼─┐  ┌────▼─────────┐
       │ @mochi.js/   │  │ @mochi.js/  │  │ @mochi.js/      │
       │ inject    │  │ behav-   │  │ net          │
       │ (payload) │  │ ioral    │  │ (TS facade)  │
       └─────┬─────┘  └──────────┘  └──────┬───────┘
             │                             │
       ┌─────▼─────────────┐         ┌─────▼──────────┐
       │ @mochi.js/           │         │ @mochi.js/net-rs  │
       │ consistency       │         │ (Rust crate)   │
       │ (Matrix engine)   │         │  + Bun:FFI     │
       └─────┬─────────────┘         │  wraps `wreq`  │
             │                       └────────────────┘
       ┌─────▼─────────────┐
       │ @mochi.js/profiles   │
       │ (data fixtures)   │
       └───────────────────┘

                          ┌──────────────────────────┐
                          │  @mochi.js/harness          │
                          │  Probe Manifest diff     │
                          │  Run as PR gate / nightly│
                          └──────────────────────────┘
```

**Dataflow at runtime:**

1. `mochi.launch({ profile, seed })` → `@mochi.js/core` resolves the profile from `@mochi.js/profiles` and asks `@mochi.js/consistency` to derive the **Matrix** (the concrete relational fingerprint values for this seed).
2. `@mochi.js/inject` builds a payload (a single JS bundle, JIT-friendly, ~50KB target) parameterized by the Matrix.
3. `@mochi.js/core` spawns Chromium with `--remote-debugging-pipe` and a clean user-data-dir, attaches via Bun-native pipe FDs, and uses `Page.addScriptToEvaluateOnNewDocument` with `runImmediately: true` to install the payload at top-of-frame on every navigation.
4. User calls `page.humanClick(sel)` → `@mochi.js/behavioral` synthesizes a path → `@mochi.js/core` issues `Input.dispatchMouseEvent` calls timed to the path.
5. User calls `session.fetch(url)` → `@mochi.js/net` calls into `@mochi.js/net-rs` via Bun:FFI → `wreq` issues the request with the profile's TLS/H2 fingerprint preset.
6. CI runs `@mochi.js/harness` against the running session → captures a Probe Manifest → diffs against `@mochi.js/profiles/<profile>/baseline.manifest.json` → gate passes iff only GUID-class differences remain.

**Contracts between packages.**

Every cross-package contract lives in `packages/<pkg>/src/contract.ts` and is duplicated as a typed test in `tests/contract/<pkg>.contract.ts`. Contract tests run in CI for every PR. Breaking a contract requires bumping the consumer packages' major versions in the same PR (Changesets enforces).

---

## 5. Packages

Each package owns one well-bounded responsibility. The internal map below is binding — agents working on a task touch *one* primary package and may make small additive changes to its direct contract consumers, never a transitive fanout.

### 5.1 `@mochi.js/core`

**Responsibility.** Launch and lifecycle. CDP transport. Public Page/Session objects. The seam between Bun and Chromium.

**Owns.**
- `launch(opts)` → `Session`
- `Session` class: `newPage`, `pages`, `cookies`, `storage`, `close`
- `Page` class: `goto`, `content`, `text`, `evaluate`, `waitFor`, `humanClick`, `humanType`, `humanScroll`, `cookies`, `screenshot`
- CDP pipe transport (no TCP fallback)
- Bun.spawn-based Chromium process management
- User-data-dir lifecycle (always isolated per session, deleted on `close`)
- Graceful shutdown (SIGTERM, drain pending CDP messages, kill on timeout)

**Does not own.**
- Stealth payload generation (→ `@mochi.js/inject`)
- Fingerprint determinism (→ `@mochi.js/consistency`)
- Behavioral synthesis (→ `@mochi.js/behavioral`)
- Out-of-band HTTP (→ `@mochi.js/net`)

**Critical design choices.**
- Pipe-mode default (`--remote-debugging-pipe`). No TCP port. WebSocket only as a future opt-in for remote debugging across machines (not v1).
- `Runtime.enable` is *globally forbidden* in this package. The CDP wrapper has a hard assertion that refuses to send `Runtime.enable`; tests verify it is never sent over the wire. Execution context tracking is done via `Page.frameAttached`/`Page.frameNavigated` + `uniqueContextId` resolution, never via `Runtime.executionContextCreated`.
- `Page.addScriptToEvaluateOnNewDocument` with `runImmediately: true` is the sole injection mechanism. We do *not* use `Page.createIsolatedWorld` — it's detectable.
- Worker contexts (dedicated, shared, service, audio worklet) are picked up via `Target.setAutoAttach({ autoAttach: true, waitForDebuggerOnStart: true, flatten: true })` and the same payload is delivered to each.

### 5.2 `@mochi.js/consistency`

**Responsibility.** The Matrix engine. Generates an immutable, relationally-locked fingerprint snapshot from `(profile, seed)`.

**Owns.**
- `deriveMatrix(profile: ProfileV1, seed: string): MatrixV1`
- The relational locking ruleset (e.g. `gpu.vendor → webgl.unmaskedVendor → canvas.text-baseline → audio.contextSampleRate`)
- Per-profile entropy budget (a profile declares which fields are *fixed* by the device and which carry per-seed jitter)
- Seeded PRNG (deterministic; xoshiro256** with seed = sha256(profile.id + seed))

**Does not own.**
- The profile data itself (→ `@mochi.js/profiles`)
- Injection mechanics (→ `@mochi.js/inject`)
- Validation that the matrix matches reality (→ `@mochi.js/harness`)

**Critical design choices.**
- The Matrix is a *plain JSON-serializable object* with no functions. It can be passed across the FFI boundary, dumped to disk, diffed, and JSON-Schema validated.
- Relational rules are encoded as `Rule[]` with `inputs: string[]` and `output: string` referencing dotted paths into the Matrix. The DAG must be acyclic; CI verifies.
- A `MatrixV1` round-trips losslessly through JSON.

### 5.3 `@mochi.js/inject`

**Responsibility.** The Zero-Jitter payload. The single JS bundle that runs in every execution context to install the spoof proxies before any page script.

**Owns.**
- `buildPayload(matrix: MatrixV1): { code: string; sha256: string }`
- The proxy library (Object.defineProperty wrappers, `Function.prototype.toString` rewriting, error stack scrubbing, native-fn cloaking)
- Per-API spoof modules: `navigator`, `screen`, `webgl`, `webgpu`, `canvas`, `audio`, `media-devices`, `fonts`, `timing`, `permissions`, `client-hints`, `webrtc`, `battery`, `bot-globals`, `iframe-side-channel`
- Build-time concatenation + minification (esbuild) into a single TurboFan-friendly bundle

**Does not own.**
- The matrix values (→ `@mochi.js/consistency`)
- The CDP `addScriptToEvaluateOnNewDocument` call (→ `@mochi.js/core`)

**Critical design choices.**
- The payload is *one IIFE* delivered as a single string. No imports at runtime.
- Every override uses `Object.defineProperty` with `configurable: false` (so page code can't unwrap us by re-defining) and `enumerable` matching the original descriptor.
- Every spoofed function's `.toString()` returns the `function ${name}() { [native code] }` shape. We track the original `Function.prototype.toString` reference and use it to forward unknown queries.
- We never throw synchronously when a fingerprint API is called in an unexpected way — we mimic Chrome's exact native error type.
- The payload self-deletes its own initialization globals (`delete window.__mochi__`) before yielding to page script.

### 5.4 `@mochi.js/net` + `@mochi.js/net-rs`

**Responsibility.** Out-of-band HTTP that matches the profile's wire fingerprint. The browser handles its own navigation/XHR/fetch using its native Chromium TLS — that already matches a Chrome profile. `@mochi.js/net` is for *additional* requests the user makes from Bun (pre-flight token fetches, captcha API calls, etc.) that need to share the browser's apparent identity.

**`@mochi.js/net` (TS facade).** Owns the `Session.fetch(url, init)` API surface. Validates inputs, routes to the FFI binding, deserializes responses to standard `Response` objects.

**`@mochi.js/net-rs` (Rust crate).** Owns the FFI surface. Wraps `wreq` (Apache-2.0/MIT) with profile-name presets (e.g. `chrome_131_macos`). Single static C ABI: `mochi_net_open`, `mochi_net_request`, `mochi_net_close`. Tokio runtime managed inside the crate; FFI calls are blocking from Bun's perspective (Bun's main thread is not blocked because Bun:FFI runs ABI calls on a worker).

**Does not own.**
- Spoofing the *browser's own* TLS (out of scope — that's the binary's responsibility, and stock Chromium produces correct Chrome TLS already)

**Critical design choices.**
- Prebuilt platform binaries: `darwin-arm64`, `darwin-x64`, `linux-x64`, `linux-arm64`, `windows-x64`. Distributed via npm postinstall fetching from GitHub Releases (esbuild-style).
- The Rust crate is pure Rust + `wreq`. No `bindgen`, no system-library deps. `cargo build --release` produces a single `cdylib`.
- Profile-to-wreq-preset mapping table is a JSON shipped in `@mochi.js/profiles`; `@mochi.js/net-rs` reads it via the FFI surface.
- Proxy support: HTTP/HTTPS CONNECT, SOCKS5 (with auth), inherited from `wreq`.

### 5.5 `@mochi.js/behavioral`

**Responsibility.** Synthesize human-shaped input event streams from biomechanical models, parameterized per profile.

**Owns.**
- `synthesizeMouseTrajectory(from, to, profile): TrajectoryEvent[]`
- `synthesizeKeystrokes(text, profile): KeystrokeEvent[]`
- `synthesizeScroll(target, profile): ScrollEvent[]`
- The Bezier path generator (cubic, with overshoot+correction)
- Fitts's Law duration model (`MT = a + b * log2(D/W + 1)`, parameterized per profile)
- Gaussian jitter (per-axis, with autocorrelation)
- Keystroke ngraph timing (digraph means ~80–150ms per profile, with per-letter variance)

**Does not own.**
- Dispatching events to CDP (→ `@mochi.js/core`)
- The profile data (→ `@mochi.js/profiles`)

**Critical design choices.**
- Outputs are pure data (`{ tMs, type, x, y, ... }[]`) — no side effects. `@mochi.js/core` consumes the array and dispatches via `Input.dispatchMouseEvent`/`Input.dispatchKeyEvent`.
- v1 is synthesis-only. The recording/playback API is v1.x; the contract leaves room for it (`humanClick` will accept a `trace?: RecordedTrace` parameter from v1.x onward without breaking).
- Profiles declare a `behavior` block: `{ hand: "right", tremor: 0.18, wpm: 65, scrollStyle: "smooth" }`. Defaults exist; users can override per-call.

### 5.6 `@mochi.js/profiles`

**Responsibility.** The data fixtures. Each profile is a directory under `packages/profiles/data/<profile-id>/` with three files:

```
<profile-id>/
├── profile.json         # ProfileV1 — the spec the consistency engine consumes
├── baseline.manifest.json  # ProbeManifestV1 captured from the real device
└── PROVENANCE.md        # Who captured, when, on what hardware, with what tool versions
```

**v1 catalog:**

| profile.id | Hardware | OS | Browser | Engine |
|---|---|---|---|---|
| `mac-m2-chrome-stable` | Mac M2 Air | macOS 14.x | Chrome stable | V8 (Chromium) |
| `mac-m1-chrome-stable` | Mac M1 | macOS 14.x | Chrome stable | V8 |
| `mac-intel-chrome-stable` | Mac Intel | macOS 13.x | Chrome stable | V8 |
| `win11-chrome-stable` | Win 11 x64 | 11 23H2 | Chrome stable | V8 |
| `win11-edge-stable` | Win 11 x64 | 11 23H2 | Edge stable | V8 (Chromium) |
| `linux-chrome-stable` | Generic x86_64 | Ubuntu 22.04 | Chrome stable | V8 |

**Shipping rule.** A profile cannot land in `main` without:
1. A `profile.json` validated against `schemas/profile.schema.json`.
2. A `baseline.manifest.json` captured by `mochi capture` on real hardware (provenance documented).
3. A `PROVENANCE.md` with: capturer, date, machine model + serial-suffix-only, browser version, mochi version, capture command.
4. Harness Zero-Diff against itself (the captured baseline replayed against the framework using the same profile must produce a manifest that diffs only on GUID-class fields).

### 5.7 `@mochi.js/harness`

**Responsibility.** Validation. Captures Probe Manifests from a Mochi-driven session, normalizes, diffs against committed baselines, classifies divergences, gates PRs.

**Owns.**
- `capture(session): Promise<ProbeManifestV1>` — drives a session through the standard probe page set
- `normalize(m: ProbeManifestV1): NormalizedManifest` — strips per-session entropy
- `diff(a: NormalizedManifest, b: NormalizedManifest): DiffEntry[]`
- `categorize(d: DiffEntry): "guid-class" | "intentional" | "material"` — mirrors Peekaboo's pattern
- `report(diff: DiffEntry[]): { verdict, structuralMatchPct, html, json }`

**Probe page set (v1).**
1. local fixture: `tests/fixtures/probe-page.html` — a deterministic synthesis of every probe in `chaser-recon/src/lib/fingerprint/*` (audio, canvas, webgl, webgpu, navigator, screen, fonts, storage, media, speech, timing, bot-detection)
2. `https://abrahamjuliot.github.io/creepjs/` (online; gated behind `--include-online`)
3. `https://bot.sannysoft.com/` (online; gated)
4. `https://browserleaks.com/` family (online; gated)
5. `https://kaliiiiiiiiii.github.io/brotector/` (online; gated)

The local fixture is the PR-fast gate. The online suite runs nightly.

**Verdict rule.** `EQUIVALENT (0 material diffs)` or `DIVERGED (N material, M intentional, K guid-class)`. PR gate fails iff `material > 0`. Categorization rules:
- **guid-class.** Both sides carry a per-session value (visitor IDs, install IDs, MUID-class GUIDs). Allowlisted by regex.
- **intentional.** Anything explicitly listed in `@mochi.js/profiles/<id>/expected-divergences.json` (e.g., probes that the profile explicitly cannot replicate from JS-only — the `docs/limits.md` set).
- **material.** Everything else. PR-blocking.

### 5.8 `@mochi.js/cli`

**Responsibility.** The `mochi` command-line. Provides:

- `mochi browsers install [--channel stable|beta] [--version X]` — fetches Chromium-for-Testing
- `mochi capture --profile <id> --out <dir>` — captures a baseline from the local device
- `mochi harness <profile> [--against <baseline>]` — runs the harness manually
- `mochi work create|list|open|submit|clean` — the worktree dev harness CLI (Section 15)
- `mochi version` — version info, including bundled Chromium version

### 5.9 No umbrella package — `@mochi.js/core` is the primary entry

mochi does not publish a top-level umbrella package. The bare `mochi` and the bare `@mochi` scope are both taken on npm by unrelated parties. We own the `@mochi.js` scope (with the dot — same shape as the precedented `@socket.io/*`), and every package in the catalog lives there. The public-facing entry point is **`@mochi.js/core`**. One coherent naming story, no umbrella to keep in sync.

```sh
bun add @mochi.js/core
```
```ts
import { mochi } from "@mochi.js/core";
const session = await mochi.launch({ profile, seed });
```

Power users can pull internal packages directly:

```sh
bun add @mochi.js/profiles @mochi.js/behavioral @mochi.js/harness
```

The brand name is **mochi** in all narrative contexts (headlines, prose, error messages, docs). The `.js` suffix appears only where it's a literal identifier — the npm scope `@mochi.js/*`. The GitHub repo (`github.com/0xchasercat/mochi`), the JS namespace in user code (`mochi.launch`), and every doc heading drop the suffix.

---

## 6. Data schemas

All schemas live in `schemas/*.schema.json` (JSON Schema 2020-12). TS types are *generated* from the schemas by `bun run codegen` — never written by hand. CI verifies that committed types match the schemas.

### 6.1 `ProfileV1`

```jsonc
{
  "id": "mac-m2-chrome-stable",
  "version": "1.0.0",
  "engine": "chromium",                // v1: always "chromium"
  "browser": { "name": "chrome", "channel": "stable", "minVersion": "131", "maxVersion": "133" },
  "os": { "name": "macos", "version": "14", "arch": "arm64" },
  "device": { "vendor": "apple", "model": "mac14,2", "cpuFamily": "apple-silicon-m2", "cores": 8, "memoryGB": 16 },
  "display": { "width": 2560, "height": 1664, "dpr": 2, "colorDepth": 30, "pixelDepth": 30 },
  "gpu": {
    "vendor": "Apple",
    "renderer": "Apple M2",
    "webglUnmaskedVendor": "Google Inc. (Apple)",
    "webglUnmaskedRenderer": "ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)",
    "webglMaxTextureSize": 16384,
    "webglMaxColorAttachments": 8,
    "webglExtensions": ["..."]
  },
  "audio": { "contextSampleRate": 44100, "audioWorkletLatency": 0.0058, "destinationMaxChannelCount": 2 },
  "fonts": { "family": "macos-system-arial-pack", "list": ["..."] },
  "timezone": "America/Los_Angeles",
  "locale": "en-US",
  "languages": ["en-US", "en"],
  "behavior": { "hand": "right", "tremor": 0.18, "wpm": 65, "scrollStyle": "smooth" },
  "wreqPreset": "chrome_131_macos",
  "userAgent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ...",
  "uaCh": { /* full client hints — sec-ch-ua, sec-ch-ua-platform, sec-ch-ua-platform-version, sec-ch-ua-arch, ... */ },
  "entropyBudget": {
    "fixed": ["gpu.*", "audio.contextSampleRate", "fonts.list", "display.dpr"],
    "perSeed": ["display.width", "display.height", "timezone", "languages[0]"]
  }
}
```

`entropyBudget.fixed` fields are constants for this profile across all seeds. `entropyBudget.perSeed` fields are deterministic-but-vary-per-seed within bounds the profile declares (e.g., `display.width` is one of `[2560, 1920, 1440]` chosen by `seed % 3`).

### 6.2 `MatrixV1`

The Matrix is a profile *instantiated for a specific seed*. Same shape as `ProfileV1` but with all `perSeed` fields resolved to concrete values. Adds:
- `seed: string` — the input seed
- `derivedAt: string` — ISO timestamp
- `consistencyEngineVersion: string`

### 6.3 `ProbeManifestV1`

Reuse [Peekaboo's schema](../Peekaboo/peekaboo/schemas/probe-manifest.schema.json) verbatim. Copy the file to `schemas/probe-manifest.schema.json` at v0.0 to vendor it; track upstream changes manually with a quarterly sync. (We don't take a git submodule on Peekaboo because Peekaboo is private and mochi is public.)

### 6.4 `DiffReportV1`

```jsonc
{
  "reportVersion": "1",
  "generatedAt": "...",
  "profile": "mac-m2-chrome-stable",
  "verdict": "EQUIVALENT" | "DIVERGED",
  "counts": { "material": 0, "intentional": 3, "guidClass": 14 },
  "structuralMatchPct": 99.4,
  "diffs": [ /* DiffEntry[] */ ]
}
```

---

## 7. Public API

The complete v1 surface. Every signature here is part of the contract; changes require a major version bump on `@mochi.js/core`.

```typescript
// @mochi.js/core (the primary public entry — no umbrella package)
// Users: import { mochi, type LaunchOptions } from "@mochi.js/core";
// Power users wanting types from internals: import type { ProfileV1, MatrixV1 } from "@mochi.js/consistency";

export const mochi: {
  launch(opts: LaunchOptions): Promise<Session>;
};

export interface LaunchOptions {
  profile: ProfileId | ProfileV1;        // string id (resolved against @mochi.js/profiles) or inline profile
  seed: string;                          // deterministic per-session entropy seed
  proxy?: string | ProxyConfig;
  headless?: boolean;                    // default: false
  binary?: string;                       // override Chromium path
  args?: string[];                       // additional Chromium flags
  out?: { traceDir?: string };           // optional CDP trace dump for debugging
  timeout?: number;                      // ms, default 30_000
}

export class Session {
  readonly profile: MatrixV1;            // resolved matrix for this session
  readonly seed: string;
  newPage(): Promise<Page>;
  pages(): Page[];
  cookies(filter?: { url?: string }): Promise<Cookie[]>;
  setCookies(cookies: Cookie[]): Promise<void>;
  storage(): Promise<StorageSnapshot>;
  fetch(url: string, init?: RequestInit): Promise<Response>;  // out-of-band, profile-fingerprinted
  close(): Promise<void>;
}

export class Page {
  readonly url: string;
  goto(url: string, opts?: { waitUntil?: "load" | "domcontentloaded" | "networkidle"; timeout?: number }): Promise<void>;
  content(): Promise<string>;
  text(selector: string): Promise<string | null>;
  evaluate<T>(fn: () => T): Promise<T>;  // runs in main world; isolation is implicit & invisible
  waitFor(selector: string, opts?: { timeout?: number; state?: "attached" | "visible" | "hidden" }): Promise<void>;

  humanClick(selector: string, opts?: { button?: "left" | "right" | "middle"; duration?: number }): Promise<void>;
  humanType(selector: string, text: string, opts?: { wpm?: number; mistakeRate?: number }): Promise<void>;
  humanScroll(opts: { to: string | { x: number; y: number }; duration?: number }): Promise<void>;

  cookies(): Promise<Cookie[]>;
  screenshot(opts?: { fullPage?: boolean; path?: string }): Promise<Uint8Array>;
  close(): Promise<void>;
}
```

Design notes:
- `evaluate` runs in main world, but the spoof payload guarantees observed page-API state matches the spoof. There is no exposed isolated-world concept; that's an implementation detail.
- `humanClick` resolves the selector, computes a viewport-relative target box, picks a target point inside the box (Gaussian-distributed toward center), and drives the mouse from current cursor position to that point via the synthesized trajectory.
- `Session.fetch` is the *only* way to get profile-fingerprinted out-of-band requests. It returns a standard Web `Response` so users can `await res.json()` etc.
- No `Browser`/`BrowserContext`/`Page` triad. `Session` *is* the per-(profile,seed) lifecycle. Multiple `Session`s = multiple Chromium processes.

---

## 8. CDP engine design notes

The CDP engine is the most stealth-sensitive component. Get this wrong and nothing else matters.

### 8.1 Transport

- **Default = pipe mode** (`--remote-debugging-pipe`). Three FDs: stdin, stdout, and pipe FDs 3+4. mochi passes pipes to the child via `Bun.spawn({ stdio: [..., "pipe", "pipe"] })` and reads/writes newline-delimited JSON-RPC.
- **No TCP fallback in v1.** Remote-debugging-over-TCP creates a localhost listener that's discoverable by side-channel attacks (`chrome://inspect`, port scans, etc). v2 may add an opt-in `transport: "ws"` for cross-machine debugging.
- **No DevTools Protocol session sharing.** Each `Session` gets its own pipe. Two `Session`s never share a Chromium process.

### 8.2 What we do NOT send

This is a hard list. The CDP wrapper has runtime asserts that refuse these:
- `Runtime.enable` (any target). Detectable by `error.stack` lookup tricks. nodriver's whole insight.
- `Page.createIsolatedWorld`. Also detectable.
- `Runtime.evaluate` with `includeCommandLineAPI: true` (leaks `$x`, `$_`, etc.).
- `Network.enable` *globally* on the root target — only attached per-frame when needed for a specific operation, then disabled.

**Note on `Fetch.enable`** (task 0266): `Fetch.enable` is NOT on the
forbidden list. It operates at the network layer below page script — no
execution-context-creation events surface, no `chrome.devtools` global is
exposed, and JS cannot detect its presence directly. mochi sends it once
per session (gated only on `bypassInject`) so the §8.4 init-script
delivery pivot can intercept document responses for body splice + CSP
rewrite. The cost is one CDP RTT per Document request and a no-op
forward (`Fetch.continueRequest`) on every other request type.

### 8.3 How we get execution-context info without `Runtime.enable`

- Subscribe to `Page.frameAttached` and `Page.frameNavigated` to learn frame topology.
- Resolve frame → execution-context via `DOM.resolveNode({ backendNodeId: documentNode })` which returns a `RemoteObject` carrying a usable `objectId`. From `objectId` we can `Runtime.callFunctionOn` without ever calling `Runtime.enable`.
- For workers/service-workers/audio-worklets: `Target.setAutoAttach({ autoAttach: true, waitForDebuggerOnStart: true, flatten: true })`. Each new sub-target gets its own session. We do *not* aggregate worker contexts under the page session.

### 8.4 Payload injection

**Amended by task 0266** — the inject delivery mechanism has been rotated
from `Page.addScriptToEvaluateOnNewDocument` to a `Fetch.fulfillRequest`
body splice + CSP rewriter, mirroring patchright's
`crNetworkManagerPatch.ts:166-453` (`RouteImpl._fixCSP`,
`_injectIntoHead`, `fulfill`).

#### Mechanism (current)

- One `Fetch.enable` per session (gated only on `bypassInject` — capture
  flows skip), with patterns
  `[{ urlPattern: "*", resourceType: "Document" }, { urlPattern: "*" }]`
  and `handleAuthRequests: true` when proxy creds are configured.
- On `Fetch.requestPaused` for a `Document`:
  1. Request stage → `Fetch.continueRequest` with
     `interceptResponse: true` (so we get the response too).
  2. Response stage → `Fetch.getResponseBody`, rewrite CSP in BOTH
     response headers (`Content-Security-Policy`,
     `Content-Security-Policy-Report-Only`) AND inline
     `<meta http-equiv="Content-Security-Policy">` tags, splice the
     payload as `<script class="__mochi_init_script__" id="…">…</script>`
     at end-of-`<head>` BEFORE the first non-comment `<script>`,
     `Fetch.fulfillRequest` with the rewritten body.
- On `Fetch.requestPaused` for non-Document → `Fetch.continueRequest`
  immediately (zero-cost pass-through; the request hangs if we don't
  reply).
- The injected `<script>` carries NO `defer`, `async`, or
  `type="module"` — those defer execution past first parse and
  re-introduce the race window the original `runImmediately:true` was
  designed to close.
- The payload IIFE's first statement is
  `document.currentScript?.remove()`; a post-`load` DOM walk strips any
  leftover `.__mochi_init_script__` nodes (defence in depth).
- See `packages/core/src/cdp/init-injector.ts` for the implementation.

#### CSP rewriter contract

| Input policy                                         | Action                                                         |
| ---------------------------------------------------- | -------------------------------------------------------------- |
| `script-src 'self'`                                  | Append `'unsafe-inline'`                                       |
| `script-src 'nonce-XYZ'`                             | Reuse `XYZ` as the injected tag's `nonce` attribute            |
| `script-src 'strict-dynamic' 'nonce-XYZ'`            | Reuse `XYZ`; `'strict-dynamic'` admits transitive scripts      |
| `script-src 'strict-dynamic'` (no nonce — invalid)   | Fall through to `'unsafe-inline'` (best-effort)                |
| `default-src 'self'` (no script-src)                 | Append `'unsafe-inline'` to `default-src`                      |
| `<meta http-equiv="Content-Security-Policy" content="…">` | Same rules; rewrite the `content` attribute in-place      |
| Multiple CSPs (header + meta)                        | Most-restrictive wins; rewrite EVERY policy independently      |

#### Rationale

`Page.addScriptToEvaluateOnNewDocument` carries a source-attribution
leak — the "Vanilla CDP" detection probe inspects how the very first
script entered the page and recognises the
`addScriptToEvaluateOnNewDocument` channel. The new mechanism is
byte-indistinguishable from a same-origin developer's own `<script>`
tag at the top of `<head>`.

#### Trade-offs

- `Fetch.enable` becomes always-on (gated only on `bypassInject`).
  Cost: one CDP RTT per Document request for the body fetch +
  fulfillment, one no-op forward per non-Document request. Both are
  bounded and only active when inject delivery is active.
- The patchright README admits the new path is detectable by *timing*
  attacks (the body splice introduces a measurable latency on the
  document request). No production antibot exploits this today — the
  trade is favourable. This is documented under `docs/limits.md`.
- `data:` and `about:blank` URLs are NOT intercepted by the Fetch
  domain; inject delivery on those URLs is intentionally a no-op (out
  of scope, behaviour preserved from the §8.4 baseline).

#### Workers (unchanged from previous §8.4)

For workers we set up an `AddScriptToEvaluateOnNewDocument`-equivalent
using `Target.setAutoAttach` + on-attach `Runtime.evaluate` (the worker
target accepts evaluate; the main page target does not have
`Runtime.enable` issued). The idOnly bootstrap (task 0254) refines the
pattern to `Runtime.evaluate("globalThis", { serialization: "idOnly" })`
+ `Runtime.callFunctionOn` against the parsed contextId.

### 8.5 Process management

- Chromium spawned with a fresh, ephemeral user-data-dir (`mkdtemp("mochi-")`).
- Hard kill on `Session.close`: SIGTERM, then SIGKILL after 2s grace, then `rm -rf` the user-data-dir.
- Crash recovery: if the child exits unexpectedly, all open `Page`s reject pending promises with a `BrowserCrashedError`. Sessions do not auto-restart.

### 8.6 Flags we always pass

Two-tier flag set as of task 0256 (audit against patchright
`chromiumSwitchesPatch.ts:20-34` + `puppeteer-real-browser`
`lib/cjs/index.js:57-58`):

#### Production default — `LaunchOptions.hermetic: false` (default)

```
--remote-debugging-pipe
--user-data-dir=<tmpdir>
--no-default-browser-check
--no-first-run
--no-service-autorun
--password-store=basic
--use-mock-keychain
--disable-features=Translate,AcceptCHFrame,IsolateOrigins,site-per-process
--enable-features=NetworkService,NetworkServiceInProcess
```

Plus `--headless=new` (when `headless: true`), `--proxy-server=<…>` (when
`proxy` is set), `--lang=<…>` (matrix locale; task 0251),
`--window-size=<W>,<H>` (matrix display; task 0252). User-supplied
`LaunchOptions.args` and the `MOCHI_EXTRA_ARGS` env passthrough append last
(after `--start-maximized` is scrubbed per task 0252).

#### Hermetic addendum — `LaunchOptions.hermetic: true`

The harness, CI, and `mochi capture` flows append these on top of the
production set:

```
--disable-default-apps
--disable-component-update
--disable-background-networking
--disable-sync
--disable-features=OptimizationHints,MediaRouter,InterestFeedContentSuggestions,CalculateNativeWinOcclusion
```

Chromium merges multiple `--disable-features=` tokens into a union, so the
final hermetic disabled set is `{Translate, AcceptCHFrame, IsolateOrigins,
site-per-process, OptimizationHints, MediaRouter,
InterestFeedContentSuggestions, CalculateNativeWinOcclusion}`.

#### Decision lineage (task 0256 audit)

| Flag                                      | Production | Hermetic | Why                                                                           |
| ----------------------------------------- | ---------- | -------- | ----------------------------------------------------------------------------- |
| `--remote-debugging-pipe`                 | ✅         | ✅       | §8.2 pipe-mode CDP transport — non-negotiable.                                 |
| `--no-default-browser-check`              | ✅         | ✅       | Suppresses "set as default" nag; not a tell (Playwright keeps it).             |
| `--no-first-run`                          | ✅         | ✅       | Suppresses welcome screen in headed mode.                                      |
| `--no-service-autorun`                    | ✅         | ✅       | Suppresses Win bg services; not a tell.                                        |
| `--password-store=basic`                  | ✅         | ✅       | Prevents Linux keyring popup; matches stable Chrome behaviour.                 |
| `--use-mock-keychain`                     | ✅         | ✅       | macOS keychain stub; not a tell.                                               |
| `--disable-features=Translate,AcceptCHFrame,IsolateOrigins,site-per-process` | ✅ | ✅ | Load-bearing: `IsolateOrigins,site-per-process` keeps OOPIF frames in-process for inject reach; `AcceptCHFrame` keeps UA-CH off the frame-negotiation path so our `Sec-CH-UA` (R-007) is the single source of truth; `Translate` suppresses the headed translate prompt. |
| `--enable-features=NetworkService,NetworkServiceInProcess` | ✅ | ✅ | Keeps NetworkService in the renderer process so CDP `Network.*` / `Fetch.*` can intercept everything. |
| `--disable-default-apps`                  | ❌         | ✅       | **Patchright drops** as cmdline tell. Production gets normal default-apps behaviour; hermetic suppresses. |
| `--disable-component-update`              | ❌         | ✅       | **Patchright drops; PRB drops.** Cmdline tell. Hermetic suppresses for harness determinism. |
| `--disable-background-networking`         | ❌         | ✅       | **Patchright drops.** Updater traffic suppressor; production users want normal-looking traffic. |
| `--disable-sync`                          | ❌         | ✅       | **Patchright drops.** Cmdline tell; harmless to leave on for production (Chromium-for-Testing has no Google account). |
| `--disable-features=OptimizationHints,MediaRouter,InterestFeedContentSuggestions,CalculateNativeWinOcclusion` | ❌ | ✅ | Network/noise suppression for hermetic determinism only; production users want the natural network surface. |

**Explicit non-defaults (per audit):**
- `--no-sandbox`: real-user fingerprint leak. CI uses `MOCHI_EXTRA_ARGS=--no-sandbox` env passthrough only.
- `--disable-blink-features=AutomationControlled`: patchright adds this back to its flag set; mochi rejects — we patch `navigator.webdriver` from JS via R-022. Adds a flag-level tell at `chrome://version` for marginal benefit.
- `--enable-unsafe-swiftshader`: NOT emitted (verified). Patchright strips Playwright's headless SwiftShader fallback that produces a distinct GL fingerprint; mochi never had it.
- `--start-maximized`: actively scrubbed from `LaunchOptions.args` and `MOCHI_EXTRA_ARGS` (task 0252).
- Legacy `--headless` (without `=new`): NOT emitted (verified). The `=new` form is critical — sannysoft trivially detects legacy headless.

---

## 9. Consistency engine design notes

### 9.1 The Matrix concept

A `ProfileV1` declares the *capabilities* of a device class; a `MatrixV1` is the concrete instantiation for one `(profile, seed)` pair. The Matrix is what the injector consumes. Two distinct seeds produce two distinct Matrices, but each Matrix is internally fully consistent.

### 9.2 The relational locking ruleset

Encoded as a DAG of rules. Each rule reads inputs and produces a deterministic output. The DAG must be acyclic (CI-checked).

Examples:
- `R-001` `[gpu.vendor, gpu.renderer]` → `webgl.unmaskedVendor`
- `R-002` `[gpu.vendor, gpu.renderer]` → `webgl.unmaskedRenderer`
- `R-003` `[gpu.renderer]` → `canvas.font-rendering-baseline-hash` (lookup table)
- `R-004` `[device.cpuFamily]` → `audio.contextSampleRate`
- `R-005` `[device.cpuFamily, audio.contextSampleRate]` → `audio.fingerprint-bytes` (precomputed)
- `R-006` `[os.name, browser.name]` → `userAgent` (plus seed-driven build number variance)
- `R-007` `[os.name, browser.name, browser.version]` → `uaCh.sec-ch-ua`
- `R-008` `[device.memoryGB]` → `navigator.deviceMemory` (cap at 8 per chaser-browser observation; 8GB is the max value Chrome reports)
- `R-009` `[device.cores]` → `navigator.hardwareConcurrency`
- `R-010` `[os.name]` → `fonts.list` (curated from real captures)
- ... (full ruleset checked into `packages/consistency/rules/*.ts`, ~80 rules at v1.0)

### 9.3 Audio consistency

Audio fingerprinting (OfflineAudioContext rendering output) is one of the trickiest areas. The fingerprint is a sequence of float samples produced by hardware-specific FFT/IIR processing. We cannot compute these from primitives — we consume per-profile captures from `packages/profiles/data/<id>/baseline.manifest.json`'s `audio` block (the `audioHash` + `sampleValues` window the v0.7 probe corpus measures).

The lock chain is implemented as **R-047** (`audioFingerprint`): inputs `(id, audio.contextSampleRate)`, output `uaCh.audio-fingerprint` JSON `{ sampleRate, audioHash, sampleValues[10] }`. The lookup table lives in `packages/consistency/src/rules/lookups/audio-canvas.ts`.

The inject module `packages/inject/src/modules/audio-fingerprint.ts` patches `OfflineAudioContext.prototype.startRendering`. The wrapper runs the underlying call (preserving real-startRendering timing — synthetic 0ms is a tell), then **overlays** the captured `sampleValues` onto channel 0 at indices [4500..4510) and balances the remaining [4510..4999) range so `sum |data[i]|` over [4500..5000) equals the captured `audioHash` byte-exactly. Indices outside the [4500..5000) probe window stay native-rendered.

Caveat: a fingerprinter that samples *outside* this window sees real CfT-rendered audio (mismatch vs the device baseline). No public probe in the v0.7 corpus does this; v0.8 may extend the captured window if the corpus changes. Documented as a known divergence in `docs/limits.md`. Task 0267.

### 9.4 Canvas consistency

Canvas text rendering produces hashes that depend on font rendering pipeline + GPU + OS subpixel hinting. The captured baselines record only the probe-side observables — `hash` (the probe's `hashString` of the full data URL), `dataUrlLength`, `dataUrlPrefix` (first 50 chars), and JPEG/WebP length echoes. We don't have the full PNG bytes; the inject layer **synthesises** a data URL whose probe-side observable triple matches byte-exactly.

The lock chain is implemented as **R-048** (`canvasFingerprint`): input `(id,)`, output `uaCh.canvas-fingerprint` JSON `{ consistent, hash, dataUrlLength, dataUrlPrefix, webpSupport, jpegHighLength, jpegLowLength }`. Same lookup table as R-047.

The inject module `packages/inject/src/modules/canvas-fingerprint.ts` patches `HTMLCanvasElement.prototype.toDataURL`, `OffscreenCanvas.prototype.convertToBlob`, and the 2D context's draw methods (to flag "this canvas had drawing"). The data URL synthesis uses **meet-in-the-middle search** over the trailing 8 base64 characters: build a body of length `targetLen - 8`, compute its hash, then iterate (c0..c3) and look up the residual in a precomputed map of all 4-char tail contributions. Build cost is one-time ~150ms per profile.

The "is this a fingerprint probe?" heuristic gates the spoof on three conditions:

  1. Canvas size matches a known probe size: 300×150 (chaser-recon, creepjs, fingerprintjs default), 240×140 (bot.incolumitas), 200×60 (Akamai bot-mgmt), 280×60 (Cloudflare challenge).
  2. The canvas has recorded drawing commands (a 2D-context method-tap WeakMap).
  3. At least one text draw (`fillText` / `strokeText`) has happened.

When all three pass, `toDataURL` returns the synthetic data URL. When any fails, the call falls through to native rendering — so legitimate canvas use (game framebuffers, image filters, signature pads) keeps working. Manual review of 1000 top-Alexa pages put the FP rate <1%; the 300×150 default size is the dominant source (legitimate text-on-default-canvas). Mitigation: those pages still see the captured-derived bytes (which look like real Chrome to fingerprinters); only the decoded *image* is broken, which matters only to the rare debug-overlay path. Task 0267.

WebGL pixel-byte replay is out of v0.2 scope — separate surface, R-001/R-002 already lock the WebGL renderer/vendor strings; pixel-byte replay is a deeper investigation tracked in v0.8+.

### 9.5 What we cover in v1

The 13 probe families from `chaser-recon/src/lib/fingerprint/*`:
- ✅ navigator (UA, plugins, permissions, client-hints, hardware info)
- ✅ screen (dims, DPR, CSS media queries, visual viewport)
- ✅ canvas (2D rendering hash via precomputed-table-or-noise hybrid)
- ✅ webgl + webgpu (parameters, render hash, shader precision)
- ✅ audio (OfflineAudioContext output via precomputed bytes)
- ✅ media-devices (enumerate with persistent IDs)
- ✅ speech-synthesis (voice list per OS profile)
- ✅ fonts (curated installed-font list per OS profile)
- ✅ storage (localStorage, sessionStorage, cookies, IndexedDB, service workers — passthrough; no spoofing needed)
- ✅ bot-detection (`navigator.webdriver`, automation key globals removed, plugin count consistent, etc.)
- ⚠️ timing (timezone, locale, performance-now precision — we *match* Chrome's natural behavior; we don't spoof against Chrome's true clock for same-engine v1)
- ✅ FPJS Pro (the public visitor-id outputs match the device baseline because the underlying probes match)

### 9.6 Cross-layer consistency: exit IP ↔ timezone ↔ locale (task 0262)

The `(matrix.timezone, matrix.locale)` axis is special: it's the only matrix-derived value whose canonical "consistent" value depends on a state OUTSIDE the matrix itself — namely, the **apparent exit IP** as seen by any server the session contacts. A US-West profile (matrix.timezone = `America/Los_Angeles`, matrix.locale = `en-US`) routed through an EU-egressing residential proxy puts every page call to `Date.getTimezoneOffset()` at -480min while the IP geolocates to UTC+1 — a direct mismatch fingerprint.

Mochi closes this leak at launch via a 7-endpoint geo-probe (`packages/core/src/geo-probe.ts`) routed through wreq with the matrix's TLS preset (so the probe is itself indistinguishable from real session traffic). The probe is shuffled-sequential with a 4-attempt cap and 2s per-endpoint timeout; on all-fail it returns `null`. A reconciler (`packages/core/src/geo-consistency.ts`) cross-references the matrix tz/locale against the probed IP geolocation, applying one of four `LaunchOptions.geoConsistency` modes:

- `"privacy-fallback"` *(default)* — override the matrix to UTC + en-US on mismatch (or probe failure). Fingerprints as a privacy-conscious user (Tor / Brave / hardened-FF), which is benign in most threat models. Mismatched-tz-vs-IP is the canonical bot signature; UTC + en-US looks like every Tor user.
- `"auto-correct"` — override the matrix's timezone with the IP's timezone and locale with a primary-locale guess for the IP's country. Trusts mochi's IP-derived defaults over the user's declared profile.
- `"strict"` — throw `GeoMismatchError` on mismatch. Probe failure does NOT throw (network blip, not a mismatch).
- `"off"` — skip the probe entirely. Used in offline tests / when the probe service is rate-limited.

Mismatch criteria use **timezone offset minutes** (computed via `Intl.DateTimeFormat({timeZoneName: "longOffset"}).formatToParts`), not zone names — `America/New_York` and `America/Detroit` share an offset and fingerprint identically. Locale region comes from `Intl.Locale(matrix.locale).region`.

The JS-side timezone spoof is delivered per-target via CDP `Emulation.setTimezoneOverride`, which drives both `Intl.DateTimeFormat().resolvedOptions().timeZone` AND `Date.getTimezoneOffset()` because Chromium's V8 reads from the same internal source. The override does NOT require `Emulation.enable`, so §8.2's bans are unaffected. Mochi NEVER manually rewrites `Date.prototype.getTimezoneOffset` — that's detectable via prototype-shape checks.

Probe results are NOT cached across sessions — proxy IPs rotate; stale cache is worse than no cache.

### 9.7 What we don't cover (documented in `docs/limits.md`)

- WebRTC IP leak (depends on system network config; v1 tells users to use a proxy that handles this themselves)
- Battery API removed in modern Chrome (no spoofing needed)
- Trust Tokens / Topics / FedCM (v1: passthrough, document as known surface)
- Sensor APIs (`DeviceOrientation`, etc.) on desktop profiles — not exposed by Chrome on desktop, no need to spoof

---

## 10. Network FFI design notes

### 10.1 The C ABI

```c
// Stable across mochi versions. Breaking changes bump @mochi.js/net-rs major.

typedef struct mochi_net_ctx mochi_net_ctx;
typedef struct mochi_net_response mochi_net_response;

mochi_net_ctx* mochi_net_open(const char* preset_json);
int             mochi_net_request(
                  mochi_net_ctx* ctx,
                  const char* request_json,
                  mochi_net_response** out);
int             mochi_net_response_status(mochi_net_response* res);
const char*     mochi_net_response_headers_json(mochi_net_response* res);
const uint8_t*  mochi_net_response_body(mochi_net_response* res, size_t* out_len);
void            mochi_net_response_free(mochi_net_response* res);
void            mochi_net_close(mochi_net_ctx* ctx);
const char*     mochi_net_last_error(void);
```

### 10.2 Bun:FFI binding

```typescript
// @mochi.js/net/src/ffi.ts (sketch)
import { dlopen, FFIType, suffix } from "bun:ffi";

const lib = dlopen(`${__dirname}/../native/mochi-net.${suffix}`, {
  mochi_net_open:        { args: ["cstring"], returns: "ptr" },
  mochi_net_request:     { args: ["ptr", "cstring", "ptr"], returns: "i32" },
  // ... etc
});
```

### 10.3 Profile preset mapping

`@mochi.js/profiles/<id>/profile.json#wreqPreset` is one of the values `wreq` accepts (e.g. `chrome_131_macos`, `edge_120_windows`). The Rust crate translates that to `wreq::Impersonate`.

### 10.4 What we don't try to do

- We do NOT MITM the browser's own connections. Browsing traffic uses Chromium's native TLS, which already produces correct Chrome JA3/JA4. Trying to replace it would require either patching Chromium (forbidden by I-1) or running a local proxy that becomes its own leak vector.
- We do NOT implement a separate `wreq`-driven page navigator. The browser is the browser.

---

## 11. Behavioral engine design notes

### 11.1 Mouse trajectory model

Cubic Bezier with 4 control points:
- P0 = current cursor position
- P3 = target point (sampled inside target box, Gaussian toward center)
- P1, P2 = control points placed off-axis, magnitude ~ 0.3–0.5 of Euclidean distance, perpendicular offset from straight line scaled by `tremor`

Sample N points along the curve where N = `ceil(MT * 60)` (60 events/sec at 60fps). Each point is jittered by Gaussian(σ = `tremor * pixelSize`) per axis, autocorrelated with τ ≈ 30ms.

Movement duration `MT = a + b * log2(D/W + 1)` (Fitts) where:
- `D` = Euclidean pixel distance
- `W` = target box minimum dimension
- `a = 200` ms (per-profile reaction time)
- `b = 90` ms/bit (per-profile motor speed)

Add a 5–15% chance of overshoot+correction past the target by `1.05–1.15 * D`, then a corrective sub-curve back to the actual target.

### 11.2 Keystroke timing

Per-letter press duration = Gaussian(80, 25) ms. Inter-key delay model:
- Same-hand digraphs: lognormal(μ=4.7, σ=0.35) ≈ 80–250ms
- Cross-hand digraphs: lognormal(μ=4.4, σ=0.30) ≈ 60–180ms
- After space: lognormal(μ=4.9, σ=0.40) ≈ 100–300ms
- After punctuation: 1.3× same-hand delay
- Mistakes: rate = `mistakeRate` (default 0.02). On mistake: type wrong key, delay 200–500ms, backspace, delay 100–300ms, type correct key.

### 11.3 Scroll model

Inertial scroll: initial velocity from a "flick" (target distance / 0.5s), friction-decayed exponentially with τ ≈ 350ms. Per-frame `Input.dispatchMouseEvent` of type `mouseWheel` with `deltaY` matching the curve, capped at 100px/frame (browsers throttle higher rates).

### 11.4 What we don't do in v1

- Real-trace recording/replay (v1.x)
- Per-profile mouse acceleration curves (v1.x)
- Touch gesture synthesis (v2 — mobile profiles)
- Eye-tracking-coupled mouse models (v2+)

---

## 12. Profile schema and capture protocol

### 12.1 `mochi capture`

```sh
$ mochi capture --profile-id mac-m2-chrome-stable --browser /Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --out packages/profiles/data/mac-m2-chrome-stable
```

Steps:
1. Spawn the user-supplied browser (NOT through mochi launch — must capture *unmodified* baseline) with a clean user-data-dir.
2. Drive it to the local probe-page fixture.
3. Capture the Probe Manifest using a CDP attach.
4. Extract device-class facts (OS, browser version, GPU strings, audio sample rate, fonts list, etc.) into `profile.json`.
5. Capture audio fingerprint bytes for each known sampleRate-of-interest into `audio/*.bin`.
6. Capture canvas fingerprint maps for each known test payload into `canvas/*.json`.
7. Write `PROVENANCE.md` from interactive prompts (capturer, machine model, etc.).

### 12.2 Provenance discipline

Every profile in `main` was captured by a known person on a known machine on a known date. The PROVENANCE.md is verified at PR time by a maintainer; CI cannot verify provenance.

If a profile baseline degrades over time (Chrome ships new minor versions, fonts update, etc.), the profile is *re-captured* and bumped (e.g., `mac-m2-chrome-stable` v1.0.0 → v1.1.0). Old versions remain in the catalog with `deprecated: true` for one release window.

### 12.3 Profile compatibility

A `ProfileV1.browser.minVersion` and `maxVersion` declare which Chromium-for-Testing versions the profile is verified against. `mochi.launch` checks the binary version against this range and emits a warning if outside (errors only with `strict: true`).

---

## 13. Validation harness specification

### 13.1 Probe pages

| Page | Source | When |
|---|---|---|
| `tests/fixtures/probe-page.html` | local, vendored from chaser-recon's probes | every PR |
| creep.js | online | nightly |
| sannysoft | online | nightly |
| browserleaks/* | online | nightly |
| brotector | online | nightly |
| FingerprintJS demo | online | nightly |

### 13.2 Capture pipeline

```
mochi.launch → drive to probe page → wait for probes settled →
  CDP DOM scrape + Page.captureScreenshot + Network.getResponseBody for telemetry endpoints →
  build ProbeManifestV1 → write manifest.json
```

### 13.3 Diff pipeline

Mirror Peekaboo's `recon/equivalence/`:
- Normalize: strip GUIDs (visitor IDs, install IDs, MUID-class), CSP nonces, timestamps, bundle URLs, hostnames.
- Diff: structural deep-equality with path-based output.
- Categorize: each diff entry → guid-class | intentional | material.
- Report: HTML + JSON; gate on `material > 0`.

### 13.4 Per-profile expected divergences

`packages/profiles/data/<id>/expected-divergences.json` lists the *known* JS-only-uncoverable divergences for that profile (e.g., `["webrtc.localIp"]`). Anything in this list is categorized as `intentional`. Adding to this list requires a corresponding line in `docs/limits.md`.

### 13.5 PR-fast vs nightly

- **PR-fast (~10s):** runs `tests/fixtures/probe-page.html` for the *changed* profiles only (detected via path-based diff in CI).
- **Nightly (~10min):** runs all profiles against the full online suite. Failures open issues automatically.

### 13.6 The "Zero-Diff" definition

A profile is **Zero-Diff certified** when:
1. PR-fast harness against `tests/fixtures/probe-page.html` produces 0 material diffs.
2. Nightly harness against creepjs + sannysoft + browserleaks-canvas + browserleaks-webgl + browserleaks-fonts + brotector produces 0 material diffs (intentional + guid-class only).

The profile cannot be marked `production: true` in the catalog without Zero-Diff certification.

---

## 14. Implementation phases

Each phase is a meaningful milestone — works end-to-end at the level of the surface it covers. Phases gate on the harness running at the level it's been built up to.

| # | Phase | Deliverable | Gate |
|---|---|---|---|
| **0.0** | Foundation | Repo skeleton, Bun workspace, biome, tsconfig base, CI green on empty, contributor docs, PR template, conventional commits enforced. | CI passes on empty PRs |
| **0.1** | CDP transport | `@mochi.js/core` can launch Chromium-for-Testing via pipe FDs, send/receive CDP messages, navigate to a URL, dump the page HTML, close cleanly. **No spoofing yet.** | Unit tests on the transport; integration test that launches Chrome and reads `document.title` |
| **0.2** | Consistency engine v0 | `@mochi.js/consistency` implements ~30 of the 80 rules (navigator, screen, simple GPU strings). `MatrixV1` round-trips JSON cleanly. Schema validated. | CI: schema validation, rule DAG acyclicity, golden-file tests for matrix derivation |
| **0.3** | Inject engine v0 | `@mochi.js/inject` builds a payload that overrides the v0.2 surface. `@mochi.js/core` injects via `addScriptToEvaluateOnNewDocument(runImmediately:true)`. | Manual probe-page check shows spoofed values; no `Runtime.enable` ever sent |
| **0.4** | Capture tool | `mochi capture` works on a real Mac M2. `mac-m2-chrome-stable` profile + baseline manifest committed. | One real profile lives in repo, schema-valid, with PROVENANCE |
| **0.5** | Harness MVP | `@mochi.js/harness` runs against the local probe-page fixture, normalizes + diffs + categorizes + reports. PR gate wired in CI. | First "Zero-Diff" run on `mac-m2-chrome-stable` for the v0.2-covered surface |
| **0.6** | Network FFI | `@mochi.js/net-rs` builds a cdylib for darwin-arm64, exposes the C ABI, wraps `wreq`. `@mochi.js/net` Bun:FFI binding works. `Session.fetch` succeeds with profile-fingerprinted JA4. | Integration test against `https://tls.peet.ws/api/all` returns matching JA4 hash |
| **0.7** | Consistency engine full | All 80+ rules implemented. WebGL, WebGPU, canvas, audio, media-devices, speech-synthesis, fonts. Audio bytes + canvas hash maps in profiles. | Full Zero-Diff against local probe-page on `mac-m2-chrome-stable` |
| **0.8** | Behavioral engine | `@mochi.js/behavioral` synthesizes mouse/keyboard/scroll. `humanClick`, `humanType`, `humanScroll` work end-to-end. | Visual demo + a behavioral-tracker probe (chaser-recon's) sees human-shaped events |
| **0.9** | Profile catalog complete | All 6 v1 profiles captured + Zero-Diff against local fixture + nightly Zero-Diff against creepjs/sannysoft. | All 6 profiles certified |
| **0.10** | Cross-platform binaries | `@mochi.js/net-rs` prebuilds for `darwin-arm64`, `darwin-x64`, `linux-x64`, `linux-arm64`, `windows-x64`. npm postinstall fetches correct binary from GH Releases. | Install on each platform succeeds, `Session.fetch` works |
| **0.11** | CLI + DX | `mochi` CLI feature-complete: `browsers install`, `capture`, `harness`, `work`, `version`. Quickstart docs. | Quickstart doc takes a new user from `bun add @mochi.js/core` to a successful spoofed page in under 5 minutes |
| **0.12** | Examples | `examples/` directory with: basic-launch, login-flow, scrape-with-rotation, cloudflare-turnstile-page (read-only — we don't ship a solver), captcha-detection-not-bypass | All examples build + run as integration tests |
| **0.13** | Docs site | `docs/` site (mintlify or astro-starlight). API ref auto-generated from TS. Limits page complete. | Public-readable, navigable, accurate against current main |
| **1.0** | Public release | All packages green. All profiles Zero-Diff. Docs published. npm packages published. v1.0.0 tag. | The vision delivered |

Phases 0.0–0.5 are sequential. 0.6 + 0.7 can run in parallel after 0.5. 0.8 can start once 0.3 lands. 0.9–0.13 are extension layers that can run partly in parallel.

---

## 15. Open questions deferred to v2

These are real open questions that we're consciously NOT answering in v1. Each has a v2-tracking note in `docs/v2-deferrals.md` to revisit post-1.0.

1. **Cross-engine spoofing.** Spoofing Safari (JavaScriptCore) or Firefox (SpiderMonkey) from a Chromium binary. v1 same-engine-family is realistic; cross-engine has fundamental FPU/JIT/regex divergence that can't be hidden from a determined probe without a Chromium fork. v2: surface-level only, with documented caveats. v2.x: investigate WebAssembly-based JIT-spoofing for Math.fround / regex output.
2. **Mobile profiles.** Chrome-Android and Safari-iOS profiles. Touch event synthesis. Different default flag set. Different probe surface (sensors, orientation, vibration). v2.
3. **HTTP/3 / QUIC fingerprint.** `wreq` supports it; profiles need to declare H3 expectations. v2.
4. **Captcha solvers.** Turnstile auto-click, hCaptcha solver, reCAPTCHA solver. Out of v1 scope on principle: solvers are a separate concern from a consistency framework, and bundling them blurs the value prop. Likely a separate `@mochi-extras/turnstile` package post-1.0.
5. **Real-trace recording for behavioral.** v1.x deliverable. The contract is reserved (`humanClick`'s `trace?` parameter) but the implementation is post-1.0.
6. **Remote debugging across machines.** Pipe-mode is local-only by definition. v2 may add an opt-in WebSocket transport for headless server scenarios; the leak surface needs careful design.
7. **Multi-session sharing of one Chromium process.** Currently one Session = one Chromium. If we want session pooling (open 100 sessions cheaply), we need to think hard about isolation across sessions in one process. v2.
8. **DevTools UI compatibility.** Right now mochi-driven sessions can't be inspected by chrome://inspect (pipe mode + no listening port). v2 may add an opt-in inspector-attach mode for development.
9. **Profile bisection.** When a Chrome update breaks a profile baseline, it would be nice to bisect which Chrome change. v2 tooling.

---

## 16. Glossary

- **Probe Manifest** — Peekaboo's canonical JSON schema describing a page's full capture surface. mochi vendors it.
- **Matrix** — a `ProfileV1` instantiated for a specific seed; the relationally-locked fingerprint snapshot consumed by the injector.
- **Profile** — a `ProfileV1` JSON document describing a device class. Lives in `@mochi.js/profiles/data/<id>/`.
- **Seed** — a string passed by the user to `mochi.launch`; determines per-session entropy within the profile's budget.
- **Zero-Diff** — the harness verdict where a captured manifest from a Mochi-driven session diffs against the baseline only on GUID-class fields.
- **Material diff** — a non-allowlisted, non-intentional divergence between Mochi-driven manifest and baseline. PR-blocking.
- **Intentional divergence** — a known-and-documented divergence (e.g., a probe we explicitly cannot replicate from JS-only). Listed in `expected-divergences.json`.
- **GUID-class** — per-session randomness (visitor IDs, install IDs, MUID-class IDs). Allowlisted.
- **Pipe mode** — `--remote-debugging-pipe`. CDP over file descriptors instead of TCP/WebSocket.
- **Worldname `""`** — the empty string as `worldName` parameter to `Page.addScriptToEvaluateOnNewDocument`, meaning "main world." Critical because any non-empty value creates a detectable isolated world.
- **runImmediately** — boolean flag on `addScriptToEvaluateOnNewDocument`. When `true`, the script runs *before* any other page script in every new document. Mandatory for stealth.
- **Out-of-band fetch** — `Session.fetch`. Profile-fingerprinted HTTP request issued from Bun (not from the browser). Uses `@mochi.js/net-rs` + `wreq`.
- **Funnel** — the implicit pattern where users hitting mochi's JS-only ceiling go find their own next step. mochi does not steer them.

---

*End of master plan. If you've made it this far, you have the full mental model. Now go ship.*
