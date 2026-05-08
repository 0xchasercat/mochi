/**
 * `Page` — public surface for one Chromium tab/target.
 *
 * v0.8 wires the behavioral surface — `humanClick`, `humanType`, `humanScroll`
 * — onto the existing v0.1 base (`goto`, `content`, `text`, `evaluate`,
 * `waitFor`, `cookies`, `close`). `screenshot` remains a placeholder.
 *
 * Critical §8.3 design: NO `Runtime.enable` is ever sent. Evaluation routes
 * through `DOM.resolveNode` → `Runtime.callFunctionOn` against the document
 * node's `objectId`. That implicitly runs in main world without naming a
 * world (which would create a detectable isolated world; PLAN.md §8.4).
 *
 * Behavioral pipeline (PLAN.md §5.5 pure-data principle): trajectory /
 * keystroke / scroll EVENTS are produced by `@mochi.js/behavioral` as plain
 * data; this module is the side-effect layer that dispatches them via
 * `Input.dispatchMouseEvent` / `Input.dispatchKeyEvent`. Per-frame pacing is
 * realized with `setTimeout(0)` chained against the synthesized `tMs` so the
 * realized cadence matches the synthesized cadence on a relaxed best-effort
 * basis (Bun's setTimeout granularity is sub-ms; the model is at 60Hz).
 *
 * @see PLAN.md §5.1 / §5.5 / §7 / §8.3 / §8.4 / §11
 */

import {
  type BehaviorProfile,
  DEFAULT_BEHAVIOR_PROFILE,
  synthesizeKeystrokes,
  synthesizeMouseTrajectory,
  synthesizeScroll,
} from "@mochi.js/behavioral";
import type { MessageRouter } from "./cdp/router";
import type {
  BoxModel,
  DispatchKeyEventParams,
  DispatchMouseEventParams,
  DomNode,
  FrameNavigatedEvent,
  PierceDomNode,
  RemoteObject,
} from "./cdp/types";
import { ElementHandle } from "./page/element-handle";
import { findPiercingMatches } from "./page/piercing";
import { parseSelector } from "./page/selector";

/** Wait conditions for `Page.goto`. */
export type WaitUntil = "load" | "domcontentloaded" | "networkidle";

/** Options for `Page.goto`. */
export interface GotoOptions {
  waitUntil?: WaitUntil;
  timeout?: number;
}

/** State predicates for `Page.waitFor`. */
export type WaitState = "attached" | "visible" | "hidden";

/** Options for `Page.waitFor`. */
export interface WaitForOptions {
  timeout?: number;
  state?: WaitState;
}

