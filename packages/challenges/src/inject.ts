/**
 * Inject-side Turnstile detector.
 *
 * Compiles a small IIFE that runs in the page's main world (worldName: "")
 * via `Page.addScriptToEvaluateOnNewDocument(runImmediately:true)` per
 * PLAN.md §8.4. The script:
 *
 *   1. Installs a MutationObserver filtered to iframe inserts only — fires
 *      a callback when an iframe whose src matches
 *      `challenges.cloudflare.com/turnstile/` is added to the DOM.
 *   2. Emits a tagged `console.debug({__mochi_event:"turnstile-detected", ...})`
 *      payload so the mochi side can pick up early-detection signals (when
 *      that channel is wired in a follow-up task — see README "Detection
 *      Channel" section).
 *   3. Exposes a non-enumerable, Symbol-keyed snapshot reader on the
 *      document so the mochi-side poller can drain detected widget state
 *      via `Runtime.callFunctionOn` without `Runtime.enable` (forbidden by
 *      PLAN.md §8.2). The reader returns `{found, frames:[{id,src,rect}]}`
 *      shape; the Symbol key (`__mochi_ts_q__`) is the only externally
 *      visible surface and uses a Symbol so iterators / `Object.keys` /
 *      `for-in` don't enumerate it.
 *
 * **Closed-shadow design.** The inject script CANNOT see iframes
 * that live behind a closed shadow root: from page JS, `Element.shadowRoot`
 * is `null` for closed shadows and `MutationObserver` doesn't fire on
 * mutations inside them. So this script is intentionally only a coarse
 * detector — it covers light DOM and OPEN shadow integrations. The
 * authoritative scan happens host-side in `install.ts`'s tick loop, which
 * issues `Page.querySelectorAllPiercing(...)` (the host-side locator that
 * walks `DOM.getDocument({ depth:-1, pierce:true })` and traverses both open
 * and closed shadow descendants — see `packages/core/src/page/piercing.ts`).
 *
 * Trade-off: the host-side scan adds one CDP `DOM.getDocument` call per
 * `pollIntervalMs`-ms tick (default 500ms). On a busy page the tree can be
 * sizeable, but Cloudflare-protected pages are usually small at the point a
 * Turnstile widget appears, and `getDocument` is a single round-trip. We do
 * NOT ship a piercing MutationObserver here because there's no JS-only
 * mechanism for one — every inject-side observer falls back to host-side
 * CDP traversal anyway.
 *
 * Stealth invariants honored (PLAN.md §5.3, §8.4):
 *   - Wrapped in a single IIFE — no top-level identifiers escape.
 *   - All state lives in IIFE-locals; nothing on `window` / `globalThis`.
 *   - The reader-key Symbol is the only externally observable surface; it
 *     is non-enumerable and the property descriptor sets writable:false,
 *     configurable:false — page script cannot tamper.
 *   - MutationObserver filters to iframe inserts via tagName check before
 *     doing any work — does NOT fire on every mutation.
 *   - try/catch wraps each module so a thrown spoof can't take out the
 *     rest of the inject pipeline.
 *
 * The script is idempotent: if installed twice (e.g. across a same-origin
 * navigation) the second install is a no-op via the Symbol presence check.
 *
 * @see PLAN.md §5.3, §8.4
 */

/**
 * The well-known reader key. The mochi-side poller uses this exact string
 * to look up the Symbol on the document and call the snapshot reader.
 *
 * Lives in source so both sides agree without a separate sync mechanism.
 */
export const TURNSTILE_READER_KEY = "__mochi_ts_q__" as const;

/**
 * The console-debug magic tag used in the detection event payload. Reserved
 * for the wire protocol; the mochi-side console listener (when wired in a
 * follow-up task) filters to events whose first argument's `__mochi_event`
 * field equals one of these values.
 */
export const TURNSTILE_EVENT_NAMES = {
  detected: "turnstile-detected",
  resolved: "turnstile-resolved",
  escalated: "turnstile-escalated",
} as const;

