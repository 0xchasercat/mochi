/**
 * @mochi.js/inject — the zero-jitter stealth payload.
 *
 * Builds a single IIFE bundle of TurboFan-friendly proxies to install via
 * `Page.addScriptToEvaluateOnNewDocument(runImmediately:true, worldName:"")`
 * before any page script runs. v0.0.1 claim release; payload lands in phase 0.3.
 *
 * @see PLAN.md §5.3 and §8.4
 */
export const VERSION = "0.0.1" as const;

export interface PayloadResult {
  readonly code: string;
  readonly sha256: string;
}

/**
 * Build the inject payload. Lands in phase 0.3.
 */
export function buildPayload(_matrix: unknown): PayloadResult {
  throw new Error(
    "@mochi.js/inject.buildPayload is not yet implemented (v0.0.1 claim). " +
      "Lands in phase 0.3; see PLAN.md §5.3.",
  );
}
