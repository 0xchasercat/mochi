/**
 * OS lookup tables — platform strings, font baselines, OS-chrome heights,
 * and other OS-derived constants used by the v0.2 ruleset.
 *
 * @see PLAN.md §9.5 — fonts.list and platform string surface
 */

import type { ProfileV1 } from "../../generated/profile";

/** Compact OS key matching `ProfileV1["os"]["name"]`. */
export type OsKey = ProfileV1["os"]["name"];

/**
 * `navigator.platform` values. Even on Apple Silicon, Chrome historically
 * reports `"MacIntel"` for compatibility — this is the v0.2 chaser-recon
 * fingerprint baseline. Linux varies with arch.
 */
export const PLATFORM_BY_OS: Readonly<Record<OsKey, string>> = {
  macos: "MacIntel",
  windows: "Win32",
  linux: "Linux x86_64",
};

/**
 * Sec-CH-UA-Platform value (note the surrounding quotes — that matches the
 * on-the-wire header form Chrome emits for Sec-CH-UA-* headers).
 */
export const SEC_CH_UA_PLATFORM_BY_OS: Readonly<Record<OsKey, string>> = {
  macos: '"macOS"',
  windows: '"Windows"',
  linux: '"Linux"',
};

/**
 * OS-chrome height (menubar, taskbar, dock) deducted from `display.height`
 * to derive `screen.availHeight`. Units: physical pixels at the profile's
 * declared `dpr`. v0.2 numbers from chaser-recon's typical-device baselines.
 */
export const OS_CHROME_HEIGHT_BY_OS: Readonly<Record<OsKey, number>> = {
  macos: 25, // mac menu bar at 1x; Dock auto-hides on most captured profiles
  windows: 40, // Windows 11 taskbar
  linux: 27, // top panel on default Ubuntu / GNOME
};

/**
 * OS-chrome width deduction. Almost always 0 on desktop OSes (taskbars are
 * horizontal on the bottom). Reserved for future side-dock profiles.
 */
export const OS_CHROME_WIDTH_BY_OS: Readonly<Record<OsKey, number>> = {
  macos: 0,
  windows: 0,
  linux: 0,
};

/**
 * Browser-window chrome (URL bar + tabs + bookmarks) deducted from outer
 * dimensions to compute `window.innerHeight`. Conservative averages across
 * default browser configs.
 */
export const BROWSER_CHROME_HEIGHT_BY_OS: Readonly<Record<OsKey, number>> = {
  macos: 87,
  windows: 117,
  linux: 110,
};

/**
 * Curated baseline font lists per OS. v0.2 ships only the universally-
 * present subset that shows up across captured profiles. The full
 * device-specific list (per `mac-m2-chrome-stable`, etc.) lands in phase
 * 0.7 along with the canvas hash maps.
 */
export const FONTS_BY_OS: Readonly<Record<OsKey, readonly string[]>> = {
  macos: [
    "American Typewriter",
    "Andale Mono",
    "Arial",
    "Arial Black",
    "Arial Hebrew",
    "Arial Narrow",
    "Arial Rounded MT Bold",
    "Arial Unicode MS",
    "Avenir",
    "Avenir Next",
    "Baskerville",
    "Big Caslon",
    "Bodoni 72",
    "Bradley Hand",
    "Brush Script MT",
    "Chalkboard",
    "Chalkduster",
    "Charter",
    "Cochin",
    "Comic Sans MS",
    "Copperplate",
    "Courier",
    "Courier New",
    "Didot",
    "Futura",
    "Geneva",
    "Georgia",
    "Gill Sans",
    "Helvetica",
    "Helvetica Neue",
    "Herculanum",
    "Hoefler Text",
    "Impact",
    "Lucida Grande",
    "Marker Felt",
    "Menlo",
    "Microsoft Sans Serif",
    "Monaco",
    "Noteworthy",
    "Optima",
    "Palatino",
    "Papyrus",
    "Phosphate",
    "Rockwell",
    "Savoye LET",
    "SignPainter",
    "Skia",
    "Snell Roundhand",
    "Tahoma",
    "Times",
    "Times New Roman",
    "Trattatello",
    "Trebuchet MS",
    "Verdana",
    "Zapfino",
  ],
  windows: [
    "Arial",
    "Arial Black",
    "Arial Narrow",
    "Bahnschrift",
    "Calibri",
    "Cambria",
    "Cambria Math",
    "Candara",
    "Comic Sans MS",
    "Consolas",
    "Constantia",
    "Corbel",
    "Courier New",
    "Ebrima",
    "Franklin Gothic Medium",
    "Gabriola",
    "Gadugi",
    "Georgia",
    "Impact",
    "Ink Free",
    "Javanese Text",
    "Leelawadee UI",
    "Lucida Console",
    "Lucida Sans Unicode",
    "MS Gothic",
    "MV Boli",
    "Malgun Gothic",
    "Marlett",
    "Microsoft Himalaya",
    "Microsoft JhengHei",
    "Microsoft New Tai Lue",
    "Microsoft PhagsPa",
    "Microsoft Sans Serif",
    "Microsoft Tai Le",
    "Microsoft YaHei",
    "Microsoft Yi Baiti",
    "MingLiU-ExtB",
    "Mongolian Baiti",
    "Myanmar Text",
    "Nirmala UI",
    "Palatino Linotype",
    "Segoe MDL2 Assets",
    "Segoe Print",
    "Segoe Script",
    "Segoe UI",
    "Segoe UI Emoji",
    "Segoe UI Historic",
    "Segoe UI Symbol",
    "SimSun",
    "Sitka",
    "Sylfaen",
    "Symbol",
    "Tahoma",
    "Times New Roman",
    "Trebuchet MS",
    "Verdana",
    "Webdings",
    "Wingdings",
  ],
  linux: [
    "DejaVu Sans",
    "DejaVu Sans Mono",
    "DejaVu Serif",
    "FreeMono",
    "FreeSans",
    "FreeSerif",
    "Liberation Mono",
    "Liberation Sans",
    "Liberation Serif",
    "Noto Color Emoji",
    "Noto Mono",
    "Noto Sans",
    "Noto Sans CJK JP",
    "Noto Sans CJK KR",
    "Noto Sans CJK SC",
    "Noto Sans CJK TC",
    "Noto Serif",
    "Ubuntu",
    "Ubuntu Condensed",
    "Ubuntu Mono",
  ],
};