/**
 * Build the inject IIFE. The result is a JS source string ready to feed to
 * `Page.addScriptToEvaluateOnNewDocument`.
 *
 * The script is parameterized only on the symbol key + event tags — there
 * are no per-(profile, seed) dependencies, so the same string is reused
 * across every Turnstile-enabled session.
 */
export function buildTurnstileInjectScript(): string {
  // The Cloudflare iframe origin signature. Both `/cdn-cgi/challenge-platform/`
  // and the public `challenges.cloudflare.com` URL families are observed in
  // the wild; we match either via substring against the iframe `src`.
  //
  // The `challenge.html` path is the escalated (image/audio) variant —
  // surfaced separately via TURNSTILE_EVENT_NAMES.escalated so callers can
  // bail out rather than blind-clicking.
  const TURNSTILE_HOSTS = JSON.stringify(["challenges.cloudflare.com/turnstile/"]);
  const ESCALATION_PATTERNS = JSON.stringify(["/challenge.html", "/managed.html"]);

  return `
// ---- @mochi.js/challenges turnstile detector ------------------------------
(function () {
  'use strict';
  try {
    if (typeof document === "undefined" || typeof window === "undefined") return;
    var READER_KEY = ${JSON.stringify(TURNSTILE_READER_KEY)};
    // Idempotent install: second invocation on same document is a no-op.
    var existing = Object.getOwnPropertySymbols(document).find(function (s) {
      return s.description === READER_KEY;
    });
    if (existing) return;

    var TURNSTILE_HOSTS = ${TURNSTILE_HOSTS};
    var ESCALATION_PATTERNS = ${ESCALATION_PATTERNS};
    var EV_DETECTED = ${JSON.stringify(TURNSTILE_EVENT_NAMES.detected)};
    var EV_ESCALATED = ${JSON.stringify(TURNSTILE_EVENT_NAMES.escalated)};

    /** Live registry of observed turnstile iframes, keyed by frame element. */
    var registry = new WeakMap();
    /** Counter used to assign stable string ids to discovered frames. */
    var nextId = 1;
    /** Snapshot array — append-only log, drained on read. */
    var queue = [];

    function isTurnstileSrc(src) {
      if (typeof src !== "string" || src.length === 0) return false;
      for (var i = 0; i < TURNSTILE_HOSTS.length; i++) {
        if (src.indexOf(TURNSTILE_HOSTS[i]) >= 0) return true;
      }
      return false;
    }

    function isEscalationSrc(src) {
      if (typeof src !== "string") return false;
      for (var i = 0; i < ESCALATION_PATTERNS.length; i++) {
        if (src.indexOf(ESCALATION_PATTERNS[i]) >= 0) return true;
      }
      return false;
    }

    function rectOf(el) {
      try {
        var r = el.getBoundingClientRect();
        return { x: r.left, y: r.top, width: r.width, height: r.height };
      } catch (_e) {
        return { x: 0, y: 0, width: 0, height: 0 };
      }
    }

    function emit(eventName, payload) {
      // Signed console.debug channel — see README "Detection Channel".
      // The first arg is a magic-tagged object the mochi-side listener
      // filters on. We deliberately use console.debug (not log/info/warn)
      // so it's the lowest-noise console level and most pages already
      // suppress it from their own DevTools view.
      try {
        if (typeof console !== "undefined" && typeof console.debug === "function") {
          console.debug({ __mochi_event: eventName, payload: payload });
        }
      } catch (_e) {}
    }

    function noteFrame(el) {
      var src = "";
      try { src = el.getAttribute("src") || ""; } catch (_e) {}
      if (!isTurnstileSrc(src)) return;
      if (registry.has(el)) return;
      var id = "ts-" + nextId++;
      var entry = { id: id, src: src, rect: rectOf(el), escalated: isEscalationSrc(src), at: Date.now() };
      registry.set(el, entry);
      queue.push(entry);
      emit(entry.escalated ? EV_ESCALATED : EV_DETECTED, entry);
    }

    function scanSubtree(root) {
      // Filter: only iframe elements. Avoids per-mutation full-tree work.
      if (!root || typeof root.querySelectorAll !== "function") return;
      try {
        if (root.tagName === "IFRAME") {
          noteFrame(root);
          return;
        }
        var iframes = root.querySelectorAll("iframe");
        for (var i = 0; i < iframes.length; i++) noteFrame(iframes[i]);
      } catch (_e) {}
    }

    /** Initial pass — handle iframes already in the document at script time. */
    function initialScan() {
      try {
        var existing = document.querySelectorAll("iframe");
        for (var i = 0; i < existing.length; i++) noteFrame(existing[i]);
      } catch (_e) {}
    }

    /** MutationObserver wired to filter iframe-only mutations cheaply. */
    function startObserver() {
      try {
        var mo = new MutationObserver(function (records) {
          for (var i = 0; i < records.length; i++) {
            var rec = records[i];
            if (rec.type === "childList") {
              var added = rec.addedNodes;
              for (var j = 0; j < added.length; j++) {
                var node = added[j];
                // Cheap filter: only ELEMENT_NODE (1) gets a tag check.
                if (node && node.nodeType === 1) scanSubtree(node);
              }
            } else if (rec.type === "attributes" && rec.target && rec.target.tagName === "IFRAME") {
              // src attribute mutation on an iframe — could be a managed
              // mode swap from about:blank → turnstile, or escalation.
              noteFrame(rec.target);
            }
          }
        });
        mo.observe(document, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ["src"],
        });
      } catch (_e) {}
    }

    /** Snapshot reader — the mochi-side poller calls this. */
    function snapshot() {
      // Refresh rects on every read so the click coordinates stay current
      // even as the iframe gets laid out / resized.
      var live = [];
      var entries = queue.slice();
      for (var i = 0; i < entries.length; i++) {
        var e = entries[i];
        live.push({ id: e.id, src: e.src, rect: e.rect, escalated: e.escalated, at: e.at });
      }
      // Best-effort: refresh rects from the live DOM.
      try {
        var iframes = document.querySelectorAll("iframe");
        for (var k = 0; k < iframes.length; k++) {
          var fr = iframes[k];
          var entry = registry.get(fr);
          if (entry) {
            for (var m = 0; m < live.length; m++) {
              if (live[m].id === entry.id) {
                live[m].rect = rectOf(fr);
                break;
              }
            }
          }
        }
      } catch (_e) {}
      return { found: live.length > 0, frames: live, token: readToken() };
    }

    /**
     * Read the cf-turnstile-response hidden field's value, if present. The
     * Turnstile widget injects this on success; reading it from the parent
     * document (where it lives — the iframe is a sibling) is how we detect
     * solve completion without polling cookies / network.
     */
    function readToken() {
      try {
        var els = document.querySelectorAll(
          'input[name="cf-turnstile-response"], textarea[name="cf-turnstile-response"]'
        );
        for (var i = 0; i < els.length; i++) {
          var v = els[i].value;
          if (typeof v === "string" && v.length > 0) return v;
        }
      } catch (_e) {}
      return null;
    }

    // Install the Symbol-keyed reader. Symbol key + non-enumerable +
    // non-configurable means page script can't enumerate or replace it.
    var sym = Symbol(READER_KEY);
    try {
      Object.defineProperty(document, sym, {
        value: snapshot,
        writable: false,
        enumerable: false,
        configurable: false,
      });
    } catch (_e) {
      // Best-effort — if the document is locked-down, page-side will fall
      // back to direct DOM polling via the mochi-side fallback path.
    }

    // Run once at install (covers iframes that were inlined in the initial
    // HTML) then start the observer for subsequent inserts.
    initialScan();
    startObserver();
  } catch (_e) {
    // Inject pipeline contract: never throw past the IIFE boundary.
  }
})();
`;
}
