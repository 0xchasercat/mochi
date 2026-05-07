/**
 * @mochi.js/inject — the zero-jitter stealth payload.
 *
 * Builds a single IIFE bundle of TurboFan-friendly proxies to install via
 * `Page.addScriptToEvaluateOnNewDocument(runImmediately:true, worldName:"")`
 * before any page script runs.
 *
 * v0.3 covers the surface that v0.2 produces (the 30 rules from
 * R-001..R-030 — navigator, screen, simple GPU strings, fonts/baseline-only,
 * locale, timezone, hardware basics). Audio precomputed bytes, canvas hash
 * maps, and full WebGL extension catalogs land in phase 0.7.
 *
 * @see PLAN.md §5.3 and §8.4
 * @see tasks/0030-inject-engine-v0.md
 */

export const VERSION = "0.1.0" as const;

export { buildPayload, type PayloadResult } from "./build";
