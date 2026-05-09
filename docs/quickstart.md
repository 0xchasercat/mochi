# Quickstart

Five minutes from zero to a spoofed Chrome session driving a page.

## Prerequisites

- [Bun](https://bun.sh) `>= 1.1`. Node and Deno are not targets ([invariant I-3](../PLAN.md)).
- ~400 MB free for the bundled Chromium-for-Testing download (cached after the first install).
- macOS, Linux, or Windows on x64 / arm64. Stock Chrome is not used; mochi pins its own CfT build.

> **Running on a Linux server?** mochi auto-detects the no-DISPLAY case and defaults `headlessMode` to `"new"` (`--headless=new`, full rendering, near-byte-identical to headful for fingerprinting). You don't need xvfb for stealth. Full guide — including the `headlessMode` option, container setup, and when xvfb is actually needed — at [Linux server deployment](https://mochijs.com/docs/getting-started/linux-server).

> **Linux gotcha — Chromium and root.** Chromium refuses to start as root unless its user-namespace sandbox is disabled or replaced. **mochi auto-handles this** as of v0.1.5: if `mochi.launch()` detects `process.platform === "linux" && process.getuid() === 0` and `--no-sandbox` isn't already set, it injects the flag with a one-line warning naming the fingerprint trade-off (`--no-sandbox` is a fingerprint leak per PLAN §8.6). The launch then succeeds.
>
> If you'd rather keep the sandbox under root (e.g. you've configured the SUID `chrome-sandbox` helper), pass `allowRootWithSandbox: true` to `mochi.launch()` to opt out. The launch will crash with `EPIPE` if the SUID setup is wrong, but you keep stealth posture intact.
>
> Best-practice ranking:
>
> 1. **Run as a non-root user** — what every production setup should do anyway.
> 2. **`chmod 4755 chrome-sandbox`** on the SUID helper next to the CfT binary, plus `allowRootWithSandbox: true`. Lets root-launched Chromium use the sandbox properly. Distro-dependent.
> 3. **Default behavior** — accept the auto-injected `--no-sandbox` (mochi warns; the flag is logged). Fast for dev / CI / first-run; not for stealth-critical production.

> **Linux runtime dependencies.** Chromium-for-Testing ships only the binary; on a fresh Ubuntu / Debian server the system libs Chromium links against are not preinstalled. Symptom: `mochi browsers install` succeeds, then `mochi.launch()` immediately dies with `BrowserCrashedError` (the parent process sees the CDP pipe close because Chromium aborted with `error while loading shared libraries: libnss3.so` or similar). v0.1.5+ runs a post-install `--version` smoke that prints the exact apt line and exits non-zero on this case, but you can install the deps up front:
>
> ```sh
> sudo apt-get update -qq && sudo apt-get install -y --no-install-recommends \
>   ca-certificates fonts-liberation libasound2t64 libatk-bridge2.0-0 \
>   libatk1.0-0 libcairo2 libcups2 libdbus-1-3 libexpat1 libfontconfig1 \
>   libgbm1 libglib2.0-0 libgtk-3-0 libnspr4 libnss3 libpango-1.0-0 \
>   libpangocairo-1.0-0 libx11-6 libx11-xcb1 libxcb1 libxcomposite1 \
>   libxcursor1 libxdamage1 libxext6 libxfixes3 libxi6 libxrandr2 \
>   libxrender1 libxss1 libxtst6 xdg-utils
> ```
>
> The CLI does NOT auto-`sudo` — sudo escalation belongs to you, not to the tool. macOS and Windows ship the equivalents via the OS itself; nothing to install. Full Linux prerequisites order: install Bun → install runtime deps (this block) → `bun add @mochi.js/core @mochi.js/cli` → `bunx mochi browsers install`.

## 1. Install

```sh
mkdir hello-mochi && cd hello-mochi
bun init -y
bun add @mochi.js/core @mochi.js/cli
```

You should see `@mochi.js/core` and `@mochi.js/cli` resolve from npm with no `workspace:*` errors. If you hit `Workspace dependency not found`, you're on `v0.1.0` — upgrade to `v0.1.1+`:

