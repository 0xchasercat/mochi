---
title: "@mochi.js/core"
description: "User-facing entrypoint — mochi.launch, Session, Page, ElementHandle, error classes, Linux-server detection."
order: 1
category: api
lastUpdated: 2026-05-09
---

`@mochi.js/core` is the package you import. `mochi.launch(opts)` resolves a profile, derives a `MatrixV1` from `(profile, seed)`, spawns Chromium-for-Testing under `--remote-debugging-pipe`, installs the inject pipeline + proxy-auth listener, and returns a `Session`. Every other `@mochi.js/*` package re-exports through here when it makes sense; reach for the sibling packages directly only when you need a piece of the surface that core doesn't expose (the FFI handle, the rule DAG, raw payload bytes, etc.).

## Installation

```sh
bun add @mochi.js/core
```

## Public exports

### Namespace `mochi`

```ts
export const mochi: {
  readonly version: string;
  readonly launch: (opts: LaunchOptions) => Promise<Session>;
  readonly connect: (opts: ConnectOptions) => Promise<Session>;
  readonly detectLinuxServerEnv: () => LinuxServerEnv;
  readonly defaultProfileForHost: () => ProfileId | null;
};
export type Mochi = typeof mochi;
```

The default import surface. `mochi.launch` is the one function 99% of users call; `mochi.connect` attaches to a Chromium mochi did NOT spawn (BrowserBase, dockerised Chromium, user-managed patched Chrome, re-attach); `mochi.version` exposes the package's `VERSION` constant; `mochi.detectLinuxServerEnv()` runs the same probe `launch` runs internally to decide the headless default; `mochi.defaultProfileForHost()` returns the profile id `launch` would auto-pick if `profile` were omitted.

```ts
import { mochi } from "@mochi.js/core";

const session = await mochi.launch({
  profile: "linux-chrome-stable",
  seed: "user-12345",
});
const page = await session.newPage();
await page.goto("https://example.com");
await session.close();
```

### `function launch(opts: LaunchOptions): Promise<Session>`

Same function as `mochi.launch`, exposed as a named export for users who tree-shake or prefer named imports.

### `interface LaunchOptions`

```ts
interface LaunchOptions {
  profile?: ProfileId | ProfileV1 | null;
  seed?: string;
  proxy?: string | ProxyConfig;
  headless?: boolean;
  headlessMode?: "new" | "legacy" | "off";
  binary?: string;
  args?: string[];
  out?: { traceDir?: string };
  timeout?: number;
  allowRootWithSandbox?: boolean;
  bypassInject?: boolean;
  hermetic?: boolean;
  challenges?: ChallengeLaunchOptions;
  geoConsistency?: GeoConsistencyMode;
}
```

