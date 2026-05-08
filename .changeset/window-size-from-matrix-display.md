---
"@mochi.js/core": patch
---

Pin Chromium's outer-window geometry from `matrix.display.{width,height}` per
task 0252.

Under `--headless=new` Chromium's outer window defaults to 800×600 regardless
of the JS-spoofed `screen.*` surface — `fingerprint-scan.com` flags the
mismatch because `window.outerWidth/outerHeight` reads from the OS-level
window, not the spoof. `launch.ts` now derives `--window-size=<W>,<H>` from
the matrix's `display` slot and passes it to `spawnChromium`, so the OS
window matches the spoof. When `display.{width,height}` is missing or
malformed the flag is omitted (the matrix is canonical — no hardcoded
fallback).

Defensive scrub: `--start-maximized` is stripped from `LaunchOptions.args`
and `MOCHI_EXTRA_ARGS`. UDC adds it; mochi must not — it produces
host-OS-dependent geometry that drifts from the matrix's display spoof.

Source: UDC `__init__.py:410-411`, UDC issue #2242.
