---
title: Your first session
description: A drill into the session lifecycle — Profile + Matrix derivation, navigation, behavioral input, out-of-band fetch, and reading the manifest.
order: 2
category: getting-started
lastUpdated: 2026-05-09
---

Following [Installation](/docs/getting-started/install), you have `@mochi.js/core` installed and Chromium-for-Testing on disk. This page walks the API surface you'll use day-to-day. The conceptual *why* lives at [The Consistency Engine](/docs/concepts/consistency-engine), [The inject pipeline](/docs/concepts/inject-pipeline), and [Stealth philosophy](/docs/concepts/stealth-philosophy).

## Launch a Session

`mochi.launch(opts)` resolves a profile, derives a [consistency Matrix](/docs/concepts/consistency-engine) from `(profile, seed)`, spawns a Chromium child, and returns a `Session`.

```ts
import { mochi } from "@mochi.js/core";

const session = await mochi.launch({
  profile: "mac-m4-chrome-stable",       // device class
  seed: "user-12345",                    // per-user variation
  proxy: "http://us-east.example.proxy:443",  // optional URL string
});
```

A few things worth knowing:

- `profile` selects the device class. `seed` selects the per-user variation. Same `(profile, seed)` produces a byte-identical Matrix every run (excluding `derivedAt`).
- Six real-device profiles ship today — `mac-m4-chrome-stable`, `mac-chrome-stable`, `mac-chrome-beta`, `windows-chrome-stable`, `linux-chrome-stable`, `mac-brave-stable`. Other ids in `KNOWN_PROFILE_IDS` resolve to a generic Linux placeholder until their captures land. See [Profiles](/docs/concepts/profiles).
- The launched Chromium uses a clean per-Session ephemeral user-data-dir. Cookies, localStorage, and cache do not leak between sessions.
- Bun's `try/finally` is the right shape — `session.close()` flushes the CDP queue, kills the child, closes the scratch frame used by `Session.fetch`, and deletes the user-data-dir.

`LaunchOptions` carries a few more knobs. Selected fields:

```ts
interface LaunchOptions {
  profile: ProfileId | ProfileV1;        // string id OR inline ProfileV1
  seed: string;                          // required
  proxy?: string | ProxyConfig;          // ProxyConfig: { server, username?, password? }
  headlessMode?: "new" | "legacy" | "off";
  headless?: boolean;                    // legacy; mapped to headlessMode
  binary?: string;                       // override auto-resolved CfT
  args?: string[];                       // appended after default flags
  timeout?: number;                      // CDP request timeout, ms (default 30_000)
  challenges?: { turnstile?: { autoClick?, onSolved?, onEscalation? } };
  geoConsistency?: "privacy-fallback" | "auto-correct" | "strict" | "off";
  bypassInject?: boolean;                // capture flows ONLY — never in production
  hermetic?: boolean;                    // harness/CI only
  allowRootWithSandbox?: boolean;
}
```

`headlessMode` defaults to `"new"` on Linux without a display, `"off"` everywhere else. See [Linux server deployment](/docs/getting-started/linux-server) for the full table.

> **Connecting to an existing browser?** `mochi.connect({ wsEndpoint, profile, seed })` is the sibling entry point — attach to a CDP browser mochi did NOT spawn (BrowserBase, Browserless, Docker, re-attach). Pass `profile: null` to skip the spoof entirely. See [Connect to an existing Chrome](/docs/guides/connect-existing-chrome).

## Read the resolved Matrix

`session.profile` exposes the resolved [`MatrixV1`](/docs/concepts/consistency-engine):

```ts
console.log("UA:        ", session.profile.userAgent);
console.log("Locale:    ", session.profile.locale);
console.log("Timezone:  ", session.profile.timezone);
console.log("GPU:       ", session.profile.gpu.webglUnmaskedRenderer);
console.log("Cores:     ", session.profile.device.cores);
console.log("Behavior:  ", session.profile.behavior);  // { hand, tremor, wpm, scrollStyle }
```

The Matrix is the *single source of truth* — every spoofed surface (the inject layer, the `Sec-CH-UA*` headers Chromium emits via `Network.setUserAgentOverride`) reads from these fields. PLAN.md I-5.

## Navigate