/** A CDP cookie shape. Matches `Network.Cookie` minus a few fields we don't surface. */
export interface Cookie {
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

/**
 * Construct a `Page` against an existing CDP target. Used internally by
 * `Session.newPage()`; not exported.
 */
export interface PageInit {
  router: MessageRouter;
  /** The CDP target id this page wraps. */
  targetId: string;
  /**
   * The flat-mode CDP session id obtained from `Target.attachToTarget`. All
   * page-level CDP calls (`Page.enable`, `DOM.*`, `Runtime.callFunctionOn`,
   * `Network.getCookies`, etc.) MUST be routed through this session.
   */
  sessionId: string;
  /** Initial URL (typically "about:blank"). */
  initialUrl: string;
  /**
   * Legacy field — preserved as optional for any out-of-tree caller that
   * still constructs a Page with it. Task 0266 retired the per-page
   * `Page.addScriptToEvaluateOnNewDocument` install in favour of the
   * session-level `Fetch.fulfillRequest` body splice; the field is no
   * longer set by `Session.newPage()` and the legacy
   * `removeScriptToEvaluateOnNewDocument` cleanup in `close()` is a no-op
   * when this is unset.
   *
   * @deprecated retained only for backward compatibility; remove after a
   * full deprecation cycle.
   */
  injectScriptIdentifier?: string;
  /**
   * Behavioral profile for `humanClick`/`humanType`/`humanScroll`. Sourced
   * from {@link MatrixV1.profile.behavior} (PLAN.md I-5: profile data is the
   * single source of truth). Optional; defaults to
   * `DEFAULT_BEHAVIOR_PROFILE` when absent.
   */
  behavior?: BehaviorProfile;
  /**
   * Per-session deterministic seed forwarded to behavioral synth. Combined
   * with a per-call counter so back-to-back `humanClick` calls within the
   * same session still produce divergent (but deterministic) trajectories.
   */
  seed?: string;
  /**
   * Initial cursor position. Real humans never start at viewport origin
   * (0, 0); a sensible default is the viewport center. The session-level
   * resolver picks this from the matrix's display dimensions; tests can
   * override directly.
   */
  initialCursor?: { x: number; y: number };
}

/** Options for `Page.humanClick`. */
export interface HumanClickOptions {
  button?: "left" | "right" | "middle";
  /** Override movement duration (ms). Default = Fitts. */
  duration?: number;
  /**
   * Add a Gaussian(150, 50) ms idle before movement. Default `true` — gives
   * the page a moment to settle (a real human doesn't snap instantly).
   */
  preMoveSettle?: boolean;
}

/** Options for `Page.humanMove`. */
export interface HumanMoveOptions {
  /** Override movement duration (ms). Default = Fitts. */
  duration?: number;
}

/** Options for `Page.humanType`. */
export interface HumanTypeOptions {
  /** Override profile WPM for this call. */
  wpm?: number;
  /** Override mistake rate (0..1). Default = 0.02. */
  mistakeRate?: number;
}

/** Options for `Page.humanScroll`. */
export interface HumanScrollOptions {
  /** Selector or absolute coords to scroll TO. */
  to: string | { x: number; y: number };
  /** Total time budget (ms). Default 500. */
  duration?: number;
}

/**
 * Options for `Page.screenshot`. Maps directly onto CDP `Page.captureScreenshot`
 * params with a thin compatibility layer for `fullPage` (which CDP doesn't
 * model directly — we synthesize it from `Page.getLayoutMetrics` +
 * `Emulation.setDeviceMetricsOverride`).
 *
 * @see PLAN.md §8.2 — `Page.captureScreenshot` is NOT on the forbidden list
 *      (only `Runtime.enable` and `Page.createIsolatedWorld` are).
 */
export interface ScreenshotOptions {
  /** Image format. Default `"png"`. */
  format?: "png" | "jpeg" | "webp";
  /**
   * Compression quality, 0..100. JPEG/WebP only — silently ignored for PNG by
   * the CDP layer (we still pass it through; CDP just drops it).
   */
  quality?: number;
  /**
   * Capture beyond the visible viewport — i.e. the full document height.
   * Implementation: `Page.getLayoutMetrics` for content size, override the
   * device metrics to that size via `Emulation.setDeviceMetricsOverride`,
   * capture, then `Emulation.clearDeviceMetricsOverride` to restore (always,
   * even on capture failure).
   */
  fullPage?: boolean;
  /**
   * Capture only a rectangular region (CSS pixels). Mutually exclusive with
   * `fullPage` — if both are set, `clip` wins (CDP semantics).
   */
  clip?: { x: number; y: number; width: number; height: number; scale?: number };
  /**
   * Render the page background as transparent (PNG only). For JPEG this is a
   * no-op since JPEG has no alpha channel.
   */
  omitBackground?: boolean;
  /**
   * Output encoding. `"binary"` (default) returns `Uint8Array`; `"base64"`
   * returns the raw CDP base64 string. The discriminated overloads of
   * `Page.screenshot` narrow the return type accordingly.
   */
  encoding?: "binary" | "base64";
}

// ---- DX cluster: DOM storage + permissions (task 0257) ---------------------

/**
 * Options for {@link Page.localStorage} / {@link Page.sessionStorage}
 * accessors. Both default to the page's main-frame origin (read at call time
 * from `window.location.origin`); pass `origin` to read/write a different
 * frame's storage explicitly.
 */
export interface DomStorageOptions {
  /**
   * Origin to scope the storage read/write to (e.g. `"https://example.com"`).
   * Default: the page's current main-frame origin.
   *
   * Required when the call must hit a *different* origin's storage (e.g.
   * cross-origin warm-session restore). If the page hasn't navigated yet
   * (origin = `"about:blank"`), an explicit `origin` is required.
   */
  origin?: string;
}

/**
 * The shape returned by {@link Page.localStorage} / {@link Page.sessionStorage}.
 * Both accessors return the same surface — the only difference is the
 * `isLocalStorage` flag CDP receives under the hood.
 *
 * Backed by `DOMStorage.getDOMStorageItems` / `DOMStorage.setDOMStorageItem`.
 * Per CDP, the response shape for `getDOMStorageItems` is
 * `{ entries: [string, string][] }` — we collapse that to a `Record` for
 * Bun-native ergonomics.
 *
 * @see https://chromedevtools.github.io/devtools-protocol/tot/DOMStorage/
 */
export interface DomStorage {
  /**
   * Read every key/value pair currently in the (local|session)Storage of the
   * scoped origin. Default scope: the page's main-frame origin at call time.
   */
  get(opts?: DomStorageOptions): Promise<Record<string, string>>;
  /**
   * Write each key in `items` to the scoped origin's storage. Existing keys
   * not mentioned in `items` are left untouched (this is `Object.assign`
   * semantics, not `replace`). To clear, set the key explicitly to `""` or
   * fetch via {@link get} → mutate → call {@link set} with the union.
   */
  set(items: Record<string, string>, opts?: DomStorageOptions): Promise<void>;
}

/**
 * Every browser-level permission descriptor `Browser.grantPermissions` accepts.
 *
 * Pinned to the CDP `Browser.PermissionType` enum on Chromium ≥ 131 (the
 * mochi profile floor — same baseline the worker idOnly bootstrap relies on).
 * The list is verbose-on-purpose: we want a contract test to catch the day
 * Chromium adds a new permission so we can decide whether to forward it.
 *
 * @see https://chromedevtools.github.io/devtools-protocol/tot/Browser/#type-PermissionType
 */
export const ALL_BROWSER_PERMISSIONS = [
  "accessibilityEvents",
  "audioCapture",
  "backgroundSync",
  "backgroundFetch",
  "captureHandle",
  "clipboardReadWrite",
  "clipboardSanitizedWrite",
  "displayCapture",
  "durableStorage",
  "flash",
  "geolocation",
  "idleDetection",
  "localFonts",
  "midi",
  "midiSysex",
  "nfc",
  "notifications",
  "paymentHandler",
  "periodicBackgroundSync",
  "protectedMediaIdentifier",
  "sensors",
  "storageAccess",
  "speakerSelection",
  "topLevelStorageAccess",
  "videoCapture",
  "videoCapturePanTiltZoom",
  "wakeLockScreen",
  "wakeLockSystem",
  "webAppInstallation",
  "windowManagement",
] as const;

/** A single entry from {@link ALL_BROWSER_PERMISSIONS}. */
export type BrowserPermission = (typeof ALL_BROWSER_PERMISSIONS)[number];

/** Options for {@link Page.grantAllPermissions}. */
export interface GrantAllPermissionsOptions {
  /**
   * Origin to grant permissions to. Default: the page's current main-frame
   * origin (read at call time). When `about:blank`, an explicit `origin` is
   * required — `Browser.grantPermissions` rejects opaque origins.
   */
  origin?: string;
}

export class Page {
  private readonly router: MessageRouter;
  private readonly targetId: string;
  private readonly sessionId: string;
  private currentUrl: string;
  private closed = false;
  /**
   * Most recently observed main-frame id (no `parentId`). Captured from
   * `Page.frameNavigated` events. Exposed via `mainFrameId()` so it has at
   * least one reader at v0.1 (future phases consume it for worker fan-out
   * and OOPIF correlation).
   */
  private _mainFrameId: string | null = null;
  /** Inject script identifier (see {@link PageInit.injectScriptIdentifier}). */
  private readonly injectScriptIdentifier: string | null;
  /**
   * Behavioral profile for the human-input surface. Defaults are documented
   * on {@link DEFAULT_BEHAVIOR_PROFILE}; the `MatrixV1.profile.behavior`
   * block is the canonical source (PLAN.md I-5).
   */
  private readonly behavior: BehaviorProfile;
  /** Per-session seed forwarded to behavioral synth (with a per-call counter mixed in). */
  private readonly seed: string;
  /**
   * Per-call counter that disambiguates back-to-back `humanClick` /
   * `humanType` / `humanScroll` calls within the same session. Without this
   * the same `(seed, opts)` would always produce the same trajectory —
   * deterministic but visibly mechanical.
   */
  private callCounter = 0;
  /**
   * Last cursor position. The `humanClick`/`humanMove` synth chains from this
   * point so a sequence of moves and clicks produces a continuous trajectory
   * (which is also what a real user does). Initialized from
   * `PageInit.initialCursor` (the matrix-derived viewport center by default
   * — see PLAN.md I-5: behavioral parameters come from MatrixV1.profile.behavior).
   */
  private cursor: { x: number; y: number };
  /** localStorage namespace returned by the {@link localStorage} getter. */
  private readonly localStorageJar: DomStorage;
  /** sessionStorage namespace returned by the {@link sessionStorage} getter. */
  private readonly sessionStorageJar: DomStorage;

  constructor(init: PageInit) {
    this.router = init.router;
    this.targetId = init.targetId;
    this.sessionId = init.sessionId;
    this.currentUrl = init.initialUrl;
    this.injectScriptIdentifier = init.injectScriptIdentifier ?? null;
    this.behavior = init.behavior ?? DEFAULT_BEHAVIOR_PROFILE;
    this.seed = init.seed ?? "default";
    this.cursor = init.initialCursor ?? { x: 0, y: 0 };
    // Bind both DOM-storage namespaces once. The `isLocalStorage` flag
    // routes the same plumbing to local vs session storage on the CDP side.
    this.localStorageJar = createDomStorage(this, true);
    this.sessionStorageJar = createDomStorage(this, false);
    this.subscribeFrameTopology();
  }

  /** The page's last-observed URL (updated on `Page.frameNavigated`). */
  get url(): string {
    return this.currentUrl;
  }

  /**
   * The CDP frame id of the main frame, or `null` before the first navigation.
   * Mostly diagnostic at v0.1 — future phases use it for worker fan-out and
   * OOPIF correlation per PLAN.md §8.3.
   */
  mainFrameId(): string | null {
    return this._mainFrameId;
  }

