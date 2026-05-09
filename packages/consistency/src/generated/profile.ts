// AUTO-GENERATED — do not edit. Run `bun run codegen` to regenerate.
// Source schema lives in schemas/. See scripts/codegen.ts.

/**
 * A device-class profile consumed by @mochi.js/consistency. Declares the deterministic capabilities of a single (hardware, OS, browser) class. Instantiated for a specific seed by deriveMatrix() to produce a MatrixV1. See PLAN.md §6.1.
 */
export interface ProfileV1 {
  /**
   * Stable profile identifier, e.g. 'mac-m2-chrome-stable'.
   */
  id: string;
  /**
   * Semver version of this profile document.
   */
  version: string;
  /**
   * JS engine family. v1 invariant: chromium-only (PLAN.md I-4, decision #4).
   */
  engine: "chromium";
  /**
   * Browser identity this profile spoofs.
   */
  browser: {
    /**
     * Branded browser name. v1: chromium-family only.
     */
    name: "chrome" | "edge" | "brave" | "arc" | "opera";
    /**
     * Release channel.
     */
    channel: "stable" | "beta" | "dev" | "canary";
    /**
     * Inclusive lower bound on the Chromium-for-Testing major version this profile is verified against.
     */
    minVersion: string;
    /**
     * Inclusive upper bound on the Chromium-for-Testing major version this profile is verified against.
     */
    maxVersion: string;
  };
  /**
   * Host OS identity.
   */
  os: {
    name: "macos" | "windows" | "linux";
    /**
     * OS marketing version, e.g. '14' for macOS Sonoma.
     */
    version: string;
    arch: "arm64" | "x64" | "x86";
  };
  /**
   * Hardware identity.
   */
  device: {
    vendor: string;
    model: string;
    cpuFamily: string;
    /**
     * Logical core count exposed to navigator.hardwareConcurrency.
     */
    cores: number;
    /**
     * Physical RAM in GiB. navigator.deviceMemory caps at 8.
     */
    memoryGB: number;
  };
  /**
   * Display geometry surfaced via window.screen / matchMedia / visualViewport.
   */
  display: {
    width: number;
    height: number;
    dpr: number;
    colorDepth: number;
    pixelDepth: number;
  };
  /**
   * GPU identity surfaced via WebGL/WebGPU. Locks the canvas/webgl/webgpu render-hash chain.
   */
  gpu: {
    vendor: string;
    renderer: string;
    webglUnmaskedVendor: string;
    webglUnmaskedRenderer: string;
    webglMaxTextureSize: number;
    webglMaxColorAttachments: number;
    webglExtensions: string[];
  };
  /**
   * AudioContext capabilities surfaced via OfflineAudioContext / AudioContext.
   */
  audio: {
    contextSampleRate: number;
    audioWorkletLatency: number;
    destinationMaxChannelCount: number;
  };
  /**
   * Installed-font inventory used for font enumeration probes.
   */
  fonts: {
    /**
     * Curated pack identifier, e.g. 'macos-system-arial-pack'.
     */
    family: string;
    /**
     * @minItems 1
     */
    list: [string, ...string[]];
  };
  /**
   * IANA timezone identifier, e.g. 'America/Los_Angeles'.
   */
  timezone: string;
  /**
   * Primary BCP 47 locale, e.g. 'en-US'.
   */
  locale: string;
  /**
   * navigator.languages ordered list. First entry must match `locale`.
   *
   * @minItems 1
   */
  languages: [string, ...string[]];
  /**
   * Per-profile behavioral parameters consumed by @mochi.js/behavioral.
   */
  behavior: {
    hand: "left" | "right";
    /**
     * Per-axis Gaussian jitter amplitude, in pixel-equivalents.
     */
    tremor: number;
    /**
     * Mean typing speed in words per minute.
     */
    wpm: number;
    scrollStyle: "smooth" | "stepped" | "inertial";
  };
  /**
   * Preset name accepted by the wreq Rust crate, e.g. 'chrome_131_macos'. Maps profile -> TLS/H2 fingerprint.
   */
  wreqPreset: string;
  /**
   * Full navigator.userAgent string this profile spoofs.
   */
  userAgent: string;
  /**
   * User-Agent Client Hints (sec-ch-ua, sec-ch-ua-platform, etc.). Headers as observed on the wire.
   */
  uaCh: {
    [k: string]: string | undefined;
  };
  /**
   * Declares which fields are device-fixed vs. seed-varying. PLAN.md §6.1.
   */
  entropyBudget: {
    /**
     * Dotted paths into this profile that are constants across all seeds.
     */
    fixed: string[];
    /**
     * Dotted paths that resolve deterministically per (profile, seed) within the profile's declared bounds.
     */
    perSeed: string[];
  };
}
