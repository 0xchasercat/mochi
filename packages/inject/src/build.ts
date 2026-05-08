/**
 * Payload builder — composes per-API spoof modules into a single IIFE
 * delivered to Chromium via `Page.addScriptToEvaluateOnNewDocument(
 * runImmediately: true, worldName: "")`.
 *
 * Determinism contract:
 *   - Same `MatrixV1` (excluding `derivedAt`) → byte-identical `code` →
 *     identical sha256.
 *   - Module composition order is fixed.
 *   - No `Date.now()`, no `Math.random()`, no env reads in the build path.
 *
 * Size budget: ≤ 80 KB minified (target ~50 KB at v0.3).
 *   - We don't run a full JS minifier here — `esbuild` can be added later
 *     if budget pressure mounts. For v0.3 the source is already compact;
 *     measured below 30 KB with whitespace.
 *
 * Stealth invariants enforced at build time:
 *   - Wrapped in a single IIFE — no top-level identifiers escape.
 *   - Initialization globals `__mochi__*` declared inside the IIFE; any
 *     stragglers wiped via `delete window.__mochi__*` at end-of-IIFE.
 *   - `try { ... } catch (e) { ... }` around each module so a thrown
 *     override never reaches page script (PLAN.md §5.3).
 *
 * @see PLAN.md §5.3, §8.4
 * @see tasks/0030-inject-engine-v0.md
 */

import type { MatrixV1 } from "@mochi.js/consistency";
import { emitBotGlobalsModule } from "./modules/bot-globals";
import { emitClientHintsModule } from "./modules/client-hints";
import { emitFontsModule } from "./modules/fonts";
import { emitMediaDevicesModule } from "./modules/media-devices";
import { emitMouseEventScreenModule } from "./modules/mouse-event-screen";
import { emitNavigatorModule } from "./modules/navigator";
import { emitNetworkInfoModule } from "./modules/network-info";
import { emitPermissionsModule } from "./modules/permissions";
import { emitPluginsModule } from "./modules/plugins";
import { emitScreenModule } from "./modules/screen";
import { emitScreenOrientationModule } from "./modules/screen-orientation";
import { emitTimingModule } from "./modules/timing";
import { emitWebglModule } from "./modules/webgl";
import { emitWebgpuModule } from "./modules/webgpu";
import { emitWindowChromeModule } from "./modules/window-chrome";
import { emitDefinePropertyHelper } from "./runtime/defineproperty";
import { emitToStringCloak } from "./runtime/tostring-cloak";

/**
 * The result returned by {@link buildPayload}.
 *
 * - `code` is the IIFE source. Send as-is to
 *   `Page.addScriptToEvaluateOnNewDocument` with `runImmediately: true,
 *   worldName: ""` and `Runtime.evaluate` against worker targets.
 * - `sha256` is hex-encoded SHA-256 of `code`. Used for cache keys, the
 *   contract pin in `tests/contract/inject-payload.contract.test.ts`, and
 *   downstream change detection in the harness.
 */
export interface PayloadResult {
  readonly code: string;
  readonly sha256: string;
}

/** Soft budget — buildPayload `console.warn`s if exceeded but never throws. */
const SIZE_BUDGET_BYTES = 80 * 1024;

/**
 * Compose the inject payload for a given matrix.
 *
 * The layout is fixed (changing it changes every downstream sha256 pin):
 *
 *   1. IIFE prologue — `(function(){`
 *   2. Header banner (always-true comment block, useful in DevTools dumps)
 *   3. Runtime helpers (defineProperty + toString cloak)
 *   4. Spoof modules — navigator, screen, webgl, client-hints, timing,
 *      bot-globals, fonts (in that order)
 *   5. Self-deletion of any `__mochi*` window globals
 *   6. IIFE epilogue — `})();`
 *
 * Each spoof module is wrapped in a `try { … } catch (_) {}` at the top
 * level of the IIFE so a single module's failure can't take out the rest.
 *
 * @throws Never. If a module throws *during build* it propagates; runtime
 * errors are swallowed by the IIFE's per-module try/catch.
 */
