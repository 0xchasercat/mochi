---
title: Quickstart
description: Five minutes from zero to a spoofed Chrome session driving a page — install, first session, first humanClick, JA4 fetch, manifest read.
order: 3
category: getting-started
lastUpdated: 2026-05-09
---

Five minutes from zero to a spoofed Chrome session driving a page. This page is the copy-pasteable end-to-end recipe; the conceptual *why* lives at [Stealth philosophy](/docs/concepts/stealth-philosophy) and [The Consistency Engine](/docs/concepts/consistency-engine).

## Prerequisites

- [Bun](https://bun.sh) `>= 1.1`. Node and Deno are not targets ([invariant I-3](/docs/concepts/stealth-philosophy)).
- ~400 MB free for the bundled Chromium-for-Testing download (cached after the first install).
- macOS, Linux, or Windows on x64 / arm64. Stock Chrome is not used; mochi pins its own CfT build.

> **Running on a Linux server?** mochi auto-detects no-DISPLAY and defaults `headlessMode` to `"new"` (`--headless=new`, full rendering, near-byte-identical to headful for fingerprinting). You don't need xvfb for stealth. Full guide — including the `headlessMode` option, container setup, root-sandbox fallback, and apt-deps line — at [Linux server deployment](/docs/getting-started/linux-server).

## 1. Install

```sh
mkdir hello-mochi && cd hello-mochi
bun init -y
bun add @mochi.js/core @mochi.js/cli
```

You should see `@mochi.js/core` and `@mochi.js/cli` resolve from npm with no `workspace:*` errors. If you hit `Workspace dependency not found`, you're on the v0.1.0 hot-fix path — upgrade:

```sh
bun add @mochi.js/core@latest @mochi.js/cli@latest
```

Linux apt deps and the root-sandbox case are covered on [Installation](/docs/getting-started/install) — skip those two sections on macOS and Windows.

## 2. Install Chromium-for-Testing

```sh
bunx mochi browsers install
```

Expected output:

```
mochi browsers install — pinning Chromium-for-Testing
  channel        stable
  version        <pinned>
  platform       <darwin-arm64 | linux-x64 | …>
  download       https://storage.googleapis.com/chrome-for-testing-public/...
  installed      ~/.cache/mochi/chromium/<version>/chrome-<platform>/
  sha256         <hex> (computed during streamed download)
done
```

The binary lives in `~/.cache/mochi/chromium/`. `mochi.launch()` auto-resolves it; you can override with `binary: <path>` for a BYO build (see [Installation](/docs/getting-started/install)).

The first install also unpacks the `@mochi.js/net-rs` cdylib (Rust crate wrapping [`wreq`](https://github.com/0x676e67/wreq)) for the JA4-coherent fetch path. Prebuilt binaries ship for `darwin-arm64`, `darwin-x64`, `linux-x64`, `linux-arm64`, and `win32-x64`. Anything else falls back to `cargo build --release` from `packages/net-rs/` — see [Network FFI](/docs/concepts/network-ffi) for the platform matrix.

## 3. First session

Create `hello-mochi.ts`:

```ts
import { mochi } from "@mochi.js/core";

const session = await mochi.launch({
  profile: "linux-chrome-stable",
  seed: "user-12345",
});
try {
  const page = await session.newPage();
  await page.goto("https://httpbin.org/headers");

  console.log("UA:        ", session.profile.userAgent);
  console.log("Locale:    ", session.profile.locale);
  console.log("Timezone:  ", session.profile.timezone);
  console.log("wreqPreset:", session.profile.wreqPreset);
} finally {
  await session.close();
}
```

Run it:

```sh
bun run hello-mochi.ts
```

Expected output:

```
UA:         Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/<pinned>.0.0.0 Safari/537.36
Locale:     en-US
Timezone:   <captured>
wreqPreset: chrome_<major>_linux
```

What just happened, layer by layer:

1. `mochi.launch` resolved `linux-chrome-stable` into a `ProfileV1`, ran it through the [40-rule consistency DAG](/docs/concepts/consistency-engine) with `seed: "user-12345"`, and produced a deterministic `MatrixV1`. Same `(profile, seed)` always produces the same Matrix (excluding the `derivedAt` timestamp).
2. The [CDP transport](/docs/concepts/inject-pipeline) opened a `--remote-debugging-pipe` connection (no TCP port) and started the spoofing inject before any page script ran. Inject delivery is dual-mechanism: `Fetch.fulfillRequest` body splice on Document responses (CSP-rewritten), with `Page.addScriptToEvaluateOnNewDocument({ runImmediately: true, worldName: "" })` as the `about:blank` / `data:` fallback.
3. `page.goto` navigated; `session.profile` is the resolved Matrix — every fingerprint surface coheres, including byte-exact `OfflineAudioContext` and `toDataURL` digests (R-047 / R-048 fed by the precomputed audio + canvas fingerprint blobs from task 0267).

Swap the seed for a different identity; swap the profile for a different device class.

## 4. Profile catalog

Six real-device baselines ship in v0.2 (imported from the wrkx harvester corpus per task 0260, each filtered by FingerprintJS Pro `suspectScore <= 20`):

| Profile id | Device |
|---|---|
| `mac-m4-chrome-stable` | MacBook (Apple Silicon, M4) — Chrome stable |
| `mac-chrome-stable` | macOS — Chrome stable |
| `mac-chrome-beta` | macOS — Chrome beta |
| `windows-chrome-stable` | Windows 11 — Chrome stable |
| `linux-chrome-stable` | Linux x86_64 — Chrome stable |
| `mac-brave-stable` | macOS — Brave stable |

Other ids in `KNOWN_PROFILE_IDS` (`mac-m2-…`, `mac-intel-…`, `win11-edge-…`) still resolve to a generic Linux placeholder — the Matrix is relationally locked but the surface values aren't from a real capture. See [Profiles](/docs/concepts/profiles).

## 5. First `humanClick`

```ts
import { mochi } from "@mochi.js/core";

const session = await mochi.launch({
  profile: "linux-chrome-stable",
  seed: "user-12345",
});
try {
  const page = await session.newPage();
  await page.goto("https://example.com");

  // Bezier path with overshoot+correction, Fitts-law movement time,
  // Gaussian jitter — parameterized off session.profile.behavior.
  await page.humanClick("a");

  console.log("URL after click:", page.url);
} finally {
  await session.close();
}
```

Run it:

```sh
bun run hello-mochi.ts
```

You should see the IANA "Example Domain" link clicked and a navigation to `https://www.iana.org/help/example-domains`. Behind the scenes mochi:

- queried `document.querySelector("a")` to find the target rect via `DOM.querySelector` + `DOM.getBoxModel`,
- generated a Bezier path from current cursor to a Fitts-law-sampled landing point inside the rect,
- dispatched `Input.dispatchMouseEvent` deltas at lognormal-spaced timestamps,
- synthesized `mousePressed` / `mouseReleased` with a profile-realistic dwell.

Same matrix → same behavioral parameters (`hand`, `tremor`, `wpm`, `scrollStyle`). Same seed → same path within a session. See [Behavioral synthesis](/docs/concepts/behavioral-synth) for the model.

`humanType` and `humanScroll` follow the same shape:

```ts
await page.humanType("input[name=email]", "alex@example.com");
await page.humanScroll({ to: "footer" });
```

## 6. JA4-coherent fetch

`session.fetch` ships through Bun:FFI → Rust [`wreq`](https://github.com/0x676e67/wreq), so the TLS / H2 fingerprint matches the spoofed Chrome profile byte-for-byte. The browser's *own* navigation already uses Chromium's native TLS (real Chrome JA4); `session.fetch` is the orthogonal *out-of-band* path. See [JA4 coherence](/docs/concepts/ja4-coherence) for the conceptual *why*.

```ts
const res = await session.fetch("https://tls.peet.ws/api/all");
const body = await res.json() as { tls: { ja4: string }, http2: unknown };
console.log("ja4:", body.tls.ja4);
console.log("h2 :", body.http2);
```

The JA4 you read here should match the JA4 emitted when the **same** session hits the same endpoint via `page.goto`. That coherence is the point.

Out-of-the-box, prebuilt cdylibs ship for `darwin-{arm64,x64}`, `linux-{x64,arm64}`, and `win32-x64`. On other targets (FreeBSD, Alpine musl, Windows arm64), `bun add` falls back to a local `cargo build`; install the Rust toolchain first.

## 7. Reading the manifest

The harness captures a [Probe Manifest](/docs/concepts/probe-manifest) from the live session and diffs it against the per-profile baseline. PR-fast harness against the local probe page runs in ~10s; the full online suite runs nightly.

```ts
import { mochi } from "@mochi.js/core";
import { capture } from "@mochi.js/harness";

const session = await mochi.launch({
  profile: "linux-chrome-stable",
  seed: "harness-canary",
});
try {
  const manifest = await capture(session, {
    fixturePath: "tests/fixtures/probe-page.html",
  });
  await Bun.write("manifest.json", JSON.stringify(manifest, null, 2));
  console.log("manifest entries:", Object.keys(manifest).length);
} finally {
  await session.close();
}
```

Diff against the baseline programmatically with `diff(manifest, baseline, expectedDivergences)` from the same package, or run `bun run harness:smoke` for the full PR-fast pipeline.

## 8. Convenience surfaces (v0.2 wave-4)

A handful of v0.2 conveniences land on `Page` and `Session`:

```ts
// Screenshot the current viewport (PNG by default).
const png = await page.screenshot();
await Bun.write("out.png", png);

// Full-page capture in JPEG with a quality knob.
const jpeg = await page.screenshot({ format: "jpeg", quality: 80, fullPage: true });
await Bun.write("out.jpg", jpeg);

// Persist + replay cookies (JSON, NOT pickle).
await session.cookies.save("./cookies.json");
await session.cookies.load("./cookies.json");

// Direct DOMStorage access — no `evaluate` round-trip.
await page.localStorage.set({ token: "abc" });
const ls = await page.localStorage.get();

// Grant the full Browser.PermissionType list in one shot (handy for tests).
await page.grantAllPermissions();
```

Element-bounded screenshot (`page.screenshot({ element: handle })`) is deferred — see [Limits](/docs/reference/limits). For now, pass an explicit `clip` rect.

## 9. Turnstile auto-click

If your target ships a visible Cloudflare Turnstile checkbox, opt in at launch:

```ts
const session = await mochi.launch({
  profile: "linux-chrome-stable",
  seed: "user-12345",
  challenges: {
    turnstile: {
      autoClick: true,
      onSolved: (token) => console.log("turnstile passed:", `${token.slice(0, 8)}…`),
      onEscalation: (reason) => console.warn("escalation:", reason),
    },
  },
});
```

The click goes through the same Bezier+Fitts behavioral synth as `humanClick`. Image / audio / managed-mode escalations fire `onEscalation(reason)` (`"image-challenge" | "managed" | "timeout"`) and bail rather than clicking blindly into a challenge iframe. See [`packages/challenges/README.md`](https://github.com/0xchasercat/mochi/blob/main/packages/challenges/README.md) and [Limits](/docs/reference/limits).

## 10. Cleanup

```sh
# List installed Chromium versions
bunx mochi browsers list

# Remove a cached build
bunx mochi browsers uninstall <version>
```

`session.close()` flushes the CDP queue, kills the Chromium child, drops the per-Session `NetCtx`, and frees the per-session ephemeral user-data-dir. Idempotent — calling it twice is safe.

## Troubleshooting

**`ChromiumNotFoundError`** — you skipped step 2. Run `bunx mochi browsers install`.

**`bun add` fails with `Workspace dependency not found`** — you're on `v0.1.0`, which leaked `workspace:*` into published `package.json` files. Upgrade: `bun add @mochi.js/core@latest @mochi.js/cli@latest`.

**Profile id resolves to a generic placeholder** — six real-device baselines ship today (see step 4). Catalog ids outside that set still fall back to the generic Linux placeholder; the Matrix is relationally locked but the surface values aren't from a real capture. See [Profiles](/docs/concepts/profiles) and [Limits](/docs/reference/limits).

**`bot.incolumitas.com` flags the session** — it will. So does every other CDP-driven tool — the page traps `Function.prototype.toString` on its anti-debugger trampoline, and the fix path is a Chromium C++ patch ([invariant I-1](/docs/concepts/stealth-philosophy)). Tracked in [Limits](/docs/reference/limits).

**`EPIPE: broken pipe` immediately after `mochi.launch()` on Linux** — usually the root + no-sandbox case. See [Linux server deployment](/docs/getting-started/linux-server#troubleshooting).

**`navigator.userAgent` shows `HeadlessChrome`** — should not happen. The inject layer rewrites the UA via CDP `Network.setUserAgentOverride`. If you see it, either `bypassInject: true` is set or the inject failed; check the conformance suite (`bun run conformance:stealth`).

## What to read next

- [Your first session](/docs/getting-started/first-session) — drill into the session lifecycle.
- [Is mochi for me?](/docs/getting-started/is-mochi-for-me) — when mochi is the right choice, when it isn't.
- [The Consistency Engine](/docs/concepts/consistency-engine) — the relational thesis.
- [JA4 coherence](/docs/concepts/ja4-coherence) — why `session.fetch` matters.
- [Stealth philosophy](/docs/concepts/stealth-philosophy) — the eight invariants.
- [Limits](/docs/reference/limits) — every known limit, with root cause and workaround.

<!-- llm-context:start
This page is the copy-pasteable end-to-end Quickstart. It exercises mochi.launch, page.goto, page.humanClick, session.fetch, capture, and the v0.2 wave-4 conveniences (Page.screenshot, Session.cookies.save/load, Page.localStorage, Page.grantAllPermissions, challenges.turnstile.autoClick).

Verified API symbols (source: packages/core/src/index.ts, packages/harness/):
- mochi.launch(opts: LaunchOptions): Promise<Session>
- session.newPage(): Promise<Page>
- session.fetch(url, init?): Promise<Response>
- session.close(): Promise<void>
- session.profile: MatrixV1  (NOT a function, a property)
- session.cookies: { get, set, save(path, opts?), load(path, opts?) }
- page.goto(url, opts?): Promise<void>  (opts.waitUntil = "load" | "domcontentloaded" | "networkidle")
- page.url (getter, not a function)
- page.content(): Promise<string>
- page.text(selector): Promise<string | null>
- page.evaluate(fn): Promise<T>  (zero-arg fn only in v0.1; JSON-serializable returns)
- page.humanClick(selector, opts?): Promise<void>
- page.humanType(selector, text, opts?): Promise<void>
- page.humanScroll({ to: string | { x, y }, duration? }): Promise<void>
- page.screenshot(opts?): Promise<Uint8Array>  (opts.encoding: "base64" → Promise<string>)
- page.localStorage.{get(opts?), set(items, opts?)}: Promise<...>
- page.sessionStorage.{get(opts?), set(items, opts?)}: Promise<...>
- page.grantAllPermissions(opts?): Promise<void>
- capture(session, { fixturePath }): Promise<ProbeManifestV1>  // from @mochi.js/harness

Profile ids that work TODAY with real-device baselines (use these verbatim):
- mac-m4-chrome-stable, mac-chrome-stable, mac-chrome-beta, windows-chrome-stable, linux-chrome-stable, mac-brave-stable

LaunchOptions (verified, source: packages/core/src/launch.ts):
- profile: ProfileId | ProfileV1
- seed: string  (REQUIRED)
- proxy?: string | ProxyConfig  (string is "http://user:pass@host:port" form)
- headlessMode?: "new" | "legacy" | "off"  (preferred)
- headless?: boolean  (legacy; mapped to headlessMode)
- binary?: string
- args?: string[]
- timeout?: number  (CDP request default; ms)
- bypassInject?: boolean  (capture flows only — NEVER in production)
- hermetic?: boolean  (harness/CI only)
- challenges?: { turnstile?: { autoClick?, timeout?, humanize?, onSolved?, onEscalation?, pollIntervalMs? } }
- geoConsistency?: "privacy-fallback" | "auto-correct" | "strict" | "off"
- allowRootWithSandbox?: boolean

Common LLM hallucinations to avoid for this page's topic:
- session.fetch(url, { proxy: "..." }) — proxy is a launch-level option, not a per-fetch option.
- page.goto(url, { headers: ... }) — does NOT exist; modify request headers via Network.setExtraHTTPHeaders only via internal CDP, not in v0.1 public API.
- page.click(selector) — does NOT exist; use page.humanClick.
- page.type(selector, text) — does NOT exist; use page.humanType.
- await page.screenshot({ path: "out.png" }) — `path` is NOT supported. Capture and write yourself: `await Bun.write("out.png", await page.screenshot())`.
- session.fetch returns NetResponse — false; returns Promise<Response> (standard Web Response).
- mochi.launch is synchronous — false; always returns Promise<Session>.

Cross-references:
- /docs/getting-started/install
- /docs/getting-started/first-session
- /docs/getting-started/linux-server
- /docs/getting-started/is-mochi-for-me
- /docs/concepts/consistency-engine
- /docs/concepts/inject-pipeline
- /docs/concepts/behavioral-synth
- /docs/concepts/ja4-coherence
- /docs/concepts/probe-manifest
- /docs/concepts/stealth-philosophy
- /docs/reference/limits
llm-context:end -->
