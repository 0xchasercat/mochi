// AUTO-GENERATED — do not edit. Run `bun run codegen` to regenerate.
// Source schema lives in schemas/. See scripts/codegen.ts.

/**
 * Canonical schema for a single page's probe manifest. One manifest per (target, axis-cell) capture. Consumed by (1) the harness to drive an equivalent collection surface, (2) the equivalence pipeline to diff captured vs. baseline.
 */
export interface ProbeManifestV1 {
  /**
   * Schema major version. Bump on breaking changes.
   */
  manifestVersion: "1";
  /**
   * Provenance: how this manifest was produced. Critical for reproducing.
   */
  capture: {
    /**
     * UUID of the capture run.
     */
    captureId: string;
    tool: {
      name: "visiblev8" | "fv8" | "playwright-cdp" | "manual";
      version: string;
      chromiumVersion?: string;
      /**
       * VV8/FV8 patch identifier or commit.
       */
      v8Patch?: string;
    };
    capturedAt: string;
    /**
     * Position in the recon matrix. All axes are nullable for ad-hoc captures.
     */
    axisCell: {
      /**
       * homepage|serp:<query>|images|videos|news|maps
       */
      entry?: string;
      userState?: "cold" | "warm" | "msa-signed-in";
      /**
       * edge-desktop|chrome-desktop|safari-desktop|firefox-desktop|chrome-android|safari-ios
       */
      uaProfile?: string;
      /**
       * ISO 3166-1 alpha-2 country code of egress IP.
       */
      geo?: string;
      egressIpType?: "datacenter" | "residential" | "mobile" | "tor" | "vpn";
      /**
       * Which bot tells were exposed during this capture.
       */
      botSignal?: {
        navigatorWebdriver?: boolean;
        headlessChrome?: boolean;
        missingPlugins?: boolean;
        phantomJs?: boolean;
        seleniumGlobals?: boolean;
        /**
         * puppeteer-extra-stealth applied.
         */
        stealthPlugin?: boolean;
      };
      interaction?: "none" | "scroll" | "click-result" | "type-and-search";
    };
    egressIp?: string;
    egressAsn?: string;
    proxy?: string | null;
  };
  /**
   * Top-level page facts independent of probes.
   */
  page: {
    url: string;
    /**
     * After redirects.
     */
    finalUrl?: string;
    loadOutcome:
      | "success"
      | "timeout"
      | "navigation-error"
      | "renderer-crashed"
      | "blocked-by-server";
    httpStatus?: number;
    httpVersion?: "1.1" | "2" | "3";
    /**
     * TLS fingerprint observed in our outbound ClientHello.
     */
    tls?: {
      ja3?: string;
      ja3Hash?: string;
      ja4?: string;
      extensionsOrder?: string[];
      alpn?: string[];
    };
    /**
     * HTTP/2 SETTINGS frame and frame-ordering signature (Akamai-style).
     */
    h2Settings?: {
      akamaiHash?: string;
      akamaiText?: string;
      settings?: {
        [k: string]: number | undefined;
      };
      windowUpdate?: number;
      headerOrder?: string[];
    };
    /**
     * Verbatim response header order + values from the document.
     */
    responseHeaders?: {
      [k: string]: string | undefined;
    };
    cookiesSet?: {
      name: string;
      domain?: string;
      path?: string;
      expires?: string;
      secure?: boolean;
      httpOnly?: boolean;
      sameSite?: "Strict" | "Lax" | "None";
    }[];
    /**
     * localStorage/sessionStorage/IndexedDB keys observed by end-of-capture.
     */
    storage?: {
      localStorage?: string[];
      sessionStorage?: string[];
      indexedDb?: string[];
    };
    /**
     * Every JS file or inline block executed, in load order.
     */
    scriptInventory?: {
      /**
       * Stable per-capture id; same script across captures resolves via sha256.
       */
      scriptId: string;
      url?: string;
      inline?: boolean;
      sizeBytes?: number;
      sha256?: string;
      /**
       * first-party host or third-party host that served it.
       */
      origin: string;
      executionContext?:
        | "main"
        | "iframe"
        | "worker"
        | "service-worker"
        | "shared-worker"
        | "audio-worklet";
      /**
       * Load/execute order across the page.
       */
      executionOrder?: number;
    }[];
  };
  /**
   * Ordered list of native API touches observed by VV8/FV8. THIS IS THE CORE.
   */
  probes: Probe[];
  /**
   * Inputs delivered to the page (mouse, keyboard, scroll, focus) AND what was observed listening for them.
   */
  behavioral?: {
    inputsDelivered?: {
      type?:
        | "mousemove"
        | "click"
        | "keydown"
        | "keyup"
        | "scroll"
        | "focus"
        | "blur"
        | "visibilitychange";
      tMs?: number;
      x?: number;
      y?: number;
      key?: string;
      target?: string;
    }[];
    listenersAttached?: {
      event?: string;
      /**
       * window|document|<selector>
       */
      target?: string;
      scriptId?: string;
      passive?: boolean;
      capture?: boolean;
    }[];
  };
  /**
   * Every outbound request the page makes (XHR/fetch/sendBeacon/img/script/iframe). What Bing sends home.
   */
  telemetryEgress?: {
    url: string;
    method: string;
    tMs: number;
    initiator?:
      | "xhr"
      | "fetch"
      | "beacon"
      | "img"
      | "script"
      | "stylesheet"
      | "iframe"
      | "websocket"
      | "navigation";
    scriptId?: string;
    requestHeaders?: {
      [k: string]: string | undefined;
    };
    /**
     * Truncated/redacted as needed.
     */
    requestBody?: string;
    responseStatus?: number;
    responseSize?: number;
  }[];
  /**
   * Resolved values for the MUID->SUIH->IG->cvid->SID->RGUID chain (or its equivalents).
   */
  identityChain?: {
    [k: string]: string | undefined;
  };
  /**
   * Optional precomputed signals that make replica equivalence-checking cheaper.
   */
  diffHints?: {
    /**
     * Map of probe callsite -> count.
     */
    probeCallSiteHistogram?: {
      [k: string]: number | undefined;
    };
    /**
     * Sorted unique (object,member,kind) triples touched anywhere.
     */
    uniqueApiSurface?: string[];
  };
}
export interface Probe {
  /**
   * Monotonic order of this probe within the capture.
   */
  seq: number;
  /**
   * ms since capture t0.
   */
  tMs: number;
  /**
   * Reference into page.scriptInventory.
   */
  scriptId: string;
  /**
   * Where in the script the probe was emitted.
   */
  callsite?: {
    line?: number;
    column?: number;
    function?: string;
  };
  executionContext?:
    | "main"
    | "iframe"
    | "worker"
    | "service-worker"
    | "shared-worker"
    | "audio-worklet";
  /**
   * VV8 realm/context id; lets us segregate cross-frame probes.
   */
  realmId?: string;
  /**
   * Constructor name or global, e.g. 'Window', 'HTMLCanvasElement', 'CanvasRenderingContext2D', 'AudioContext', 'navigator', 'screen'.
   */
  object: string;
  /**
   * Property or method name, e.g. 'userAgent', 'toDataURL', 'getChannelData'.
   */
  member: string;
  kind: "get" | "set" | "call" | "construct";
  /**
   * Stringified arguments (truncated). Order matters for fingerprinting.
   */
  args?: string[];
  argTypes?: string[];
  returnTypeHint?: string;
  /**
   * Byte size of returned blob/string when applicable (e.g. toDataURL output length).
   */
  returnSize?: number;
  /**
   * True when surfaced by FV8 forced-execution rather than natural execution.
   */
  forced?: boolean;
  /**
   * If forced, the original branch predicate FV8 short-circuited (e.g. 'navigator.webdriver === undefined').
   */
  forcedBranchCondition?: string;
  /**
   * Optional hand-curated bucket: canvas|audio|webgl|webgpu|fonts|navigator|screen|storage|permissions|sensors|webrtc|timing|css|wasm|input-biometrics|cross-origin|other.
   */
  category?:
    | "canvas"
    | "audio"
    | "webgl"
    | "webgpu"
    | "fonts"
    | "navigator"
    | "screen"
    | "storage"
    | "permissions"
    | "sensors"
    | "webrtc"
    | "timing"
    | "css"
    | "wasm"
    | "input-biometrics"
    | "cross-origin"
    | "media-devices"
    | "speech"
    | "battery"
    | "gamepad"
    | "wake-lock"
    | "service-worker"
    | "iframe-side-channel"
    | "csp-bypass"
    | "client-hints"
    | "trust-tokens"
    | "topics"
    | "fedcm"
    | "other";
  /**
   * Free-form labels for ad-hoc grouping.
   */
  tags?: string[];
}
