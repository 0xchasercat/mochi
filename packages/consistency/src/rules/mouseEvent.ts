/**
 * MouseEvent-surface rules. Cover R-041.
 *
 * The matrix has no slot for window position / per-event clientXY because
 * those are runtime values, not derivable from the (profile, seed) pair.
 * What the rule DOES lock is the *formula* the inject layer must satisfy:
 *
 *   `MouseEvent.screenX === MouseEvent.clientX + window.screenX`
 *   `MouseEvent.screenY === MouseEvent.clientY + window.screenY`
 *
 * Real OS-level mouse events satisfy this identity. CDP
 * `Input.dispatchMouseEvent` does NOT (it sets screenX/Y from the dispatch
 * params, ignoring the window's screen offset). The rule's output is a
 * static JSON descriptor that the harness probe reads to:
 *   1. confirm the inject's prototype patch is installed,
 *   2. assert the patched getter returns the expected sum.
 *
 * @see PLAN.md §5.2, §9.2 (R-041)
 */

import { defineRule, type Rule } from "../rule";

/**
 * R-041 — MouseEvent.screenX/screenY relational lock.
 *
 * Output: `uaCh.mouseEvent-screen-formula` as JSON
 *   `{ "screenX": "clientX + window.screenX",
 *      "screenY": "clientY + window.screenY",
 *      "rule": "R-041" }`.
 *
 * No inputs — the formula is invariant across profiles. The rule exists to
 * record the lock in the matrix so the inject build path and the harness
 * probe both have a single source of truth they can agree on.
 */
export const R041: Rule = defineRule<readonly [], string>({
  id: "R-041",
  description: "MouseEvent.{screenX,screenY} === client{X,Y} + window.screen{X,Y} (CDP I-5 lock)",
  inputs: [],
  output: "uaCh.mouseEvent-screen-formula",
  derive() {
    return JSON.stringify({
      screenX: "clientX + window.screenX",
      screenY: "clientY + window.screenY",
      rule: "R-041",
    });
  },
});

export const MOUSE_EVENT_RULES: readonly Rule[] = [R041];
