/**
 * @mochi.js/cli/capture — `mochi capture` orchestrator.
 *
 * Drives a bare, un-spoofed Chromium against the canonical
 * `tests/fixtures/probe-page.html` fixture, captures every probe
 * family, derives the device-class facts into a {@link ProfileV1},
 * validates against the schema, and writes the result to disk:
 *
 *   <out>/profile.json            — the derived ProfileV1
 *   <out>/baseline.manifest.json  — the raw probe payload (ProbeManifestV1
 *                                   shape; v0.4 keeps it raw, harness
 *                                   normalization lands in phase 0.5)
 *   <out>/PROVENANCE.md           — capturer / machine / version / etc.
 *
 * Critical invariant (PLAN.md §12.1): the browser MUST be unmodified —
 * `mochi.launch({ bypassInject: true })` short-circuits the inject
 * payload so the captured fingerprint is the device's truth, not the
 * spoofed Matrix.
 *
 * @see PLAN.md §12.1
 * @see tasks/0040-mochi-capture.md
 */

import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import type { ProfileV1 } from "@mochi.js/consistency";
import { type LaunchOptions, mochi } from "@mochi.js/core";
import { resolveChromiumBinary } from "../browsers/index";
import { VERSION as CLI_VERSION } from "../index";
import { type CapturedProbes, type DeriveOptions, deriveProfile } from "./derive-profile";
import { locateProbePage, type ProbePageLocation } from "./probe-page";
import {
  collectProvenance,
  type ProvenanceInputs,
  type ProvenanceRecord,
  renderProvenance,
} from "./provenance";
import {
  loadProfileSchema,
  type ValidationError,
  type ValidationResult,
  validate,
} from "./validate";

/**
 * Options accepted by {@link runCapture}.
 *
 * Mirror of the `mochi capture` flag set, plus a couple of test seams
 * (`provenanceInputs`, `interactive`, `now`). The CLI subcommand layer
 * fills these from argv; tests fill them directly.
 */
export interface CaptureOptions {
  /** Profile id stamped into the output. */
  readonly profileId: string;
  /** Output directory; defaults to `packages/profiles/data/<id>/`. */
  readonly outDir?: string;
  /** Override Chromium binary path; falls back to `resolveChromiumBinary()`. */
  readonly browserPath?: string;
  /** Seed for the (bypassed) Matrix derivation. Default: `capture-<id>`. */
  readonly seed?: string;
  /** Run the browser headless. Default: true (capture is non-interactive). */
  readonly headless?: boolean;
  /** Provenance pre-fills. */
  readonly provenanceInputs?: ProvenanceInputs;
  /** Whether the provenance collector may prompt. Default: false (non-TTY). */
  readonly interactive?: boolean;
  /** Probe-completion polling timeout. Default: 30000 ms. */
  readonly probeTimeoutMs?: number;
  /** Override `Date.now()` for deterministic testing. */
  readonly now?: () => Date;
}

export interface CaptureResult {
  readonly profile: ProfileV1;
  readonly probes: CapturedProbes;
  readonly provenance: ProvenanceRecord;
  readonly outDir: string;
  readonly profilePath: string;
  readonly manifestPath: string;
  readonly provenancePath: string;
  readonly probePage: ProbePageLocation;
}

/**
 * Thrown when the derived profile fails schema validation. The partial
 * output is written to `<outDir>/.invalid/` for diagnosis.
 */
export class CaptureValidationError extends Error {
  override readonly name = "CaptureValidationError";
  readonly errors: readonly ValidationError[];
  readonly invalidDir: string;
  constructor(message: string, errors: readonly ValidationError[], invalidDir: string) {
    super(message);
    this.errors = errors;
    this.invalidDir = invalidDir;
  }
}

/**
 * Build a *bare* `ProfileV1` for `mochi.launch` to consume. The
 * consistency engine still derives a Matrix from this — the matrix is
 * just NOT injected (`bypassInject: true`). v0.4 uses a generic
 * placeholder; the captured ProfileV1 we WRITE comes from
 * {@link deriveProfile}, NOT this stub.
 */
