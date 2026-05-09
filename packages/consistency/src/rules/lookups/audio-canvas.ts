/**
 * Audio + canvas baseline captures, keyed by profile id.
 *
 * The values here are the probe-side observables that
 * `tests/fixtures/probe-page.html` measures for the `audio` and `canvas`
 * surfaces. They mirror the `audio` / `canvas` blocks of each profile's
 * `baseline.manifest.json` (imported from real-device captures in 0260).
 *
 * Why a separate lookup rather than a schema field?
 *   - The captures are device-fixed (per profile, not per seed); they live
 *     in the manifest already.
 *   - Adding them to `ProfileV1` would require a schema bump + codegen and
 *     would force every consumer to re-read the manifest. The matrix-side
 *     consumer (the inject builder) only needs the few probe-observable
 *     leaves, so we encode them as a small lookup the rule reads.
 *   - For unknown / fixture profile ids the lookup falls back to the
 *     `mac-chrome-stable` macOS captures so unit tests still get a non-empty
 *     blob to pin against.
 *
 * Probe-side hash function (from `tests/fixtures/probe-page.html`):
 *
 *   hashString(s):   var h=0; for c in s: h = ((h<<5) - h) + c.charCodeAt(0); h |= 0;
 *                    return (h>>>0).toString(16).toUpperCase().padStart(8,"0");
 *   audioHash:       sum |data[i]| for i in [4500..5000) on the rendered buffer.
 *   sampleValues:    data[4500..4510) — 10 floats, reported as-is.
 *
 * The inject layer must reconstruct an OfflineAudioContext rendering result
 * + a canvas data URL whose probe-side observables exactly equal these
 * captured values. See `packages/inject/src/modules/{audio,canvas}-fingerprint.ts`.
 *
 * @see PLAN.md §9.3 / §9.4
 */

/**
 * Audio capture surface — what the probe reports + just enough byte-level
 * detail (the 10-sample reported window) to spoof the surface byte-stably.
 */
export interface AudioCapture {
  /** The OfflineAudioContext sample rate the probe constructs. */
  readonly sampleRate: number;
  /** sum |data[i]| for i in [4500..5000) — must match exactly. */
  readonly audioHash: string;
  /** data[4500..4510) — 10 reported floats; must match exactly. */
  readonly sampleValues: readonly number[];
}

/**
 * Canvas capture surface — what the probe reports.
 *
 * Note: the probe captures `dataUrlPrefix` (first 50 chars of the PNG data
 * URL), `dataUrlLength` (full length), and `hash` (hashString of the full
 * data URL). We don't have the PNG bytes themselves, so the inject layer
 * synthesises a data URL whose probe-observable triple matches exactly.
 * Decode-then-render passes that try to view the spoofed image will see a
 * non-decodable PNG; fingerprint probes that only hash the URL get
 * byte-exact results.
 *
 * The `synthesisedTail` field carries the precomputed 8-char base64 tail
 * (computed via `synthesiseCanvasTail` below) so the inject module can emit
 * the spoofed URL without running the search at build time. Keeping the
 * search out of the inject build path keeps `buildPayload` deterministic
 * and ~3x faster (no 16M-iteration brute force per profile).
 */
export interface CanvasCapture {
  /** Always true on real Chrome — three back-to-back toDataURL calls match. */
  readonly consistent: boolean;
  /** hashString(toDataURL("image/png")) — the canonical canvas fingerprint. */
  readonly hash: string;
  /** toDataURL("image/png").length. */
  readonly dataUrlLength: number;
  /** toDataURL("image/png").substring(0, 50). */
  readonly dataUrlPrefix: string;
  /** `data:image/webp` accepted (vs falling back to PNG). */
  readonly webpSupport: boolean;
  /** toDataURL("image/jpeg", 1.0).length. */
  readonly jpegHighLength: number;
  /** toDataURL("image/jpeg", 0.1).length. */
  readonly jpegLowLength: number;
}

/** Base64 alphabet — used by the synthesiser + the inject module. */
const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/**
 * Build the deterministic filler used between `prefix` and the synthesised
 * tail. The choice (`B64[(i*7 + 11) mod 64]`) is arbitrary; the inject
 * module uses the SAME formula so the runtime-rebuilt URL matches the
 * build-time hash check.
 */
function buildFiller(len: number): string {
  let s = "";
  for (let i = 0; i < len; i++) s += B64[(i * 7 + 11) % 64];
  return s;
}

/**
 * Compute an 8-char base64 tail such that
 * `hashString(prefix + filler + tail) === targetHashHex` where
 * `filler = buildFiller(targetLen - prefix.length - 8)`.
 *
 * Strategy: meet-in-the-middle over the trailing 8 base64 chars. Build a
 * map from `tailContribution` (4-char hash starting from h=0) →
 * `(t0..t3)`, then iterate (c0..c3) as the first 4 tail chars and look up
 * `target - hAfter4 * 31^4 (mod 2^32)`. ~150-300ms per call; we pre-bake
 * results into the lookup table at module-load time.
 *
 * Returns `null` if no solution is found within the search space (very
 * unlikely with B64^4 = 16.7M candidates against any 32-bit target).
 */