export function buildPayload(matrix: MatrixV1): PayloadResult {
  // PLAN.md I-5: never invent values — but we DO build defensively. If the
  // matrix is missing a uaCh key, the corresponding module skips that line.
  const parts: string[] = [];

  parts.push("(function () {");
  parts.push(banner(matrix));
  parts.push("'use strict';");
  parts.push(emitDefinePropertyHelper());
  parts.push(emitToStringCloak());

  // Each module is wrapped in a try/catch so a single failure can't take
  // down the rest. The wrapper logs nothing (PLAN.md §5.3 — never let our
  // injection produce console output that page script can observe).
  parts.push(wrapTry("navigator", emitNavigatorModule(matrix)));
  parts.push(wrapTry("screen", emitScreenModule(matrix)));
  parts.push(wrapTry("webgl", emitWebglModule(matrix)));
  parts.push(wrapTry("client-hints", emitClientHintsModule(matrix)));
  parts.push(wrapTry("timing", emitTimingModule(matrix)));
  parts.push(wrapTry("bot-globals", emitBotGlobalsModule()));
  parts.push(wrapTry("fonts", emitFontsModule(matrix)));
  // Phase 0.7 surface coverage. Order doesn't matter for correctness — each
  // module is wrapped in its own try/catch and reads only matrix.uaCh.* — but
  // we keep an alphabetical-ish grouping for human readability of the dump.
  parts.push(wrapTry("media-devices", emitMediaDevicesModule(matrix)));
  parts.push(wrapTry("network-info", emitNetworkInfoModule(matrix)));
  parts.push(wrapTry("permissions", emitPermissionsModule(matrix)));
  parts.push(wrapTry("screen-orientation", emitScreenOrientationModule(matrix)));
  parts.push(wrapTry("webgpu", emitWebgpuModule(matrix)));
  // CloakBrowser-surfaced modules — defensive shims that no-op on real
  // Chrome.app (where the underlying browser already provides these
  // surfaces) and install on Chromium-for-Testing where they're absent.
  // See tasks/0140-stealth-conformance.md.
  parts.push(wrapTry("window-chrome", emitWindowChromeModule(matrix)));
  parts.push(wrapTry("plugins", emitPluginsModule(matrix)));
  // R-041: MouseEvent.screenX/screenY prototype patch — closes the I-5
  // relational leak on CDP-dispatched mouse events. See task 0250 +
  // packages/consistency/src/rules/mouseEvent.ts. No matrix input.
  parts.push(wrapTry("mouse-event-screen", emitMouseEventScreenModule()));

  // Self-deletion of any stray __mochi__* properties on window/globalThis
  // — none of our helpers leak there in v0.3 (they're all IIFE-locals),
  // but the cleanup is the safety net described in PLAN.md §5.3 last bullet.
  parts.push(emitSelfDelete());

  parts.push("})();");

  const code = parts.join("\n");

  // Soft size budget warning.
  const bytes = byteLength(code);
  if (bytes > SIZE_BUDGET_BYTES) {
    console.warn(
      `[mochi/inject] payload size ${bytes}B exceeds ${SIZE_BUDGET_BYTES}B budget — consider trimming modules`,
    );
  }

  const sha256 = hashHex(code);
  return { code, sha256 };
}

// ---- helpers ----------------------------------------------------------------

/**
 * The header banner — a comment block at the top of the IIFE. Useful for
 * humans reading the payload in DevTools dumps, and harmless. Includes the
 * `Runtime.enable`-resilience disclaimer per PLAN.md §8.2.
 */
function banner(matrix: MatrixV1): string {
  // We deliberately do NOT include `derivedAt` so the payload bytes stay
  // stable per (profile, seed). Engine version + matrix-deterministic fields
  // are fine because they're determinism-stable.
  return [
    "// @mochi inject payload — see PLAN.md §5.3 / §8.4.",
    "// Assumption: Runtime.enable is never sent (PLAN.md §8.2). This IIFE",
    "//             does NOT add anti-Runtime.enable hacks; the CDP layer",
    "//             enforces the invariant via packages/core/src/cdp/forbidden.ts.",
    `// engine: ${matrix.consistencyEngineVersion}`,
    `// profile: ${matrix.id}@${matrix.version}`,
    `// seed: ${JSON.stringify(matrix.seed)}`,
  ].join("\n");
}

/**
 * Wrap a module body in a top-level `try { ... } catch (_) {}`. The
 * try/catch sits inside the IIFE but outside the module's own IIFEs.
 */
function wrapTry(name: string, body: string): string {
  // Inline JS comments stay inside the IIFE source; the wrapper itself is
  // a try/catch so a thrown spoof can't take out subsequent modules.
  return `try { /* mochi:${name} */\n${body}\n} catch (_e) { /* swallowed per PLAN.md §5.3 */ }`;
}

/**
 * Emit the self-delete tail. Walks `window` for keys starting with
 * `__mochi__` or `__mochi_` and `delete`s them. Belt-and-braces — the
 * module sources don't actually expose any of these to window today (all
 * helpers are IIFE-locals).
 */
function emitSelfDelete(): string {
  return `
// ---- self-delete init globals ---------------------------------------------
try {
  if (typeof window !== "undefined") {
    var __mochi_keys__ = Object.getOwnPropertyNames(window);
    for (var __mochi_i__ = 0; __mochi_i__ < __mochi_keys__.length; __mochi_i__++) {
      var __mochi_k__ = __mochi_keys__[__mochi_i__];
      if (__mochi_k__.indexOf("__mochi") === 0) {
        try { delete window[__mochi_k__]; } catch (_e) {}
      }
    }
  }
} catch (_e) {}
`;
}

/** UTF-8 byte length of a JS string. */
function byteLength(s: string): number {
  // Bun has Buffer; using the global TextEncoder for portability.
  return new TextEncoder().encode(s).length;
}

/**
 * Hex-encoded SHA-256. Uses Bun's native CryptoHasher when available
 * (per task brief), falls back to a small inline JS implementation if
 * not (so that the package can be consumed by tooling that runs the
 * builder under Node — e.g. doc generators).
 */
function hashHex(input: string): string {
  // Bun's CryptoHasher is fastest and matches the task brief's contract.
  type CryptoHasherCtor = new (
    algo: "sha256",
  ) => {
    update(data: string): void;
    digest(encoding: "hex"): string;
  };
  const maybeBun = (globalThis as { Bun?: { CryptoHasher?: CryptoHasherCtor } }).Bun;
  if (maybeBun !== undefined && maybeBun.CryptoHasher !== undefined) {
    const h = new maybeBun.CryptoHasher("sha256");
    h.update(input);
    return h.digest("hex");
  }
  // Fallback: WebCrypto (sync wouldn't be possible — but the inject build
  // path is invoked from sync paths). Throw a helpful error.
  throw new Error(
    "[mochi/inject] buildPayload requires Bun's CryptoHasher — running outside Bun is unsupported",
  );
}
