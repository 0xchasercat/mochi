/**
 * derive-profile.ts — translate probe-page JSON into a `ProfileV1`.
 *
 * The output is the *device-class* description: OS / browser / device /
 * display / GPU / audio / fonts / locale / timezone — i.e. everything the
 * consistency engine needs to derive a Matrix for any seed. This is NOT
 * a fingerprint snapshot (that's the ProbeManifest).
 *
 * Heuristics:
 *   - `cpuFamily` is detected from the unmasked WebGL renderer string.
 *     Apple-Silicon Mn → `apple-silicon-m{n}`. Intel/AMD on Win/Linux fall
 *     back to a coarse vendor bucket. Unknown → `unknown`.
 *   - `wreqPreset` is derived from `(browser, majorVersion, os)` — the
 *     same naming wreq publishes (e.g. `chrome_131_macos`).
 *   - `memoryGB` is inferred from `navigator.deviceMemory * 2` (Chrome
 *     caps the published value at 8; the bake-in factor of 2 hits the
 *     16 GB midpoint typical of dev machines).
 *
 * Fallbacks: every probe family is wrapped in `safe()` upstream, so this
 * module receives a JSON value that may be `{ __error: string }` or
 * `null`. We narrow defensively and emit reasonable defaults.
 *
 * @see PLAN.md §6.1 / §12.1
 */

import type { ProfileV1 } from "@mochi.js/consistency";

/** The aggregated probe-page output produced by tests/fixtures/probe-page.html. */
export interface CapturedProbes {
  readonly navigator?: Record<string, unknown>;
  readonly screen?: Record<string, unknown>;
  readonly canvas?: Record<string, unknown>;
  readonly webgl?: Record<string, unknown>;
  readonly webgpu?: Record<string, unknown>;
  readonly audio?: Record<string, unknown>;
  readonly mediaDevices?: Record<string, unknown>;
  readonly speech?: Record<string, unknown>;
  readonly fonts?: Record<string, unknown>;
  readonly storage?: Record<string, unknown>;
  readonly timing?: Record<string, unknown>;
  readonly bot?: Record<string, unknown>;
  readonly __meta?: Record<string, unknown>;
}

export interface DeriveOptions {
  /** Profile id stamped on the output. */
  readonly profileId: string;
  /** Profile version (semver). Default: "1.0.0". */
  readonly version?: string;
}

const DEFAULT_PROFILE_VERSION = "1.0.0";

/**
 * Turn a captured probe payload into a {@link ProfileV1}. The output
 * MAY still need schema validation downstream — this function is
 * permissive about missing probes (replacing with conservative defaults)
 * but never throws.
 */
