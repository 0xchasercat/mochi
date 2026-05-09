/**
 * Rule registry — the single source of truth for the v0.2 ruleset.
 *
 * The order in `RULES` is the **declaration order**. The engine topo-sorts
 * via `validateAndOrder` (see `dag.ts`); declaration order is used as the
 * tie-breaker for nodes with equal topological depth. Adding a rule means:
 *   1. write the rule in its category file (gpu / userAgent / navigator / …),
 *   2. import it here,
 *   3. append it to `RULES`.
 *
 * Acyclicity is verified the first time `deriveMatrix` runs; the rule list
 * is also exercised by `tests/contract/consistency-rules.contract.test.ts`.
 *
 * @see PLAN.md §5.2 / §9.2
 * @see tasks/0020-consistency-engine-v0.md
 */

import type { Rule } from "../rule";
import { AUDIO_CANVAS_RULES } from "./audioCanvas";
import { EXTRAS_RULES } from "./extras";
import { GPU_RULES } from "./gpu";
import { LOCALE_RULES } from "./locale";
import { MOUSE_EVENT_RULES } from "./mouseEvent";
import { NAVIGATOR_RULES } from "./navigator";
import { SCREEN_RULES } from "./screen";
import { USER_AGENT_RULES } from "./userAgent";
import { WEBGPU_RULES } from "./webgpu";

/**
 * The full rule list. Don't reorder casually — the topo sort uses
 * declaration order as the tie-breaker, so reorderings can change the
 * output of seed-driven rules that share a PRNG cursor.
 *
 * Rule families:
 *   - GPU_RULES         R-001..R-003, R-024, R-025
 *   - USER_AGENT_RULES  R-004..R-007, R-023, R-026, R-031,
 *                       R-042..R-046 (UA-CH metadata struct;
 *                       sec-ch-ua-arch / -bitness / -mobile / -model and
 *                       single-string ua-full-version derived from R-031)
 *   - NAVIGATOR_RULES   R-008..R-009, R-015..R-018, R-020, R-022, R-027,
 *                       R-028, R-030
 *   - SCREEN_RULES      R-010..R-012, R-021, R-029
 *   - LOCALE_RULES      R-013, R-014, R-019
 *   - WEBGPU_RULES      R-032, R-033
 *   - EXTRAS_RULES      R-034..R-040 (mediaDevices / permissions / network /
 *                       screen.orientation / matchMedia / storage)
 *   - MOUSE_EVENT_RULES R-041 (MouseEvent.screenX/screenY relational lock —
 *                       PLAN.md I-5 / CDP-dispatch leak)
 *   - AUDIO_CANVAS_RULES R-047 + R-048 (audio + canvas fingerprint blobs;
 *                        PLAN.md §9.3 / §9.4)
 */
export const RULES: readonly Rule[] = [
  ...GPU_RULES,
  ...USER_AGENT_RULES,
  ...NAVIGATOR_RULES,
  ...SCREEN_RULES,
  ...LOCALE_RULES,
  ...WEBGPU_RULES,
  ...EXTRAS_RULES,
  ...MOUSE_EVENT_RULES,
  ...AUDIO_CANVAS_RULES,
];