- `profile` — **optional**. A `ProfileId` string (looked up under `packages/profiles/data/<id>/profile.json`), an inline `ProfileV1` object, or `null` to opt out of the spoof entirely (see [No-spoof mode](#no-spoof-mode-profile-null) below). When omitted, mochi calls [`defaultProfileForHost`](#function-defaultprofileforhost-profileid--null) and auto-picks the profile whose declared OS matches the host's `process.platform` / `process.arch` pair (`linux/x64` → `linux-chrome-stable`, `darwin/arm64` → `mac-m4-chrome-stable`, `darwin/x64` → `mac-chrome-stable`, `win32/x64` → `windows-chrome-stable`). On unsupported hosts (FreeBSD, Linux arm64 today, Windows arm64, Alpine musl) launch throws with a precise diagnostic listing the six explicit profile IDs. Explicit `profile` always wins. The architectural rationale lives in [Stealth philosophy → Default to the host OS](/docs/concepts/stealth-philosophy#default-to-the-host-os-not-windows).
- `seed` — required when `profile` is anything except `null`. Drives the consistency engine PRNG. Same `(profile, seed)` produces a byte-identical Matrix (excluding `derivedAt`). Ignored under `profile: null` (a `console.warn` fires if both are supplied).
- `proxy` — `"http://user:pass@host:port"` URL form, `"socks5://host:1080"` form, or `{ server, username?, password? }`. Credentials get stripped from the `--proxy-server=` flag and replayed via a CDP `Fetch.authRequired` handler.
- `headlessMode` — `"new"` (modern headless), `"legacy"`, or `"off"` (headful). When unset, mochi infers `"new"` on Linux without `DISPLAY` / `WAYLAND_DISPLAY`, `"off"` everywhere else. The legacy `headless: boolean` knob still works (`true` → `"new"`, `false` → `"off"`) but `headlessMode` wins when both are set.
- `binary` — path to a Chromium-for-Testing binary. When omitted, mochi resolves through `MOCHI_CHROMIUM_PATH`, then `~/.mochi/browsers/`. See [`mochi browsers install`](/docs/api/cli).
- `hermetic` — apply the harness/CI flag set (`--disable-component-update`, `--disable-default-apps`, `--disable-background-networking`, `--disable-sync`, plus a noise-reduction `--disable-features=` block). Default `false` so production users don't carry the passive command-line bot-tells. `mochi capture` and the harness orchestrator both set this `true`.
- `bypassInject` — skip the inject payload entirely (no `buildPayload`, no `Fetch.fulfillRequest` body splice, no worker injection). Used by `mochi capture`. Never enable in production — the browser exposes its bare CfT fingerprint.
- `geoConsistency` — `"privacy-fallback"` (default), `"auto-correct"`, `"strict"`, or `"off"`. Reconciles `(matrix.timezone, matrix.locale)` against the proxy's exit-IP geolocation; closes the cross-layer leak where a US profile over an EU proxy reports PT timezone while the IP geolocates to UTC+1.

See [Concepts → Profiles](/docs/concepts/profiles) for the `(profile, seed)` derivation contract.

#### No-spoof mode (`profile: null`)

Pass `profile: null` to skip every fingerprint override. Mochi launches a stock Chromium-for-Testing, drives it through the same `Session` / `Page` API surface (including `humanClick` / `humanType` / `session.fetch` / cookies / screenshots), but does **not**:

- derive a `MatrixV1`;
- compile or splice the inject payload;
- send `Network.setUserAgentOverride`, `Emulation.setTimezoneOverride`, `Emulation.setLocaleOverride`, `Page.addScriptToEvaluateOnNewDocument`, or any matrix-derived viewport / locale CDP call.

`Session.profile` surfaces as `null`. Behavioral synthesis falls back to [`DEFAULT_BEHAVIOR`](/docs/api/behavioral) from `@mochi.js/behavioral` (`{ hand: "right", tremor: 0.18, wpm: 60, scrollStyle: "smooth" }`).

```ts
import { mochi } from "@mochi.js/core";

const session = await mochi.launch({ profile: null });
const page = await session.newPage();
await page.goto("https://example.com");
// humanClick still works — uses DEFAULT_BEHAVIOR.
await page.humanClick("button#submit");
await session.close();
```

This is the right shape when you've layered your own stealth elsewhere (a patched binary, your own inject pipeline, a remote browser that already spoofs), or when you want to run the harness against the bare browser to measure a baseline.

### `function connect(opts: ConnectOptions): Promise<Session>`

Same shape as `mochi.connect`, exposed as a named export. Attaches to a CDP browser endpoint mochi did NOT spawn — BrowserBase, Browserless, a Chromium running in a Docker container you manage, a patched Chrome you want mochi to drive, or a Chromium you (or another tool) launched earlier and want to re-attach to.

`session.close()` disconnects the WebSocket without killing the browser, matching `puppeteer.connect`'s convention. The browser keeps running.

```ts
import { mochi } from "@mochi.js/core";

// Direct WebSocket endpoint (BrowserBase-style).
const a = await mochi.connect({
  wsEndpoint: "wss://gateway.browserbase.com/devtools/browser/abc123",
  profile: "linux-chrome-stable",
  seed: "user-12345",
  headers: { Authorization: "Bearer …" },
});

// HTTP base — mochi fetches /json/version to discover the WS URL.
const b = await mochi.connect({
  browserURL: "http://localhost:9222",
  profile: null,            // no-spoof — drive the bare browser
});
```

#### `interface ConnectOptions`

```ts
interface ConnectOptions {
  wsEndpoint?: string;
  browserURL?: string;
  profile?: ProfileId | ProfileV1 | null;
  seed?: string;
  geoConsistency?: GeoConsistencyMode;
  challenges?: ChallengeLaunchOptions;
  headers?: Record<string, string>;
  timeout?: number;
}
```

- `wsEndpoint` — direct WebSocket URL of the CDP browser endpoint (`ws://…/devtools/browser/<id>`). Takes precedence over `browserURL` when both are set.
- `browserURL` — base HTTP URL of the browser (e.g. `http://localhost:9222`). Mochi GETs `${browserURL}/json/version` and reads `webSocketDebuggerUrl` — the same discovery dance Puppeteer / Playwright run.
- `profile` — same semantics as `LaunchOptions.profile`, plus `null` for no-spoof mode. **Required**: `undefined` is rejected because the auto-pick path keys off the local `process.platform`, which is meaningless for a remote browser whose host OS we don't know. Pass an explicit profile (or `null`).
- `seed` — required when `profile` is non-null.
- `headers` — extra HTTP headers for the WebSocket upgrade request. Useful for proxied / authenticated CDP gateways (BrowserBase tokens, mTLS-gated Docker Chromium, etc.). Applied to the upgrade only; in-band CDP is unaffected.
- `geoConsistency`, `challenges`, `timeout` — same semantics as the matching `LaunchOptions` fields.

`ConnectOptions` deliberately **omits** launch-only fields (`binary`, `headless`, `proxy`, `extraArgs`, `hermetic`, `allowRootWithSandbox`, `bypassInject`). The browser is already running; the launcher's flag-set tradeoffs don't apply.

For end-to-end usage examples, see [Connect to an existing Chrome](/docs/guides/connect-existing-chrome).

### `class ConnectionLostError extends Error`

Thrown when the connect-mode transport could not be established (DNS, ECONNREFUSED, TLS, 4xx upgrade rejection, timeout) or when the live socket dropped without a clean close. Carries `endpoint: string` so logs can pinpoint which CDP gateway failed.

### `type ProfileId = string`

A `ProfileV1` directory id. Keep it string-typed; `@mochi.js/profiles` enumerates the shipped IDs in `KNOWN_PROFILE_IDS`.

### `interface ProxyConfig`

```ts
interface ProxyConfig {
  server: string;
  username?: string;
  password?: string;
}
```

Explicit form when the URL string isn't ergonomic (e.g. credentials with reserved characters that you'd rather not percent-encode).

### `interface ChallengeLaunchOptions`

```ts
interface ChallengeLaunchOptions {
  turnstile?: {
    autoClick?: boolean;
    timeout?: number;
    humanize?: boolean;
    onSolved?: (token: string) => void;
    onEscalation?: (reason: "image-challenge" | "managed" | "timeout") => void;
    pollIntervalMs?: number;
  };
}
```

When `turnstile.autoClick: true`, every page returned by `Session.newPage()` has [`installTurnstileAutoClick`](/docs/api/challenges) wired automatically. Image / audio / managed-failed iframes never get blind-clicked — `onEscalation` fires and the session bails. v0.2 covers visible-checkbox Turnstile only.

### `function resolveHeadlessMode(opts, env): "new" | "legacy" | "off"`

```ts
function resolveHeadlessMode(
  opts: Pick<LaunchOptions, "headless" | "headlessMode">,
  env: LinuxServerEnv,
): "new" | "legacy" | "off";
```

Pure resolver for the headless dispatch table. Exposed so unit tests (and downstream tooling) can assert what mode `launch` would pick without spawning a Chromium.

### `function defaultProfileForHost(): ProfileId | null`

```ts
function defaultProfileForHost(): ProfileId | null;
function resolveDefaultProfileForHost(
  platform: NodeJS.Platform,
  arch: string,
): ProfileId | null;
```

Returns the profile id `launch` would auto-pick on the current host when `profile` is omitted from `LaunchOptions`. Pure read of `process.platform` / `process.arch`. Returns `null` on unsupported hosts (FreeBSD, Linux arm64 today, Windows arm64, Alpine musl) — `launch` throws on that path with a list of the six explicit profile IDs.

```ts
import { mochi, defaultProfileForHost } from "@mochi.js/core";

console.log(defaultProfileForHost());
// On a Linux x64 server: "linux-chrome-stable"
// On a Mac arm64 dev box: "mac-m4-chrome-stable"
// On linux/arm64:         null  (unsupported — pass profile explicitly)

// The auto-pick happens transparently when `profile` is omitted:
const session = await mochi.launch({ seed: "u-1" });
// [mochi] no profile supplied; auto-picked linux-chrome-stable for host linux/x64. ...
```

The strategic rationale: spoofing Windows from a Linux server is the wrong default — Linux is a real-user signal, not a bot signal — see [Stealth philosophy → Default to the host OS](/docs/concepts/stealth-philosophy#default-to-the-host-os-not-windows). `resolveDefaultProfileForHost` is the same table exposed for tests that want to drive both axes without stubbing `process`.

### `class Session`

The per-`(profile, seed)` browser lifecycle. Owns one Chromium child + one CDP transport + one lazily-opened net Ctx. Constructed by `launch`; close idempotently via `session.close()`.

```ts
class Session {
  readonly profile: MatrixV1 | null;
  readonly seed: string;
  readonly owned: boolean;
  newPage(): Promise<Page>;
  pages(): Page[];
  get cookies(): CookieJar;
  storage(): Promise<StorageSnapshot>;
  fetch(url: string, init?: RequestInit): Promise<Response>;
  close(): Promise<void>;
}
```

- `profile` — the resolved `MatrixV1` (NOT the input `ProfileV1`). Read it for `userAgent`, `locale`, `timezone`, `display.{width,height}`, etc. **`null`** when the session was launched / connected with `profile: null` (no-spoof mode) — the browser is presenting its bare fingerprint.
- `owned` — `true` for sessions returned by `mochi.launch` (mochi spawned the Chromium it owns; `close()` kills it). `false` for `mochi.connect` sessions (mochi attached to a browser the caller manages; `close()` disconnects the WebSocket but leaves the browser running, matching `puppeteer.connect`).
- `newPage()` — opens a tab via `Target.createTarget` + `Target.attachToTarget({ flatten: true })`, then wires the inject payload through both the session-level Fetch splice AND the per-page `Page.addScriptToEvaluateOnNewDocument` fallback. Returns a `Page`.
- `cookies` — see `CookieJar` below.
- `fetch(url, init)` — out-of-band HTTP routed through Chromium itself via CDP. Simple GETs (no `init` / no method override / no headers / no body) use `Network.loadNetworkResource` (no CORS at the network layer); anything else uses `page.evaluate("fetch(url, init)")` against an `about:blank` scratch frame. JA4/JA3/H2 are real Chrome by definition because Chromium is the client. Cookies inherit from the page's origin; CORS applies for non-GET cross-origin calls. Body shapes: `string`, `ArrayBuffer` / typed arrays, `URLSearchParams`. `Blob` / `FormData` / `ReadableStream` throw with a clear diagnostic.
- `storage()` — snapshot `{ cookies, localStorage: {}, sessionStorage: {} }`. localStorage / sessionStorage are placeholders today; for live read/write use `Page.localStorage` / `Page.sessionStorage`.
- `close()` — disposes challenge handles, closes every page, closes the scratch frame used by `Session.fetch`, removes the init-injector subscription, closes the router, kills Chromium (SIGTERM → 2s grace → SIGKILL), removes the user-data-dir.

```ts
const session = await mochi.launch({ profile: "mac-m4-chrome-stable", seed: "u-1" });
try {
  const page = await session.newPage();
  await page.goto("https://api.example.com/whoami");
  const html = await page.content();
  const apiResp = await session.fetch("https://api.example.com/profile", {
    headers: { authorization: "Bearer abc" },
  });
  console.log(apiResp.status, html.slice(0, 200));
} finally {
  await session.close();
}
```

### `interface SessionInit`

Constructor-init shape. Internal — `launch` builds it for you. Exposed for tests + downstream tooling.

```ts
interface SessionInit {
  proc: ChromiumProcess;
  matrix: MatrixV1 | null;
  seed: string;
  owned?: boolean;
  defaultTimeoutMs?: number;
  bypassInject?: boolean;
  netProxy?: string;
  proxyAuth?: { username: string; password: string };
  netAdapter?: NetAdapter; // @internal
  challenges?: ChallengeLaunchOptions;
}
```

### `interface CookieJar`

```ts
interface CookieJar {
  get(filter?: { url?: string }): Promise<Cookie[]>;
  set(cookies: Cookie[]): Promise<void>;
  save(path: string, opts?: CookieJarOptions): Promise<void>;
  load(path: string, opts?: CookieJarOptions): Promise<void>;
}
```

Returned from `session.cookies`. Routes through `Storage.getCookies` / `Storage.setCookies` on the root browser target — the jar is session-wide, not page-scoped. `save` / `load` read and write a JSON file with the `CookieJarFile` shape; `pattern` (a `RegExp`) filters by `cookie.domain` and applies on both sides.

```ts
await session.cookies.save("./state/cookies.json", {
  pattern: /\.example\.com$/,
});

// In a future run:
await session.cookies.load("./state/cookies.json");
```

### `interface CookieJarFile`

```ts
interface CookieJarFile {
  version: 1;
  savedAt: string; // ISO-8601 UTC
  mochiVersion: string;
  pattern: string; // regex source
  count: number;
  cookies: Cookie[];
}
```

### `interface CookieJarOptions`

```ts
interface CookieJarOptions {
  pattern?: RegExp;
}
```

### `const COOKIE_JAR_FORMAT_VERSION: 1`

Format version stamped on every saved jar. The reader rejects unknown majors with a precise diagnostic.

### `interface StorageSnapshot`

```ts
interface StorageSnapshot {
  cookies: Cookie[];
  localStorage: Record<string, Record<string, string>>;
  sessionStorage: Record<string, Record<string, string>>;
}
```

Returned by `session.storage()`. localStorage / sessionStorage are empty placeholders at v0.1.x — use `Page.localStorage` / `Page.sessionStorage` for the live read/write surface.

### `class Page`

Owns one Chromium tab + the per-page CDP target. Constructed by `Session.newPage()` — never directly.

```ts
class Page {
  get url(): string;
  mainFrameId(): string | null;
  cursorPosition(): { x: number; y: number };
  goto(url: string, opts?: GotoOptions): Promise<void>;
  content(): Promise<string>;
  text(selector: string): Promise<string | null>;
  evaluate<T>(fn: () => T | Promise<T>): Promise<T>;
  waitFor(selector: string, opts?: WaitForOptions): Promise<void>;
  cookies(): Promise<Cookie[]>;
  get localStorage(): DomStorage;
  get sessionStorage(): DomStorage;
  grantAllPermissions(opts?: GrantAllPermissionsOptions): Promise<void>;
  addInitScript(source: string): Promise<string>;
  removeInitScript(identifier: string): Promise<void>;
  humanMove(x: number, y: number, opts?: HumanMoveOptions): Promise<void>;
  humanClick(selector: string, opts?: HumanClickOptions): Promise<void>;
  humanClickHandle(handle: ElementHandle, opts?: HumanClickOptions): Promise<void>;
  humanType(selector: string, text: string, opts?: HumanTypeOptions): Promise<void>;
  humanScroll(opts: HumanScrollOptions): Promise<void>;
  querySelectorPiercing(selector: string): Promise<ElementHandle | null>;
  querySelectorAllPiercing(selector: string): Promise<ElementHandle[]>;
  screenshot(opts: ScreenshotOptions & { encoding: "base64" }): Promise<string>;
  screenshot(opts?: ScreenshotOptions & { encoding?: "binary" }): Promise<Uint8Array>;
  close(): Promise<void>;
}
```

Critical §8.2 invariant: `Page` never sends `Runtime.enable`. Evaluation routes through `DOM.resolveNode` → `Runtime.callFunctionOn` against the document's `objectId`, which runs in the page's main world without naming an isolated world.

#### Navigation + content

- `goto(url, opts?)` — `waitUntil: "load" | "domcontentloaded" | "networkidle"`. `"networkidle"` is currently mapped to `"load"` until per-frame `Network.enable` lands.
- `content()` — outerHTML of `document.documentElement`.
- `text(selector)` — `textContent` of the first match, or `null`.
- `evaluate(fn)` — `Runtime.callFunctionOn` on the document with `awaitPromise: true`. Limits: function takes no args, returns a JSON-serializable value or a `Promise` of one.
- `waitFor(selector, { state, timeout })` — `state: "attached" | "visible" | "hidden"`, polls every 50ms.

#### Behavioral input

- `humanClick(selector, { button?, duration?, preMoveSettle? })` — Bezier+Fitts trajectory, then `mousePressed` + `mouseReleased`.
- `humanType(selector, text, { wpm?, mistakeRate? })` — focus + lognormal digraph delays + adjacent-key mistakes. `text === ""` clears the field with realistic Backspace timings.
- `humanScroll({ to, duration? })` — inertial scroll with friction. `to` is a CSS selector (`"footer"`, `"[data-testid=item]:last-of-type"`) or absolute coords `{ x, y }`. There are no magic keywords: `humanScroll({ to: "top" })` does **not** scroll to the top — it parses `"top"` as a selector and (almost certainly) fails to resolve. Use `{ to: { x: 0, y: 0 } }` for top, `{ to: "footer" }` (or coords matching `document.body.scrollHeight`) for bottom.
- `humanMove(x, y, { duration? })` — trajectory only, no click. Updates the cursor so a subsequent `humanClick` chains realistically from this point.
- `humanClickHandle(handle, opts?)` — same as `humanClick` but takes an `ElementHandle` (used after `querySelectorPiercing`).

#### Closed-shadow piercing

- `querySelectorPiercing(selector)` — find an element across the entire DOM, piercing closed shadow roots. Required for Cloudflare Turnstile auto-click on Cloudflare Challenge pages where the widget iframe lives behind a closed shadow root. Selector grammar: tag / id / class / attribute / descendant / comma-list. **No** `>`/`+`/`~` combinators, **no** pseudo-classes, **no** XPath.
- `querySelectorAllPiercing(selector)` — DFS pre-order match list.

#### Storage + permissions

- `localStorage.get(opts?) / set(items, opts?)` — backed by `DOMStorage.getDOMStorageItems` / `setDOMStorageItem`. Origin defaults to the page's main-frame origin; pass `{ origin }` to scope explicitly. `set` has `Object.assign` semantics. Throws on opaque origins (`about:blank`, `data:`).
- `sessionStorage` — same surface, hits sessionStorage via `isLocalStorage: false`.
- `grantAllPermissions({ origin? })` — wraps `Browser.grantPermissions` with the full `ALL_BROWSER_PERMISSIONS` descriptor list. Browser-level grant; the page-side `navigator.permissions.query()` matrix is still controlled by the inject (R-036) — orthogonal surfaces.

#### Init scripts

- `addInitScript(source)` — installs a main-world script via `Page.addScriptToEvaluateOnNewDocument({ runImmediately: true, worldName: "" })`. Returns the CDP identifier. Empty `worldName` is critical — naming a world creates an isolated world (PLAN.md §8.4) that's detectable.
- `removeInitScript(identifier)` — best-effort uninstall.

The session's Mochi inject payload is NOT routed through `addInitScript` — see [the inject pipeline concept page](/docs/concepts/inject-pipeline).

#### Capture

- `screenshot(opts?)` — CDP `Page.captureScreenshot`. Defaults to a PNG `Uint8Array` of the visible viewport. `format: "png" | "jpeg" | "webp"`, `quality: 0..100` (jpeg/webp only), `fullPage: true` (synthesized via `Emulation.setDeviceMetricsOverride`), `clip: { x, y, width, height, scale? }`, `omitBackground: true` (PNG only), `encoding: "binary" | "base64"`. `clip` and `fullPage` are mutually exclusive — `clip` wins.

```ts
const png = await page.screenshot({ fullPage: true });
await Bun.write("./out.png", png);

const b64 = await page.screenshot({ format: "jpeg", quality: 80, encoding: "base64" });
```

### `class ElementHandle`

```ts
class ElementHandle {
  constructor(init: ElementHandleInit);
  get backendNodeId(): number;
  getAttribute(name: string): Promise<string | null>;
  textContent(): Promise<string | null>;
  evaluate<T>(fn: (this: Element) => T): Promise<T>;
}
```

Issued by `page.querySelectorPiercing` / `querySelectorAllPiercing`. Lifetime is bound to the page's CDP session — closing the page invalidates every handle.

### `interface ElementHandleInit`

```ts
interface ElementHandleInit {
  router: MessageRouter;
  sessionId: CdpSessionId;
  objectId: string;
  backendNodeId: number;
}
```

### Page option types

```ts
type WaitUntil = "load" | "domcontentloaded" | "networkidle";
interface GotoOptions { waitUntil?: WaitUntil; timeout?: number; }
type WaitState = "attached" | "visible" | "hidden";
interface WaitForOptions { timeout?: number; state?: WaitState; }
interface HumanClickOptions {
  button?: "left" | "right" | "middle";
  duration?: number;
  preMoveSettle?: boolean;
}
interface HumanMoveOptions { duration?: number; }
interface HumanTypeOptions { wpm?: number; mistakeRate?: number; }
interface HumanScrollOptions {
  to: string | { x: number; y: number };
  duration?: number;
}
interface DomStorageOptions { origin?: string; }
interface DomStorage {
  get(opts?: DomStorageOptions): Promise<Record<string, string>>;
  set(items: Record<string, string>, opts?: DomStorageOptions): Promise<void>;
}
interface GrantAllPermissionsOptions { origin?: string; }
interface ScreenshotOptions {
  format?: "png" | "jpeg" | "webp";
  quality?: number;
  fullPage?: boolean;
  clip?: { x: number; y: number; width: number; height: number; scale?: number };
  omitBackground?: boolean;
  encoding?: "binary" | "base64";
}
```

### `interface PageInit`

Constructor shape for `Page`. `Session.newPage` builds it; you should not construct pages directly.

### `const ALL_BROWSER_PERMISSIONS`

```ts
const ALL_BROWSER_PERMISSIONS = [
  "accessibilityEvents", "audioCapture", "backgroundSync", "backgroundFetch",
  "captureHandle", "clipboardReadWrite", "clipboardSanitizedWrite",
  "displayCapture", "durableStorage", "flash", "geolocation",
  "idleDetection", "localFonts", "midi", "midiSysex", "nfc", "notifications",
  "paymentHandler", "periodicBackgroundSync", "protectedMediaIdentifier",
  "sensors", "storageAccess", "speakerSelection", "topLevelStorageAccess",
  "videoCapture", "videoCapturePanTiltZoom", "wakeLockScreen", "wakeLockSystem",
  "webAppInstallation", "windowManagement",
] as const;
type BrowserPermission = (typeof ALL_BROWSER_PERMISSIONS)[number];
```

Pinned to Chromium ≥ 131 (the mochi profile floor). The list is verbose-on-purpose so a contract test catches the day Chromium adds a new permission.

### `interface Cookie`

```ts
interface Cookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number;
  size: number;
  httpOnly: boolean;
  secure: boolean;
  session: boolean;
  sameSite?: "Strict" | "Lax" | "None";
}
```

Mirrors CDP `Network.Cookie`.

### Linux-server detection

```ts
interface LinuxServerProbes {
  platform: NodeJS.Platform;
  display: string | undefined;
  waylandDisplay: string | undefined;
  uid: number | undefined;
  hasDockerEnvFile: boolean;
  cgroup: string | undefined;
}
interface LinuxServerEnv {
  serverNoDisplay: boolean;
  root: boolean;
  container: boolean;
  rationale: string;
}
function detectLinuxServerEnv(probes: LinuxServerProbes): LinuxServerEnv;
function probeLinuxServerEnv(): LinuxServerEnv;
function snapshotProbes(): LinuxServerProbes;
```

`probeLinuxServerEnv()` is what `mochi.detectLinuxServerEnv()` calls — same return value. Use it to introspect whether `launch` would auto-pick `headlessMode: "new"`. See [Linux server setup](/docs/getting-started/linux-server).

### Geo-consistency

```ts
type GeoConsistencyMode = "privacy-fallback" | "auto-correct" | "strict" | "off";
interface GeoReconcileResult {
  readonly matrix: MatrixV1;
  readonly action: "ok" | "no-probe" | "off" | "privacy-fallback" | "auto-correct";
  readonly geo: ExitGeo | null;
  readonly reason?: string;
}
class GeoMismatchError extends Error { /* matrix, geo, reason */ }
function tzOffsetMinutes(zone: string, ref?: Date): number | null;
function localeRegion(locale: string): string | null;
function reconcileGeoConsistency(
  matrix: MatrixV1,
  geo: ExitGeo | null,
  mode: GeoConsistencyMode,
): GeoReconcileResult;
interface ExitGeo {
  readonly ip: string;
  readonly country: string;
  readonly region?: string;
  readonly city?: string;
  readonly timezone: string;
  readonly postalCode?: string;
  readonly lat?: number;
  readonly lng?: number;
  readonly source: string;
}
interface ProbeOptions {
  readonly proxy?: string;
  readonly matrix?: Partial<MatrixV1>;
  readonly maxAttempts?: number;
  readonly perEndpointTimeoutMs?: number;
  readonly fetch?: ProbeFetch;
  readonly shuffle?: (xs: readonly Adapter[]) => readonly Adapter[];
}
function probeExitGeo(opts: ProbeOptions): Promise<ExitGeo | null>;
```

`probeExitGeo` issues a single GET through the session's Chromium-native network stack (4-attempt cap, 2s per endpoint). `reconcileGeoConsistency` cross-references `(matrix.timezone, matrix.locale)` against the IP's country/timezone and applies the policy. `launch` calls both internally when `geoConsistency !== "off"`.

### `function parseProxyUrl(url: string): ParsedProxy`

```ts
interface ParsedProxy {
  server: string;
  auth?: { username: string; password: string };
  protocol: "http" | "https" | "socks5" | "socks4";
}
```

Accepts `http://user:pass@host:port`, `socks5://user@host:1080`, `http://host:8080`, percent-encoded credentials, IPv6 hosts. Throws on unsupported protocols or empty hosts.

### Error classes

```ts
class ChromiumNotFoundError extends Error { /* "ChromiumNotFoundError" */ }
class BrowserCrashedError extends Error { /* "BrowserCrashedError"; cause? */ }
class CdpRemoteError extends Error {
  readonly method: string;
  readonly code: number;
  readonly data: unknown;
}
class CdpTimeoutError extends Error {
  readonly method: string;
  readonly timeoutMs: number;
}
class ForbiddenCdpMethodError extends Error { /* §8.2 violation */ }
class NotImplementedError extends Error { /* placeholder */ }
class GeoMismatchError extends Error {
  readonly matrix: { timezone: string; locale: string };
  readonly geo: ExitGeo;
  readonly reason: string;
}
```

### CDP router types

```ts
type CdpEventHandler = (params: unknown, sessionId?: CdpSessionId) => void;
type Unsubscribe = () => void;
interface SendOptions {
  timeoutMs?: number;
  sessionId?: CdpSessionId;
}
```

### `const VERSION: string`

The package version as published on npm. Mirrored on `mochi.version`.

## Common patterns

### Scrape under a residential proxy

```ts
import { mochi } from "@mochi.js/core";

const session = await mochi.launch({
  profile: "linux-chrome-stable",
  seed: process.env.RUN_ID ?? "default",
  proxy: process.env.PROXY_URL, // "http://user:pass@host:port"
  geoConsistency: "privacy-fallback",
});
try {
  const page = await session.newPage();
  await page.goto("https://target.example.com");
  const html = await page.content();
  console.log(html.length);
} finally {
  await session.close();
}
```

### Persist + restore a cookie jar

```ts
const a = await mochi.launch({ profile: "mac-m4-chrome-stable", seed: "u1" });
const page = await a.newPage();
await page.goto("https://app.example.com/login");
await page.humanType("input[name=email]", "me@example.com");
await page.humanType("input[name=password]", "hunter2");
await page.humanClick("button[type=submit]");
await page.waitFor("[data-testid=dashboard]");
await a.cookies.save("./state/jar.json", { pattern: /\.example\.com$/ });
await a.close();

const b = await mochi.launch({ profile: "mac-m4-chrome-stable", seed: "u1" });
await b.cookies.load("./state/jar.json");
const p = await b.newPage();
await p.goto("https://app.example.com/dashboard"); // already logged in
```

### Side-channel API call sharing the session's TLS fingerprint

```ts
const session = await mochi.launch({ profile: "linux-chrome-stable", seed: "x" });
const apiResp = await session.fetch("https://api.example.com/v1/me", {
  headers: { authorization: `Bearer ${token}` },
});
console.log(apiResp.status, await apiResp.json());
await session.close();
```

### Auto-solve Turnstile on every new page

```ts
const session = await mochi.launch({
  profile: "mac-m4-chrome-stable",
  seed: "u1",
  challenges: {
    turnstile: {
      autoClick: true,
      onSolved: (token) => console.log("got cf-turnstile token:", token.slice(0, 8)),
      onEscalation: (reason) => console.warn("turnstile escalated:", reason),
    },
  },
});
const page = await session.newPage();
await page.goto("https://protected.example.com");
```

### Pierce a closed shadow root and click

```ts
const handle = await page.querySelectorPiercing("iframe[src*='challenges.cloudflare.com']");
if (handle !== null) {
  const src = await handle.getAttribute("src");
  await page.humanClickHandle(handle);
}
```

## Errors

| Class | When it fires | How to recover |
| --- | --- | --- |
| `ChromiumNotFoundError` | No CfT install matched and `MOCHI_CHROMIUM_PATH` is unset | `bunx mochi browsers install` or set `MOCHI_CHROMIUM_PATH` |
| `BrowserCrashedError` | Chromium child exited or pipe closed mid-call | Re-launch the session; check `cause` for the underlying signal |
| `CdpRemoteError` | A CDP method returned `{error: ...}` | Read `.method`, `.code`, `.data`; usually a logic bug in the caller |
| `CdpTimeoutError` | A CDP request didn't resolve within `timeoutMs` | Bump `LaunchOptions.timeout` or per-call `timeout` |
| `ForbiddenCdpMethodError` | Code reached for `Runtime.enable` / `Page.createIsolatedWorld` / similar §8.2-banned method | Don't reach into `session._internalRouter()`; if you must, file an issue |
| `NotImplementedError` | A placeholder method that hasn't shipped yet | Check the version table; pin a compatible release |
| `GeoMismatchError` | `geoConsistency: "strict"` and the proxy egress doesn't match the matrix's `(timezone, locale)` | Switch profile, switch proxy, or relax to `"privacy-fallback"` |

## See also

- [Concepts → Inject pipeline](/docs/concepts/inject-pipeline)
- [Concepts → Profiles](/docs/concepts/profiles)
- [Guides → Cookies and storage](/docs/guides/cookies-and-storage)
- [Guides → Proxy auth](/docs/guides/proxy-auth)
- [Guides → Cloudflare Turnstile](/docs/guides/turnstile)
- [Guides → Screenshots](/docs/guides/screenshots)
- [API → @mochi.js/consistency](/docs/api/consistency)
- [API → @mochi.js/inject](/docs/api/inject)
- [API → @mochi.js/challenges](/docs/api/challenges)
- [API → mochi CLI](/docs/api/cli)
- [Reference → Limits](/docs/reference/limits)

<!-- llm-context:start
Package: @mochi.js/core
Public surface (verbatim from packages/core/src/index.ts as of 2026-05-09):

Re-exports:
  ChromiumNotFoundError                              (class, from "./binary")
  ForbiddenCdpMethodError                            (class, from "./cdp/forbidden")
  BrowserCrashedError                                (class, from "./cdp/router")
  CdpRemoteError                                     (class)
  CdpTimeoutError                                    (class)
  CdpEventHandler                                    (type)
  SendOptions                                        (type)
  Unsubscribe                                        (type)
  NotImplementedError                                (class, from "./errors")

  GeoConsistencyMode                                 (type)
  GeoMismatchError                                   (class)
  GeoReconcileResult                                 (type)
  localeRegion                                       (function)
  reconcileGeoConsistency                            (function)
  tzOffsetMinutes                                    (function)
  ExitGeo                                            (type, from "./geo-probe")
  ProbeOptions                                       (type)
  probeExitGeo                                       (function)

  ChallengeLaunchOptions                             (type, from "./launch")
  LaunchOptions                                      (type)
  launch(opts: LaunchOptions): Promise<Session>      (function)
  Mochi                                              (type)
  mochi                                              (const namespace)
  ProfileId                                          (type alias for string)
  ProxyConfig                                        (type)
  resolveHeadlessMode(opts, env)                     (function)

  defaultProfileForHost(): ProfileId | null          (function, from "./default-profile")
  resolveDefaultProfileForHost(platform, arch)       (function — pure resolver for tests)
  EXPLICIT_PROFILE_IDS                               (const tuple of 6 real-device profile IDs)

  detectLinuxServerEnv(probes): LinuxServerEnv       (function, from "./linux-server")
  LinuxServerEnv                                     (type)
  LinuxServerProbes                                  (type)
  probeLinuxServerEnv(): LinuxServerEnv              (function)
  snapshotProbes(): LinuxServerProbes                (function)

  ALL_BROWSER_PERMISSIONS                            (const tuple, from "./page")
  BrowserPermission                                  (type)
  Cookie                                             (type)
  DomStorage                                         (type)
  DomStorageOptions                                  (type)
  GotoOptions                                        (type)
  GrantAllPermissionsOptions                         (type)
  HumanClickOptions                                  (type)
  HumanMoveOptions                                   (type)
  HumanScrollOptions                                 (type)
  HumanTypeOptions                                   (type)
  Page                                               (class)
  PageInit                                           (type)
  ScreenshotOptions                                  (type)
  WaitForOptions                                     (type)
  WaitState                                          (type)
  WaitUntil                                          (type)

  ElementHandle                                      (class, from "./page/element-handle")
  ElementHandleInit                                  (type)

  ParsedProxy                                        (type, from "./proxy-auth")
  parseProxyUrl(url: string): ParsedProxy            (function)

  COOKIE_JAR_FORMAT_VERSION                          (const, value 1, from "./session")
  CookieJar                                          (type)
  CookieJarFile                                      (type)
  CookieJarOptions                                   (type)
  Session                                            (class)
  SessionInit                                        (type)
  StorageSnapshot                                    (type)

  VERSION                                            (const string, from "./version")

mochi namespace shape:
  mochi.version: string
  mochi.launch(opts: LaunchOptions): Promise<Session>
  mochi.detectLinuxServerEnv(): LinuxServerEnv
  mochi.defaultProfileForHost(): ProfileId | null  // host-OS auto-pick

LaunchOptions:
  - profile is OPTIONAL. When omitted, mochi auto-picks via defaultProfileForHost():
      linux/x64    → linux-chrome-stable
      darwin/arm64 → mac-m4-chrome-stable
      darwin/x64   → mac-chrome-stable
      win32/x64    → windows-chrome-stable
    Unsupported hosts throw with a list of the 6 explicit profile IDs.
    Explicit `profile` always wins.
  - On Linux servers, omit `profile`; the default is the right answer.
  - Strategic rationale: https://mochijs.com/docs/concepts/stealth-philosophy#default-to-the-host-os-not-windows

Session methods:
  session.profile: MatrixV1
  session.seed: string
  session.newPage(): Promise<Page>
  session.pages(): Page[]
  session.cookies: CookieJar (getter)
  session.storage(): Promise<StorageSnapshot>
  session.fetch(url, init?): Promise<Response>
  session.close(): Promise<void>

Page methods:
  page.url (getter)
  page.mainFrameId(): string | null
  page.cursorPosition(): {x, y}
  page.goto(url, opts?)
  page.content()
  page.text(selector)
  page.evaluate(fn)
  page.waitFor(selector, opts?)
  page.cookies()
  page.localStorage / page.sessionStorage (getters → DomStorage)
  page.grantAllPermissions(opts?)
  page.addInitScript(source) → identifier
  page.removeInitScript(identifier)
  page.humanMove(x, y, opts?)
  page.humanClick(selector, opts?)
  page.humanClickHandle(handle, opts?)
  page.humanType(selector, text, opts?)
  page.humanScroll(opts)
  page.querySelectorPiercing(selector)
  page.querySelectorAllPiercing(selector)
  page.screenshot(opts?) — overloaded: encoding "base64" → string, "binary" (default) → Uint8Array
  page.close()

CookieJar methods: get, set, save, load
DomStorage methods: get, set
ElementHandle methods: backendNodeId (getter), getAttribute, textContent, evaluate

Common LLM hallucinations for this package (DO NOT use these — they do not exist):
- `mochi.connect()` / `mochi.attach()` — there is no remote-attach API
- `session.context()` / `session.contexts` / `BrowserContext` — mochi has no Playwright-style contexts; one Session = one Chromium child
- `page.click(selector)` / `page.type(selector, text)` — names are `humanClick` / `humanType` (no plain `click` / `type`)
- `page.fill(selector, value)` — does not exist; use `humanType`
- `page.hover(selector)` — does not exist; use `humanMove(x, y)` or compute the box and move into it
- `page.$(selector)` / `page.$$(selector)` — no jQuery-style shortcuts; use `text()`, `humanClick(selector)`, or `querySelectorPiercing(selector)`
- `page.locator(selector)` — no Playwright-style locator API
- `page.frames()` / `page.frame(name)` — no frame surface in v0.1.x
- `page.setViewportSize()` — viewport is matrix-derived; pass `display.{width,height}` via the profile, not at runtime
- `page.setExtraHTTPHeaders()` — not in v0.1.x; use `session.fetch` for header control or set them on the profile/matrix
- `Session.context.cookies()` — call `session.cookies.get()` (not `.cookies()`)
- `session.cookies()` (function-call form) — `cookies` is a getter returning the `CookieJar`; call `session.cookies.get()`
- `page.evaluate(fn, ...args)` — `evaluate` takes a zero-arg function only; arguments are not supported in v0.1.x
- `page.waitForSelector` / `page.waitForLoadState` / `page.waitForNavigation` — use `page.waitFor(selector)` and `goto({ waitUntil })`
- `page.screenshot({ path: "..." })` — there is no `path` option; the call returns bytes. Write yourself with `Bun.write(path, bytes)`
- `page.pdf()` / `Page.printToPDF` — not implemented
- `mochi.launch({ headless: "new" })` — `headless` is boolean. Use `headlessMode: "new"`
- `mochi.launch({ profile: "windows-chrome-stable" })` from a Linux server — that's the wrong default. On Linux, omit `profile` (mochi auto-picks `linux-chrome-stable`) or pass it explicitly. Linux is a real-user signal, not a bot signal — full rationale at https://mochijs.com/docs/concepts/stealth-philosophy
- `LaunchOptions.userDataDir` — not a public option; mochi manages a per-Session ephemeral user-data-dir
- `LaunchOptions.viewport` — derive viewport from the profile/matrix, not at launch
- `LaunchOptions.executablePath` — use `binary`
- `LaunchOptions.proxy.bypass` — not supported; the proxy URL is the entire surface
- `Runtime.enable` / `Page.createIsolatedWorld` — forbidden via `ForbiddenCdpMethodError`; do not reach for these
- `addInitScript({ path })` — only the source-string form exists; read the file yourself

Cross-references:
- /docs/api/consistency
- /docs/api/inject
- /docs/api/behavioral
- /docs/api/challenges
- /docs/api/net
- /docs/api/profiles
- /docs/api/cli
- /docs/concepts/inject-pipeline
- /docs/concepts/profiles- /docs/concepts/consistency-engine
- /docs/concepts/behavioral-synth
- /docs/getting-started/linux-server
- /docs/guides/proxy-auth
- /docs/guides/turnstile
- /docs/guides/cookies-and-storage
- /docs/guides/screenshots
- /docs/reference/limits
- /docs/reference/invariants
llm-context:end -->
