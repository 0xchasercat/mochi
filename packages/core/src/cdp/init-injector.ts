/**
 * Init-script delivery via `Fetch.fulfillRequest` body injection + CSP rewriter.
 *
 * Architectural pivot — see PLAN.md §8.4. This REPLACES
 * `Page.addScriptToEvaluateOnNewDocument` as the inject delivery mechanism.
 *
 * Why
 * ---
 * Scripts installed via `Page.addScriptToEvaluateOnNewDocument` carry a
 * source-attribution leak: the "Vanilla CDP" detection probe inspects how
 * the very first script entered the page and recognises the
 * `addScriptToEvaluateOnNewDocument` channel. Patchright sidesteps the leak
 * entirely (see `crNetworkManagerPatch.ts:166-453`,
 * `RouteImpl._fixCSP`/`_injectIntoHead`/`fulfill`) by intercepting the
 * document response itself, rewriting any restrictive CSP, splicing the
 * payload as an inline `<script>` at end-of-`<head>` (before the first
 * non-comment `<script>`), and emitting `Fetch.fulfillRequest` with the
 * rewritten body.
 *
 * After this lands the inject is byte-indistinguishable from a same-origin
 * developer's own `<script>` tag.
 *
 * Wire algorithm
 * --------------
 * `Fetch.enable` is sent once with patterns
 *   `[{ urlPattern: "*", resourceType: "Document" }, { urlPattern: "*" }]`
 * — the more-specific Document pattern matches first; the catch-all wildcard
 * ensures every request also pauses (so we can answer `Fetch.authRequired`
 * via the same domain when credentials are configured).
 *
 * On `Fetch.requestPaused`:
 *   - resourceType === "Document":
 *       - request stage (no `responseStatusCode`)  → `Fetch.continueRequest`
 *           with `interceptResponse: true` so we get the response stage too.
 *       - response stage (has `responseStatusCode`) → fetch body, rewrite
 *           CSP, splice script, `Fetch.fulfillRequest`.
 *   - other resourceType → `Fetch.continueRequest` immediately (zero-cost
 *     pass-through; the request hangs if we don't reply).
 *
 * On `Fetch.authRequired` (only when `auth` is set): `Fetch.continueWithAuth`
 * with `ProvideCredentials`.
 *
 * Self-removing payload
 * ---------------------
 * The injected `<script>` runs an IIFE whose first statement is
 * `document.currentScript?.remove()`. A defensive post-`load` walk via
 * `document.querySelectorAll(".${MOCHI_INIT_SCRIPT_CLASS}")` strips any leftover
 * — added by the same IIFE so the DOM-walk happens once we know the document
 * is loaded.
 *
 * The injected `<script>` tag MUST NOT carry `defer`, `async`, or
 * `type="module"` — those defer execution past first parse and re-introduce
 * the same race window `runImmediately:true` originally closed.
 *
 * CSP rewriting
 * -------------
 * See {@link rewriteCsp}. We handle:
 *   - `Content-Security-Policy:` and `Content-Security-Policy-Report-Only:`
 *     response headers.
 *   - `<meta http-equiv="Content-Security-Policy" content="…">` tags in the
 *     HTML head.
 *   - nonce reuse (`'nonce-abc123'` → tag carries `nonce="abc123"`).
 *   - `'strict-dynamic'` (admits any script the original allowed dispatched —
 *     reusing the existing nonce is sufficient).
 *   - missing-nonce / `'self'`-only policies → add `'unsafe-inline'`.
 *   - multiple CSPs (header + meta) → most-restrictive wins, so we rewrite
 *     them ALL.
 *
 * §8.2 invariant
 * --------------
 * `Fetch.enable` is NOT on the forbidden list (only `Runtime.enable` and
 * `Page.createIsolatedWorld`). Fetch operates at the network layer below
 * page script and is invisible from JS — see PLAN.md §8.2.
 *
 * @see PLAN.md §8.2, §8.4
 * @see docs/audits/patchright.md HIGH §"Init-script delivery via Fetch.fulfillRequest"
 */

import type { MessageRouter, Unsubscribe } from "./router";

/**
 * The class attribute applied to every injected `<script>` tag. Patchright
 * uses a similar marker (`__playwright_init_script__`) — we publish ours so
 * the post-`load` cleanup walk (and any future probe-friendly diagnostic)
 * can find leftovers.
 */