  /**
   * Navigate to a URL. v0.1 supports `waitUntil: "load"` (the default) and
   * `"domcontentloaded"`. `"networkidle"` requires Network-domain plumbing
   * that lands later — for now we map it to `"load"` and document the limit.
   */
  async goto(url: string, opts: GotoOptions = {}): Promise<void> {
    this.assertOpen();
    const timeoutMs = opts.timeout ?? 30_000;
    const waitUntil = opts.waitUntil ?? "load";
    const targetEvent =
      waitUntil === "domcontentloaded" ? "Page.domContentEventFired" : "Page.loadEventFired";

    // Page.enable is *not* on the §8.2 forbidden list — it's required for
    // lifecycle events. Only Runtime.enable is forbidden.
    await this.send("Page.enable");

    const settled = new Promise<void>((resolve) => {
      const off = this.router.on(targetEvent, (_params, sessionId) => {
        // Filter to events from our session (flat mode delivers all events
        // to the root listener, tagged by sessionId).
        if (sessionId !== this.sessionId) return;
        off();
        resolve();
      });
    });
    await this.send("Page.navigate", { url });
    await Promise.race([
      settled,
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error(`[mochi] page.goto(${url}) timed out after ${timeoutMs}ms`)),
          timeoutMs,
        ),
      ),
    ]);
    this.currentUrl = url;
  }

  /** Return the full serialized HTML of the document. */
  async content(): Promise<string> {
    this.assertOpen();
    const docId = await this.documentObjectId();
    const result = await this.send<{ result: RemoteObject }>("Runtime.callFunctionOn", {
      objectId: docId,
      functionDeclaration: "function() { return this.documentElement.outerHTML; }",
      returnByValue: true,
    });
    const value = result.result.value;
    if (typeof value !== "string") {
      throw new Error("[mochi] page.content(): expected string from documentElement.outerHTML");
    }
    return value;
  }

  /**
   * Return the `textContent` of the first element matching the selector, or
   * `null` if no match. Uses `DOM.querySelector` + `Runtime.callFunctionOn`
   * exactly per PLAN.md §8.3.
   */
  async text(selector: string): Promise<string | null> {
    this.assertOpen();
    const root = await this.documentNode();
    const result = await this.send<{ nodeId: number }>("DOM.querySelector", {
      nodeId: root.nodeId,
      selector,
    });
    if (result.nodeId === 0) return null;
    const resolved = await this.send<{ object: RemoteObject }>("DOM.resolveNode", {
      nodeId: result.nodeId,
    });
    if (resolved.object.objectId === undefined) return null;
    const callResult = await this.send<{ result: RemoteObject }>("Runtime.callFunctionOn", {
      objectId: resolved.object.objectId,
      functionDeclaration: "function() { return this.textContent; }",
      returnByValue: true,
    });
    const value = callResult.result.value;
    if (value === null || value === undefined) return null;
    if (typeof value !== "string") {
      throw new Error("[mochi] page.text(): expected string textContent");
    }
    return value;
  }

  /**
   * Evaluate a function in the page's main world via `Runtime.callFunctionOn`
   * against the document's objectId. The function runs as a method on the
   * document (so `this` === document). Result is JSON-serialized via
   * `returnByValue: true`.
   *
   * The function may return a value or a `Promise`. Promise-returning
   * functions are awaited page-side via `awaitPromise: true` (CDP's canonical
   * mechanism for async eval) — without that flag, an `async () => ...`
   * function round-trips its returned Promise as `undefined` because CDP
   * serializes the Promise object itself, not its resolution. `awaitPromise`
   * is NOT on PLAN.md §8.2's forbidden list — only `Runtime.enable` and
   * `Page.createIsolatedWorld` are. Available since Chromium 67.
   *
   * Limitations (documented in docs/limits.md):
   *   - Non-JSON return values (functions, DOM nodes, undefined) are
   *     coerced/dropped per CDP semantics.
   *   - The function must be a syntactically valid `function() { ... }`
   *     expression (closures over outer scope are not supported — this is
   *     standard for any cross-process evaluator).
   *   - Arguments cannot be passed in v0.1; the function takes no args.
   */
  async evaluate<T>(fn: () => T | Promise<T>): Promise<T> {
    this.assertOpen();
    const docId = await this.documentObjectId();
    const result = await this.send<{ result: RemoteObject }>("Runtime.callFunctionOn", {
      objectId: docId,
      functionDeclaration: fn.toString(),
      returnByValue: true,
      awaitPromise: true,
    });
    return result.result.value as T;
  }

  /**
   * Wait for a selector to satisfy the requested `state`. v0.1 supports
   * `attached` (default) and `visible`/`hidden`. Polls every 50ms.
   */
  async waitFor(selector: string, opts: WaitForOptions = {}): Promise<void> {
    this.assertOpen();
    const timeoutMs = opts.timeout ?? 30_000;
    const state = opts.state ?? "attached";
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const ok = await this.evaluateSelectorState(selector, state);
      if (ok) return;
      await new Promise<void>((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(
      `[mochi] page.waitFor("${selector}", state=${state}) timed out after ${timeoutMs}ms`,
    );
  }

  /** All cookies visible to this page (no filter at v0.1). */
  async cookies(): Promise<Cookie[]> {
    this.assertOpen();
    const result = await this.send<{ cookies: Cookie[] }>("Network.getCookies");
    return result.cookies;
  }

  /**
   * Per-origin localStorage accessor — `get()` and `set(items)`. Backed by
   * `DOMStorage.getDOMStorageItems` / `DOMStorage.setDOMStorageItem`. Frame
   * scope defaults to the page's current main-frame origin; pass
   * `{ origin }` to target a different frame's storage. See {@link DomStorage}.
   *
   * Use cases (per `docs/audits/nodriver.md` LOW finding 3):
   *   - "returning visitor" warming: seed `lastVisit`, A/B-test bucket,
   *     consent-banner dismissal.
   *   - Capture + replay across runs by serializing the `Record` to disk.
   *
   * Sister surface: {@link sessionStorage} — same shape, hits sessionStorage
   * via the `isLocalStorage: false` CDP flag.
   */
  get localStorage(): DomStorage {
    return this.localStorageJar;
  }

  /**
   * Per-origin sessionStorage accessor. Same shape as {@link localStorage}
   * but hits sessionStorage via `DOMStorage.getDOMStorageItems` /
   * `DOMStorage.setDOMStorageItem` with `isLocalStorage: false`. Note
   * sessionStorage is per-tab — values written here vanish when the page is
   * closed, exactly as in a regular browsing session.
   */
  get sessionStorage(): DomStorage {
    return this.sessionStorageJar;
  }

  /**
   * Grant every permission `Browser.grantPermissions` accepts (the full
   * descriptor list pinned by {@link ALL_BROWSER_PERMISSIONS}) to the
   * scoped origin. Defaults to the page's current main-frame origin; pass
   * `{ origin }` to grant explicitly.
   *
   * Pairs with R-036 (the per-permission `navigator.permissions.query()`
   * spoof in `@mochi.js/inject/src/modules/permissions.ts`): this method
   * grants ALL at the *browser* level (so the page never sees a permission
   * prompt), but the page-side `query()` matrix still returns whatever
   * `matrix.uaCh["permissions-defaults"]` says. The two surfaces are
   * orthogonal — the inject module decides what the page *sees*; this method
   * decides what the browser *enforces*.
   *
   * Throws when the page hasn't navigated yet (`about:blank` resolves to no
   * usable origin) and no `origin` was passed explicitly — the CDP method
   * rejects opaque origins.
   *
   * @see docs/audits/nodriver.md LOW finding 4 (`Browser.grant_all_permissions`).
   */
  async grantAllPermissions(opts: GrantAllPermissionsOptions = {}): Promise<void> {
    this.assertOpen();
    const origin = opts.origin ?? (await this.resolveOrigin("grantAllPermissions"));
    // Browser.grantPermissions runs on the ROOT browser target — it's not a
    // page-scoped method. The router's `sessionId` defaults to the root
    // browser target when omitted, which is exactly what we want here.
    await this.router.send("Browser.grantPermissions", {
      permissions: [...ALL_BROWSER_PERMISSIONS],
      origin,
    });
  }

  /**
   * Install an additional main-world script that runs on every new document
   * via `Page.addScriptToEvaluateOnNewDocument({ runImmediately: true,
   * worldName: "" })`. Returns the CDP identifier so callers can later
   * remove it via {@link removeInitScript}.
   *
   * `worldName: ""` is critical — any non-empty string creates an isolated
   * world (PLAN.md §8.4) which is detectable. `runImmediately: true` ensures
   * the script also runs against the current document if one already exists,
   * not just on the next navigation.
   *
   * Use cases:
   *   - The `@mochi.js/challenges` Turnstile detector (mounts a
   *     `MutationObserver` + Symbol-keyed reader on `document` in the page's
   *     main world, before any page script runs).
   *   - Any future per-page convenience layer that needs main-world
   *     mutation observation.
   *
   * The session-level inject payload is installed separately on every
   * `newPage()` and is NOT routed through this method — convenience-layer
   * scripts compose on top of it.
   */
  async addInitScript(source: string): Promise<string> {
    this.assertOpen();
    const result = await this.send<{ identifier: string }>(
      "Page.addScriptToEvaluateOnNewDocument",
      {
        source,
        runImmediately: true,
        worldName: "",
      },
    );
    return result.identifier;
  }

  /**
   * Remove a previously-installed init script by its identifier (returned
   * from {@link addInitScript}). Best-effort — silently ignores failures
   * (e.g. the target was already closed).
   */
  async removeInitScript(identifier: string): Promise<void> {
    if (this.closed) return;
    try {
      await this.send("Page.removeScriptToEvaluateOnNewDocument", { identifier });
    } catch {
      // Ignore — target might already be gone.
    }
  }

  /** Tear down the page. Does not close the session's other pages. */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    // PLAN.md §8.4 — un-register the inject script so the per-target
    // identifier list stays bounded. Best-effort: if the page is already
    // gone the remove call will fail and we ignore it.
    if (this.injectScriptIdentifier !== null) {
      try {
        await this.router.send(
          "Page.removeScriptToEvaluateOnNewDocument",
          { identifier: this.injectScriptIdentifier },
          { sessionId: this.sessionId },
        );
      } catch {
        // Ignore — target might already be gone.
      }
    }
    try {
      // Target.closeTarget runs on the *root* (browser) target, not the page
      // session — it's how we tell the browser to kill that page.
      await this.router.send("Target.closeTarget", { targetId: this.targetId });
    } catch {
      // Ignore — session may already be tearing down.
    }
  }

  // ---- Phase 0.8 — behavioral surface ----------------------------------------

  /**
   * The current cursor position (viewport-relative pixels). Tracked across
   * `humanClick`/`humanMove` so consecutive movements compose realistically
   * (a real user doesn't teleport between every action).
   */
  cursorPosition(): { x: number; y: number } {
    return { x: this.cursor.x, y: this.cursor.y };
  }

  /**
   * Animate the cursor to `(x, y)` along a human-shaped Bezier trajectory,
   * WITHOUT pressing any button. Same dispatch path as `humanClick` minus
   * the final `mousePressed` + `mouseReleased`. The cursor's last position
   * updates so a subsequent `humanClick` chains realistically from this
   * arrival point.
   *
   * Pipeline (PLAN.md §11.1):
   *   1. Synthesize the `TrajectoryEvent[]` via `@mochi.js/behavioral` from
   *      the page's current cursor to `(x, y)`, using the resolved `behavior`
   *      profile + a deterministic per-call seed.
   *   2. Dispatch each event as `Input.dispatchMouseEvent` of type
   *      `mouseMoved`, paced via `setTimeout` to match the synthesized `tMs`
   *      cadence.
   *   3. Update `cursor` to the final synthesized point.
   *
   * Use cases:
   *   - Hover over an element without clicking (pre-click positioning).
   *   - Plausible idle cursor activity between explicit interactions.
   *   - Composing fine-grained drag/drop sequences (v1.x).
   */
  async humanMove(x: number, y: number, opts: HumanMoveOptions = {}): Promise<void> {
    this.assertOpen();
    const callSeed = this.nextCallSeed();
    const traj = synthesizeMouseTrajectory({
      from: { x: this.cursor.x, y: this.cursor.y },
      to: { x, y },
      profile: this.behavior,
      seed: callSeed,
      ...(opts.duration !== undefined ? { durationMs: opts.duration } : {}),
    });
    if (traj.length === 0) {
      // Degenerate: from === to. Still register the position.
      this.cursor = { x, y };
      return;
    }

    let prevT = 0;
    for (let i = 0; i < traj.length; i++) {
      const ev = traj[i];
      if (ev === undefined) continue;
      const dt = ev.tMs - prevT;
      if (i > 0 && dt > 0) await sleep(dt);
      prevT = ev.tMs;
      await this.dispatchMouse({
        type: "mouseMoved",
        x: ev.x,
        y: ev.y,
        button: "none",
      });
    }
    const last = traj[traj.length - 1];
    if (last !== undefined) {
      this.cursor = { x: last.x, y: last.y };
    }
  }

  /**
   * Move the mouse to the matched element with a human-shaped Bezier
   * trajectory, then dispatch a single `mousePressed` + `mouseReleased`.
   *
   * Pipeline (PLAN.md §11.1):
   *   1. Resolve the selector via `DOM.querySelector` + `DOM.getBoxModel`.
   *   2. Synthesize the `TrajectoryEvent[]` via `@mochi.js/behavioral`,
   *      passing the page's resolved `behavior` profile + a deterministic
   *      seed (per-call counter mixed in).
   *   3. Sleep `preMoveSettle` (default Gaussian(150, 50) ms).
   *   4. Dispatch each trajectory event via `Input.dispatchMouseEvent` of
   *      type `mouseMoved`, paced via `setTimeout` to match the synthesized
   *      `tMs` cadence.
   *   5. Dispatch `mousePressed` then `mouseReleased` at the final point
   *      with a realistic press duration (~30..80 ms).
   */
  async humanClick(selector: string, opts: HumanClickOptions = {}): Promise<void> {
    this.assertOpen();
    const root = await this.documentNode();
    const result = await this.send<{ nodeId: number }>("DOM.querySelector", {
      nodeId: root.nodeId,
      selector,
    });
    if (result.nodeId === 0) {
      throw new Error(`[mochi] humanClick: selector "${selector}" matched no element`);
    }
    const box = await this.send<{ model: BoxModel }>("DOM.getBoxModel", {
      nodeId: result.nodeId,
    });
    const targetBox = boxFromBorderQuad(box.model);
    const callSeed = this.nextCallSeed();
    // Trajectory synth lives here (not in `performClickAt`) so prototype
    // inspection in conformance tests can see the synthesize / trajectory
    // / cursor markers — they're a consumer-side smoke check that the
    // behavioral synth is wired in.
    const traj = synthesizeMouseTrajectory({
      from: { x: this.cursor.x, y: this.cursor.y },
      to: { x: targetBox.x + targetBox.width / 2, y: targetBox.y + targetBox.height / 2 },
      box: targetBox,
      profile: this.behavior,
      seed: callSeed,
      ...(opts.duration !== undefined ? { durationMs: opts.duration } : {}),
    });
    await this.dispatchClickTrajectory(traj, callSeed, opts);
  }

  /**
   * Variant of {@link humanClick} that operates on an {@link ElementHandle}
   * resolved via {@link querySelectorPiercing} — required when the target
   * element lives inside a closed shadow root (no CSS path can name it from
   * the parent document, so the regular `humanClick(selector)` route fails).
   *
   * Pipeline differs from {@link humanClick} only in step 1: the box model
   * is resolved via `DOM.getBoxModel({ backendNodeId })` instead of through a
   * `DOM.querySelector`-resolved nodeId. Everything downstream (trajectory
   * synth, dispatch loop, press/release) is identical.
   */
  async humanClickHandle(handle: ElementHandle, opts: HumanClickOptions = {}): Promise<void> {
    this.assertOpen();
    const box = await this.send<{ model: BoxModel }>("DOM.getBoxModel", {
      backendNodeId: handle.backendNodeId,
    });
    const targetBox = boxFromBorderQuad(box.model);
    const callSeed = this.nextCallSeed();
    const traj = synthesizeMouseTrajectory({
      from: { x: this.cursor.x, y: this.cursor.y },
      to: { x: targetBox.x + targetBox.width / 2, y: targetBox.y + targetBox.height / 2 },
      box: targetBox,
      profile: this.behavior,
      seed: callSeed,
      ...(opts.duration !== undefined ? { durationMs: opts.duration } : {}),
    });
    await this.dispatchClickTrajectory(traj, callSeed, opts);
  }

  /**
   * Inner dispatch loop shared by {@link humanClick} and
   * {@link humanClickHandle}. Takes the synthesised trajectory, paces the
   * `mouseMoved` events, then fires `mousePressed` + `mouseReleased` at the
   * arrival point with realistic press duration. Trajectory synth itself
   * stays inside the public methods so source-grep conformance checks can
   * verify the synth is reachable from the public API.
   */
  private async dispatchClickTrajectory(
    traj: ReturnType<typeof synthesizeMouseTrajectory>,
    callSeed: string,
    opts: HumanClickOptions,
  ): Promise<void> {
    if (traj.length === 0) return;

    // Pre-move settle: Gaussian(150, 50) ms idle. Cheaply approximated via
    // the seed-derived Gaussian on a short range.
    const settle = opts.preMoveSettle ?? true;
    if (settle) {
      // 50..300 ms uniform (no need for full Gaussian here — just realism).
      await sleep(150 + (hash01(callSeed) - 0.5) * 100);
    }

    // Dispatch trajectory events at synthesized cadence.
    let prevT = 0;
    for (let i = 0; i < traj.length; i++) {
      const ev = traj[i];
      if (ev === undefined) continue;
      const dt = ev.tMs - prevT;
      if (i > 0 && dt > 0) await sleep(dt);
      prevT = ev.tMs;
      await this.dispatchMouse({
        type: "mouseMoved",
        x: ev.x,
        y: ev.y,
        button: "none",
      });
    }
    const last = traj[traj.length - 1];
    if (last === undefined) return;
    this.cursor = { x: last.x, y: last.y };

    // Press + release.
    const button = opts.button ?? "left";
    const pressMs = 30 + Math.floor(hash01(`${callSeed}:press`) * 50); // 30..80
    await this.dispatchMouse({
      type: "mousePressed",
      x: last.x,
      y: last.y,
      button,
      buttons: buttonsMaskFor(button),
      clickCount: 1,
    });
    await sleep(pressMs);
    await this.dispatchMouse({
      type: "mouseReleased",
      x: last.x,
      y: last.y,
      button,
      buttons: 0,
      clickCount: 1,
    });
  }

  /**
   * Type `text` into the matched input with human-shaped per-key timing,
   * digraph-aware delays, and configurable mistake injection.
   *
   * Special case — `text === ""`: clears the field by sending Backspace ×
   * `value.length` with realistic key timings. The keystroke synth is reused
   * with a string of N space placeholders to derive realistic press
   * durations + inter-key delays; only the `key` is rewritten to "Backspace"
   * and `text` is emptied so the dispatch produces deletion events.
   *
   * Pipeline (PLAN.md §11.2):
   *   1. Focus the matched node via `DOM.focus({nodeId})`.
   *   2. If `text === ""`, read `element.value.length` and synthesize N
   *      Backspace keystrokes; otherwise synthesize the literal text.
   *   3. Dispatch each event as `keyDown` (with `text` for printable keys)
   *      then `keyUp`, paced by the synthesized `tDownMs` cadence.
   */
  async humanType(selector: string, text: string, opts: HumanTypeOptions = {}): Promise<void> {
    this.assertOpen();
    const root = await this.documentNode();
    const result = await this.send<{ nodeId: number }>("DOM.querySelector", {
      nodeId: root.nodeId,
      selector,
    });
    if (result.nodeId === 0) {
      throw new Error(`[mochi] humanType: selector "${selector}" matched no element`);
    }
    await this.send("DOM.focus", { nodeId: result.nodeId });

    const profile: BehaviorProfile = {
      ...this.behavior,
      ...(opts.wpm !== undefined ? { wpm: opts.wpm } : {}),
    };
    const callSeed = this.nextCallSeed();

    let events: ReturnType<typeof synthesizeKeystrokes>;
    if (text === "") {
      // Clear flow: figure out current value length via the focused element,
      // then synthesize that many Backspace events.
      const valueLength = await this.focusedElementValueLength(result.nodeId);
      if (valueLength === 0) return;
      const placeholder = " ".repeat(valueLength);
      const synth = synthesizeKeystrokes({
        text: placeholder,
        profile,
        seed: callSeed,
        // Mistakes don't make sense for a clear; force-disable.
        mistakeRate: 0,
      });
      events = synth.map((ev) => ({
        ...ev,
        key: "Backspace",
        text: "",
      }));
    } else {
      events = synthesizeKeystrokes({
        text,
        profile,
        seed: callSeed,
        ...(opts.mistakeRate !== undefined ? { mistakeRate: opts.mistakeRate } : {}),
      });
    }

    let prevT = 0;
    for (const ev of events) {
      const dt = ev.tDownMs - prevT;
      if (dt > 0) await sleep(dt);
      const downParams = buildKeyEventParams("keyDown", ev.key, ev.text);
      await this.dispatchKey(downParams);
      const downDur = ev.tUpMs - ev.tDownMs;
      if (downDur > 0) await sleep(downDur);
      const upParams = buildKeyEventParams("keyUp", ev.key, ev.text);
      await this.dispatchKey(upParams);
      prevT = ev.tUpMs;
    }
  }

  /**
   * Read `element.value.length` for the matched element via
   * `Runtime.callFunctionOn` (PLAN.md §8.3 — no `Runtime.evaluate`). Used by
   * the `humanType("", selector)` clear path. Falls back to `0` for elements
   * without a `value` (non-input).
   */
  private async focusedElementValueLength(nodeId: number): Promise<number> {
    const resolved = await this.send<{ object: RemoteObject }>("DOM.resolveNode", {
      nodeId,
    });
    if (resolved.object.objectId === undefined) return 0;
    const r = await this.send<{ result: RemoteObject }>("Runtime.callFunctionOn", {
      objectId: resolved.object.objectId,
      functionDeclaration:
        "function() { return typeof this.value === 'string' ? this.value.length : 0; }",
      returnByValue: true,
    });
    const v = r.result.value;
    return typeof v === "number" ? v : 0;
  }

  /**
   * Inertial-scroll the page to a target Y position (or DOM element).
   *
   * Pipeline (PLAN.md §11.3):
   *   1. Resolve `to` to an absolute Y delta (selector → element top, coords
   *      → use the y component directly).
   *   2. Synthesize a `ScrollEvent[]` via `@mochi.js/behavioral`.
   *   3. Dispatch each frame as `Input.dispatchMouseEvent` of type
   *      `mouseWheel` with the synthesized `deltaY`, paced at 60Hz.
   */
  async humanScroll(opts: HumanScrollOptions): Promise<void> {
    this.assertOpen();
    const targetY = await this.resolveScrollTargetY(opts.to);
    const fromY = await this.currentScrollY();
    const callSeed = this.nextCallSeed();
    const events = synthesizeScroll({
      from: fromY,
      to: targetY,
      profile: this.behavior,
      seed: callSeed,
      ...(opts.duration !== undefined ? { duration: opts.duration } : {}),
    });
    let prevT = 0;
    for (const ev of events) {
      const dt = ev.tMs - prevT;
      if (dt > 0) await sleep(dt);
      prevT = ev.tMs;
      // mouseWheel events are dispatched at the current cursor position;
      // x/y here is the wheel point, not a target. Use cursor or viewport
      // center as a sane default.
      await this.dispatchMouse({
        type: "mouseWheel",
        x: this.cursor.x,
        y: this.cursor.y,
        deltaX: 0,
        deltaY: ev.deltaY,
      });
    }
  }

  /**
   * Closed-shadow-root piercing locator — find the first element matching the
   * CSS selector across the entire DOM tree, including elements nested inside
   * **closed** shadow roots (which {@link text}, {@link humanClick}, etc. can
   * NOT reach because `DOM.querySelector` does not traverse closed shadows
   * even with `pierce: true` set on the parent `getDocument` call).
   *
   * Required for Cloudflare Turnstile auto-click on integrations where the
   * widget iframe lives behind a closed shadow root (Cloudflare Challenge
   * pages, Workers Static Assets, some CDN configs). Without this, task
   * 0220's auto-click silently fails on those flows.
   *
   * Algorithm (port of patchright `framesPatch.ts:868-1012`
   * `_customFindElementsByParsed`):
   *   1. `DOM.getDocument({ depth: -1, pierce: true })` — yields the full
   *      tree, with shadow descendants under `shadowRoots[]` for both open
   *      AND closed roots.
   *   2. Recursive walk in JS, matching against a parsed CSS selector. We
   *      can't `DOM.querySelector` per shadow because the per-shadow query
   *      itself doesn't pierce closed roots either.
   *   3. For matches, `DOM.resolveNode({ backendNodeId })` to get a
   *      `RemoteObject.objectId`, wrapped in {@link ElementHandle}.
   *
   * Supported selectors (see `selector.ts`): tag / id / class / attribute /
   * descendant combinator / comma-separated lists. **Not** supported:
   * `>`/`+`/`~` combinators, `:pseudo-classes`, `::pseudo-elements`, XPath.
   * XPath is a stretch goal per task 0253 brief — TODO if a future surface
   * needs it (Turnstile detection only needs CSS).
   *
   * Performance: O(N) in DOM size per call. Acceptable for v0.2; a per-page
   * cache layer is a v0.3+ concern (also called out in 0253).
   *
   * @see tasks/0253-closed-shadow-piercing-locator.md
   * @see PLAN.md §8.2 (`DOM.getDocument` and `DOM.resolveNode` are not on the
   *   forbidden list — both fine to use here).
   */
  async querySelectorPiercing(selector: string): Promise<ElementHandle | null> {
    const handles = await this.queryPiercing(selector, 1);
    return handles[0] ?? null;
  }

  /**
   * The "all matches" variant of {@link querySelectorPiercing}. Returns every
   * element that satisfies the selector, in depth-first pre-order — same
   * traversal a regular `querySelectorAll` produces, with closed-shadow
   * descendants spliced in at the position they'd appear under the host.
   *
   * Returns an empty array when nothing matches.
   */
  async querySelectorAllPiercing(selector: string): Promise<ElementHandle[]> {
    return this.queryPiercing(selector);
  }

  /** Shared implementation for the piercing locator. `limit` short-circuits the walk. */
  private async queryPiercing(selector: string, limit?: number): Promise<ElementHandle[]> {
    this.assertOpen();
    const parsed = parseSelector(selector);
    // depth: -1 + pierce: true is the magic combination patchright uses; CDP
    // returns a fully-flattened tree including shadow descendants on both
    // open and closed roots, AND iframe contentDocuments for same-origin
    // children.
    const root = await this.send<{ root: PierceDomNode }>("DOM.getDocument", {
      depth: -1,
      pierce: true,
    });
    const matches = findPiercingMatches(root.root, parsed, limit);
    if (matches.length === 0) return [];
    const handles: ElementHandle[] = [];
    for (const m of matches) {
      const resolved = await this.send<{ object: RemoteObject }>("DOM.resolveNode", {
        backendNodeId: m.backendNodeId,
      });
      const objectId = resolved.object.objectId;
      // Skip nodes the protocol couldn't bind to a RemoteObject (rare — e.g.
      // detached subtree races). Surfacing a partial set is more useful than
      // throwing for the Turnstile detector path.
      if (objectId === undefined) continue;
      handles.push(
        new ElementHandle({
          router: this.router,
          sessionId: this.sessionId,
          objectId,
          backendNodeId: m.backendNodeId,
        }),
      );
    }
    return handles;
  }

  /**
   * Capture a screenshot of the page via CDP `Page.captureScreenshot`.
   *
   * Default: PNG-encoded `Uint8Array` of the visible viewport. Pass
   * `fullPage: true` to capture beyond the viewport (we round-trip through
   * `Emulation.setDeviceMetricsOverride` and restore via
   * `Emulation.clearDeviceMetricsOverride` afterwards — guaranteed even on
   * capture failure). Pass `encoding: "base64"` to skip the base64 → bytes
   * decode and get the raw CDP string back.
   *
   * Out of scope at v0.2 (tracked separately):
   *   - Element-bounded screenshot (`{ element: handle }`) — needs
   *     `DOM.getBoxModel` integration.
   *   - PDF generation — `Page.printToPDF` lives in its own brief.
   *
   * @see PLAN.md §8.2 — `Page.captureScreenshot` is permitted; only
   *      `Runtime.enable` and `Page.createIsolatedWorld` are forbidden.
   */
  screenshot(opts: ScreenshotOptions & { encoding: "base64" }): Promise<string>;
  screenshot(opts?: ScreenshotOptions & { encoding?: "binary" }): Promise<Uint8Array>;
  async screenshot(opts: ScreenshotOptions = {}): Promise<Uint8Array | string> {
    this.assertOpen();
    const format = opts.format ?? "png";
    // CDP `Page.captureScreenshot` params. We pass `captureBeyondViewport`
    // for fullPage *in addition to* the device-metrics override below — the
    // override changes the layout viewport for the capture, while
    // `captureBeyondViewport` lets the renderer paint past the visible area
    // for the duration of the capture (belt-and-braces; either alone has
    // edge cases on long pages).
    const params: Record<string, unknown> = { format };
    if (opts.quality !== undefined && (format === "jpeg" || format === "webp")) {
      params.quality = opts.quality;
    }
    if (opts.clip !== undefined) {
      // CDP requires `scale` — default 1 if caller didn't set it.
      params.clip = { ...opts.clip, scale: opts.clip.scale ?? 1 };
    }
    if (opts.omitBackground === true) {
      params.omitBackground = true;
    }

    // fullPage round-trip. We capture the layout metrics first, then size
    // the device viewport up to the content size, capture, then clear the
    // override. The `try/finally` is load-bearing — if `captureScreenshot`
    // throws (e.g. target detached mid-capture) we still need to restore
    // the viewport so subsequent calls don't see a frozen oversized layout.
    let restoreOverride = false;
    if (opts.fullPage === true && opts.clip === undefined) {
      const metrics = await this.send<{
        contentSize: { width: number; height: number };
        layoutViewport: { clientWidth: number; clientHeight: number };
      }>("Page.getLayoutMetrics");
      const width = Math.ceil(metrics.contentSize.width);
      const height = Math.ceil(metrics.contentSize.height);
      await this.send("Emulation.setDeviceMetricsOverride", {
        width,
        height,
        deviceScaleFactor: 0,
        mobile: false,
      });
      restoreOverride = true;
      params.captureBeyondViewport = true;
    }

    let result: { data: string };
    try {
      result = await this.send<{ data: string }>("Page.captureScreenshot", params);
    } finally {
      if (restoreOverride) {
        // Always clear, even if capture threw. Best-effort: if the target is
        // gone the clear will fail and we swallow it — the page is unusable
        // anyway and the override dies with the target.
        try {
          await this.send("Emulation.clearDeviceMetricsOverride");
        } catch {
          // ignore
        }
      }
    }

    const encoding = opts.encoding ?? "binary";
    if (encoding === "base64") {
      return result.data;
    }
    // Decode base64 → bytes via Bun-native `Buffer.from`. The Buffer is a
    // Uint8Array subclass; we slice into a plain Uint8Array view backed by
    // the same memory so the public type is the standard one.
    const buf = Buffer.from(result.data, "base64");
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  }

  // ---- internals --------------------------------------------------------------

  /** Helper: send a CDP method routed to this page's flat-mode session. */
  private send<T = unknown>(method: string, params?: unknown): Promise<T> {
    return this.router.send<T>(method, params, { sessionId: this.sessionId });
  }

  /**
   * Resolve the page's main-frame origin via `Runtime.callFunctionOn` against
   * the document objectId. Used by {@link grantAllPermissions} and the DOM
   * storage namespaces when the caller didn't pass an explicit `origin`.
   *
   * Throws with a precise diagnostic when the origin is opaque
   * (`about:blank` / `data:` URLs) — the consumers can't fall back to
   * "current page" because there's nothing meaningful to scope.
   */
  private async resolveOrigin(callerName: string): Promise<string> {
    const docId = await this.documentObjectId();
    const r = await this.send<{ result: RemoteObject }>("Runtime.callFunctionOn", {
      objectId: docId,
      functionDeclaration:
        "function() { return (this.defaultView || window).location && (this.defaultView || window).location.origin || ''; }",
      returnByValue: true,
    });
    const v = r.result.value;
    if (typeof v !== "string" || v.length === 0 || v === "null") {
      throw new Error(
        `[mochi] page.${callerName}: page origin is opaque (likely about:blank). Pass { origin } explicitly.`,
      );
    }
    return v;
  }

  /**
   * Module-private accessor used by {@link createDomStorage}. Mirrors the
   * cookie-jar plumbing pattern on Session — the factory lives in module
   * scope so its return type can be the public {@link DomStorage} interface
   * without leaking implementation onto the Page surface.
   *
   * @internal
   */
  _internalDomStoragePlumbing(): {
    send: <T>(method: string, params?: unknown) => Promise<T>;
    resolveOrigin: (caller: string) => Promise<string>;
    assertOpen: () => void;
  } {
    return {
      send: <T>(method: string, params?: unknown) => this.send<T>(method, params),
      resolveOrigin: (caller: string) => this.resolveOrigin(caller),
      assertOpen: () => this.assertOpen(),
    };
  }

  /** Subscribe to frame events to keep `currentUrl` and `mainFrameId` fresh. */
  private subscribeFrameTopology(): void {
    this.router.on("Page.frameNavigated", (params, sessionId) => {
      if (sessionId !== this.sessionId) return;
      const ev = params as FrameNavigatedEvent;
      // The main frame has no `parentId`. (For OOPIF subframes we ignore.)
      if (ev.frame.parentId === undefined) {
        this._mainFrameId = ev.frame.id;
        this.currentUrl = ev.frame.url;
      }
    });
    // Page.frameAttached is consumed for topology bookkeeping that grows in
    // later phases (worker fan-out, OOPIF correlation). v0.1 just acknowledges.
    this.router.on("Page.frameAttached", () => {});
  }

  private async documentNode(): Promise<DomNode> {
    const result = await this.send<{ root: DomNode }>("DOM.getDocument", {
      depth: 1,
    });
    return result.root;
  }

  private async documentObjectId(): Promise<string> {
    const root = await this.documentNode();
    const resolved = await this.send<{ object: RemoteObject }>("DOM.resolveNode", {
      backendNodeId: root.backendNodeId,
    });
    if (resolved.object.objectId === undefined) {
      throw new Error("[mochi] DOM.resolveNode returned no objectId for the document node");
    }
    return resolved.object.objectId;
  }

  private async evaluateSelectorState(selector: string, state: WaitState): Promise<boolean> {
    const docId = await this.documentObjectId();
    const fn =
      state === "attached"
        ? `function(sel) { return !!this.querySelector(sel); }`
        : state === "visible"
          ? `function(sel) {
              const el = this.querySelector(sel);
              if (!el) return false;
              const cs = (this.defaultView || window).getComputedStyle(el);
              const r = el.getBoundingClientRect();
              return cs.visibility !== 'hidden' && cs.display !== 'none' && r.width > 0 && r.height > 0;
            }`
          : `function(sel) {
              const el = this.querySelector(sel);
              if (!el) return true;
              const cs = (this.defaultView || window).getComputedStyle(el);
              const r = el.getBoundingClientRect();
              return cs.visibility === 'hidden' || cs.display === 'none' || r.width === 0 || r.height === 0;
            }`;
    const result = await this.send<{ result: RemoteObject }>("Runtime.callFunctionOn", {
      objectId: docId,
      functionDeclaration: fn,
      arguments: [{ value: selector }],
      returnByValue: true,
    });
    return result.result.value === true;
  }

  private assertOpen(): void {
    if (this.closed) {
      throw new Error("[mochi] page is closed");
    }
  }

  /** Send `Input.dispatchMouseEvent` against this page session. */
  private dispatchMouse(params: DispatchMouseEventParams): Promise<unknown> {
    return this.send("Input.dispatchMouseEvent", params);
  }

  /** Send `Input.dispatchKeyEvent` against this page session. */
  private dispatchKey(params: DispatchKeyEventParams): Promise<unknown> {
    return this.send("Input.dispatchKeyEvent", params);
  }

  /** Compose a per-call deterministic seed; different across humanX calls. */
  private nextCallSeed(): string {
    const n = this.callCounter++;
    return `${this.seed}:${this.targetId}:${n}`;
  }

  /** Read `window.scrollY` via the document objectId. */
  private async currentScrollY(): Promise<number> {
    const docId = await this.documentObjectId();
    const r = await this.send<{ result: RemoteObject }>("Runtime.callFunctionOn", {
      objectId: docId,
      functionDeclaration: "function() { return (this.defaultView || window).scrollY; }",
      returnByValue: true,
    });
    const v = r.result.value;
    return typeof v === "number" ? v : 0;
  }

  /**
   * Resolve a `humanScroll` target into an absolute scroll-Y. Selector → the
   * element's `top` plus current scroll. Coords → the y component.
   */
  private async resolveScrollTargetY(to: HumanScrollOptions["to"]): Promise<number> {
    if (typeof to !== "string") return to.y;
    const root = await this.documentNode();
    const found = await this.send<{ nodeId: number }>("DOM.querySelector", {
      nodeId: root.nodeId,
      selector: to,
    });
    if (found.nodeId === 0) {
      throw new Error(`[mochi] humanScroll: selector "${to}" matched no element`);
    }
    const resolved = await this.send<{ object: RemoteObject }>("DOM.resolveNode", {
      nodeId: found.nodeId,
    });
    if (resolved.object.objectId === undefined) {
      throw new Error("[mochi] humanScroll: failed to resolve node objectId");
    }
    const r = await this.send<{ result: RemoteObject }>("Runtime.callFunctionOn", {
      objectId: resolved.object.objectId,
      functionDeclaration:
        "function() { const r = this.getBoundingClientRect(); const w = this.ownerDocument.defaultView || window; return w.scrollY + r.top; }",
      returnByValue: true,
    });
    const v = r.result.value;
    return typeof v === "number" ? v : 0;
  }
}