```sh
bun add @mochi.js/core@latest @mochi.js/cli@latest
```

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

The binary lives in `~/.cache/mochi/chromium/`. `mochi.launch()` auto-resolves it; you can override with `binary: <path>` for a BYO build.

## 3. First session

Create `hello-mochi.ts`:

```ts
import { mochi } from "@mochi.js/core";

const session = await mochi.launch({
  profile: "linux-chrome-stable",
  seed: "user-12345",
});

const page = await session.newPage();
await page.goto("https://httpbin.org/headers");

console.log("UA:        ", session.profile.userAgent);
console.log("Locale:    ", session.profile.locale);
console.log("Timezone:  ", session.profile.timezone);
console.log("wreqPreset:", session.profile.wreqPreset);

await session.close();
```

Run it:

```sh
bun run hello-mochi.ts
```

Expected output (real-device baseline imported per task 0260; six profile ids ship today — see step 4 below):

```
UA:         Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/<pinned>.0.0.0 Safari/537.36
Locale:     en-US
Timezone:   <captured>
wreqPreset: chrome_<major>_linux
```

What just happened:

1. `mochi.launch` resolved `linux-chrome-stable` into a `ProfileV1`, ran it through the 40-rule consistency DAG with `seed: "user-12345"`, and produced a deterministic `MatrixV1`.
2. The CDP transport opened a `--remote-debugging-pipe` connection (no TCP port) and started the spoofing inject before any page script ran. Inject delivery uses the dual-mechanism path from task 0266: `Fetch.fulfillRequest` body splice on Document responses, with `Page.addScriptToEvaluateOnNewDocument({ runImmediately: true, worldName: "" })` as the `about:blank` / `data:` fallback.
3. `page.goto` navigated; `session.profile` is the resolved Matrix — every fingerprint surface coheres, including byte-exact `OfflineAudioContext` and `toDataURL` digests (R-047 / R-048 fed by the precomputed audio + canvas fingerprint blobs from task 0267).

The same `(profile, seed)` always produces the same Matrix. Swap the seed for a different identity; swap the profile for a different device class.

## 4. Profile catalog

Six real-device baselines ship in v0.2 (imported from the wrkx harvester corpus per task 0260, each filtered by FingerprintJS Pro `suspectScore <= 20` and validated by the harness round-trip):

| Profile id | Device |
|---|---|
| `mac-m4-chrome-stable` | MacBook (Apple Silicon, M4) — Chrome stable |
| `mac-chrome-stable` | macOS — Chrome stable |
| `mac-chrome-beta` | macOS — Chrome beta |
| `windows-chrome-stable` | Windows 11 — Chrome stable |
| `linux-chrome-stable` | Linux x86_64 — Chrome stable |
| `mac-brave-stable` | macOS — Brave stable |

Other ids in the catalog (`mac-m2-…`, `mac-intel-…`, `win11-edge-…`) still resolve to the generic placeholder; see [`docs/limits.md`](limits.md).

## 5. First `humanClick`

```ts
import { mochi } from "@mochi.js/core";

const session = await mochi.launch({
  profile: "linux-chrome-stable",
  seed: "user-12345",
});

const page = await session.newPage();
await page.goto("https://example.com");

// Bezier path with overshoot+correction, Fitts-law movement time,
// Gaussian jitter — parameterized off session.profile.behavior.
await page.humanClick("a");

console.log("Title after click:", await page.title());
await session.close();
```

Run it:

```sh
bun run hello-mochi.ts
```

You should see the IANA "Example Domain" link clicked and a navigation to `https://www.iana.org/help/example-domains`. Behind the scenes, mochi:

- queried `document.querySelector("a")` to find the target rect
- generated a Bezier path from current cursor to a Fitts-law sampled landing point inside the rect
- dispatched `Input.dispatchMouseEvent` deltas at lognormal-spaced timestamps
- synthesized `mousedown` / `mouseup` with a profile-realistic dwell

Same matrix → same behavioral parameters (`hand`, `tremor`, `wpm`, `scrollStyle`). Same seed → same path within a session.

## 6. JA4-coherent fetch