export const MOCHI_INIT_SCRIPT_CLASS = "__mochi_init_script__";

/**
 * Public global the injected payload sets to `true` on first run. Used by the
 * live conformance test to assert "our inject ran BEFORE the document's first
 * `<script>`" — a property of execution order that distinguishes the
 * fulfill-rewrite mechanism from a post-parse alternative.
 */
export const MOCHI_INIT_MARKER = "__mochi_inject_marker";

/** What the `Fetch.requestPaused` event carries (subset we consume). */
interface FetchRequestPausedEvent {
  requestId: string;
  request: { url: string; method?: string };
  resourceType?: string;
  responseStatusCode?: number;
  responseHeaders?: { name: string; value: string }[];
  /** Set by Chromium when the response intercept was opted in via continueRequest. */
  responseErrorReason?: string;
  frameId?: string;
}

/** Options for {@link installInitInjector}. */
export interface InitInjectorOptions {
  /** The compiled payload source code. May be empty when bypassInject is on. */
  payloadCode: string | null;
  /** Optional proxy credentials. When set, `Fetch.authRequired` is answered via `continueWithAuth`. */
  auth?: { username: string; password: string };
}

/** Lifecycle handle. `dispose()` removes listeners and sends `Fetch.disable`. Idempotent. */
export interface InitInjectorHandle {
  dispose(): Promise<void>;
}

/**
 * Wire the unified Fetch-domain handler. Sends `Fetch.enable` once with the
 * Document-first patterns, subscribes to `Fetch.requestPaused` (and
 * `Fetch.authRequired` when `auth` is set), and tears down on `dispose()`.
 *
 * No-op fallback: when `payloadCode` is `null` AND `auth` is undefined, the
 * function returns a disposed handle without sending `Fetch.enable` — this
 * is the bypassInject + no-proxy capture path that wants zero protocol
 * surface.
 */
export async function installInitInjector(
  router: MessageRouter,
  opts: InitInjectorOptions,
): Promise<InitInjectorHandle> {
  const { payloadCode, auth } = opts;

  // Capture flow with no proxy auth has nothing to do — return a disposed
  // no-op handle so callers can construct uniformly.
  if (payloadCode === null && auth === undefined) {
    return {
      async dispose(): Promise<void> {
        // no-op
      },
    };
  }

  const wrappedPayload = payloadCode === null ? null : wrapSelfRemovingPayload(payloadCode);
  // Per-request id-set — `requestPaused` may fire twice for the same id
  // (request stage + response stage when interceptResponse: true) and we
  // want one fulfillment per request.
  const fulfilled = new Set<string>();

  // Subscribe BEFORE Fetch.enable so we never miss the first event.
  const offAuth: Unsubscribe | null = auth
    ? router.on("Fetch.authRequired", (params) => {
        const requestId = (params as { requestId?: string } | null)?.requestId;
        if (typeof requestId !== "string") return;
        router
          .send("Fetch.continueWithAuth", {
            requestId,
            authChallengeResponse: {
              response: "ProvideCredentials",
              username: auth.username,
              password: auth.password,
            },
          })
          .catch((err: unknown) => {
            if (!isClosedError(err)) {
              console.warn("[mochi] Fetch.continueWithAuth failed:", err);
            }
          });
      })
    : null;

  const offPaused: Unsubscribe = router.on("Fetch.requestPaused", (params, sessionId) => {
    const ev = params as FetchRequestPausedEvent | null;
    if (ev === null || typeof ev.requestId !== "string") return;
    void handlePaused(router, ev, sessionId, wrappedPayload, fulfilled).catch((err: unknown) => {
      if (!isClosedError(err)) {
        console.warn(
          `[mochi] init-injector: failed handling ${ev.resourceType ?? "?"} ${ev.request?.url ?? "?"}:`,
          err,
        );
      }
      // Best-effort: continue the request so it doesn't hang. Errors here
      // most commonly mean we can't get the body (already consumed) — we
      // still want the page to load.
      router
        .send(
          "Fetch.continueRequest",
          { requestId: ev.requestId },
          sessionId !== undefined ? { sessionId } : {},
        )
        .catch(() => {
          /* ignore */
        });
    });
  });

  // Patterns: Document first (matches first per CDP semantics), wildcard
  // catch-all second so every other request also pauses for proxy-auth
  // forwarding. Both stages of a Document request reach us when we set
  // `interceptResponse: true` on the request-stage continueRequest.
  await router.send("Fetch.enable", {
    handleAuthRequests: auth !== undefined,
    patterns: [{ urlPattern: "*", resourceType: "Document" }, { urlPattern: "*" }],
  });

  let disposed = false;
  return {
    async dispose(): Promise<void> {
      if (disposed) return;
      disposed = true;
      offAuth?.();
      offPaused();
      try {
        await router.send("Fetch.disable");
      } catch (err) {
        if (!isClosedError(err)) {
          console.warn("[mochi] Fetch.disable failed:", err);
        }
      }
    },
  };
}