```ts
const page = await session.newPage();
await page.goto("https://httpbin.org/headers", { waitUntil: "load" });

const html = await page.content();
console.log(html.slice(0, 200));
```

`page.goto` is `--remote-debugging-pipe`-driven. There is no TCP port; nothing for a network probe to scan. `waitUntil` accepts `"load" | "domcontentloaded" | "networkidle"` — `"networkidle"` is currently mapped to `"load"` until per-frame `Network.enable` lands (see [Limits](/docs/reference/limits)).

`page.url` (a getter, not a function) reflects the most recent navigation; `page.mainFrameId()` is diagnostic. `page.content()` returns the serialized `documentElement.outerHTML`. `page.text(selector)` returns `textContent` for the first match (or `null`).

## Evaluate JS in the page

```ts
const title = await page.evaluate<string>(() => document.title);
const linkCount = await page.evaluate<number>(() => document.querySelectorAll("a").length);
```

`page.evaluate(fn)` runs `fn` as a method on `document` (so `this === document`) via `Runtime.callFunctionOn` with `returnByValue: true` and `awaitPromise: true`. Constraints:

- The function must be a syntactically valid expression — closures over outer scope are not supported (cross-process evaluator).
- v0.1 takes a zero-arg `fn` only; argument passing lands later.
- Return values must be JSON-serializable. DOM nodes, functions, `undefined`, circular structures, classes, and Maps/Sets are coerced or dropped per CDP semantics.

Why these constraints? PLAN.md §8.2 forbids `Runtime.enable`, and §8.4 forbids `Page.createIsolatedWorld` and `Runtime.evaluate({ includeCommandLineAPI: true })`. Without those, the only way to run a function in main world is `Runtime.callFunctionOn` against the document's `objectId` — which has lossier return-value semantics than full `Runtime.evaluate`. The trade is the no-`Runtime.enable` stealth posture.

## Synthesize human input

The [behavioral surface](/docs/concepts/behavioral-synth) — `humanClick`, `humanType`, `humanScroll`, `humanMove`. Each derives from a Bezier+Fitts+jitter model parameterized by the matrix's `behavior` block.

```ts
await page.goto("https://example.com");

// Move the cursor to a Fitts-sampled point inside the target rect, then click.
await page.humanClick("a[href]");

// Type with lognormal digraph delays + adjacent-key mistakes (~2% rate by default).
await page.humanType("input[name=q]", "stealth automation");

// Inertial scroll to a selector or to absolute coords.
await page.humanScroll({ to: "footer" });
await page.humanScroll({ to: { x: 0, y: 1200 } });

// Hover without clicking.
await page.humanMove(400, 300);
```

`humanClick`, `humanType`, and `humanScroll` accept per-call overrides — `{ duration }`, `{ wpm, mistakeRate }`, `{ duration }` respectively. The matrix defaults are the canonical source; per-call overrides supersede *for that call only*. See [Behavioral synthesis](/docs/concepts/behavioral-synth).

For elements behind a *closed* shadow root (Cloudflare Challenge pages, some CDN configs), use the piercing locator:

```ts
const handle = await page.querySelectorPiercing("input[type=checkbox]");
if (handle !== null) await page.humanClickHandle(handle);
```

## Out-of-band fetch

`session.fetch(url, init)` routes through Chromium itself via CDP, so JA4/JA3/H2 are real Chrome by definition — same network stack as `page.goto`. Two paths under the hood:

- **Simple GET (no `init` / no method override / no headers / no body)** — drives `Network.loadNetworkResource`, which bypasses CORS at the network layer.
- **Anything else** (POST, custom headers, body) — routes through `page.evaluate("fetch(url, init)")` against an `about:blank` scratch frame the Session lazily allocates. Cookies inherit from the page's origin; CORS applies the same as a real user's `fetch` from the console.

```ts
const res = await session.fetch("https://api.example.com/v1/me", {
  method: "GET",
  headers: { Authorization: "Bearer ..." },
});
console.log(res.status, await res.text());
```

**Cookie-inheritance shift (vs. 0.6).** `session.fetch` now shares the session's cookie jar with the browser. A cookie set via `Page.goto` or `session.cookies.set` is sent on the next `session.fetch` to the same origin automatically. Pre-0.7 the wreq path was cookieless; if your code relied on that, set `init.credentials = "omit"` for the page-evaluate path or clear the jar before the call.

