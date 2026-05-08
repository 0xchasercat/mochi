/**
 * Screen-extra lookups — `screen.orientation` and `matchMedia()` defaults
 * for desktop Chrome.
 *
 * `screen.orientation`: desktop is always landscape-primary, angle 0.
 * Mobile profiles in v2 will key off `device.formFactor`.
 *
 * `matchMedia` defaults match the captured `mac-m4-chrome-stable` baseline:
 *
 *   - prefers-color-scheme:    "light"
 *   - prefers-reduced-motion:  "reduce"        (system pref on capture machine)
 *   - prefers-contrast:        "no-preference"
 *   - forced-colors:           "none"
 *   - color-gamut:             "srgb"           (varies by display)
 *   - pointer / hover:         "fine" / "hover" (desktop with mouse)
 *   - any-pointer / any-hover: "fine" / "hover"
 *   - display-mode:            "browser"
 *   - dynamic-range:           "standard"
 *   - update:                  "fast"
 *   - min-resolution:          "96dpi"
 *   - monochrome:              false
 *
 * The values are surfaced via the `screen-orientation` inject module by
 * intercepting `Window.matchMedia(spec)` and answering from this table.
 *
 * @see tasks/0070-consistency-rules-full.md (screen-orientation)
 */

/**
 * `screen.orientation` shape on desktop Chrome. v2 will diversify by
 * `device.formFactor`.
 */
export const DESKTOP_ORIENTATION = {
  type: "landscape-primary",
  angle: 0,
} as const;

/**
 * Default `matchMedia` answers for the v0.7 desktop catalog. The keys are
 * the CSS media features the probe-page measures (chaser-recon's `screen-
 * probe.ts`); the values are the answers Chrome is observed to return on
 * the captured device.
 */
export const MEDIA_QUERY_DEFAULTS: Readonly<Record<string, string | boolean>> = {
  "prefers-color-scheme": "light",
  "prefers-reduced-motion": "reduce",
  "prefers-contrast": "no-preference",
  "forced-colors": "none",
  "color-gamut": "srgb",
  pointer: "fine",
  hover: "hover",
  "any-pointer": "fine",
  "any-hover": "hover",
  "display-mode": "browser",
  "dynamic-range": "standard",
  update: "fast",
  "min-resolution": "96dpi",
  monochrome: false,
};
