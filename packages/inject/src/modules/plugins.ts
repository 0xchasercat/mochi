/**
 * Spoof module: `navigator.plugins` + `navigator.mimeTypes`.
 *
 * Real Chrome 92+ ships a curated 5-plugin PluginArray (see
 * `packages/profiles/data/<id>/baseline.manifest.json` `navigator.plugins`):
 *
 *   1. PDF Viewer            internal-pdf-viewer  application/pdf, text/pdf
 *   2. Chrome PDF Viewer     internal-pdf-viewer  application/pdf, text/pdf
 *   3. Chromium PDF Viewer   internal-pdf-viewer  application/pdf, text/pdf
 *   4. Microsoft Edge PDF    internal-pdf-viewer  application/pdf, text/pdf
 *   5. WebKit built-in PDF   internal-pdf-viewer  application/pdf, text/pdf
 *
 * Stock Chromium-for-Testing builds may report `plugins.length === 0`
 * depending on flag set, which CloakBrowser's `test_plugins_present`
 * (line 52) flags as automation. The shim is **defensive** — we only
 * install our PluginArray if the underlying browser reports an empty
 * list. When the underlying browser already exposes ≥ 5 plugins (the
 * common case on real Chrome.app), we leave them alone so the existing
 * Probe Manifest Zero-Diff gate doesn't regress.
 *
 * The shim builds a frozen array-like object with:
 *   - `.length`, integer-keyed access, `Symbol.iterator`
 *   - `namedItem(name)`, `item(idx)` — PluginArray API surface
 *   - per-plugin `.length`, `.namedItem`, `.item` — Plugin API surface
 *   - per-mimetype `application/pdf` / `text/pdf` entries with `.enabledPlugin`
 *
 * Future: we may key the catalog off `matrix.os.name` to vary plugins
 * per OS (Windows / Linux Chrome ship the same 5 in 2026), but for v1
 * the catalog is profile-invariant.
 *
 * @see CloakBrowser tests/test_stealth.py:52-56
 * @see packages/profiles/data/mac-m4-chrome-stable/baseline.manifest.json
 */

import type { MatrixV1 } from "@mochi.js/consistency";

interface PluginShape {
  readonly name: string;
  readonly filename: string;
  readonly description: string;
  readonly mimeTypes: readonly { readonly type: string; readonly suffixes: string }[];
}

/**
 * Curated catalog. Mirrors the baseline-captured list in
 * `packages/profiles/data/mac-m4-chrome-stable/baseline.manifest.json`.
 *
 * The mime-type list is the deduplicated union across all 5 plugins —
 * real Chrome's `navigator.mimeTypes` shows 2 entries (`application/pdf`,
 * `text/pdf`), each pointing to the first plugin that registered it.
 */
const CHROMIUM_PLUGINS: readonly PluginShape[] = [
  {
    name: "PDF Viewer",
    filename: "internal-pdf-viewer",
    description: "Portable Document Format",
    mimeTypes: [
      { type: "application/pdf", suffixes: "pdf" },
      { type: "text/pdf", suffixes: "pdf" },
    ],
  },
  {
    name: "Chrome PDF Viewer",
    filename: "internal-pdf-viewer",
    description: "Portable Document Format",
    mimeTypes: [
      { type: "application/pdf", suffixes: "pdf" },
      { type: "text/pdf", suffixes: "pdf" },
    ],
  },
  {
    name: "Chromium PDF Viewer",
    filename: "internal-pdf-viewer",
    description: "Portable Document Format",
    mimeTypes: [
      { type: "application/pdf", suffixes: "pdf" },
      { type: "text/pdf", suffixes: "pdf" },
    ],
  },
  {
    name: "Microsoft Edge PDF Viewer",
    filename: "internal-pdf-viewer",
    description: "Portable Document Format",
    mimeTypes: [
      { type: "application/pdf", suffixes: "pdf" },
      { type: "text/pdf", suffixes: "pdf" },
    ],
  },
  {
    name: "WebKit built-in PDF",
    filename: "internal-pdf-viewer",
    description: "Portable Document Format",
    mimeTypes: [
      { type: "application/pdf", suffixes: "pdf" },
      { type: "text/pdf", suffixes: "pdf" },
    ],
  },
] as const;

