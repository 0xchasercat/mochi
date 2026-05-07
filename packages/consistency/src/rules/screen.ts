/**
 * Screen-surface rules. Cover R-010, R-011, R-012, R-021, R-029.
 *
 * The schema has slots for `display.{width,height,dpr,colorDepth,pixelDepth}`
 * but no explicit `availWidth/availHeight/innerWidth/...` slots. v0.2
 * stashes the derived avail/viewport pair as JSON-encoded `uaCh` entries —
 * phase 0.7 adds proper schema slots when the inject layer wants them.
 *
 * Each rule has exactly one output path (the engine contract). R-010
 * produces a JSON tuple summarizing the four screen dimensions; the inject
 * layer (phase 0.3+) splits it into `screen.width` / `screen.height` /
 * `screen.availWidth` / `screen.availHeight`.
 *
 * @see PLAN.md §9.2
 */

import type { ProfileV1 } from "../generated/profile";
import { defineRule, type Rule } from "../rule";
import {
  BROWSER_CHROME_HEIGHT_BY_OS,
  OS_CHROME_HEIGHT_BY_OS,
  OS_CHROME_WIDTH_BY_OS,
} from "./lookups/os";

type OsName = ProfileV1["os"]["name"];

/**
 * R-010 — `[display.width, display.height, display.dpr, os.name]` →
 * `uaCh.screen-dimensions` as JSON `{ width, height, availWidth, availHeight }`.
 * The width/height come from the profile; availWidth/availHeight subtract
 * the OS chrome from the lookup table.
 */
export const R010: Rule = defineRule<readonly [number, number, number, OsName], string>({
  id: "R-010",
  description: "screen.{width,height,availWidth,availHeight} JSON tuple",
  inputs: ["display.width", "display.height", "display.dpr", "os.name"],
  output: "uaCh.screen-dimensions",
  derive([width, height, _dpr, osName]) {
    const availWidth = Math.max(0, width - OS_CHROME_WIDTH_BY_OS[osName]);
    const availHeight = Math.max(0, height - OS_CHROME_HEIGHT_BY_OS[osName]);
    return JSON.stringify({ width, height, availWidth, availHeight });
  },
});

/** R-011 — `display.colorDepth` → `display.colorDepth` (passthrough). */
export const R011: Rule = defineRule<readonly [number], number>({
  id: "R-011",
  description: "screen.colorDepth — passthrough",
  inputs: ["display.colorDepth"],
  output: "display.colorDepth",
  derive([cd]) {
    return cd;
  },
});

/** R-012 — `display.dpr` → `display.dpr` (passthrough). */
export const R012: Rule = defineRule<readonly [number], number>({
  id: "R-012",
  description: "window.devicePixelRatio — passthrough",
  inputs: ["display.dpr"],
  output: "display.dpr",
  derive([dpr]) {
    return dpr;
  },
});

/**
 * R-021 — `[display.width, display.height, os.name]` → `uaCh.screen-availSize`
 * as JSON `{ availWidth, availHeight }`.
 *
 * Functionally overlaps with R-010 (which also computes avail*) but the brief
 * lists them separately to keep the avail-screen lock independently testable.
 * The two rules MUST agree — that's the relational invariant captured here.
 */
export const R021: Rule = defineRule<readonly [number, number, OsName], string>({
  id: "R-021",
  description: "screen.availWidth/availHeight — display dims minus OS chrome",
  inputs: ["display.width", "display.height", "os.name"],
  output: "uaCh.screen-availSize",
  derive([width, height, osName]) {
    const availWidth = Math.max(0, width - OS_CHROME_WIDTH_BY_OS[osName]);
    const availHeight = Math.max(0, height - OS_CHROME_HEIGHT_BY_OS[osName]);
    return JSON.stringify({ availWidth, availHeight });
  },
});

/**
 * R-029 — `[display.dpr, display.width, display.height, os.name]`
 * → `uaCh.window-viewport` as JSON `{innerWidth, innerHeight, outerWidth, outerHeight}`.
 *
 * inner = outer minus browser chrome (URL bar + tabs + bookmark bar);
 * outer = display minus OS chrome. Assumes a maximized browser window.
 */
export const R029: Rule = defineRule<readonly [number, number, number, OsName], string>({
  id: "R-029",
  description: "window.{innerWidth,innerHeight,outerWidth,outerHeight} per OS chrome",
  inputs: ["display.dpr", "display.width", "display.height", "os.name"],
  output: "uaCh.window-viewport",
  derive([_dpr, width, height, osName]) {
    const outerWidth = Math.max(0, width - OS_CHROME_WIDTH_BY_OS[osName]);
    const outerHeight = Math.max(0, height - OS_CHROME_HEIGHT_BY_OS[osName]);
    const innerWidth = outerWidth;
    const innerHeight = Math.max(0, outerHeight - BROWSER_CHROME_HEIGHT_BY_OS[osName]);
    return JSON.stringify({ innerWidth, innerHeight, outerWidth, outerHeight });
  },
});

export const SCREEN_RULES: readonly Rule[] = [R010, R011, R012, R021, R029];