/**
 * Per-event dispatcher. Document responses get the body-splice path; every
 * other resource is waved through with `continueRequest`.
 */
async function handlePaused(
  router: MessageRouter,
  ev: FetchRequestPausedEvent,
  sessionId: string | undefined,
  wrappedPayload: string | null,
  fulfilled: Set<string>,
): Promise<void> {
  const sendOpts = sessionId !== undefined ? { sessionId } : {};
  const isDocument = ev.resourceType === "Document";
  const isResponseStage = typeof ev.responseStatusCode === "number";

  // Non-Document or no-payload: forward immediately.
  if (!isDocument || wrappedPayload === null) {
    await router.send("Fetch.continueRequest", { requestId: ev.requestId }, sendOpts);
    return;
  }

  // Document, request stage (no response yet): opt into the response
  // intercept so we get a second `requestPaused` carrying the body.
  if (!isResponseStage) {
    await router.send(
      "Fetch.continueRequest",
      { requestId: ev.requestId, interceptResponse: true },
      sendOpts,
    );
    return;
  }

  // Document, response stage: fetch body, rewrite CSP, splice payload,
  // fulfill. Guard against a duplicate fulfillment for the same id (shouldn't
  // happen, but the set is cheap insurance).
  if (fulfilled.has(ev.requestId)) return;
  fulfilled.add(ev.requestId);

  const bodyResp = await router.send<{ body: string; base64Encoded: boolean }>(
    "Fetch.getResponseBody",
    { requestId: ev.requestId },
    sendOpts,
  );
  const originalBody = bodyResp.base64Encoded ? base64Decode(bodyResp.body) : bodyResp.body;

  // Existing response headers may carry CSP. We rewrite them and pass them
  // through to fulfillRequest. fulfill defaults Content-Length to body
  // length, but we still strip any explicit Content-Length to avoid mismatch
  // and the CSP pair.
  const originalHeaders = ev.responseHeaders ?? [];
  const { headers: rewrittenHeaders, scriptNonce } = rewriteHeaders(originalHeaders);
  // CSP-in-meta rewrite happens on the body string (HTML).
  const { html: cspFixedBody } = rewriteMetaCsp(originalBody);
  const splicedBody = injectIntoHead(cspFixedBody, wrappedPayload, scriptNonce);

  await router.send(
    "Fetch.fulfillRequest",
    {
      requestId: ev.requestId,
      responseCode: ev.responseStatusCode ?? 200,
      responseHeaders: rewrittenHeaders,
      body: base64Encode(splicedBody),
    },
    sendOpts,
  );
}

// ---- payload wrapper --------------------------------------------------------

/**
 * Wrap the raw payload in a self-removing IIFE that:
 *   1. Removes its own `<script>` node from the DOM as the very first action.
 *   2. Sets `__mochi_inject_marker = true` for conformance tests.
 *   3. Schedules a post-`load` DOM walk to strip any sibling marker tags
 *      (defence in depth — the same payload may run in many frames during
 *      a single page lifecycle).
 *   4. Runs the original payload.
 *
 * The wrapper produces no detectable global; the marker is gone after the
 * conformance test reads it (the test reads via `Runtime.callFunctionOn`
 * synchronously after `goto`).
 */
