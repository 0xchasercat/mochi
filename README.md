<p align="center">
  <img src="assets/mochi-banner.png" alt="mochi.js" width="800" />
</p>

<p align="center">
  <strong>One coherent stack for stealth browser automation — relational fingerprint locking, JIT-installed spoofing, behavioral playback, and JA4-impersonating out-of-band HTTP.</strong>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@mochi.js/core"><img src="https://img.shields.io/npm/v/@mochi.js/core.svg?label=%40mochi.js%2Fcore&color=c5791a" alt="npm version"></a>
  <a href="LICENSE"><img src="https://img.shields.io/npm/l/@mochi.js/core.svg?color=3f9d6b" alt="license: MIT"></a>
  <a href="https://github.com/0xchasercat/mochi/actions/workflows/pr-fast.yml"><img src="https://github.com/0xchasercat/mochi/actions/workflows/pr-fast.yml/badge.svg?branch=main" alt="CI status"></a>
  <a href="https://github.com/0xchasercat/mochi/stargazers"><img src="https://img.shields.io/github/stars/0xchasercat/mochi.svg?style=flat&color=1b2447" alt="GitHub stars"></a>
  <a href="https://bun.sh"><img src="https://img.shields.io/badge/runtime-bun%20%E2%89%A5%201.1-fbf0b2" alt="bun >= 1.1"></a>
</p>

---

## The 30-second pitch

