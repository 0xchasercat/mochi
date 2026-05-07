/**
 * Spoof module: `screen.*` and `window.{innerWidth,innerHeight,outerWidth,
 * outerHeight,devicePixelRatio}`.
 *
 * Reads from the matrix:
 *   - `matrix.display.width/height/colorDepth/pixelDepth/dpr` (R-010..R-012)
 *   - `matrix.uaCh["screen-availSize"]`     (R-021) — JSON `{availWidth, availHeight}`
 *   - `matrix.uaCh["window-viewport"]`      (R-029) — JSON `{innerWidth, innerHeight, outerWidth, outerHeight}`
 *
 * Missing uaCh keys are skipped (PLAN.md I-5).
 *
 * @see tasks/0030-inject-engine-v0.md §"screen.ts"
 */

import type { MatrixV1 } from "@mochi.js/consistency";

/** Best-effort JSON parse — returns null on any failure. */
function tryParse(s: unknown): unknown {
  if (typeof s !== "string") return null;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function isFiniteNumber(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

export function emitScreenModule(matrix: MatrixV1): string {
  const screenLines: string[] = [];
  const winLines: string[] = [];

  // screen.width / screen.height — from display.
  screenLines.push(`  __mochi_define__(__sp__, "width", ${matrix.display.width});`);
  screenLines.push(`  __mochi_define__(__sp__, "height", ${matrix.display.height});`);

  // screen.colorDepth / screen.pixelDepth — from display.
  screenLines.push(`  __mochi_define__(__sp__, "colorDepth", ${matrix.display.colorDepth});`);
  screenLines.push(`  __mochi_define__(__sp__, "pixelDepth", ${matrix.display.pixelDepth});`);

  // screen.availWidth/availHeight — derived in R-021.
  const avail = tryParse(matrix.uaCh["screen-availSize"]) as {
    availWidth?: number;
    availHeight?: number;
  } | null;
  if (avail !== null) {
    if (isFiniteNumber(avail.availWidth)) {
      screenLines.push(`  __mochi_define__(__sp__, "availWidth", ${avail.availWidth});`);
    }
    if (isFiniteNumber(avail.availHeight)) {
      screenLines.push(`  __mochi_define__(__sp__, "availHeight", ${avail.availHeight});`);
    }
  }

  // window.devicePixelRatio — from display.dpr (R-012). DPR lives on the
  // Window instance, not a prototype — Chrome returns it via a getter on
  // Window. Defining on the instance is the correct match.
  winLines.push(`  __mochi_define__(window, "devicePixelRatio", ${matrix.display.dpr});`);

  // window.{innerWidth,innerHeight,outerWidth,outerHeight} — R-029 JSON.
  const vp = tryParse(matrix.uaCh["window-viewport"]) as {
    innerWidth?: number;
    innerHeight?: number;
    outerWidth?: number;
    outerHeight?: number;
  } | null;
  if (vp !== null) {
    for (const key of ["innerWidth", "innerHeight", "outerWidth", "outerHeight"] as const) {
      const v = vp[key];
      if (isFiniteNumber(v)) {
        winLines.push(`  __mochi_define__(window, ${JSON.stringify(key)}, ${v});`);
      }
    }
  }

  return `
// ---- screen + viewport spoof -----------------------------------------------
(function() {
  var __sp__ = __mochi_getPrototypeOf__(screen);
${screenLines.join("\n")}
${winLines.join("\n")}
})();
`;
}