Body shapes supported today: `string`, `ArrayBuffer` / typed arrays, `URLSearchParams`. `Blob`, `FormData`, and `ReadableStream` throw with a clear diagnostic — they need a richer transport than the JSON-only page-evaluate seam, and land in a follow-up PR.

## Cookies + storage

The cookie-jar surface lives on `session.cookies` (a getter, not a function — the legacy `session.cookies(filter)` shape was retired in v0.2):

```ts
// Read
const cookies = await session.cookies.get();
const scoped = await session.cookies.get({ url: "https://example.com" });

// Write
await session.cookies.set([{ name: "auth", value: "...", domain: "example.com", path: "/", expires: -1, size: 0, httpOnly: true, secure: true, session: false }]);

// Persist (JSON, NOT pickle)
await session.cookies.save("./cookies.json");
await session.cookies.save("./cookies.json", { pattern: /\.example\.com$/ });

// Replay
await session.cookies.load("./cookies.json");
```

Per-page `localStorage` / `sessionStorage` route through CDP DOMStorage:

```ts
await page.localStorage.set({ token: "abc", lastVisit: "2026-05-09" });
const ls = await page.localStorage.get();

// Cross-origin scope:
await page.localStorage.set({ k: "v" }, { origin: "https://example.com" });
```

Both default to the page's main-frame origin. Pass `{ origin }` for cross-origin reads/writes. Throws if the page origin is opaque (`about:blank`) and no `origin` was passed.

## Screenshots

```ts
// Visible viewport, PNG bytes (default).
const png = await page.screenshot();
await Bun.write("page.png", png);

// Full-page JPEG with quality knob.
const jpeg = await page.screenshot({ format: "jpeg", quality: 80, fullPage: true });

// A region.
const region = await page.screenshot({ clip: { x: 100, y: 100, width: 400, height: 300 } });

// Inline base64.
const base64 = await page.screenshot({ encoding: "base64" });
```

Element-bounded capture (`{ element: handle }`) is deferred — see [Limits](/docs/reference/limits). For now, derive the rect from `DOM.getBoxModel` yourself and pass `clip`.

## Read the Probe Manifest

The harness drives a [Probe Manifest](/docs/concepts/probe-manifest) capture against a fixture page and diffs against the per-profile baseline:

```ts
import { capture } from "@mochi.js/harness";

const manifest = await capture(session, {
  fixtureUrl: "file:///absolute/path/to/tests/fixtures/probe-page.html",
});
await Bun.write("manifest.json", JSON.stringify(manifest, null, 2));
```

Compare against `packages/profiles/data/<profile-id>/baseline.manifest.json`. The harness does this automatically (`bun run harness:smoke`) — see [Probe Manifest](/docs/concepts/probe-manifest) for the diff pipeline and the Zero-Diff gate.

## Close cleanly

```ts
await session.close();
```

`close()` flushes the CDP queue, kills the Chromium child (SIGTERM → 2s grace → SIGKILL), closes the scratch frame used by `Session.fetch`, unsubscribes the [init-injector](/docs/concepts/inject-pipeline) handle, and removes the per-session ephemeral user-data-dir. It is idempotent — calling it twice is safe.

## Next

- [Quickstart](/docs/getting-started/quickstart) — copy-pasteable end-to-end recipe.
- [The Consistency Engine](/docs/concepts/consistency-engine) — the relational thesis.
- [The inject pipeline](/docs/concepts/inject-pipeline) — how the matrix reaches the page.
- [Behavioral synthesis](/docs/concepts/behavioral-synth) — Bezier+Fitts model.
- [Stealth philosophy → Network and JA4](/docs/concepts/stealth-philosophy) — why all mochi traffic is Chromium-native.
- [Probe Manifest](/docs/concepts/probe-manifest) — Zero-Diff gate.
- [Limits](/docs/reference/limits) — every known limit, with root cause.

<!-- llm-context:start
This page covers the Session + Page surfaces day-to-day — launch, evaluate, navigate, humanClick / humanType / humanScroll, session.fetch, cookies / localStorage / sessionStorage / grantAllPermissions, screenshot, capture(), close.

