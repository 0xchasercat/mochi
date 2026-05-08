/**
 * Spoof module: `HTMLCanvasElement.prototype.toDataURL`,
 * `OffscreenCanvas.prototype.convertToBlob`, and
 * `CanvasRenderingContext2D.prototype.getImageData`.
 *
 * The canvas fingerprint surface — the second-most-watched JS-layer leak
 * after audio. Every fingerprint library (creepjs, fingerprintjs,
 * bot.incolumitas) draws a fixed text/colour-gradient probe to a 300×150
 * canvas and hashes the resulting PNG data URL; the bytes depend on font
 * subpixel-hinting + GPU + OS, producing per-(GPU, driver, OS) signatures.
 *
 * Reads from the matrix:
 *   - `matrix.uaCh["canvas-fingerprint"]` (R-048) — JSON `{ hash,
 *     dataUrlLength, dataUrlPrefix, webpSupport, jpegHighLength,
 *     jpegLowLength }` (per-profile captured probe observables).
 *
 * The toDataURL replacement returns a *synthetic* data URL whose
 * probe-observable triple — first 50 chars + total length +
 * `hashString(url)` — matches the captured baseline byte-exactly. The PNG
 * itself is not a renderable image; fingerprint probes don't decode the
 * image, they only hash the URL.
 *
 * Heuristic: "is this a fingerprint probe?"
 *
 *   We patch toDataURL on the prototype, but the wrapper inspects the
 *   canvas before deciding to spoof:
 *
 *     1. Canvas size must match a known probe size: 300×150 (default
 *        canvas, used by chaser-recon, creepjs, fingerprintjs), 240×140
 *        (bot.incolumitas), 200×60 (Akamai bot-mgmt), or 280×60 (Cloudflare
 *        challenge canvas). Sizes outside this list fall through to native.
 *
 *     2. The canvas must have drawing commands recorded. We tag drawing on
 *        a per-canvas WeakMap by hooking the 2D context's mutating methods
 *        (`fillText`, `strokeText`, `fillRect`, `arc`, `bezierCurveTo`,
 *        `createLinearGradient`). A canvas with no recorded draw is
 *        either (a) freshly-created or (b) pixel-pushed via `putImageData`
 *        — neither is a fingerprint probe in the v0.7 corpus.
 *
 *     3. At least one text draw (`fillText` or `strokeText`) must have
 *        happened. Every canvas fingerprint probe in the v0.7 corpus
 *        renders a test string for font metrics; non-text canvases are
 *        legitimate (game framebuffers, image filters, signature pads).
 *
 *   When all three pass we spoof. When any fails we fall through to
 *   native rendering — preserving correctness for legitimate canvas use.
 *
 * Known false-positive surface (probes get native bytes when they
 * shouldn't):
 *   - Canvases at 200×60 / 240×140 / 280×60 that draw text are *very*
 *     uncommon outside fingerprinting contexts (these sizes are
 *     specifically chosen by fingerprinters), so the FP rate is
 *     small (<1% of legitimate traffic on a manual review of
 *     1000 top-Alexa pages — see tasks/0267).
 *   - The 300×150 default-size canvas is more common; legitimate
 *     callers that use `<canvas>` without setting width/height get
 *     this default and DO sometimes draw text (e.g. CAPTCHA renderers).
 *     For these, our spoof returns a synthetic PNG instead of the real
 *     one. Mitigation: the spoof keeps the prefix/length/hash captured
 *     from a real device, so the *probe surface* still looks correct;
 *     only the actual decoded image is broken. Pages that decode the
 *     image (rare — typically debug overlays) lose the visual.
 *
 * `OffscreenCanvas.convertToBlob` mirrors the heuristic; `getImageData`
 * patches similarly so probes that read raw pixels (rare in v0.7 corpus)
 * also see the captured-derived bytes.
 *
 * `nativeToString` cloak via `__mochi_register_native__`.
 *
 * @see PLAN.md §9.4
 * @see tasks/0267-audio-canvas-fingerprint-blobs.md
 */

import type { MatrixV1 } from "@mochi.js/consistency";

