/**
 * Shared fake-CDP-pipe helper for fixtures that drive `Session` (and other
 * `MessageRouter` consumers) without spawning a real Chromium process.
 *
 * # Why this exists
 *
 * Every fake-pipe fixture used to hand-roll its own NUL-delimited responder
 * loop. That pattern was a recurring footgun — both because the framing was
 * encoded as literal `\x00` bytes in source files (invisible to `Read` /
 * `grep`), and because every new CDP method `Session` started sending
 * required updating every existing fixture. We hit that trap four times
 * across waves 2 and 3 alone:
 *
 *   1. **Wave 2 / 0254 (worker idOnly bootstrap)** — agent burned ~10
 *      minutes on a NUL-byte template-literal that rendered as whitespace.
 *   2. **Wave 2 / 0255 (UA override)** — agent had to update three existing
 *      fixtures to register an auto-responder for
 *      `Network.setUserAgentOverride`, none of which they'd touched.
 *   3. **Wave 3 / 0262 (geo consistency)** — same shape: three more fixtures
 *      needed an auto-responder for `Emulation.setTimezoneOverride`.
 *   4. **Post-merge fallout** — 0261's brand-new contract test (which 0262
 *      couldn't see during review) didn't have the timezone responder. Main
 *      went red. Hot-fix in commit `053f8b1`.
 *
 * The pattern is structural: hand-rolled responders + opaque NUL framing =
 * guaranteed silent failure when the next CDP method gets added.
 *
 * # What this fixes
 *
 *   - **NUL framing is encapsulated.** `makeFakePipe` constructs frames via
 *     `Uint8Array` + `0x00` byte writes; tests never see the wire format.
 *     Contract `tests/contract/cdp-fixture-no-source-nuls.contract.test.ts`
 *     scans `tests/` + `packages/star/src/__tests__/` for literal NUL bytes
 *     and fails the build if any reappear.
 *   - **`defaultResponders` covers every method `Session` observably sends.**
 *     A drift-detection contract test (`cdp-fixture-coverage.contract.test.ts`)
 *     records every `router.send()` call across a stock Session lifecycle
 *     and asserts every recorded method has a key in `defaultResponders`.
 *     Adding a new send anywhere in `Session` without updating this map
 *     fails the test with the missing method named — exactly the regression
 *     we keep hitting.
 *   - **Per-test overrides merge over defaults.** Tests that need to model
 *     a CDP error, return a non-default `objectId`, or inspect a specific
 *     method's params can pass `responders: { "Method.name": params => ... }`
 *     to `makeFakePipe`; the override wins for that method, the rest of
 *     the Session lifecycle keeps working.
 *
 * @see tasks/0264-cdp-fixture-helper.md
 * @see packages/core/src/cdp/framer.ts — the wire format we mimic.
 */

import type { PipeReader, PipeWriter } from "../../packages/core/src/cdp/transport";

// ---- public types -----------------------------------------------------------

/** A responder maps CDP method params → result payload. */
export type CdpResponder = (params: unknown) => unknown;

/** Map of CDP method name → responder. */
export type CdpResponders = Record<string, CdpResponder>;

/** A CDP frame the writer captured, decoded. */
export interface RecordedFrame {
  /** UTF-8 JSON, NOT including the trailing NUL byte. */
  raw: string;
  /** Best-effort `JSON.parse(raw)` — `{}` if parsing failed. */
  parsed: {
    id?: number;
    method?: string;
    params?: unknown;
    sessionId?: string;
  };
  /** True after the auto-responder has answered this frame. */
  __responded?: boolean;
}

/** What `makeFakePipe` returns. */
export interface FakePipe {
  reader: PipeReader;
  writer: PipeWriter;
  /** Every write the consumer pushed, decoded. Order-preserving. */
  written: RecordedFrame[];
  /**
   * Inject a CDP frame from the browser-side (a response or event). Handles
   * NUL-delimited framing internally. The argument is a JSON-serializable
   * object — typically `{ id, result }` for responses or `{ method, params }`
   * for events.
   */
  inject(msg: object): void;
  /**
   * Promise that resolves once the auto-responder has answered a frame for
   * `method`. Useful when a test wants to await "the bootstrap finished
   * its first round-trip" without polling. `undefined`-method calls
   * (events with no `method`) do not satisfy the promise.
   */
  waitFor(
    method: string,
    opts?: { sessionId?: string; timeoutMs?: number },
  ): Promise<RecordedFrame>;
}

/** Optional construction knobs. */
export interface MakeFakePipeOptions {
  /**
   * Per-test responders that merge OVER `defaultResponders`. The override
   * map's keys win for matching method names; unmatched methods fall back
   * to the default. Pass `null` for a key to suppress the default
   * auto-response (useful when the test wants to drive the response by
   * hand via `inject(...)`).
   */
  responders?: Partial<Record<string, CdpResponder | null>>;
  /**
   * If true, the helper does NOT auto-respond at all — every frame must be
   * answered by the test calling `inject(...)` manually. The default is
   * `false` (auto-respond using `defaultResponders` + overrides).
   */
  manual?: boolean;
}