export function emitPluginsModule(matrix: MatrixV1): string {
  if (matrix.engine !== "chromium") {
    return `\n// ---- plugins spoof (skipped — non-chromium engine) -----------------------\n`;
  }

  const pluginsLiteral = JSON.stringify(CHROMIUM_PLUGINS);

  return `
// ---- plugins spoof ---------------------------------------------------------
(function() {
  if (typeof navigator === "undefined") return;
  // Defensive: only install if the underlying browser reports an empty list.
  // Real Chrome.app ships the same 5-plugin PluginArray natively; overwriting
  // it would regress the harness Zero-Diff gate.
  try {
    if (navigator.plugins !== undefined && navigator.plugins !== null) {
      var existingLen = navigator.plugins.length;
      if (typeof existingLen === "number" && existingLen >= 5) {
        return;
      }
    }
  } catch (_e) { /* fall through */ }

  var SPOOF_PLUGINS = ${pluginsLiteral};

  // Build mimetype objects. Real Chrome dedupes — each mimetype's
  // .enabledPlugin points at the first plugin that registered it.
  var mimeByType = {};

  function makeMimeType(mt, plugin) {
    var obj = Object.create(null);
    obj.type = mt.type;
    obj.suffixes = mt.suffixes;
    obj.description = "";
    Object.defineProperty(obj, "enabledPlugin", {
      configurable: true, enumerable: true, get: function() { return plugin; },
    });
    return obj;
  }

  function makePlugin(spec) {
    var plug = Object.create(null);
    plug.name = spec.name;
    plug.filename = spec.filename;
    plug.description = spec.description;
    var mimes = [];
    for (var i = 0; i < spec.mimeTypes.length; i++) {
      var mt = makeMimeType(spec.mimeTypes[i], plug);
      mimes.push(mt);
      // First-registered mimetype wins for the global mimeTypes array.
      if (mimeByType[mt.type] === undefined) mimeByType[mt.type] = mt;
    }
    plug.length = mimes.length;
    for (var j = 0; j < mimes.length; j++) {
      plug[String(j)] = mimes[j];
      plug[mimes[j].type] = mimes[j];
    }
    plug.item = function(idx) { return mimes[idx] || null; };
    __mochi_register_native__(plug.item, "item");
    plug.namedItem = function(name) {
      for (var k = 0; k < mimes.length; k++) {
        if (mimes[k].type === name) return mimes[k];
      }
      return null;
    };
    __mochi_register_native__(plug.namedItem, "namedItem");
    return plug;
  }

  var plugins = [];
  for (var i = 0; i < SPOOF_PLUGINS.length; i++) {
    plugins.push(makePlugin(SPOOF_PLUGINS[i]));
  }

  // Build a PluginArray-like object. Real Chrome's PluginArray.length,
  // .item, .namedItem, .refresh are all on the prototype; for the shim
  // we put them on the instance (the assertion is on length and indexed
  // access, both of which work the same way).
  var pluginArr = Object.create(null);
  pluginArr.length = plugins.length;
  for (var p = 0; p < plugins.length; p++) {
    pluginArr[String(p)] = plugins[p];
    pluginArr[plugins[p].name] = plugins[p];
  }
  pluginArr.item = function(idx) { return plugins[idx] || null; };
  __mochi_register_native__(pluginArr.item, "item");
  pluginArr.namedItem = function(name) {
    for (var k = 0; k < plugins.length; k++) {
      if (plugins[k].name === name) return plugins[k];
    }
    return null;
  };
  __mochi_register_native__(pluginArr.namedItem, "namedItem");
  pluginArr.refresh = function() {};
  __mochi_register_native__(pluginArr.refresh, "refresh");
  pluginArr[Symbol.iterator] = function() {
    var i = 0;
    return {
      next: function() {
        if (i < plugins.length) return { value: plugins[i++], done: false };
        return { value: undefined, done: true };
      },
    };
  };

  // Build a MimeTypeArray-like object from the deduplicated map.
  var mimeKeys = Object.keys(mimeByType);
  var mimeArr = Object.create(null);
  mimeArr.length = mimeKeys.length;
  for (var m = 0; m < mimeKeys.length; m++) {
    mimeArr[String(m)] = mimeByType[mimeKeys[m]];
    mimeArr[mimeKeys[m]] = mimeByType[mimeKeys[m]];
  }
  mimeArr.item = function(idx) {
    var k = mimeKeys[idx]; return k ? mimeByType[k] : null;
  };
  __mochi_register_native__(mimeArr.item, "item");
  mimeArr.namedItem = function(name) { return mimeByType[name] || null; };
  __mochi_register_native__(mimeArr.namedItem, "namedItem");
  mimeArr[Symbol.iterator] = function() {
    var idx = 0;
    return {
      next: function() {
        if (idx < mimeKeys.length) return { value: mimeByType[mimeKeys[idx++]], done: false };
        return { value: undefined, done: true };
      },
    };
  };

  // Install on the Navigator prototype so getOwnPropertyNames(navigator)
  // doesn't show new own properties (mirrors how the navigator module
  // installs its accessors).
  var navProto = __mochi_getPrototypeOf__(navigator);
  try {
    __mochi_define__(navProto, "plugins", pluginArr);
  } catch (_e) {}
  try {
    __mochi_define__(navProto, "mimeTypes", mimeArr);
  } catch (_e) {}
})();
`;
}