// ---- module-private helpers -------------------------------------------------

/** Promise wrapper around `setTimeout`. */
function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

/**
 * Convert a CDP `BoxModel.border` quad into a {x, y, width, height} box.
 * The quad walks corners in CCW order; we take min/max for a robust AABB.
 */
function boxFromBorderQuad(model: BoxModel): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  const q = model.border;
  if (q.length < 8) {
    return { x: 0, y: 0, width: model.width, height: model.height };
  }
  const xs = [q[0] ?? 0, q[2] ?? 0, q[4] ?? 0, q[6] ?? 0];
  const ys = [q[1] ?? 0, q[3] ?? 0, q[5] ?? 0, q[7] ?? 0];
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  const width = Math.max(...xs) - x;
  const height = Math.max(...ys) - y;
  return { x, y, width, height };
}

/** CDP `buttons` mask for `Input.dispatchMouseEvent`. */
function buttonsMaskFor(button: "left" | "right" | "middle"): number {
  switch (button) {
    case "left":
      return 1;
    case "right":
      return 2;
    case "middle":
      return 4;
  }
}

/**
 * Build CDP `Input.dispatchKeyEvent` params from a `KeystrokeEvent`. Control
 * keys (Backspace, Enter, Tab) NEED `windowsVirtualKeyCode` + `code` for
 * Chromium to fire the corresponding edit-action handler in the focused
 * input; without those Chromium just delivers a `keydown` to JS listeners
 * but doesn't mutate the field. The mapping table below covers the small
 * set of control keys mochi's behavioral synth produces.
 *
 * @see https://chromedevtools.github.io/devtools-protocol/tot/Input/#method-dispatchKeyEvent
 */