// ---- the default responders -------------------------------------------------

/**
 * Baseline responder map covering every CDP method `Session` observably
 * sends across a stock launch / `newPage` / `close` lifecycle.
 *
 * Pinned by the drift-detection contract test
 * `tests/contract/cdp-fixture-coverage.contract.test.ts` — when a new CDP
 * method gets added to `Session` (or its callees), the contract test fails
 * with the missing method named, prompting the author to add a responder
 * here BEFORE the rest of the test suite trips over it.
 *
 * Notes per method:
 *
 *   - `Target.createTarget` returns a synthetic `targetId` — tests that
 *     need a specific id should override.
 *   - `Target.attachToTarget` returns a synthetic `sessionId`. Same caveat.
 *   - `Page.addScriptToEvaluateOnNewDocument` returns a synthetic
 *     `identifier` — `page.close()` will issue a corresponding
 *     `removeScriptToEvaluateOnNewDocument` for it.
 *   - `Runtime.evaluate` (worker-bootstrap) and `Runtime.callFunctionOn`
 *     responders are NOT in the default set — those flows are driven only
 *     by tests that exercise the worker path, and the test usually wants
 *     to inspect / drive the objectId-format edge cases.
 */
export const defaultResponders: CdpResponders = {
  "Target.setAutoAttach": () => ({}),
  "Target.createTarget": () => ({ targetId: "tgt-test" }),
  "Target.attachToTarget": () => ({ sessionId: "page-test" }),
  "Target.closeTarget": () => ({ success: true }),
  "Page.enable": () => ({}),
  "Page.getFrameTree": () => ({ frameTree: { frame: { id: "frm-test" } } }),
  "Network.setUserAgentOverride": () => ({}),
  "Emulation.setTimezoneOverride": () => ({}),
  "Fetch.enable": () => ({}),
  "Fetch.disable": () => ({}),
  "Page.addScriptToEvaluateOnNewDocument": () => ({ identifier: "scr-test" }),
  "Page.removeScriptToEvaluateOnNewDocument": () => ({}),
};

// ---- the helper ------------------------------------------------------------

/**
 * Open a fake CDP duplex pipe wired to byte-identical NUL-delimited framing
 * (see `packages/core/src/cdp/framer.ts`). Auto-responds to every recognized
 * frame using the merged `defaultResponders` ⊕ per-test overrides.
 *
 * Frame bytes are constructed via `TextEncoder` + a programmatic `0x00`
 * write — never via source-level NUL literals.
 */
