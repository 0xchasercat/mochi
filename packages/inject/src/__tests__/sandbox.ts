/**
 * Synthesized JS sandbox for inject unit tests.
 *
 * Bun has no `node:vm` and we don't want to spin up real Chromium for
 * unit tests. We build a fake `window` / `navigator` / `screen` /
 * `WebGLRenderingContext` / etc. that is *enumerable-shape* close to a
 * real Chromium globalThis, then run the payload via the `Function`
 * constructor with the fakes in scope.
 *
 * The sandbox is intentionally minimal — it gives the payload enough of a
 * surface to install its overrides without throwing. It does NOT
 * faithfully emulate Chromium semantics; the E2E test (`packages/core/src/
 * __tests__/inject.e2e.test.ts`) is the real proof against the real
 * browser. These unit tests verify the payload's STRUCTURE and INTENT —
 * not full Chrome compatibility.
 */

/**
 * The shape of the fake globals exposed inside the sandbox. All accessors
 * and methods relevant to the v0.3 spoof modules are present and
 * read-writable until the payload installs its overrides.
 */
export interface SandboxGlobals {
  window: SandboxGlobals & Record<string, unknown>;
  globalThis: SandboxGlobals & Record<string, unknown>;
  navigator: Record<string, unknown>;
  screen: Record<string, unknown>;
  document: { fonts: Record<string, unknown> };
  WebGLRenderingContext: { prototype: Record<string, unknown> };
  WebGL2RenderingContext: { prototype: Record<string, unknown> };
  // Minimal MouseEvent fake — constructor that copies clientX/clientY from
  // init dict onto `this` and walks the prototype for screenX/screenY. The
  // mouse-event-screen module installs its prototype getters here.
  MouseEvent: {
    new (
      type: string,
      init?: { clientX?: number; clientY?: number; screenX?: number; screenY?: number },
    ): Record<string, unknown>;
    prototype: Record<string, unknown>;
  };
  Intl: typeof Intl;
  FontFace: typeof FontFace | undefined;
  Symbol: typeof Symbol;
  Object: typeof Object;
  Array: typeof Array;
  Promise: typeof Promise;
  Function: typeof Function;
  Number: typeof Number;
  String: typeof String;
  TypeError: typeof TypeError;
  Error: typeof Error;
  WeakMap: typeof WeakMap;
}

/**
 * Build a fresh sandbox. The returned object's `window === globalThis ===
 * sandbox` so the payload's `typeof window !== "undefined"` checks succeed.
 *
 * Each call returns a brand-new sandbox; tests should NOT share state.
 */