`session.fetch` ships through Bun:FFI → Rust [`wreq`](https://github.com/0x676e67/wreq), so the TLS / H2 fingerprint matches the spoofed Chrome profile byte-for-byte.

```ts
const res = await session.fetch("https://tls.peet.ws/api/all");
const body = await res.json();
console.log("ja4:", body.tls.ja4);
console.log("h2 :", body.http2);
```

The JA4 you read here should match the JA4 emitted when the **same** session hits the same endpoint via `page.goto`. That coherence is the point.

Out-of-the-box, prebuilt cdylibs ship for `darwin-{arm64,x64}`, `linux-{x64,arm64}`, and `win32-x64`. On other targets (FreeBSD, Alpine musl, Windows arm64), `bun add` falls back to a local `cargo build`; install the Rust toolchain first.

## 7. Convenience surfaces (v0.2 wave-4)

A handful of v0.2 conveniences land on `Page` and `Session`. Full reference lives at [mochijs.com](https://mochijs.com); the quickstart-relevant one-liners:

```ts
// Screenshot the current viewport (PNG by default).
const png = await page.screenshot();
await Bun.write("out.png", png);

// Full-page capture in JPEG with a quality knob.
const jpeg = await page.screenshot({ format: "jpeg", quality: 80, fullPage: true });

// Persist + replay cookies (JSON, NOT pickle).
await session.cookies.save("./cookies.json");
await session.cookies.load("./cookies.json");

// Direct DOMStorage access — no `evaluate` round-trip.
await page.localStorage.set({ token: "abc" });
const ls = await page.localStorage.get();

// Grant the full Browser.PermissionType list in one shot (handy for tests).
await page.grantAllPermissions();
```

Element-bounded screenshot (`page.screenshot({ element: handle })`) is deferred — see [`docs/limits.md`](limits.md). For now, pass an explicit `clip` rect.

## 8. Turnstile auto-click

If your target ships a visible Cloudflare Turnstile checkbox, opt in at launch:

```ts
const session = await mochi.launch({
  profile: "linux-chrome-stable",
  seed: "user-12345",
  challenges: {
    turnstile: {
      autoClick: true,
      onSolved: (token) => console.log("turnstile passed:", token.slice(0, 8) + "…"),
      onEscalation: (reason) => console.warn("escalation:", reason),
    },
  },
});
```

The click goes through the same Bezier+Fitts behavioral synth as `humanClick`. Image / audio / managed-mode escalations fire `onEscalation(reason)` (`"image-challenge" | "managed" | "timeout"`) and bail rather than clicking blindly into a challenge iframe. See [`packages/challenges/README.md`](../packages/challenges/README.md).

## 9. Cleanup

```sh
# Remove the cached Chromium build
bunx mochi browsers list
bunx mochi browsers uninstall <version>
```

## Troubleshooting

**`ChromiumNotFoundError`**
You skipped step 2. Run `bunx mochi browsers install`.

**`bun add` fails with `Workspace dependency not found`**
You're on `v0.1.0`, which leaked `workspace:*` into published `package.json` files. Upgrade: `bun add @mochi.js/core@latest @mochi.js/cli@latest` (the `v0.1.1` hot-fix rewrites those refs to concrete semver).

**Profile id resolves to a generic placeholder**
Six real-device baselines ship today (see step 4). Catalog ids outside that set still fall back to the generic placeholder; the Matrix is relationally locked but the surface values aren't from a real capture. See [`docs/limits.md`](limits.md).

**`bot.incolumitas.com` flags the session**
It will. So does every other CDP-driven tool — that page traps `Function.prototype.toString` on its anti-debugger trampoline, and the fix path is a Chromium C++ patch (which is [invariant I-1](../PLAN.md)). Tracked in [`docs/limits.md`](limits.md).

## Next steps

- [`docs/limits.md`](limits.md) — every known limit with root cause and workaround.
- [mochijs.com](https://mochijs.com) — landing + reference docs.
- [`PLAN.md`](../PLAN.md) — the design contract.
- [`tasks/`](../tasks/) — open task briefs you might want to pick up.