export function wrapSelfRemovingPayload(payloadCode: string): string {
  // Note: the inner IIFE wrapping is preserved AS-IS — buildPayload already
  // emits `(()=>{ ... })()`. We just prepend the self-remove + marker block.
  return [
    "(function(){",
    // Self-remove: keep the line short so a syntax error here is obvious.
    "try{document.currentScript&&document.currentScript.remove&&document.currentScript.remove();}catch(_){}",
    // Marker — set on every `globalThis` regardless of frame; the conformance
    // test reads it on the top-level frame.
    `try{Object.defineProperty(globalThis,${JSON.stringify(MOCHI_INIT_MARKER)},{value:true,writable:false,configurable:true});}catch(_){try{globalThis[${JSON.stringify(MOCHI_INIT_MARKER)}]=true;}catch(__){}}`,
    // Belt: post-load DOM walk that strips any leftover marker tags.
    `try{var __mochi_strip=function(){try{var ns=document.querySelectorAll(${JSON.stringify(`.${MOCHI_INIT_SCRIPT_CLASS}`)});for(var i=0;i<ns.length;i++){try{ns[i].parentNode&&ns[i].parentNode.removeChild(ns[i]);}catch(_){}}}catch(_){}}; if(document.readyState==='complete'){__mochi_strip();}else{addEventListener('load',__mochi_strip,{once:true});}}catch(_){}`,
    // Original payload — already wrapped in its own IIFE by buildPayload, so
    // we just splice it in. The trailing semicolon is defensive.
    payloadCode,
    ";})();",
  ].join("\n");
}

// ---- HTML splice ------------------------------------------------------------

/**
 * Splice an inline `<script>` carrying our payload into the document `<head>`
 * AHEAD of any existing non-comment `<script>` tag. When no head exists,
 * insert one at top of `<html>`. When that's also missing, prepend at the
 * very top of the body.
 *
 * Critical: the tag MUST NOT carry `defer`, `async`, or `type="module"` —
 * those defer execution past first parse and re-introduce the race window.
 *
 * @param html        HTML source
 * @param payloadCode JS source to inline (already self-removing-wrapped)
 * @param nonce       optional nonce attribute (when CSP requires nonce reuse)
 */
export function injectIntoHead(
  html: string,
  payloadCode: string,
  nonce: string | undefined,
): string {
  const idAttr = ` id="__mochi_init_${randomHex(16)}"`;
  const classAttr = ` class="${MOCHI_INIT_SCRIPT_CLASS}"`;
  const nonceAttr = nonce !== undefined && nonce.length > 0 ? ` nonce="${nonce}"` : "";
  const tag = `<script${classAttr}${idAttr}${nonceAttr}>${payloadCode}</script>`;

  // Find first `<script>` in the head, insert before it. We're not running
  // an HTML parser; this is deliberately simple and matches every valid
  // markup mochi tests against. patchright does the same.
  const headOpen = findHeadOpen(html);
  if (headOpen === null) {
    // No <head>. Try <html> insert.
    const htmlOpen = matchAfterTag(html, /<html[^>]*>/i);
    if (htmlOpen !== null) {
      return `${html.slice(0, htmlOpen)}<head>${tag}</head>${html.slice(htmlOpen)}`;
    }
    // No <html> either — prepend at top.
    return tag + html;
  }

  // Search for the first `<script>` AFTER headOpen but inside <head>.
  // Strip HTML comments before matching so we don't fall for
  // `<!-- <script>... -->`.
  const headEnd = findHeadClose(html, headOpen);
  const headInner = headEnd === null ? html.slice(headOpen) : html.slice(headOpen, headEnd);
  const stripped = stripHtmlComments(headInner);
  // First `<script>` (with or without attributes) in the stripped slice.
  const scriptMatch = /<script(\s|>)/i.exec(stripped);
  if (scriptMatch !== null) {
    // Translate the stripped-buffer offset back to the original buffer.
    const orig = mapStrippedOffsetToOriginal(headInner, scriptMatch.index);
    const insertAt = headOpen + orig;
    return html.slice(0, insertAt) + tag + html.slice(insertAt);
  }
  // No existing <script> in head — splice just after `<head…>` so we still
  // run before any inline script the body may carry.
  return html.slice(0, headOpen) + tag + html.slice(headOpen);
}

/**
 * Return the offset just after the opening `<head…>` tag, or null when
 * there's no head.
 */
function findHeadOpen(html: string): number | null {
  return matchAfterTag(html, /<head(\s[^>]*)?>/i);
}

function findHeadClose(html: string, from: number): number | null {
  const re = /<\/head\s*>/i;
  const slice = html.slice(from);
  const m = re.exec(slice);
  return m === null ? null : from + m.index;
}

function matchAfterTag(html: string, re: RegExp): number | null {
  const m = re.exec(html);
  if (m === null) return null;
  return m.index + m[0].length;
}