function buildKeyEventParams(
  type: "keyDown" | "keyUp",
  key: string,
  text: string,
): DispatchKeyEventParams {
  const params: DispatchKeyEventParams = { type, key };
  // Printable keys carry their literal as `text` on keydown so the page sees
  // both the keyboard event AND the input event. (CDP requires `text`
  // present, and an empty string is *not* the same as omitting.)
  if (type === "keyDown" && text !== "") params.text = text;
  const meta = CONTROL_KEY_META[key];
  if (meta !== undefined) {
    params.code = meta.code;
    params.windowsVirtualKeyCode = meta.vk;
  } else if (text !== "" && text.length === 1) {
    // Printable single-character key: derive a plausible KeyboardEvent.code
    // and the ASCII virtual key code so layout-aware page code can read
    // event.code and event.keyCode. Chromium accepts either upper-case
    // letter codes or `KeyA`-style; we use the latter for letters.
    const ch = text;
    const upper = ch.toUpperCase();
    if (upper >= "A" && upper <= "Z") {
      params.code = `Key${upper}`;
      params.windowsVirtualKeyCode = upper.charCodeAt(0);
    } else if (ch >= "0" && ch <= "9") {
      params.code = `Digit${ch}`;
      params.windowsVirtualKeyCode = ch.charCodeAt(0);
    } else if (ch === " ") {
      params.code = "Space";
      params.windowsVirtualKeyCode = 32;
    }
  }
  return params;
}