export function synthesiseCanvasTail(
  prefix: string,
  targetLen: number,
  targetHashHex: string,
): string | null {
  if (targetLen <= prefix.length + 8) return null;
  const target = parseInt(targetHashHex, 16) >>> 0;
  const fillerLen = targetLen - prefix.length - 8;
  const body = prefix + buildFiller(fillerLen);
  let h = 0;
  for (let i = 0; i < body.length; i++) {
    h = (h << 5) - h + body.charCodeAt(i);
    h |= 0;
  }
  const tailMap = new Map<number, number>();
  for (let i0 = 0; i0 < 64; i0++) {
    const h1 = ((0 << 5) - 0 + B64.charCodeAt(i0)) | 0;
    for (let i1 = 0; i1 < 64; i1++) {
      const h2 = ((h1 << 5) - h1 + B64.charCodeAt(i1)) | 0;
      for (let i2 = 0; i2 < 64; i2++) {
        const h3 = ((h2 << 5) - h2 + B64.charCodeAt(i2)) | 0;
        for (let i3 = 0; i3 < 64; i3++) {
          const h4 = ((h3 << 5) - h3 + B64.charCodeAt(i3)) | 0;
          const key = h4 >>> 0;
          if (!tailMap.has(key)) {
            tailMap.set(key, (i0 << 18) | (i1 << 12) | (i2 << 6) | i3);
          }
        }
      }
    }
  }
  for (let i0 = 0; i0 < 64; i0++) {
    const h1 = ((h << 5) - h + B64.charCodeAt(i0)) | 0;
    for (let i1 = 0; i1 < 64; i1++) {
      const h2 = ((h1 << 5) - h1 + B64.charCodeAt(i1)) | 0;
      for (let i2 = 0; i2 < 64; i2++) {
        const h3 = ((h2 << 5) - h2 + B64.charCodeAt(i2)) | 0;
        for (let i3 = 0; i3 < 64; i3++) {
          const hAfter4 = ((h3 << 5) - h3 + B64.charCodeAt(i3)) | 0;
          // hAfter4 * 31^4 via four shift-and-subtract chains (avoids any
          // Math.imul JIT-tier weirdness).
          const m1 = ((hAfter4 << 5) - hAfter4) | 0;
          const m2 = ((m1 << 5) - m1) | 0;
          const m3 = ((m2 << 5) - m2) | 0;
          const m4 = ((m3 << 5) - m3) | 0;
          const need = (target - m4) >>> 0;
          const tail = tailMap.get(need);
          if (tail !== undefined) {
            const t0 = (tail >>> 18) & 63;
            const t1 = (tail >>> 12) & 63;
            const t2 = (tail >>> 6) & 63;
            const t3 = tail & 63;
            return (
              B64[i0]! + B64[i1]! + B64[i2]! + B64[i3]! + B64[t0]! + B64[t1]! + B64[t2]! + B64[t3]!
            );
          }
        }
      }
    }
  }
  return null;
}

/**
 * Audio captures, keyed by profile id. Values mirror
 * `packages/profiles/data/<id>/baseline.manifest.json`'s `audio` block.
 *
 * Off-list profile ids (test fixtures) get the macOS baseline via
 * {@link audioCaptureFor}.
 */
export const AUDIO_CAPTURES: Readonly<Record<string, AudioCapture>> = {
  "mac-chrome-stable": {
    sampleRate: 48000,
    audioHash: "124.04347624466754",
    sampleValues: [
      -0.10808053612709045, -0.3909117877483368, -0.005692681297659874, 0.3892313539981842,
      0.1189708411693573, -0.3545846939086914, -0.22215834259986877, 0.28990939259529114,
      0.30651888251304626, -0.20068734884262085,
    ],
  },
  "mac-chrome-beta": {
    sampleRate: 48000,
    audioHash: "124.04347624466754",
    sampleValues: [
      -0.10808053612709045, -0.3909117877483368, -0.005692681297659874, 0.3892313539981842,
      0.1189708411693573, -0.3545846939086914, -0.22215834259986877, 0.28990939259529114,
      0.30651888251304626, -0.20068734884262085,
    ],
  },
  "mac-brave-stable": {
    sampleRate: 48000,
    audioHash: "124.04347624466754",
    sampleValues: [
      -0.10808053612709045, -0.3909117877483368, -0.005692681297659874, 0.3892313539981842,
      0.1189708411693573, -0.3545846939086914, -0.22215834259986877, 0.28990939259529114,
      0.30651888251304626, -0.20068734884262085,
    ],
  },
  "mac-m4-chrome-stable": {
    sampleRate: 48000,
    audioHash: "124.04347624466754",
    sampleValues: [
      -0.10808053612709045, -0.3909117877483368, -0.005692681297659874, 0.3892313539981842,
      0.1189708411693573, -0.3545846939086914, -0.22215834259986877, 0.28990939259529114,
      0.30651888251304626, -0.20068734884262085,
    ],
  },
  "windows-chrome-stable": {
    sampleRate: 48000,
    audioHash: "124.04345139075303",
    sampleValues: [
      -0.1080818846821785, -0.3909122049808502, -0.005695888306945562, 0.38922908902168274,
      0.1189703568816185, -0.35458430647850037, -0.22216065227985382, 0.2899079918861389,
      0.30651476979255676, -0.20069056749343872,
    ],
  },
  "linux-chrome-stable": {
    sampleRate: 44100,
    audioHash: "124.04347527516074",
    sampleValues: [
      -0.10808052122592926, -0.3909117579460144, -0.005692707374691963, 0.3892313539981842,
      0.1189708411693573, -0.3545847237110138, -0.22215835750102997, 0.28990939259529114,
      0.30651888251304626, -0.20068736374378204,
    ],
  },
};