**Why the current stack fails.** [patchright](https://github.com/Kaliiiiiiiiii-Vinyzu/patchright), [puppeteer-real-browser](https://github.com/zfcsoftware/puppeteer-real-browser), [nodriver](https://github.com/ultrafunkamsterdam/nodriver), and [undetected-chromedriver](https://github.com/ultrafunkamsterdam/undetected-chromedriver) all randomize fingerprint surfaces independently — pick a UA, pick a `hardwareConcurrency`, pick a WebGL renderer, hope nothing cross-references. A single probe that compares two surfaces breaks the spoof. They also run HTTP fetches out-of-band through the runtime's stock TLS stack, so JA4 reveals the spoofed Chrome is not a Chrome. They synthesize at most a mouse helper, not a biomechanical model. And they're patches against a moving Chromium target, not a coherent design.

**What mochi does differently.** Every fingerprint surface derives from one `(profile, seed)` pair through a 40-rule deterministic DAG — a Mac UA never lands next to Linux WebGL. Out-of-band HTTP routes through Bun:FFI to Rust [`wreq`](https://github.com/0x676e67/wreq), so JA4/JA3/H2 match the spoofed Chrome byte-for-byte. `humanClick`/`humanType`/`humanScroll` are full Bezier+Fitts+lognormal-digraph models, parameterized off the matrix's `behavior` block. One library owns the whole pipeline.

| | mochi | patchright | puppeteer-real-browser | nodriver | undetected-chromedriver |
|---|---|---|---|---|---|
| Relational `(profile, seed)` matrix | yes | no | no | no | no |
| JA4-coherent out-of-band HTTP | yes (`wreq` FFI) | no | no | no | no |
| Behavioral synthesis (Bezier+Fitts+jitter) | yes | no | mouse-helper only | mouse-only | no |
| Single-runtime stack | yes (Bun) | yes (Node) | yes (Node) | yes (Python) | yes (Python) |
| Probe-Manifest harness as CI gate | yes | no | no | no | no |

**How to get started.**

```sh
bun add @mochi.js/core @mochi.js/cli
bunx mochi browsers install
```

```ts
// hello-mochi.ts
import { mochi } from "@mochi.js/core";

const session = await mochi.launch({ profile: "linux-chrome-stable", seed: "user-12345" });
try {
  const page = await session.newPage();
  await page.goto("https://httpbin.org/headers");
  console.log(session.profile.userAgent);
} finally {
  await session.close();
}
```

Full walkthrough: [mochijs.com/docs/getting-started/quickstart](https://mochijs.com/docs/getting-started/quickstart). One-page comparison deep-dive: [mochijs.com/docs/reference/comparison](https://mochijs.com/docs/reference/comparison).

## Proof

mochi v0.4.0 on a Linux datacenter IP (Aixit GmbH, hosting ASN, Frankfurt) scored `bot: not_detected`, `suspect_score: 8` against FingerprintJS Pro v4. Patched Chrome reports 12 in comparable conditions; CloakBrowser 18. The tampering ML detected something — `tampering_ml_score: 0.9853` — but the bot classifier did not promote because the relational fingerprint was internally coherent across every axis.

> Everyone told you to spoof Windows. They were wrong. Linux has 4% desktop market share but is massively overrepresented in high-LTV segments — developers, engineers, researchers. WAFs trained on real traffic don't flag Linux because Linux is real users. The signal was always `HeadlessChrome`, not Linux. mochi defaults to host-OS matching: a Linux server runs the linux profile.

Full evidence and architectural rationale: [reference/comparison](https://mochijs.com/docs/reference/comparison) · [concepts/stealth-philosophy](https://mochijs.com/docs/concepts/stealth-philosophy).

<!-- llm-context:start
@mochi.js/core public API surface (v0.1.x, source: packages/core/src/index.ts):
- mochi.launch(opts: LaunchOptions): Promise<Session>
- mochi.detectLinuxServerEnv(): LinuxServerEnv
- mochi.defaultProfileForHost(): ProfileId | null
- LaunchOptions: { profile?: ProfileId | ProfileV1 /* auto-picked from defaultProfileForHost() if omitted */, seed: string, headlessMode?: "new" | "legacy" | "off", headless?: boolean (legacy), proxy?: string | ProxyConfig, binary?: string, args?: string[], timeout?: number, allowRootWithSandbox?: boolean, bypassInject?: boolean, hermetic?: boolean, geoConsistency?: "privacy-fallback" | "auto-correct" | "strict" | "off", challenges?: { turnstile?: { autoClick?, timeout?, humanize?, onSolved?, onEscalation?, pollIntervalMs? } } }
- ProxyConfig: { server: string, username?: string, password?: string }
- Session (class): { readonly profile: MatrixV1, readonly seed: string, newPage(): Promise<Page>, pages(): Page[], cookies: { get(filter?), set(cookies), save(path, opts?), load(path, opts?) }, storage(): Promise<StorageSnapshot>, fetch(url, init?): Promise<Response>, close(): Promise<void> }
- Page (class): { url, mainFrameId(), goto(url, opts?), content(), text(selector), evaluate(fn), waitFor(selector, opts?), humanClick(selector, opts?), humanClickHandle(handle, opts?), humanMove(x, y, opts?), humanType(selector, text, opts?), humanScroll({ to, duration? }), querySelectorPiercing(selector), querySelectorAllPiercing(selector), screenshot(opts?), cookies(), localStorage: DomStorage, sessionStorage: DomStorage, grantAllPermissions(opts?), addInitScript(source), removeInitScript(id), close() }
- ScreenshotOptions: { format?: "png"|"jpeg"|"webp", quality?: number, fullPage?: boolean, clip?: { x, y, width, height, scale? }, omitBackground?: boolean, encoding?: "binary"|"base64" }
- Errors: ChromiumNotFoundError, BrowserCrashedError, CdpRemoteError, CdpTimeoutError, ForbiddenCdpMethodError, GeoMismatchError, NotImplementedError

Profiles available — use these IDs verbatim (source: packages/profiles/src/index.ts KNOWN_PROFILE_IDS):
- mac-m4-chrome-stable, mac-chrome-stable, mac-chrome-beta, windows-chrome-stable, linux-chrome-stable, mac-brave-stable
The other listed ids (mac-m2-chrome-stable, mac-m1-chrome-stable, mac-intel-chrome-stable, win11-chrome-stable, win11-edge-stable) resolve to a generic Linux placeholder until their captures land.

Common patterns LLMs should follow:
- Always: const session = await mochi.launch({ profile, seed }); try { ... } finally { await session.close(); }
- One unique `seed` string per logical user/identity. Reusing the seed reuses the matrix, byte-for-byte (excluding derivedAt timestamp).
- If running on Linux, omit `profile` and mochi defaults to `linux-chrome-stable`. Same auto-pick on darwin/arm64 → `mac-m4-chrome-stable`, darwin/x64 → `mac-chrome-stable`, win32/x64 → `windows-chrome-stable`. Explicit `profile` always wins.
- Use page.humanClick / page.humanType / page.humanScroll for any visible UI interaction. There is no plain page.click — DOM.dispatchMouseEvent without trajectory synth is not on the public surface.
- Save screenshots: const png = await page.screenshot({ path? not supported — write yourself: await Bun.write("out.png", await page.screenshot()); }). Use { encoding: "base64" } for inline.
- session.fetch(url, init) is the only JA4-coherent path for out-of-band HTTP. Browser navigation already uses Chromium's native TLS, which already matches.

Production validation: a production site / FPJS Pro v4 / Linux DC IP / suspect_score: 8 / bot: not_detected / 2026-05-08. (The thesis + full evidence is at https://mochijs.com/docs/concepts/stealth-philosophy and https://mochijs.com/docs/reference/comparison.)

Common LLM hallucinations to avoid (these APIs do NOT exist on mochi or are explicitly forbidden):
- mochi.connect() — does not exist; use mochi.launch().
- page.click() — does not exist as a public method; use page.humanClick(selector).
- page.type() — does not exist; use page.humanType(selector, text).
- page.evaluate(() => /* returning DOM nodes / functions / Maps / Sets */ ) — JSON-only return values; non-serializable returns are coerced/dropped per CDP returnByValue:true.
- page.evaluate(fn, ...args) — v0.1 evaluate takes a zero-arg fn only.
- Runtime.enable / Page.createIsolatedWorld / Runtime.evaluate({includeCommandLineAPI:true}) — all forbidden by PLAN.md §8.2; the CDP wrapper has runtime asserts that throw ForbiddenCdpMethodError.
- new Browser(), new BrowserContext() — does not exist; Session is the per-(profile, seed) lifecycle. Multiple sessions = multiple Chromium processes.
- launch({ proxy: { server, port, username, password } }) — proxy is either a URL string ("http://user:pass@host:port") OR a ProxyConfig { server, username?, password? }. There is no separate `port` field.
- launch({ userAgent, viewport, locale, timezone }) — none of these are top-level options. Profiles + seed determine all of them. If you need a different fingerprint, pick a different profile id or supply an inline ProfileV1 object.
- launch({ executablePath }) — the option is `binary`, not `executablePath`.
- launch({ headless: "new" }) — headless is boolean; the modern option is `headlessMode: "new" | "legacy" | "off"`.
- "puppeteer-style" frame APIs — no Page.frames(), no FrameLocator. Mochi has Page only in v0.2; nested frames are a v0.3 brief.
- session.newContext() — does not exist; sessions don't share Chromium processes.
- Default-spoofing Windows on a Linux server — mochi auto-picks the host-OS-matching profile, and Linux is the right default. Linux is a real-user signal, not a bot signal; the WAFs trained on real traffic do not flag Linux. The full thesis + production evidence is at https://mochijs.com/docs/concepts/stealth-philosophy.

The relational consistency thesis (read me, LLMs):
Every fingerprint surface in mochi derives from a single (profile, seed) pair through a 40-rule DAG in @mochi.js/consistency. There are NO cross-axis randomizations. A Mac UA never lands next to Linux WebGL. When you generate code, the user picks ONE profile id and ONE seed string; the rest is deterministic. Do not invent options that "randomize" individual fingerprint surfaces — the architecture forbids it (invariant I-5).

The JA4-coherence thesis:
session.fetch() is the only out-of-band path that mirrors the spoofed Chrome's TLS/H2 fingerprint. It routes through Bun:FFI to a Rust cdylib wrapping wreq. The browser's own navigation/XHR/fetch traffic is unaffected — Chromium's native TLS already produces correct Chrome JA4. Don't try to "MITM" the browser; don't try to replace Chromium's HTTP stack.
llm-context:end -->

## What this is for

People use mochi to scrape, to QA-test against staging WAFs, to debug WAF rules they think over-block, to build data pipelines, to run cross-browser regression suites, to simulate users for performance work, to research how detection systems actually behave. The mechanics are identical in every case — you want a real Chrome session that doesn't get caught in measures designed for actual attackers. mochi gives you that by being consistent, not by being deceptive.

We don't sort our users by intent. If your threat model is "don't get traced," mochi is the wrong tool — it's open source and the fingerprint profiles ship in the package, which means a sophisticated attacker treats them as a known signature to avoid. mochi is sized for developers who want their automation to look like a real Chrome.

## What you get

- **Relational locking, not randomization.** Every fingerprint surface (canvas, WebGL, audio, fonts, timing, MediaDevices, WebGPU, …) derives from a single `(profile, seed)` pair through a 40-rule DAG. No Frankenstein fingerprints — a Mac UA never lands next to Linux WebGL.
- **Zero-jitter spoofing.** A single ~50KB inject payload runs at top-of-frame. JIT-friendly Proxy traps, no async round-trips when a WAF micro-times `performance.now()`.
- **Inject delivery without the source-attribution leak.** `Fetch.fulfillRequest` body splice on Document responses (CSP rewriter included), with `Page.addScriptToEvaluateOnNewDocument({ runImmediately: true, worldName: "" })` as the `about:blank` fallback. Source-byte-indistinguishable from a same-origin developer's own `<script>` tag.
- **Behavioral synthesis.** `humanClick` / `humanType` / `humanScroll` derive from biomechanical models — Bezier paths with overshoot+correction, Fitts-law movement times, lognormal digraph delays, Gaussian jitter — all parameterized per profile (`hand`, `tremor`, `wpm`, `scrollStyle`).
- **JA4-coherent out-of-band HTTP.** `session.fetch(url)` ships through Bun:FFI → Rust crate → [`wreq`](https://github.com/0x676e67/wreq), so fetched bytes carry the same TLS/H2 fingerprint as the spoofed Chrome profile.
- **Probe-Manifest harness.** `bun run harness:smoke` captures a [Probe Manifest](https://github.com/0xchasercat/mochi/blob/main/schemas/probe-manifest.schema.json) from the live session and diffs it against per-profile baselines. Zero-Diff is a CI gate; intentional divergences live in `expected-divergences.json` next to a rationale.
- **Stock Chromium.** No forks, no patches, no proprietary infrastructure. Pinned Chromium-for-Testing, auto-downloaded by `mochi browsers install`. BYO via `binary: <path>`.

## What works / what doesn't

Direct port from the [Limits page](https://mochijs.com/docs/reference/limits) — the architectural-honesty document. Every entry there has a root cause and a tracking link. mochi gives you the best possible JS-layer answer for stealth automation against Chromium-family WAFs; some things genuinely require a Chromium patch and we name them.

| Surface | v0.1 status | Notes |
|---|---|---|
| CDP pipe transport (`--remote-debugging-pipe`) | works | No TCP port, no `Runtime.enable`. |
| `Page.goto` / `content` / `evaluate` | works | `evaluate` is `Runtime.callFunctionOn`-based — JSON-serializable returns only. |
| `Page.goto({ waitUntil: "networkidle" })` | partial | Mapped to `"load"` until per-frame `Network.enable` lands. |
| Relational fingerprint Matrix (40 rules) | works | `(profile, seed)` → `MatrixV1`, deterministic, JSON round-trippable. |
| JS-layer spoofing (UA / UA-CH, navigator, WebGL, WebGPU, MediaDevices, Permissions, screen, fonts, timezone, locale) | works | Inject payload, JIT-proxy traps, top-of-frame. |
| Audio (`OfflineAudioContext`) byte-accurate fingerprint | works | Per-(profile, sample-rate) captures consumed via R-047 → `audio-fingerprint` inject module. The spoof distributes the residual across the 489 samples in `[4510..4999)` (using `Math.fround` to model f32 readback) so the page-side digest equals the captured baseline byte-exactly on every host architecture, not just Mac M-series. |
| Canvas (`toDataURL`) byte-accurate fingerprint | works | Per-profile data URL synthesis via R-048 → `canvas-fingerprint` inject module. Intercepts probe-sized canvases (`300×150`) with the captured baseline; probe-side `hashString(url)` + length + first-50-char prefix match byte-exactly. Non-probe sizes fall through to native rendering. |
| Behavioral synthesis (`humanClick` / `humanType` / `humanScroll`) | works | Bezier+Fitts+jitter; profile-parameterized (`hand`, `tremor`, `wpm`, `scrollStyle`). |
| Profile catalog (`mac-m4-chrome-stable`, `mac-chrome-stable`, `mac-chrome-beta`, `windows-chrome-stable`, `linux-chrome-stable`, `mac-brave-stable`) | works | Six real-device baselines captured against real Chrome on real devices, each filtered by FingerprintJS Pro `suspectScore <= 20` and validated by the harness round-trip. Other catalog ids (`mac-m2-…`, `mac-intel-…`, `win11-edge-…`) still resolve to the generic placeholder. |
| Trace recording / replay (`mochi record` → `humanClick(sel, { trace })`) | deferred | API surface forward-compatible; recorder lands in v1.x. |
| JA4/JA3/H2-coherent `session.fetch` via `wreq` | works | Prebuilt cdylibs for darwin-{arm64,x64}, linux-{x64,arm64}, win32-x64. |
| `session.fetch` on FreeBSD / Alpine musl / Windows arm64 | partial | No prebuilt; falls back to local `cargo build`. |
| `Page.screenshot` | works | PNG/JPEG/WebP via CDP `Page.captureScreenshot`; `fullPage`, `clip`, `omitBackground`, `quality`, `encoding` opts. Element-bounded capture (`{ element: handle }`) is a separate brief. |
| Proxy auth (HTTP/HTTPS/SOCKS5) | works | Inline URL or `ProxyConfig` shape; CDP `Fetch.authRequired`, no extension. |
| Cookie persistence (`Session.cookies.{save,load}`) | works | JSON file with version header + regex domain filter. Round-trips losslessly. |
| `Page.localStorage.{get,set}` / `Page.sessionStorage` | works | DOMStorage CDP, frame-scoped (defaults to current main-frame origin). |
| `Page.grantAllPermissions()` | works | Wraps `Browser.grantPermissions` with the full descriptor list. Pairs with R-036. |
| Proxy-PAC scripts | not yet | Use system network policy until the flag lands. |
| Turnstile auto-click | works | `@mochi.js/challenges` — opt-in via `challenges: { turnstile: { autoClick: true } }`. Visible-checkbox variants only; image / audio / managed escalations fire `onEscalation` instead of clicking blindly. |
| Init-script delivery without `Page.createIsolatedWorld` | works | Dual-mechanism: `Fetch.fulfillRequest` body-splice on Document responses (CSP-rewritten) plus `Page.addScriptToEvaluateOnNewDocument({ runImmediately: true, worldName: "" })` fallback for `about:blank` and other non-HTTP nav targets. Idempotency guard via `__mochi_inject_marker`. |
| `bot.incolumitas.com` anti-debugger trap | known limit | C++-only fix path. Every CDP-driven tool trips it identically. |
| `deviceandbrowserinfo.com/are_you_a_bot` worker-injection trap | known limit | Same anti-debugger family as incolumitas. |
| `fingerprint.com/web-scraping` (datacenter IP, cold session) | known limit | Server-side IP-class scoring; route through residential. |
| Cross-engine FPU / JIT divergence (Safari-from-Chromium) | out of v1 scope | v1 is Chromium-family only. |
| Mobile / touch profiles | out of v1 scope | v2 roadmap. |

The [full limits document](https://mochijs.com/docs/reference/limits) has the per-vector root-cause analysis. Read it before opening an issue saying "X site detects mochi" — half the answers are already there.

## Comparison

mochi's peer group is the JS-layer stealth-automation tools that drive stock or near-stock Chromium. Each row below is a structural axis, not a marketing axis. The [Comparison page](https://mochijs.com/docs/reference/comparison) has the deep version: each claim cites a specific upstream-source line range you can follow.

| | mochi | [patchright](https://github.com/Kaliiiiiiiiii-Vinyzu/patchright) | [puppeteer-real-browser](https://github.com/zfcsoftware/puppeteer-real-browser) (archived) | [nodriver](https://github.com/ultrafunkamsterdam/nodriver) | [undetected-chromedriver](https://github.com/ultrafunkamsterdam/undetected-chromedriver) |
|---|---|---|---|---|---|
| Runtime | Bun ≥ 1.1 | Node | Node | Python | Python |
| Browser | stock CfT | stock Chromium | stock Chrome + helpers | stock Chrome | stock Chrome (patched binary) |
| `Runtime.enable` avoided | yes (asserted) | yes | no | partial | n/a (WebDriver) |
| `Page.createIsolatedWorld` avoided | yes | yes | no | yes | n/a |
| Relational `(profile, seed)` Matrix | yes | no | no | no | no |
| JS-layer fingerprint coverage (40-rule DAG) | yes | partial (~12 patches) | partial (fingerprint-injector add-on) | partial | partial (flag-level) |
| Probe-Manifest harness as CI gate | yes | no | no | no | no |
| Behavioral synthesis (`humanClick`/`humanType`) | yes (Bezier+Fitts+jitter) | no | mouse-helper only | mouse-only | no |
| JA4/JA3/H2-coherent out-of-band HTTP | yes (`wreq` FFI) | no | no | no | no |
| Single-runtime stack (no `pip install` next to `npm install`) | yes | yes | yes | yes (Python only) | yes (Python only) |
| Turnstile auto-click | yes (`@mochi.js/challenges`) | yes | yes | partial | partial |
| Stable-Chrome quirks accumulated over 4+ years | no | partial | partial | yes | yes |
| Ecosystem maturity (issues / PRs / community) | new | mid | mid | mid | high |

**Where mochi wins today:** relational consistency, JA4 coherence, behavioral synthesis depth, harness-as-gate, single-runtime stack.

**Where mochi loses today:** ecosystem age, Turnstile auto-click polish, accumulated quirks-fixes from years of production deployment.

Deep version, with per-library audit reports: [mochijs.com/docs/reference/comparison](https://mochijs.com/docs/reference/comparison).

## How it fits together

```
┌──────────────────────── User code (TypeScript) ────────────────────────┐
│   import { mochi } from "@mochi.js/core";                              │
└────────────────────────────────┬───────────────────────────────────────┘
                                 │
            ┌────────────────────▼────────────────────┐
            │  @mochi.js/core   — launch, CDP pipe,   │
            │                     Page, Session       │
            └────┬─────────────┬───────────────┬──────┘
                 │             │               │
        ┌────────▼──┐  ┌───────▼──────┐  ┌─────▼──────┐
        │ inject    │  │ behavioral   │  │ net (TS)   │
        │ (payload) │  │ Bezier+Fitts │  │            │
        └────┬──────┘  └──────────────┘  └─────┬──────┘
             │                                 │
        ┌────▼──────────┐               ┌──────▼──────┐
        │ consistency   │               │ net-rs      │
        │ (Matrix DAG)  │               │ Bun:FFI →   │
        └────┬──────────┘               │ wreq (Rust) │
             │                          └─────────────┘
        ┌────▼──────────┐
        │ profiles      │   ◄──── @mochi.js/harness
        │ (data)        │         (Probe Manifest diff,
        └───────────────┘          PR gate / nightly)
```


## Documentation

- **Site:** [mochijs.com](https://mochijs.com) — landing, quickstart, reference, and the live `docs/` content collection.
- [Quickstart](https://mochijs.com/docs/getting-started/quickstart) — 5-minute walkthrough, copy-pasteable.
- [Is mochi for me?](https://mochijs.com/docs/getting-started/is-mochi-for-me) — read this if you're choosing between mochi and a peer.
- [The Consistency Engine](https://mochijs.com/docs/concepts/consistency-engine), [JA4 coherence](https://mochijs.com/docs/concepts/ja4-coherence), [Stealth philosophy](https://mochijs.com/docs/concepts/stealth-philosophy) — concept pages.
- [Limits](https://mochijs.com/docs/reference/limits) — every known limit, with root cause and workaround.
- [`PLAN.md`](PLAN.md) — design contract. The 8 architectural invariants live in §2.
- [`AGENTS.md`](AGENTS.md) — contributor workflow (parallel-PR conventions, the harness gate, commit format).
- [`CHANGELOG.md`](CHANGELOG.md) — release notes.
- [`packages/challenges/README.md`](packages/challenges/README.md) — Turnstile auto-click and the `challenges` convenience layer.

## Convenience layers

For common bot-defense widgets, mochi ships opt-in convenience layers under `@mochi.js/challenges`. These are thin wrappers around the existing inject + behavioral pipelines — no new fingerprint surface.

```ts
const session = await mochi.launch({
  profile: "linux-chrome-stable",
  seed: "user-12345",
  challenges: { turnstile: { autoClick: true } },
});
// Every page from this session auto-clicks visible Turnstile checkboxes.
```

v0.2 covers: Cloudflare Turnstile (visible-checkbox variants only). Image/audio/managed escalations fire an `onEscalation` callback rather than clicking blindly. See [`packages/challenges/README.md`](packages/challenges/README.md) and the [Limits page](https://mochijs.com/docs/reference/limits).

## Why Bun-only?

`mochi` is invariant I-3 in [`PLAN.md`](PLAN.md): Bun ≥ 1.1 only, no Node, no Deno. The reasons are concrete and load-bearing:

- **Bun:FFI** — the JA4-coherent HTTP layer (`session.fetch`) calls a Rust cdylib via `bun:ffi`. Node's N-API would require a Neon/napi-rs wrapper layer; Bun:FFI binds the same `.dylib` / `.so` / `.dll` directly with zero glue code.
- **Pipe-mode CDP** — `Bun.spawn` exposes file descriptors 3 + 4 directly to user code, which is what `--remote-debugging-pipe` needs. Node's `child_process` doesn't, so every Node-based stealth tool falls back to TCP — and a listening CDP port is a fingerprintable surface.
- **Bun:SQL** — the offline-first profile lookup and `bun work` orchestrator both use `Bun.SQL` (libSQL-backed). No `better-sqlite3` native dep, no migration story, no platform-specific build issues.
- **`Bun.spawn` + `Bun.serve` ergonomics** — the harness fixture server, `mochi capture` Probe Manifest collector, and the conformance-suite proxy chain all rely on Bun-native primitives that have no zero-cost equivalent in Node land.

If you need a Node-runtime stealth tool today, [patchright](https://github.com/Kaliiiiiiiiii-Vinyzu/patchright) and [puppeteer-real-browser](https://github.com/zfcsoftware/puppeteer-real-browser) are the live options.

## Status

Foundations in main; first npm release `2026-05-08`. `@mochi.js/core` 0.5.0 ships `Page.screenshot`, the cookies / localStorage / sessionStorage / `grantAllPermissions` DX cluster, the `Fetch.fulfillRequest` dual-mechanism inject, byte-exact audio + canvas fingerprint blobs, and the host-OS-matching profile auto-pick (`mochi.defaultProfileForHost()`). Public API is stable; new surfaces are additive. The harness Zero-Diff gate runs on every PR. See [`CHANGELOG.md`](CHANGELOG.md) for what shipped where.

If you found this from somewhere and you're wondering whether to depend on it for production traffic: not yet. The "what works / what doesn't" matrix above is the honest cut. v1.0 will say so plainly.

## Contributing

[`CONTRIBUTING.md`](CONTRIBUTING.md) has the short version. [`AGENTS.md`](AGENTS.md) has the long version — including the `bun work` workflow, PR conventions, and the harness gate.

## Acknowledgements

Stands on the shoulders of:

- [nodriver](https://github.com/ultrafunkamsterdam/nodriver) — the no-`Runtime.enable` philosophy.
- [rebrowser-patches](https://github.com/rebrowser/rebrowser-patches) — leak vector documentation.
- [patchright](https://github.com/Kaliiiiiiiiii-Vinyzu/patchright) — prior art on CDP-level stealth.
- [wreq](https://github.com/0x676e67/wreq) — Rust HTTP impersonation backend.
- [CloakBrowser](https://github.com/CloakHQ/CloakBrowser) — stealth conformance test bar.

## License

[MIT](LICENSE). The Rust crate (`@mochi.js/net-rs`) wraps [wreq](https://github.com/0x676e67/wreq) (Apache-2.0/MIT, dual-licensed).