/** Replace `<!-- ... -->` with whitespace of identical length so offsets line up. */
function stripHtmlComments(s: string): string {
  return s.replace(/<!--[\s\S]*?-->/g, (m) => " ".repeat(m.length));
}

/** Identity mapping — we used same-length whitespace replacement above. */
function mapStrippedOffsetToOriginal(_original: string, strippedOffset: number): number {
  return strippedOffset;
}

// ---- CSP rewrite — headers --------------------------------------------------

/**
 * Walk the response-header list, rewriting any `Content-Security-Policy[-
 * Report-Only]` entries so an inline `<script>` we splice will be admitted.
 *
 * Returns the rewritten header list AND a nonce (extracted from the original
 * `script-src 'nonce-…'` directive, when present) so we can attach it to the
 * tag we splice. When multiple CSPs collide (rare — generally header + meta)
 * we adopt the FIRST nonce we encounter; the rule "most-restrictive wins"
 * means picking any one nonce always works because each policy is
 * independently rewritten.
 *
 * Header names are case-insensitive on the wire; we preserve the original
 * casing in the output to keep the response shape stable.
 */
export function rewriteHeaders(headers: { name: string; value: string }[]): {
  headers: { name: string; value: string }[];
  scriptNonce: string | undefined;
} {
  let scriptNonce: string | undefined;
  const out: { name: string; value: string }[] = [];
  for (const h of headers) {
    const lower = h.name.toLowerCase();
    if (lower === "content-security-policy" || lower === "content-security-policy-report-only") {
      const { value, nonce } = rewriteCsp(h.value);
      if (scriptNonce === undefined && nonce !== undefined) scriptNonce = nonce;
      out.push({ name: h.name, value });
      continue;
    }
    if (lower === "content-length") {
      // Body changes shape; let Chromium recompute (omitting the header
      // makes fulfillRequest set Content-Length itself).
      continue;
    }
    out.push(h);
  }
  return { headers: out, scriptNonce };
}

// ---- CSP rewrite — meta tag in body -----------------------------------------

/**
 * Rewrite any `<meta http-equiv="Content-Security-Policy" content="...">`
 * tags in the HTML head. We do NOT remove the tag (callers may rely on its
 * presence for non-script directives like `frame-ancestors`); we surgically
 * relax the script-related directives in the `content` attribute instead.
 */
export function rewriteMetaCsp(html: string): { html: string; firstNonce: string | undefined } {
  // case-insensitive `<meta ... http-equiv="Content-Security-Policy" ... content="...">`
  // Allow either order of attrs, single or double quotes.
  const re =
    /<meta\b[^>]*?http-equiv\s*=\s*("Content-Security-Policy"|'Content-Security-Policy')[^>]*>/gi;
  let firstNonce: string | undefined;
  const out = html.replace(re, (tag) => {
    const contentRe = /content\s*=\s*("([^"]*)"|'([^']*)')/i;
    const m = contentRe.exec(tag);
    if (m === null) return tag;
    const raw = (m[2] ?? m[3] ?? "") as string;
    const decoded = htmlAttrDecode(raw);
    const { value: rewritten, nonce } = rewriteCsp(decoded);
    if (firstNonce === undefined && nonce !== undefined) firstNonce = nonce;
    const encoded = htmlAttrEncode(rewritten);
    const quoteChar = m[1]?.[0] ?? '"';
    return tag.replace(contentRe, `content=${quoteChar}${encoded}${quoteChar}`);
  });
  return { html: out, firstNonce };
}

// ---- core CSP transformer ---------------------------------------------------

/**
 * Transform a single CSP string so an inline script we splice is admitted.
 *
 * Rules
 * -----
 *   - Walks every directive (`;`-separated). Only `script-src`,
 *     `script-src-elem`, and `default-src` are mutated; others pass through.
 *   - When the directive includes a nonce token (`'nonce-abc123'`), the
 *     nonce is returned and the directive is left intact — reusing the
 *     existing nonce on our `<script>` is sufficient.
 *   - When the directive includes `'strict-dynamic'`, the directive is left
 *     intact AND the nonce (if any) is extracted; strict-dynamic admits
 *     anything an already-admitted script then loads, but our INITIAL inline
 *     tag still needs a nonce. If no nonce exists alongside strict-dynamic
 *     the directive is invalid and we fall through to the unsafe-inline path.
 *   - Otherwise we ensure `'unsafe-inline'` is present.
 *
 * The function does not strip `'unsafe-eval'` or any unrelated directives.
 */