/**
 * Mapping from CDP `key` (DOM `KeyboardEvent.key`) to its `KeyboardEvent.code`
 * and Windows virtual-key code. Only the control keys the behavioral synth
 * currently produces — extend as new control keys land.
 */
const CONTROL_KEY_META: Record<string, { code: string; vk: number }> = {
  Backspace: { code: "Backspace", vk: 8 },
  Tab: { code: "Tab", vk: 9 },
  Enter: { code: "Enter", vk: 13 },
  Escape: { code: "Escape", vk: 27 },
  Delete: { code: "Delete", vk: 46 },
};

/**
 * Cheap deterministic 32-bit hash → [0, 1) of a string. Used for the small
 * settle-delay and press-duration jitter in the dispatch layer (the major
 * randomness lives inside the synthesized event arrays). Not cryptographic.
 */
function hash01(s: string): number {
  let h = 2166136261 >>> 0; // FNV-1a 32-bit
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return (h >>> 0) / 0x1_0000_0000;
}

// ---- DOM storage factory (task 0257) ----------------------------------------

/**
 * Build the {@link DomStorage} returned by `Page.localStorage` /
 * `Page.sessionStorage`. Bound to one Page instance via
 * {@link Page._internalDomStoragePlumbing}. Module-private; the public surface
 * is the interface — instances are only created by the Page constructor.
 *
 * `isLocalStorage` flag picks the CDP storage backing:
 *   - `true`  → `localStorage`  (the persistent per-origin store).
 *   - `false` → `sessionStorage` (the per-tab transient store).
 *
 * @internal
 */
