---
"@mochi.js/inject": minor
"@mochi.js/consistency": patch
---

MouseEvent.screenX/screenY prototype patch (R-041) per task 0250.

Closes a real PLAN.md I-5 (relational consistency) leak: when CDP
`Input.dispatchMouseEvent` synthesizes a click, the dispatched event's
`screenX`/`screenY` slots come from the dispatch params and DON'T include
the browser window's screen offset — sites reading `event.screenX` for
clickjacking/bot heuristics see `0` or a viewport-relative value rather
than the screen-relative coord a real OS-level mouse event would carry.

`@mochi.js/inject` gains a new `mouse-event-screen` module that patches
`MouseEvent.prototype.{screenX,screenY}` to return
`this.client{X,Y} + window.screen{X,Y}`. The replacement getters preserve
Chrome's native descriptor shape (`configurable: true, enumerable: true`)
and register with the existing `Function.prototype.toString` cloak so
`Object.getOwnPropertyDescriptor(MouseEvent.prototype, "screenX").get
.toString()` returns `function get screenX() { [native code] }`.

`@mochi.js/consistency` gains rule R-041 (`mouseEvent-screen-formula`) —
a static identity lock that records the formula in the matrix so the
inject build path and the harness probe agree on a single source of truth.

Source: PRB `lib/cjs/module/pageController.js:48-58` (origin
`TheFalloutOf76/CDP-bug-MouseEvent-.screenX-.screenY-patcher`).