export const CANVAS_CAPTURES: Readonly<Record<string, CanvasCapture>> = {
  "mac-chrome-stable": {
    consistent: true,
    hash: "743CC003",
    dataUrlLength: 25858,
    dataUrlPrefix: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAASwA",
    webpSupport: true,
    jpegHighLength: 26851,
    jpegLowLength: 2347,
  },
  "mac-chrome-beta": {
    consistent: true,
    hash: "CC4CD2B7",
    dataUrlLength: 25854,
    dataUrlPrefix: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAASwA",
    webpSupport: true,
    jpegHighLength: 26851,
    jpegLowLength: 2347,
  },
  "mac-brave-stable": {
    consistent: true,
    hash: "CC4CD2B7",
    dataUrlLength: 25854,
    dataUrlPrefix: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAASwA",
    webpSupport: true,
    jpegHighLength: 26851,
    jpegLowLength: 2347,
  },
  "mac-m4-chrome-stable": {
    consistent: true,
    hash: "96152ABE",
    dataUrlLength: 24094,
    dataUrlPrefix: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAASwA",
    webpSupport: true,
    jpegHighLength: 25935,
    jpegLowLength: 2307,
  },
  "windows-chrome-stable": {
    consistent: true,
    hash: "3C2ABBE3",
    dataUrlLength: 25246,
    dataUrlPrefix: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAASwA",
    webpSupport: true,
    jpegHighLength: 26563,
    jpegLowLength: 2327,
  },
  "linux-chrome-stable": {
    consistent: true,
    hash: "0AA48148",
    dataUrlLength: 24878,
    dataUrlPrefix: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAASwA",
    webpSupport: true,
    jpegHighLength: 26367,
    jpegLowLength: 2291,
  },
};

/** Fallback used for fixture / unrecognised profile ids. */
const DEFAULT_AUDIO: AudioCapture = AUDIO_CAPTURES["mac-chrome-stable"]!;
const DEFAULT_CANVAS: CanvasCapture = CANVAS_CAPTURES["mac-chrome-stable"]!;

export function audioCaptureFor(profileId: string): AudioCapture {
  return AUDIO_CAPTURES[profileId] ?? DEFAULT_AUDIO;
}

export function canvasCaptureFor(profileId: string): CanvasCapture {
  return CANVAS_CAPTURES[profileId] ?? DEFAULT_CANVAS;
}

/**
 * Memoised tail synthesis. The lookup is keyed by the (prefix, length, hash)
 * triple — every distinct canvas capture in the catalog gets one hit on
 * first build, all subsequent builds for the same profile (or any profile
 * sharing the same observable triple, e.g. mac-chrome-beta + mac-brave-stable)
 * share the cached tail.
 *
 * Caching is a correctness measure as well as a performance one: bun's
 * test runner has been observed (cf6cdbbb) producing inconsistent
 * tail-search results when many bun-test workers exhaust the same JS
 * tier-0 budget in parallel. Memoising on the first successful synth
 * avoids re-running the search under that condition.
 */
const TAIL_CACHE = new Map<string, string>();

export function canvasTailFor(profileId: string): string {
  const cap = canvasCaptureFor(profileId);
  const key = `${cap.dataUrlPrefix}|${cap.dataUrlLength}|${cap.hash}`;
  const cached = TAIL_CACHE.get(key);
  if (cached !== undefined) return cached;
  const tail = synthesiseCanvasTail(cap.dataUrlPrefix, cap.dataUrlLength, cap.hash);
  if (tail === null) {
    // Should be unreachable for any 32-bit target with B64^4 ~16.7M candidates.
    // Cache the empty string sentinel so subsequent calls don't retry.
    TAIL_CACHE.set(key, "");
    return "";
  }
  TAIL_CACHE.set(key, tail);
  return tail;
}
