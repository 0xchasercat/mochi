/**
 * Spoof module: bot-detection global cleanup.
 *
 * Defensive deletion of automation framework globals that should NOT exist
 * on stock Chromium-for-Testing but show up if the user accidentally launched
 * a CDC-tainted Selenium/Chromedriver build, or if a hostile extension
 * injected them. The list mirrors the sentinel-key catalog in
 * `chaser-recon/src/lib/fingerprint/bot-detection.ts:14-25`.
 *
 * v0.3 deletes them; phase 0.7 may add a per-key getter trap for
 * "delete and observe" detection. The deletion is best-effort (silently
 * ignores TypeErrors from non-configurable globals).
 *
 * The matrix isn't read here — these keys must always be absent regardless
 * of profile.
 *
 * @see tasks/0030-inject-engine-v0.md §"bot-globals.ts"
 */

/**
 * The full automation-key catalog. Order doesn't matter; deletion is
 * symmetric.
 */
const AUTOMATION_KEYS: readonly string[] = [
  // Chromedriver/Selenium CDC sentinel keys.
  "cdc_adoQpoasnfa76pfcZLmcfl_Array",
  "cdc_adoQpoasnfa76pfcZLmcfl_Promise",
  "cdc_adoQpoasnfa76pfcZLmcfl_Symbol",
  "$cdc_asdjflasutopfhvcZLmcfl_",
  "$chrome_asyncScriptInfo",
  "__$webdriverAsyncExecutor",
  // PhantomJS / Nightmare / Selenium IDE sentinels.
  "_phantom",
  "__nightmare",
  "_selenium",
  "callPhantom",
  "callSelenium",
  "_Selenium_IDE_Recorder",
  // Headless browser markers.
  "domAutomation",
  "domAutomationController",
  "__webdriver_evaluate",
  "__selenium_evaluate",
  "__webdriver_script_function",
  "__webdriver_script_func",
  "__webdriver_script_fn",
  "__fxdriver_evaluate",
  "__driver_unwrapped",
  "__webdriver_unwrapped",
  "__driver_evaluate",
  "__selenium_unwrapped",
  "__fxdriver_unwrapped",
  "__webdriverFunc",
] as const;

export function emitBotGlobalsModule(): string {
  const keys = JSON.stringify(AUTOMATION_KEYS);
  return `
// ---- bot-globals cleanup ---------------------------------------------------
(function() {
  var KEYS = ${keys};
  for (var i = 0; i < KEYS.length; i++) {
    var k = KEYS[i];
    try {
      // Outer scope deletion — \`window\` and \`document\` both checked.
      if (typeof window !== "undefined" && k in window) {
        delete window[k];
      }
      if (typeof document !== "undefined" && k in document) {
        delete document[k];
      }
    } catch (_e) {
      // Non-configurable; nothing we can do at JS layer. Caller documents
      // in docs/limits.md if the surface ever exists in stock Chromium-for-
      // Testing.
    }
  }
})();
`;
}