function bareLaunchProfile(profileId: string): ProfileV1 {
  return {
    id: `${profileId}-bare-launch`,
    version: "0.0.0-bare",
    engine: "chromium",
    browser: { name: "chrome", channel: "stable", minVersion: "131", maxVersion: "133" },
    os: { name: "linux", version: "22", arch: "x64" },
    device: {
      vendor: "generic",
      model: "generic-x64",
      cpuFamily: "intel-core-i7",
      cores: 8,
      memoryGB: 16,
    },
    display: { width: 1920, height: 1080, dpr: 1, colorDepth: 24, pixelDepth: 24 },
    gpu: {
      vendor: "Intel Inc.",
      renderer: "Intel Iris Xe Graphics",
      webglUnmaskedVendor: "Google Inc. (Intel Inc.)",
      webglUnmaskedRenderer: "ANGLE (Intel Inc., Intel Iris Xe Graphics, OpenGL 4.1)",
      webglMaxTextureSize: 16384,
      webglMaxColorAttachments: 8,
      webglExtensions: [],
    },
    audio: { contextSampleRate: 48000, audioWorkletLatency: 0.005, destinationMaxChannelCount: 2 },
    fonts: { family: "linux-baseline", list: ["DejaVu Sans"] },
    timezone: "UTC",
    locale: "en-US",
    languages: ["en-US", "en"],
    behavior: { hand: "right", tremor: 0.18, wpm: 60, scrollStyle: "smooth" },
    wreqPreset: "chrome_131_linux",
    userAgent:
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    uaCh: {},
    entropyBudget: { fixed: [], perSeed: [] },
  };
}

const DEFAULT_PROBE_TIMEOUT_MS = 30_000;
const PROBE_POLL_INTERVAL_MS = 100;

/**
 * Run the full capture pipeline. Returns the captured + persisted
 * artifacts; throws {@link CaptureValidationError} on schema failure.
 *
 * Steps (mirrors PLAN.md §12.1):
 *   1. Locate the probe-page fixture.
 *   2. Resolve the Chromium binary.
 *   3. `mochi.launch(...bypassInject: true)` against bare Chromium.
 *   4. Open a new page; navigate to `file://…/probe-page.html`.
 *   5. Poll `window.__probesReady` until true (timeout: 30s).
 *   6. Read `#probes` text content; parse as JSON.
 *   7. Derive a ProfileV1 from the probes.
 *   8. Validate against `schemas/profile.schema.json`.
 *   9. Collect/render provenance.
 *  10. Write profile.json, baseline.manifest.json, PROVENANCE.md.
 *  11. Sanity round-trip: `deriveMatrix(profile, seed)` succeeds.
 */