export function deriveProfile(probes: CapturedProbes, opts: DeriveOptions): ProfileV1 {
  const navigator = (probes.navigator ?? {}) as Record<string, unknown>;
  const screen = (probes.screen ?? {}) as Record<string, unknown>;
  const webgl = (probes.webgl ?? {}) as Record<string, unknown>;
  const audio = (probes.audio ?? {}) as Record<string, unknown>;
  const fonts = (probes.fonts ?? {}) as Record<string, unknown>;
  const timing = (probes.timing ?? {}) as Record<string, unknown>;

  const userAgent = readString(navigator.userAgent, defaultUserAgent());
  const platform = readString(navigator.platform, "MacIntel");
  const uadPlatform = readUadPlatform(navigator);
  const uadHigh = readUadHighEntropy(navigator);

  const osName = detectOsName(platform, uadPlatform, userAgent);
  const osVersion = readString(uadHigh.platformVersion, defaultOsVersion(osName));
  const arch = detectArch(uadHigh.architecture, uadHigh.bitness, platform, userAgent);

  const cores = readPositiveInt(navigator.hardwareConcurrency, 8);
  // Chrome caps deviceMemory at 8; double it for the typical 16 GiB dev box.
  const reportedMemory = readPositiveInt(navigator.deviceMemory, 4);
  const memoryGB = Math.max(1, reportedMemory * 2);

  const unmaskedRenderer = readString(webgl.unmaskedRenderer, "");
  const unmaskedVendor = readString(webgl.unmaskedVendor, "Google Inc.");
  const cpuFamily = detectCpuFamily(unmaskedRenderer, osName, arch);
  const deviceVendor = detectDeviceVendor(osName, unmaskedVendor, unmaskedRenderer);
  const deviceModel = readString(uadHigh.model, defaultDeviceModel(osName, arch));

  const browserMeta = detectBrowser(navigator, userAgent);
  const browserVersionMajor = browserMeta.majorVersion;

  const display = {
    width: readPositiveInt(screen.width, 1920),
    height: readPositiveInt(screen.height, 1080),
    dpr: readPositiveNumber(screen.devicePixelRatio, 1),
    colorDepth: readPositiveInt(screen.colorDepth, 24),
    pixelDepth: readPositiveInt(screen.pixelDepth, 24),
  };

  const gpu = {
    vendor: detectGpuVendor(unmaskedVendor, unmaskedRenderer),
    renderer: detectGpuRenderer(unmaskedRenderer),
    webglUnmaskedVendor: unmaskedVendor || "Google Inc.",
    webglUnmaskedRenderer: unmaskedRenderer || "ANGLE (Generic)",
    webglMaxTextureSize: readPositiveInt(webgl.maxTextureSize, 16384),
    webglMaxColorAttachments: readPositiveInt(webgl.maxColorAttachments, 8),
    webglExtensions: readStringArray(webgl.extensions, []),
  };

  const audioBlock = {
    contextSampleRate: readPositiveInt(audio.sampleRate, 48000),
    audioWorkletLatency: readPositiveNumber(audio.baseLatency, 0.005),
    destinationMaxChannelCount: readPositiveInt(audio.maxChannelCount, 2),
  };

  // Curated font intersection — we keep the captured detected list verbatim
  // (deduped + sorted for determinism). The list is the *device-class
  // truth* so the harness can replay it.
  const detectedFonts = readStringArray(fonts.detected, []);
  const dedupSorted = [...new Set(detectedFonts)].sort();
  const fontList: [string, ...string[]] =
    dedupSorted.length > 0 ? (dedupSorted as [string, ...string[]]) : [defaultFontFor(osName)];
  const fontFamily = `${osName}-system-pack`;

  const timezone = readString(timing.timezone, "UTC");
  const localeFromNav = readString(navigator.language, "en-US");
  const langs = readStringArray(navigator.languages, [localeFromNav]);
  const languages: [string, ...string[]] =
    langs.length > 0 ? (langs as [string, ...string[]]) : [localeFromNav];

  // For uaCh.sec-ch-ua-model we pass the *captured* model string verbatim —
  // real Chrome desktop reports "" (empty) for `model`, and stuffing the
  // device.model fallback ("Mac"/"PC"/"MacIntel") into the uaCh slot would
  // contradict the live header.
  const uadModel = typeof uadHigh.model === "string" ? uadHigh.model : "";
  const uaCh = buildUaCh(navigator, browserMeta, osName, osVersion, arch, uadModel);

  const wreqPreset = `${browserMeta.name}_${browserVersionMajor}_${osName}`;

  return {
    id: opts.profileId,
    version: opts.version ?? DEFAULT_PROFILE_VERSION,
    engine: "chromium",
    browser: {
      name: browserMeta.name,
      channel: "stable",
      minVersion: browserVersionMajor,
      maxVersion: browserVersionMajor,
    },
    os: { name: osName, version: osVersion, arch },
    device: {
      vendor: deviceVendor,
      model: deviceModel,
      cpuFamily,
      cores,
      memoryGB,
    },
    display,
    gpu,
    audio: audioBlock,
    fonts: { family: fontFamily, list: fontList },
    timezone,
    locale: localeFromNav,
    languages,
    behavior: { hand: "right", tremor: 0.18, wpm: 60, scrollStyle: "smooth" },
    wreqPreset,
    userAgent,
    uaCh,
    entropyBudget: { fixed: [], perSeed: [] },
  };
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function readString(v: unknown, fallback: string): string {
  return typeof v === "string" && v.length > 0 ? v : fallback;
}
function readPositiveInt(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.round(v) : fallback;
}
function readPositiveNumber(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : fallback;
}
function readStringArray(v: unknown, fallback: string[]): string[] {
  if (!Array.isArray(v)) return fallback;
  const out: string[] = [];
  for (const x of v) if (typeof x === "string") out.push(x);
  return out;
}

interface UadHighEntropy {
  readonly platformVersion?: string;
  readonly architecture?: string;
  readonly bitness?: string;
  readonly model?: string;
  readonly fullVersionList?: ReadonlyArray<{ brand?: string; version?: string }>;
}

function readUadHighEntropy(navigator: Record<string, unknown>): UadHighEntropy {
  const v = navigator.userAgentDataHighEntropy;
  if (!v || typeof v !== "object" || v === null || (v as { __error?: string }).__error) {
    return {};
  }
  const entries = v as Record<string, unknown>;
  const out: UadHighEntropy = {
    ...(typeof entries.platformVersion === "string"
      ? { platformVersion: entries.platformVersion }
      : {}),
    ...(typeof entries.architecture === "string" ? { architecture: entries.architecture } : {}),
    ...(typeof entries.bitness === "string" ? { bitness: entries.bitness } : {}),
    ...(typeof entries.model === "string" ? { model: entries.model } : {}),
  };
  const fvl = entries.fullVersionList;
  if (Array.isArray(fvl)) {
    const list: Array<{ brand?: string; version?: string }> = [];
    for (const item of fvl) {
      if (item && typeof item === "object") {
        const o = item as { brand?: unknown; version?: unknown };
        list.push({
          ...(typeof o.brand === "string" ? { brand: o.brand } : {}),
          ...(typeof o.version === "string" ? { version: o.version } : {}),
        });
      }
    }
    return { ...out, fullVersionList: list };
  }
  return out;
}

function readUadPlatform(navigator: Record<string, unknown>): string {
  const ua = navigator.userAgentData;
  if (ua && typeof ua === "object" && (ua as { platform?: unknown }).platform !== undefined) {
    const p = (ua as { platform?: unknown }).platform;
    if (typeof p === "string") return p;
  }
  return "";
}

function detectOsName(
  platform: string,
  uadPlatform: string,
  userAgent: string,
): "macos" | "windows" | "linux" {
  const blob = `${platform} ${uadPlatform} ${userAgent}`.toLowerCase();
  if (blob.includes("mac") || blob.includes("darwin")) return "macos";
  if (blob.includes("win")) return "windows";
  return "linux";
}

function detectArch(
  uadArch: string | undefined,
  uadBitness: string | undefined,
  platform: string,
  userAgent: string,
): "arm64" | "x64" | "x86" {
  if (uadArch === "arm" && uadBitness === "64") return "arm64";
  if (uadArch === "arm") return "arm64";
  if (uadArch === "x86" && uadBitness === "64") return "x64";
  if (uadArch === "x86" && uadBitness === "32") return "x86";
  // Heuristics
  const blob = `${platform} ${userAgent}`.toLowerCase();
  if (blob.includes("arm64") || blob.includes("aarch64")) return "arm64";
  if (blob.includes("wow64") || blob.includes("x86_64") || blob.includes("x64")) return "x64";
  if (blob.includes("i386") || blob.includes("i686") || blob.includes("x86")) return "x86";
  return "x64";
}

function defaultUserAgent(): string {
  return "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36";
}
function defaultOsVersion(os: "macos" | "windows" | "linux"): string {
  return os === "macos" ? "14" : os === "windows" ? "10" : "22";
}
function defaultDeviceModel(os: "macos" | "windows" | "linux", arch: string): string {
  if (os === "macos" && arch === "arm64") return "Mac";
  if (os === "macos") return "MacIntel";
  if (os === "windows") return "PC";
  return "generic-x64";
}
function defaultFontFor(os: "macos" | "windows" | "linux"): string {
  if (os === "macos") return "Helvetica";
  if (os === "windows") return "Arial";
  return "DejaVu Sans";
}

function detectCpuFamily(
  unmaskedRenderer: string,
  os: "macos" | "windows" | "linux",
  arch: "arm64" | "x64" | "x86",
): string {
  // Apple Silicon — match `Apple Mn` (M1, M2, M3, M4, …) including PRO/MAX/ULTRA suffixes.
  const m = unmaskedRenderer.match(/Apple\s*M(\d+)/i);
  if (m) return `apple-silicon-m${m[1]}`;
  if (os === "macos" && arch === "arm64") return "apple-silicon";
  if (os === "macos") return "intel-core";
  if (/(intel|iris|uhd)/i.test(unmaskedRenderer)) return "intel-core";
  if (/(amd|radeon)/i.test(unmaskedRenderer)) return "amd-ryzen";
  if (/(nvidia|geforce|rtx|gtx)/i.test(unmaskedRenderer)) return "intel-core";
  return arch === "arm64" ? "arm-generic" : "intel-core";
}

function detectDeviceVendor(
  os: "macos" | "windows" | "linux",
  unmaskedVendor: string,
  unmaskedRenderer: string,
): string {
  if (os === "macos") return "apple";
  const blob = `${unmaskedVendor} ${unmaskedRenderer}`.toLowerCase();
  if (blob.includes("nvidia")) return "generic";
  if (blob.includes("amd")) return "generic";
  if (blob.includes("intel")) return "generic";
  return "generic";
}

function detectGpuVendor(unmaskedVendor: string, unmaskedRenderer: string): string {
  const blob = `${unmaskedVendor} ${unmaskedRenderer}`;
  if (/Apple/i.test(blob)) return "Apple";
  if (/NVIDIA/i.test(blob)) return "NVIDIA Corporation";
  if (/AMD|ATI|Radeon/i.test(blob)) return "AMD";
  if (/Intel/i.test(blob)) return "Intel Inc.";
  return unmaskedVendor || "Generic";
}
function detectGpuRenderer(unmaskedRenderer: string): string {
  // Strip the "ANGLE (…)" wrapper to expose the inner GPU name when possible.
  const angle = unmaskedRenderer.match(/ANGLE\s*\(([^,]+),\s*([^,]+)/);
  if (angle?.[2]) return angle[2].trim();
  return unmaskedRenderer || "Generic Renderer";
}

interface BrowserMeta {
  name: "chrome" | "edge" | "brave" | "arc" | "opera";
  majorVersion: string;
  fullVersion: string;
}

function detectBrowser(navigator: Record<string, unknown>, userAgent: string): BrowserMeta {
  const uad = navigator.userAgentData;
  if (uad && typeof uad === "object") {
    const brands = (uad as { brands?: unknown }).brands;
    if (Array.isArray(brands)) {
      for (const b of brands) {
        if (b && typeof b === "object") {
          const brand = String((b as { brand?: unknown }).brand ?? "");
          const version = String((b as { version?: unknown }).version ?? "");
          const matched = matchBrand(brand);
          if (matched && version) {
            return {
              name: matched,
              majorVersion: version.split(".")[0] ?? version,
              fullVersion: version,
            };
          }
        }
      }
    }
  }
  // Fallback: parse the UA.
  const m = userAgent.match(/Chrome\/(\d+)\.([0-9.]+)/);
  return {
    name: /Edg\//i.test(userAgent) ? "edge" : "chrome",
    majorVersion: m?.[1] ?? "148",
    fullVersion: m ? `${m[1]}.${m[2] ?? "0"}` : "148.0.0.0",
  };
}

function matchBrand(b: string): "chrome" | "edge" | "brave" | "arc" | "opera" | null {
  const s = b.toLowerCase();
  if (s.includes("edge")) return "edge";
  if (s.includes("brave")) return "brave";
  if (s.includes("arc")) return "arc";
  if (s.includes("opera")) return "opera";
  if (s.includes("chrome") || s.includes("chromium")) return "chrome";
  return null;
}

function buildUaCh(
  navigator: Record<string, unknown>,
  browser: BrowserMeta,
  os: "macos" | "windows" | "linux",
  osVersion: string,
  arch: "arm64" | "x64" | "x86",
  deviceModel: string,
): Record<string, string> {
  const out: Record<string, string> = {};
  const uad = navigator.userAgentData;
  if (uad && typeof uad === "object") {
    const brands = (uad as { brands?: unknown }).brands;
    if (Array.isArray(brands)) {
      out["sec-ch-ua"] = brands
        .map((b) => {
          const brand = String((b as { brand?: unknown }).brand ?? "");
          const version = String((b as { version?: unknown }).version ?? "");
          return `"${brand}";v="${version}"`;
        })
        .join(", ");
    }
    const mobile = (uad as { mobile?: unknown }).mobile;
    out["sec-ch-ua-mobile"] = mobile === true ? "?1" : "?0";
    const plat = (uad as { platform?: unknown }).platform;
    if (typeof plat === "string") out["sec-ch-ua-platform"] = `"${plat}"`;
  }
  out["sec-ch-ua-platform-version"] = `"${osVersion}"`;
  out["sec-ch-ua-arch"] = `"${arch === "arm64" ? "arm" : "x86"}"`;
  out["sec-ch-ua-bitness"] = `"${arch === "x86" ? "32" : "64"}"`;
  out["sec-ch-ua-model"] = `"${deviceModel}"`;
  out["sec-ch-ua-full-version"] = `"${browser.fullVersion}"`;
  out["sec-ch-ua-os"] = `"${os}"`;
  return out;
}