export function makeFakePipe(opts: MakeFakePipeOptions = {}): FakePipe {
  const written: RecordedFrame[] = [];
  let pushChunk: ((chunk: Uint8Array) => void) | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(ctrl) {
      pushChunk = (chunk) => ctrl.enqueue(chunk);
    },
  });

  // Merge defaults + overrides. An override of `null` means "suppress the
  // default response" — the test will drive the response manually.
  const overrides = opts.responders ?? {};
  const responders = new Map<string, CdpResponder | null>();
  if (!opts.manual) {
    for (const [k, v] of Object.entries(defaultResponders)) {
      responders.set(k, v);
    }
  }
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined) continue;
    responders.set(k, v);
  }

  const waiters = new Map<
    string,
    { sessionId?: string; resolve: (f: RecordedFrame) => void; reject: (err: Error) => void }[]
  >();

  /** Encode JSON + trailing NUL. Programmatic — no source-level NULs. */
  function encodeFrame(json: string): Uint8Array {
    const utf8 = new TextEncoder().encode(json);
    const out = new Uint8Array(utf8.length + 1);
    out.set(utf8, 0);
    out[utf8.length] = 0x00;
    return out;
  }

  function inject(msg: object): void {
    if (pushChunk === null) {
      throw new Error("[cdp-fixture] pipe not ready (writer hasn't been started yet)");
    }
    pushChunk(encodeFrame(JSON.stringify(msg)));
  }

  const reader: PipeReader = {
    getReader: () => stream.getReader(),
  };

  const writer: PipeWriter = {
    write(chunk) {
      const buf = chunk as Uint8Array;
      // Strip the trailing NUL the framer always appends (`encodeFrame` in
      // `cdp/framer.ts`). Defensive: if a future change drops the
      // delimiter, we still decode the bytes we did get.
      const end = buf[buf.length - 1] === 0 ? buf.length - 1 : buf.length;
      const raw = new TextDecoder().decode(buf.subarray(0, end));
      let parsed: RecordedFrame["parsed"] = {};
      try {
        parsed = JSON.parse(raw) as RecordedFrame["parsed"];
      } catch {
        // ignore malformed
      }
      const frame: RecordedFrame = { raw, parsed };
      written.push(frame);

      // Notify waiters for this method.
      if (typeof parsed.method === "string") {
        const queue = waiters.get(parsed.method);
        if (queue !== undefined) {
          for (let i = queue.length - 1; i >= 0; i--) {
            const w = queue[i];
            if (w === undefined) continue;
            if (w.sessionId !== undefined && w.sessionId !== parsed.sessionId) continue;
            queue.splice(i, 1);
            w.resolve(frame);
          }
          if (queue.length === 0) waiters.delete(parsed.method);
        }
      }

      // Auto-respond. Run on a microtask so we never re-enter the writer
      // synchronously — the router doesn't expect that.
      if (typeof parsed.id === "number" && typeof parsed.method === "string") {
        const responder = responders.get(parsed.method);
        if (responder !== undefined && responder !== null) {
          const id = parsed.id;
          let result: unknown;
          try {
            result = responder(parsed.params);
          } catch (err) {
            // Surface as a CDP error frame so the consumer's promise
            // rejects with a CdpRemoteError instead of timing out.
            const message = err instanceof Error ? err.message : String(err);
            queueMicrotask(() => {
              if (pushChunk === null) return;
              frame.__responded = true;
              pushChunk(encodeFrame(JSON.stringify({ id, error: { code: -32000, message } })));
            });
            return;
          }
          queueMicrotask(() => {
            if (pushChunk === null) return;
            frame.__responded = true;
            pushChunk(encodeFrame(JSON.stringify({ id, result })));
          });
        }
      }
    },
    flush() {
      /* no-op — bytes are already in the queue */
    },
    end() {
      try {
        // Best-effort: close the readable stream so consumers waiting on
        // it observe EOF. Not all paths need this, hence the try/catch.
        const ctrl = pushChunk;
        pushChunk = null;
        if (ctrl !== null) {
          // there's no public close-controller hook here; readable-stream's
          // `start(ctrl)` ctrl is captured above. We can't close it without
          // a reference, but that's fine — Bun's tests tear down the
          // stream when the test exits. Reject any pending waiters so they
          // don't hang the test.
        }
        for (const [, queue] of waiters) {
          for (const w of queue) w.reject(new Error("[cdp-fixture] pipe closed"));
        }
        waiters.clear();
      } catch {
        // ignore
      }
    },
  };

  function waitFor(
    method: string,
    waitOpts: { sessionId?: string; timeoutMs?: number } = {},
  ): Promise<RecordedFrame> {
    // Fast path: already written.
    for (const f of written) {
      if (f.parsed.method !== method) continue;
      if (waitOpts.sessionId !== undefined && f.parsed.sessionId !== waitOpts.sessionId) continue;
      return Promise.resolve(f);
    }
    return new Promise<RecordedFrame>((resolve, reject) => {
      const timeoutMs = waitOpts.timeoutMs ?? 2000;
      const timer = setTimeout(() => {
        // Remove from waiters and reject.
        const queue = waiters.get(method);
        if (queue !== undefined) {
          const idx = queue.findIndex((w) => w.resolve === wrapped);
          if (idx >= 0) queue.splice(idx, 1);
        }
        reject(new Error(`[cdp-fixture] waitFor("${method}") timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      const wrapped = (f: RecordedFrame): void => {
        clearTimeout(timer);
        resolve(f);
      };
      const entry = { sessionId: waitOpts.sessionId, resolve: wrapped, reject };
      let queue = waiters.get(method);
      if (queue === undefined) {
        queue = [];
        waiters.set(method, queue);
      }
      queue.push(entry);
    });
  }

  return { reader, writer, written, inject, waitFor };
}

// ---- a fake ChromiumProcess wrapper ----------------------------------------

/**
 * Many fixtures construct a fake `ChromiumProcess` shape around the pipe so
 * they can pass it directly to `new Session({ proc, ... })`. This helper
 * builds the canonical wrapper — never-resolves `exited`, no-op `close`,
 * synthetic `pid`/`userDataDir` — to avoid the ~10 lines of boilerplate
 * each fixture used to copy.
 */
export interface FakeProcOptions {
  userDataDir?: string;
  pid?: number;
}

export function fakeChromiumProcess(
  pipe: FakePipe,
  opts: FakeProcOptions = {},
): {
  reader: PipeReader;
  writer: PipeWriter;
  userDataDir: string;
  pid: number;
  exited: Promise<number>;
  close: () => Promise<void>;
} {
  return {
    reader: pipe.reader,
    writer: pipe.writer,
    userDataDir: opts.userDataDir ?? "/tmp/mochi-cdp-fixture",
    pid: opts.pid ?? 0,
    exited: new Promise<number>(() => {
      /* never resolves — fake browser never exits on its own */
    }),
    close: async () => {
      /* no-op */
    },
  };
}