export async function runCapture(opts: CaptureOptions): Promise<CaptureResult> {
  const probePage = locateProbePage();
  const seed = opts.seed ?? `capture-${opts.profileId}`;
  const outDir =
    opts.outDir ?? join(probePage.repoRoot, "packages", "profiles", "data", opts.profileId);

  // --- resolve the browser binary --------------------------------------
  const binary = await resolveBrowserBinary(opts.browserPath);

  // --- launch + drive --------------------------------------------------
  const launchOpts: LaunchOptions = {
    profile: bareLaunchProfile(opts.profileId),
    seed,
    headless: opts.headless ?? true,
    bypassInject: true,
    // Capture is a hermetic flow: we want the bare un-spoofed Chromium
    // surface AND we want it free of updater / sync / default-apps /
    // feed-prefetch network noise so the baseline manifest is byte-stable
    // across reruns. Pairs with `bypassInject: true`. Task 0256.
    hermetic: true,
    binary,
  };
  const session = await mochi.launch(launchOpts);
  let probesJson: CapturedProbes;
  try {
    const page = await session.newPage();
    await page.goto(probePage.fileUrl, { waitUntil: "load" });

    // Poll the sentinel.
    const deadline =
      (opts.now?.() ?? new Date()).getTime() + (opts.probeTimeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS);
    let ready = false;
    while ((opts.now?.() ?? new Date()).getTime() < deadline) {
      const flag = await page.evaluate<boolean>(() => {
        return (globalThis as { __probesReady?: boolean }).__probesReady === true;
      });
      if (flag === true) {
        ready = true;
        break;
      }
      await sleep(PROBE_POLL_INTERVAL_MS);
    }
    if (!ready) {
      throw new Error(
        `[mochi capture] probe-page sentinel did not fire within ${opts.probeTimeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS}ms`,
      );
    }

    const text = await page.text("#probes");
    if (text === null || text.length === 0) {
      throw new Error("[mochi capture] #probes element produced no textContent");
    }
    probesJson = JSON.parse(text) as CapturedProbes;
  } finally {
    await session.close();
  }

  // --- derive ProfileV1 ------------------------------------------------
  const deriveOpts: DeriveOptions = { profileId: opts.profileId };
  const profile = deriveProfile(probesJson, deriveOpts);

  // --- validate --------------------------------------------------------
  const schema = await loadProfileSchema(probePage.repoRoot);
  const result: ValidationResult = validate(profile, schema);

  if (!result.valid) {
    const invalidDir = join(outDir, ".invalid");
    await mkdir(invalidDir, { recursive: true });
    await Bun.write(join(invalidDir, "profile.json"), JSON.stringify(profile, null, 2));
    await Bun.write(
      join(invalidDir, "baseline.manifest.json"),
      JSON.stringify(probesJson, null, 2),
    );
    await Bun.write(join(invalidDir, "validation.json"), JSON.stringify(result.errors, null, 2));
    throw new CaptureValidationError(
      `[mochi capture] derived profile failed schema validation (${result.errors.length} errors)`,
      result.errors,
      invalidDir,
    );
  }

  // --- collect provenance ---------------------------------------------
  const browserVersionFromProbes = readBrowserVersion(probesJson);
  const provenance = await collectProvenance({
    profileId: opts.profileId,
    interactive: opts.interactive ?? false,
    inputs: {
      ...opts.provenanceInputs,
      ...(opts.provenanceInputs?.browserVersion === undefined && browserVersionFromProbes
        ? { browserVersion: browserVersionFromProbes }
        : {}),
      ...(opts.provenanceInputs?.mochiVersion === undefined ? { mochiVersion: CLI_VERSION } : {}),
      ...(opts.provenanceInputs?.capturedAt === undefined && opts.now !== undefined
        ? { capturedAt: opts.now().toISOString() }
        : {}),
    },
  });

  // --- write artifacts -------------------------------------------------
  // Wipe any stale .invalid/ from previous runs once we're successful.
  await rm(join(outDir, ".invalid"), { recursive: true, force: true }).catch(() => {});
  await mkdir(outDir, { recursive: true });
  const profilePath = join(outDir, "profile.json");
  const manifestPath = join(outDir, "baseline.manifest.json");
  const provenancePath = join(outDir, "PROVENANCE.md");
  await Bun.write(profilePath, `${JSON.stringify(profile, null, 2)}\n`);
  await Bun.write(manifestPath, `${JSON.stringify(probesJson, null, 2)}\n`);
  await Bun.write(provenancePath, renderProvenance(provenance));

  // --- sanity round-trip -----------------------------------------------
  // Confirm deriveMatrix would succeed for the captured profile (no
  // schema errors, no missing inputs in the rule DAG). We don't actually
  // launch a second session.
  const { deriveMatrix } = await import("@mochi.js/consistency");
  deriveMatrix(profile, seed);

  return {
    profile,
    probes: probesJson,
    provenance,
    outDir,
    profilePath,
    manifestPath,
    provenancePath,
    probePage,
  };
}

async function resolveBrowserBinary(explicit: string | undefined): Promise<string> {
  if (explicit !== undefined && explicit.length > 0) return explicit;
  // resolveChromiumBinary picks up MOCHI_CHROMIUM_PATH and the on-disk
  // mochi browsers install. If the env var is set we honour it.
  if (process.env.MOCHI_CHROMIUM_PATH && process.env.MOCHI_CHROMIUM_PATH.length > 0) {
    return process.env.MOCHI_CHROMIUM_PATH;
  }
  const resolved = await resolveChromiumBinary();
  return resolved.path;
}

function readBrowserVersion(probes: CapturedProbes): string | undefined {
  const navigator = (probes.navigator ?? {}) as Record<string, unknown>;
  const uad = navigator.userAgentData;
  if (uad && typeof uad === "object") {
    const brands = (uad as { brands?: unknown }).brands;
    if (Array.isArray(brands)) {
      for (const b of brands) {
        if (b && typeof b === "object") {
          const brand = String((b as { brand?: unknown }).brand ?? "").toLowerCase();
          const version = (b as { version?: unknown }).version;
          if (
            (brand.includes("chrome") ||
              brand.includes("chromium") ||
              brand.includes("edge") ||
              brand.includes("brave")) &&
            typeof version === "string"
          ) {
            return version;
          }
        }
      }
    }
  }
  const ua = navigator.userAgent;
  if (typeof ua === "string") {
    const m = ua.match(/Chrome\/([\d.]+)/);
    if (m?.[1]) return m[1];
  }
  return undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---- public re-exports ------------------------------------------------------

export { type CapturedProbes, type DeriveOptions, deriveProfile } from "./derive-profile";
export { findProbePage, locateProbePage, type ProbePageLocation } from "./probe-page";
export {
  collectProvenance,
  type ProvenanceInputs,
  type ProvenanceRecord,
  renderProvenance,
} from "./provenance";
export {
  loadProfileSchema,
  type ValidationError,
  type ValidationResult,
  validate,
} from "./validate";