export function rewriteCsp(input: string): { value: string; nonce: string | undefined } {
  const directives = input
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  let extractedNonce: string | undefined;
  const out: string[] = [];
  // Track whether we've already mutated either of the script-relevant
  // directives so we can fall back to default-src if neither is present.
  let sawScriptSrc = false;
  let sawScriptSrcElem = false;

  for (const directive of directives) {
    const parts = directive.split(/\s+/);
    const name = (parts[0] ?? "").toLowerCase();
    const tokens = parts.slice(1);
    if (name === "script-src" || name === "script-src-elem" || name === "default-src") {
      const { tokens: rewritten, nonce } = adjustScriptSrcTokens(tokens);
      if (extractedNonce === undefined && nonce !== undefined) extractedNonce = nonce;
      out.push([name, ...rewritten].join(" "));
      if (name === "script-src") sawScriptSrc = true;
      if (name === "script-src-elem") sawScriptSrcElem = true;
      continue;
    }
    out.push(directive);
  }

  // If a `default-src` was the only fallback for scripts and didn't admit
  // inline, the rewrite already added `'unsafe-inline'` to default-src.
  // Nothing more to do.
  void sawScriptSrc;
  void sawScriptSrcElem;

  return { value: out.join("; "), nonce: extractedNonce };
}

/**
 * Inspect `script-src`-style tokens. If a nonce is present, extract it and
 * leave the tokens as-is. Otherwise add `'unsafe-inline'` (idempotent).
 */
function adjustScriptSrcTokens(tokens: string[]): { tokens: string[]; nonce: string | undefined } {
  let nonce: string | undefined;
  for (const t of tokens) {
    const m = /^'nonce-([^']+)'$/i.exec(t);
    if (m !== null) {
      nonce = m[1];
      break;
    }
  }
  if (nonce !== undefined) {
    // Keep tokens intact — strict-dynamic et al stay live.
    return { tokens, nonce };
  }
  // No nonce: ensure 'unsafe-inline' admits us. Idempotent.
  if (!tokens.some((t) => t.toLowerCase() === "'unsafe-inline'")) {
    return { tokens: [...tokens, "'unsafe-inline'"], nonce: undefined };
  }
  return { tokens, nonce: undefined };
}

// ---- helpers ----------------------------------------------------------------

/** Cryptographically-random hex string of `len` bytes. */
function randomHex(len: number): string {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}

/**
 * Decode HTML attribute entities we might encounter inside a meta-tag's
 * `content="…"` attribute. Spec-rigorous decoding is out of scope; the
 * common entities are enough for the policies real-world sites ship.
 */
function htmlAttrDecode(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
}

function htmlAttrEncode(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** Decode a Chromium `Fetch.getResponseBody` base64 string into UTF-8. */
function base64Decode(s: string): string {
  // Bun + browsers expose `atob`; fall back through Buffer for older runtimes.
  if (typeof atob === "function") {
    const bin = atob(s);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  }
  // Buffer path — Bun has it globally.
  const buf = (
    globalThis as {
      Buffer?: { from: (s: string, enc: string) => { toString(enc: string): string } };
    }
  ).Buffer;
  if (buf !== undefined) return buf.from(s, "base64").toString("utf-8");
  throw new Error("[mochi] no base64 decoder available");
}

/** Encode a UTF-8 string back into base64 for `Fetch.fulfillRequest`. */
function base64Encode(s: string): string {
  const bytes = new TextEncoder().encode(s);
  if (typeof btoa === "function") {
    let bin = "";
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin);
  }
  const buf = (
    globalThis as {
      Buffer?: { from: (b: Uint8Array) => { toString(enc: string): string } };
    }
  ).Buffer;
  if (buf !== undefined) return buf.from(bytes).toString("base64");
  throw new Error("[mochi] no base64 encoder available");
}

/** Closed-pipe / browser-crashed errors are non-actionable during teardown. */
function isClosedError(err: unknown): boolean {
  if (err instanceof Error) {
    return (
      err.name === "BrowserCrashedError" ||
      /transport already closed|pipe closed|browser process exited/i.test(err.message)
    );
  }
  return false;
}