function createDomStorage(page: Page, isLocalStorage: boolean): DomStorage {
  const { send, resolveOrigin, assertOpen } = page._internalDomStoragePlumbing();
  const callerName = isLocalStorage ? "localStorage" : "sessionStorage";
  return {
    async get(opts: DomStorageOptions = {}) {
      assertOpen();
      const securityOrigin = opts.origin ?? (await resolveOrigin(`${callerName}.get`));
      const result = await send<{ entries: Array<[string, string]> }>(
        "DOMStorage.getDOMStorageItems",
        { storageId: { securityOrigin, isLocalStorage } },
      );
      // CDP returns `[ [k, v], ... ]`. Collapse to a Record for ergonomics.
      const out: Record<string, string> = {};
      for (const entry of result.entries) {
        const k = entry[0];
        const v = entry[1];
        if (typeof k === "string" && typeof v === "string") out[k] = v;
      }
      return out;
    },
    async set(items: Record<string, string>, opts: DomStorageOptions = {}) {
      assertOpen();
      const securityOrigin = opts.origin ?? (await resolveOrigin(`${callerName}.set`));
      // CDP's `setDOMStorageItem` takes one key/value at a time. We fan out
      // sequentially so a partial failure (e.g. a too-large value) surfaces
      // with the offending key in the error frame.
      for (const [k, v] of Object.entries(items)) {
        await send("DOMStorage.setDOMStorageItem", {
          storageId: { securityOrigin, isLocalStorage },
          key: k,
          value: v,
        });
      }
    },
  };
}