export function makeSandbox(): SandboxGlobals {
  // Build the navigator with proto-style accessor descriptors. Every
  // property is configurable so the payload's `defineProperty` calls
  // succeed; once the payload installs its overrides they become
  // configurable:false.
  type Navish = Record<string, unknown>;
  const navProto: Navish = Object.create(Object.prototype);
  // Default fields the page would normally see — placeholders so we can
  // assert "before" vs "after" the payload runs.
  Object.defineProperty(navProto, "userAgent", {
    configurable: true,
    enumerable: true,
    get() {
      return "BARE";
    },
  });
  Object.defineProperty(navProto, "platform", {
    configurable: true,
    enumerable: true,
    get() {
      return "BARE-PLATFORM";
    },
  });
  Object.defineProperty(navProto, "vendor", {
    configurable: true,
    enumerable: true,
    get() {
      return "BARE-VENDOR";
    },
  });
  Object.defineProperty(navProto, "appVersion", {
    configurable: true,
    enumerable: true,
    get() {
      return "BARE-APPVER";
    },
  });
  Object.defineProperty(navProto, "appCodeName", {
    configurable: true,
    enumerable: true,
    get() {
      return "BARE-APPCODE";
    },
  });
  Object.defineProperty(navProto, "product", {
    configurable: true,
    enumerable: true,
    get() {
      return "BARE-PRODUCT";
    },
  });
  Object.defineProperty(navProto, "cookieEnabled", {
    configurable: true,
    enumerable: true,
    get() {
      return false;
    },
  });
  Object.defineProperty(navProto, "maxTouchPoints", {
    configurable: true,
    enumerable: true,
    get() {
      return 99;
    },
  });
  Object.defineProperty(navProto, "webdriver", {
    configurable: true,
    enumerable: true,
    get() {
      return true;
    },
  });
  Object.defineProperty(navProto, "hardwareConcurrency", {
    configurable: true,
    enumerable: true,
    get() {
      return 0;
    },
  });
  Object.defineProperty(navProto, "deviceMemory", {
    configurable: true,
    enumerable: true,
    get() {
      return 0;
    },
  });
  Object.defineProperty(navProto, "language", {
    configurable: true,
    enumerable: true,
    get() {
      return "BARE-LANG";
    },
  });
  Object.defineProperty(navProto, "languages", {
    configurable: true,
    enumerable: true,
    get() {
      return [];
    },
  });
  Object.defineProperty(navProto, "userAgentData", {
    configurable: true,
    enumerable: true,
    get() {
      return undefined;
    },
  });
  const navigator = Object.create(navProto);

  // Screen with prototype-defined accessors.
  type Screenish = Record<string, unknown>;
  const screenProto: Screenish = Object.create(Object.prototype);
  for (const k of ["width", "height", "availWidth", "availHeight", "colorDepth", "pixelDepth"]) {
    Object.defineProperty(screenProto, k, {
      configurable: true,
      enumerable: true,
      get() {
        return -1;
      },
    });
  }
  const screen = Object.create(screenProto);

  // Stub WebGL contexts with a `getParameter` method on the prototype.
  type Glish = { getParameter: (pname: number) => unknown };
  const glProto: Glish & Record<string, unknown> = Object.create(Object.prototype);
  glProto.getParameter = function getParameter(pname: number): unknown {
    return `BARE-${String(pname)}`;
  };
  const gl2Proto: Glish & Record<string, unknown> = Object.create(Object.prototype);
  gl2Proto.getParameter = function getParameter(pname: number): unknown {
    return `BARE2-${String(pname)}`;
  };
  const WebGLRenderingContext = function (this: unknown) {} as unknown as {
    prototype: Glish & Record<string, unknown>;
  };
  WebGLRenderingContext.prototype = glProto;
  const WebGL2RenderingContext = function (this: unknown) {} as unknown as {
    prototype: Glish & Record<string, unknown>;
  };
  WebGL2RenderingContext.prototype = gl2Proto;

  // MouseEvent stub. Real Chrome's MouseEvent.prototype.screenX is a native
  // accessor (configurable:true, enumerable:true). Mirror that shape so the
  // patched module's defineProperty doesn't trip on a non-configurable slot.
  type MEProto = Record<string, unknown>;
  const meProto: MEProto = Object.create(Object.prototype);
  Object.defineProperty(meProto, "screenX", {
    configurable: true,
    enumerable: true,
    get() {
      return 0;
    },
  });
  Object.defineProperty(meProto, "screenY", {
    configurable: true,
    enumerable: true,
    get() {
      return 0;
    },
  });
  const MouseEvent = function MouseEvent(
    this: Record<string, unknown>,
    _type: string,
    init?: { clientX?: number; clientY?: number; screenX?: number; screenY?: number },
  ) {
    this.clientX = init?.clientX ?? 0;
    this.clientY = init?.clientY ?? 0;
    // Note: native screenX/Y come from the prototype getter, not instance
    // slots — but unpatched MouseEvent in our sandbox lets us construct
    // with a screenX init for completeness.
    if (init !== undefined && init.screenX !== undefined) {
      this.__nativeScreenX = init.screenX;
    }
    if (init !== undefined && init.screenY !== undefined) {
      this.__nativeScreenY = init.screenY;
    }
  } as unknown as SandboxGlobals["MouseEvent"];
  MouseEvent.prototype = meProto;

  // FontFaceSet stub.
  const fonts: Record<string, unknown> = {
    size: 0,
    [Symbol.iterator](): IterableIterator<unknown> {
      return [].values();
    },
    forEach(_cb: (...args: unknown[]) => void): void {},
    check(_spec: string): boolean {
      return false;
    },
  };

  const sandbox = {
    navigator,
    screen,
    document: { fonts },
    WebGLRenderingContext,
    WebGL2RenderingContext,
    MouseEvent,
    Intl,
    FontFace: typeof FontFace !== "undefined" ? FontFace : undefined,
    // The payload reaches for these globals; share them from the host.
    Symbol,
    Object,
    Array,
    Promise,
    Function,
    Number,
    String,
    TypeError,
    Error,
    WeakMap,
  } as unknown as SandboxGlobals;

  // window === globalThis === sandbox itself. The mouse-event-screen module
  // reads `window.screenX/Y` — pin defaults so the formula is exercised.
  (sandbox as unknown as { window: unknown }).window = sandbox;
  (sandbox as unknown as { globalThis: unknown }).globalThis = sandbox;
  (sandbox as unknown as { screenX: number }).screenX = 50;
  (sandbox as unknown as { screenY: number }).screenY = 75;
  return sandbox;
}

/**
 * Run the payload code against a fresh sandbox. Returns the sandbox so
 * tests can probe state.
 *
 * Errors bubble out — payload-internal try/catch swallows module errors,
 * so a propagated error here means the IIFE itself failed (e.g. parse).
 */
export function runPayloadInSandbox(code: string): SandboxGlobals {
  const sandbox = makeSandbox();
  // Bind every sandbox property as a function arg so the payload's bare
  // identifier references resolve against our fake. We omit `globalThis`
  // because Function-constructor scripts bind it to the host globalThis;
  // the payload uses `window` for its world checks.
  const keys = [
    "window",
    "navigator",
    "screen",
    "document",
    "WebGLRenderingContext",
    "WebGL2RenderingContext",
    "MouseEvent",
    "Intl",
    "FontFace",
    "Symbol",
    "Object",
    "Array",
    "Promise",
    "Function",
    "Number",
    "String",
    "TypeError",
    "Error",
    "WeakMap",
  ];
  // Body: shadow `globalThis` locally so the payload's `globalThis` reads
  // see our sandbox. The Function constructor's scope is the global
  // scope; nested `var globalThis` in the body shadows correctly.
  const body = `var globalThis = window; ${code}`;
  const fn = new Function(...keys, body);
  fn(
    sandbox.window,
    sandbox.navigator,
    sandbox.screen,
    sandbox.document,
    sandbox.WebGLRenderingContext,
    sandbox.WebGL2RenderingContext,
    sandbox.MouseEvent,
    sandbox.Intl,
    sandbox.FontFace,
    sandbox.Symbol,
    sandbox.Object,
    sandbox.Array,
    sandbox.Promise,
    sandbox.Function,
    sandbox.Number,
    sandbox.String,
    sandbox.TypeError,
    sandbox.Error,
    sandbox.WeakMap,
  );
  return sandbox;
}