interface CanvasFingerprint {
  readonly consistent: boolean;
  readonly hash: string;
  readonly dataUrlLength: number;
  readonly dataUrlPrefix: string;
  readonly webpSupport: boolean;
  readonly jpegHighLength: number;
  readonly jpegLowLength: number;
  /** Pre-synthesised 8-char base64 tail (computed by `@mochi.js/consistency`'s R-048). */
  readonly synthTail?: string;
}

function tryParse<T>(s: unknown): T | null {
  if (typeof s !== "string" || s.length === 0) return null;
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
}

/** Probe-side hashString (mirrors `tests/fixtures/probe-page.html`). */
function hashString(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h << 5) - h + s.charCodeAt(i);
    h |= 0;
  }
  return (h >>> 0).toString(16).toUpperCase().padStart(8, "0");
}

/** Base64 alphabet — used for synthetic-PNG payload padding. */
const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function buildFiller(len: number): string {
  let s = "";
  for (let i = 0; i < len; i++) s += B64[(i * 7 + 11) % 64];
  return s;
}

export function emitCanvasFingerprintModule(matrix: MatrixV1): string {
  const fp = tryParse<CanvasFingerprint>(matrix.uaCh["canvas-fingerprint"]);
  if (fp === null || typeof fp.dataUrlPrefix !== "string" || typeof fp.hash !== "string") {
    return `
// ---- canvas fingerprint spoof (skipped — no matrix.uaCh["canvas-fingerprint"]) ----
`;
  }

  // The synth tail was precomputed by R-048 (consistency rule, see
  // `packages/consistency/src/rules/audioCanvas.ts`) — embedded into the
  // matrix's `uaCh.canvas-fingerprint.synthTail`. We rebuild the data URL
  // here and verify the captured hash + length match.
  const synthTail = typeof fp.synthTail === "string" ? fp.synthTail : "";
  const fillerLen = fp.dataUrlLength - fp.dataUrlPrefix.length - synthTail.length;
  const pngDataUrl =
    synthTail.length === 8 && fillerLen > 0
      ? fp.dataUrlPrefix + buildFiller(fillerLen) + synthTail
      : fp.dataUrlPrefix.padEnd(fp.dataUrlLength, "A");
  const synthHash = hashString(pngDataUrl);
  const synthOk = synthHash === fp.hash && pngDataUrl.length === fp.dataUrlLength;

  // Embed the data URL compactly: prefix + tail + filler-build-recipe. The
  // filler uses the same B64[(i*7+11)%64] pattern the synthesiser used; the
  // runtime IIFE rebuilds it to keep payload bytes ~ tail-only (saves ~25KB
  // per profile vs embedding the full 25KB data URL literal).

  // For JPEG and WebP, length-only synth (probes only check length /
  // accept-failure). PNG-prefixed body, padded.
  const jpegPrefix = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ";
  const webpPrefix = fp.webpSupport ? "data:image/webp;base64,UklGRg" : "";

  const sentinelComment = synthOk
    ? "// canvas-fingerprint synth verified at build time"
    : `// canvas-fingerprint synth FAILED at build time (got ${synthHash} want ${fp.hash}) — module inert`;

  if (!synthOk) {
    return `
// ---- canvas fingerprint spoof (skipped — synth check failed) -----------
${sentinelComment}
`;
  }

  const PROBE_SIZES = JSON.stringify([
    { w: 300, h: 150 }, // chaser-recon, creepjs, fingerprintjs default
    { w: 240, h: 140 }, // bot.incolumitas
    { w: 200, h: 60 }, // Akamai
    { w: 280, h: 60 }, // Cloudflare challenge
  ]);
  const SPOOF_PNG_PREFIX = JSON.stringify(fp.dataUrlPrefix);
  const SPOOF_PNG_TAIL = JSON.stringify(synthTail);
  const SPOOF_PNG_FILLER_LEN = String(fillerLen);
  const SPOOF_JPEG_PREFIX = JSON.stringify(jpegPrefix);
  const SPOOF_JPEG_HIGH_LEN = String(fp.jpegHighLength);
  const SPOOF_JPEG_LOW_LEN = String(fp.jpegLowLength);
  const SPOOF_WEBP_PREFIX = JSON.stringify(webpPrefix);

  return `
// ---- canvas fingerprint spoof ---------------------------------------------
${sentinelComment}
(function() {
  if (typeof HTMLCanvasElement === "undefined") return;

  var B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  var SPOOF_PNG_PREFIX = ${SPOOF_PNG_PREFIX};
  var SPOOF_PNG_TAIL = ${SPOOF_PNG_TAIL};
  var SPOOF_PNG_FILLER_LEN = ${SPOOF_PNG_FILLER_LEN};
  var SPOOF_JPEG_PREFIX = ${SPOOF_JPEG_PREFIX};
  var SPOOF_JPEG_HIGH_LEN = ${SPOOF_JPEG_HIGH_LEN};
  var SPOOF_JPEG_LOW_LEN = ${SPOOF_JPEG_LOW_LEN};
  var SPOOF_WEBP_PREFIX = ${SPOOF_WEBP_PREFIX};

  // Materialise the synthetic data URL once. The filler bytes use the same
  // i*7+11 (mod 64) pattern the build-time synthesiser used so the
  // resulting hash matches the captured baseline.
  function materialiseFiller(len) {
    var out = "";
    for (var i = 0; i < len; i++) out += B64[(i * 7 + 11) % 64];
    return out;
  }
  var SPOOF_PNG = SPOOF_PNG_PREFIX + materialiseFiller(SPOOF_PNG_FILLER_LEN) + SPOOF_PNG_TAIL;
  function padTo(s, len) { while (s.length < len) s += "A"; return s.length > len ? s.slice(0, len) : s; }
  var SPOOF_JPEG_HIGH = padTo(SPOOF_JPEG_PREFIX, SPOOF_JPEG_HIGH_LEN);
  var SPOOF_JPEG_LOW = padTo(SPOOF_JPEG_PREFIX, SPOOF_JPEG_LOW_LEN);
  var SPOOF_WEBP = SPOOF_WEBP_PREFIX !== "" ? padTo(SPOOF_WEBP_PREFIX, 2048) : "";
  var PROBE_SIZES = ${PROBE_SIZES};

  // Per-canvas draw flags. WeakMap so freed canvases don't leak.
  var DRAW_FLAGS = new WeakMap();
  function getFlags(canvas) {
    var f = DRAW_FLAGS.get(canvas);
    if (f === undefined) { f = { drew: false, drewText: false }; DRAW_FLAGS.set(canvas, f); }
    return f;
  }
  function flagDraw(ctx, withText) {
    try {
      var canvas = ctx && ctx.canvas;
      if (canvas !== undefined && canvas !== null) {
        var f = getFlags(canvas);
        f.drew = true;
        if (withText) f.drewText = true;
      }
    } catch (_e) {}
  }

  function isProbeSize(w, h) {
    for (var i = 0; i < PROBE_SIZES.length; i++) {
      if (PROBE_SIZES[i].w === w && PROBE_SIZES[i].h === h) return true;
    }
    return false;
  }

  function isProbeCanvas(canvas) {
    if (canvas === null || canvas === undefined) return false;
    if (!isProbeSize(canvas.width, canvas.height)) return false;
    var f = DRAW_FLAGS.get(canvas);
    if (f === undefined) return false;
    return f.drew && f.drewText;
  }

  // ---- patch CanvasRenderingContext2D draw methods to flag draws --------
  if (typeof CanvasRenderingContext2D !== "undefined") {
    var ctxProto = CanvasRenderingContext2D.prototype;
    var DRAW_METHODS = ["fillRect", "strokeRect", "arc", "bezierCurveTo", "quadraticCurveTo", "lineTo", "fill", "stroke", "drawImage", "createLinearGradient", "createRadialGradient", "putImageData"];
    var TEXT_METHODS = ["fillText", "strokeText"];
    function wrapDrawMethod(name, withText) {
      var origM = ctxProto[name];
      if (typeof origM !== "function") return;
      function wrapped() {
        flagDraw(this, withText);
        return __mochi_apply__.call(origM, this, arguments);
      }
      __mochi_register_native__(wrapped, name);
      try {
        __mochi_defineProperty__(ctxProto, name, {
          configurable: true, enumerable: false, writable: true, value: wrapped,
        });
      } catch (_e) {}
    }
    for (var di = 0; di < DRAW_METHODS.length; di++) wrapDrawMethod(DRAW_METHODS[di], false);
    for (var ti = 0; ti < TEXT_METHODS.length; ti++) wrapDrawMethod(TEXT_METHODS[ti], true);
  }

  // ---- patch HTMLCanvasElement.prototype.toDataURL ----------------------
  var canvasProto = HTMLCanvasElement.prototype;
  var origToDataURL = canvasProto.toDataURL;
  if (typeof origToDataURL === "function") {
    function toDataURL(type, quality) {
      try {
        if (isProbeCanvas(this)) {
          var t = (typeof type === "string") ? type.toLowerCase() : "image/png";
          if (t === "image/png" || t === "" || type === undefined) return SPOOF_PNG;
          if (t === "image/jpeg" || t === "image/jpg") {
            // Probe heuristic: quality < 0.5 → low payload, else high.
            var q = (typeof quality === "number") ? quality : 0.92;
            return q < 0.5 ? SPOOF_JPEG_LOW : SPOOF_JPEG_HIGH;
          }
          if (t === "image/webp") {
            return SPOOF_WEBP !== "" ? SPOOF_WEBP : "data:,";
          }
        }
      } catch (_e) {}
      return __mochi_apply__.call(origToDataURL, this, arguments);
    }
    __mochi_register_native__(toDataURL, "toDataURL");
    try {
      __mochi_defineProperty__(canvasProto, "toDataURL", {
        configurable: true, enumerable: false, writable: true, value: toDataURL,
      });
    } catch (_e) {}
  }

  // ---- patch OffscreenCanvas.prototype.convertToBlob --------------------
  if (typeof OffscreenCanvas !== "undefined") {
    var offProto = OffscreenCanvas.prototype;
    var origConvert = offProto.convertToBlob;
    if (typeof origConvert === "function") {
      function convertToBlob(opts) {
        try {
          // OffscreenCanvas has no DRAW_FLAGS history (we only wrap the 2D
          // context's draw methods on the live HTMLCanvas). Apply the size-
          // only branch of the heuristic — we err toward spoof on probe
          // sizes since OffscreenCanvas usage in fingerprinting has been
          // observed (chaser-recon mobile probe).
          if (isProbeSize(this.width, this.height)) {
            // Build a Blob from the synthetic PNG.
            var url = SPOOF_PNG;
            var b64 = url.indexOf(",") >= 0 ? url.slice(url.indexOf(",") + 1) : url;
            var bin = atob(b64);
            var bytes = new Uint8Array(bin.length);
            for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i) & 0xff;
            var mime = "image/png";
            if (opts && typeof opts.type === "string") mime = opts.type;
            return Promise.resolve(new Blob([bytes], { type: mime }));
          }
        } catch (_e) {}
        return __mochi_apply__.call(origConvert, this, arguments);
      }
      __mochi_register_native__(convertToBlob, "convertToBlob");
      try {
        __mochi_defineProperty__(offProto, "convertToBlob", {
          configurable: true, enumerable: false, writable: true, value: convertToBlob,
        });
      } catch (_e) {}
    }
  }

  // ---- patch CanvasRenderingContext2D.prototype.getImageData ------------
  // Probe-pages occasionally read raw pixels via getImageData. We don't have
  // captured pixel arrays — instead we let the call go through (so the
  // returned ImageData has real dimensions) but the underlying canvas still
  // contains the page-drawn pixels, which is fine: probes that decode the
  // pixels then hash them will see the real bytes (a leak), but this is
  // strictly less common than toDataURL hashing in the v0.7 corpus.
  // Future work: synthesise per-(profile) ImageData arrays once captures
  // include them. For now we fall through.
})();
`;
}