Verified API symbols (source: packages/core/src/session.ts, packages/core/src/page.ts):
- mochi.launch(opts: LaunchOptions): Promise<Session>
- session.profile: MatrixV1  (property)
- session.seed: string  (property)
- session.newPage(): Promise<Page>
- session.pages(): Page[]
- session.cookies: CookieJar  (getter, not a function)
  - cookies.get(filter?: { url?: string }): Promise<Cookie[]>
  - cookies.set(cookies: Cookie[]): Promise<void>
  - cookies.save(path: string, opts?: { pattern?: RegExp }): Promise<void>
  - cookies.load(path: string, opts?: { pattern?: RegExp }): Promise<void>
- session.storage(): Promise<StorageSnapshot>
- session.fetch(url: string, init?: RequestInit): Promise<Response>
- session.close(): Promise<void>

- page.url: string  (getter)
- page.mainFrameId(): string | null
- page.goto(url, opts?: GotoOptions): Promise<void>
- page.content(): Promise<string>
- page.text(selector: string): Promise<string | null>
- page.evaluate<T>(fn: () => T | Promise<T>): Promise<T>  // zero-arg fn; JSON return
- page.waitFor(selector: string, opts?: WaitForOptions): Promise<void>  // state: "attached"|"visible"|"hidden"
- page.cookies(): Promise<Cookie[]>
- page.cursorPosition(): { x: number, y: number }
- page.humanClick(selector, opts?): Promise<void>
- page.humanClickHandle(handle: ElementHandle, opts?): Promise<void>
- page.humanMove(x, y, opts?): Promise<void>
- page.humanType(selector, text, opts?): Promise<void>
- page.humanScroll(opts: HumanScrollOptions): Promise<void>
- page.querySelectorPiercing(selector): Promise<ElementHandle | null>
- page.querySelectorAllPiercing(selector): Promise<ElementHandle[]>
- page.localStorage: DomStorage  (getter)
- page.sessionStorage: DomStorage  (getter)
- page.grantAllPermissions(opts?: { origin? }): Promise<void>
- page.addInitScript(source: string): Promise<string>  // returns CDP identifier
- page.removeInitScript(identifier: string): Promise<void>
- page.screenshot(opts?: ScreenshotOptions): Promise<Uint8Array>  // base64 overload also available
- page.close(): Promise<void>

LaunchOptions (verified, source: packages/core/src/launch.ts):
See system context for the full list. Key constraints:
- profile + seed are REQUIRED.
- proxy can be a URL string OR ProxyConfig; ProxyConfig is { server, username?, password? } — there is NO separate `port` field.
- bypassInject is for capture flows ONLY; never enable in production.
- hermetic is for harness/CI only.

Common LLM hallucinations to avoid:
- session.profile() — false; profile is a property (getter on construction), not a function.
- session.cookies() called as function — false in v0.2+; use session.cookies.get().
- page.click(selector) — does NOT exist; use page.humanClick.
- page.type(selector, text) — does NOT exist; use page.humanType.
- page.hover(selector) — does NOT exist; resolve the rect and humanMove(x, y).
- page.evaluate(fn, arg1, arg2) — false; v0.1 takes zero-arg fn only.
- page.evaluate(() => document.body) — RETURN VALUE LOST. DOM nodes don't serialize through callFunctionOn.
- page.screenshot({ path: "out.png" }) — false; `path` is not an option. Capture and Bun.write yourself.
- session.fetch({ url, ... }) — false; signature is fetch(url, init?) — url first.
- page.goto(url, { headers }) — false; goto does not take headers.
- session.context() / session.newContext() — does NOT exist; sessions don't share Chromium.

Cross-references:
- /docs/getting-started/quickstart
- /docs/getting-started/install
- /docs/getting-started/linux-server
- /docs/getting-started/is-mochi-for-me
- /docs/concepts/consistency-engine
- /docs/concepts/inject-pipeline
- /docs/concepts/behavioral-synth
- /docs/concepts/probe-manifest
- /docs/concepts/profiles
- /docs/concepts/stealth-philosophy
- /docs/reference/limits
- /docs/api/core
llm-context:end -->
