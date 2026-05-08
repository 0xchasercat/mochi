/**
 * Spoof module: `navigator.userAgentData`.
 *
 * Reads from the matrix:
 *   - `matrix.uaCh["sec-ch-ua"]`                  → brands list (R-005)
 *   - `matrix.uaCh["sec-ch-ua-platform"]`         → platform   (R-006)
 *   - `matrix.uaCh["sec-ch-ua-platform-version"]` → platformVersion (R-007)
 *   - `matrix.uaCh["sec-ch-ua-arch"]`             → arch (R-042)
 *   - `matrix.uaCh["sec-ch-ua-bitness"]`          → bitness (R-043)
 *   - `matrix.uaCh["sec-ch-ua-model"]`            → model (R-045)
 *   - `matrix.uaCh["sec-ch-ua-mobile"]`           → mobile (R-044, "?0"/"?1")
 *   - `matrix.uaCh["ua-full-version-list"]`       → fullVersionList (R-031)
 *   - `matrix.uaCh["ua-full-version"]`            → uaFullVersion (R-046)
 *
 * The same `sec-ch-ua*` and `ua-full-version*` fields drive
 * `Network.setUserAgentOverride.userAgentMetadata` in `@mochi.js/core`
 * (task 0261). Single source of truth — the JS-side spoof and the
 * request-header spoof read the same matrix slots so they cannot drift
 * (PLAN.md I-5).
 *
 * Sec-CH-UA values arrive on the wire as quoted (e.g. `'"macOS"'`,
 * `'"Google Chrome";v="131", "Not.A/Brand";v="8", "Chromium";v="131"'`).
 * The spoofed `userAgentData` API exposes parsed shapes:
 *   - `brands`: array of `{ brand, version }`
 *   - `platform`: unquoted string
 *   - `mobile`: boolean
 *   - `getHighEntropyValues(hints)`: Promise resolving to the requested hints
 *
 * Missing keys → field omitted from the response (PLAN.md I-5).
 *
 * @see tasks/0030-inject-engine-v0.md §"client-hints.ts"
 */

import type { MatrixV1 } from "@mochi.js/consistency";

interface BrandEntry {
  readonly brand: string;
  readonly version: string;
}

/** Strip surrounding double-quotes if present. */
function unquote(s: string): string {
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) {
    return s.slice(1, -1);
  }
  return s;
}

/**
 * Parse a Sec-CH-UA header value into brand entries. Format:
 *   `"Brand A";v="123", "Not.A/Brand";v="8", "Brand B";v="456"`
 */
function parseSecChUa(s: string): BrandEntry[] {
  const out: BrandEntry[] = [];
  // Split on `,` outside quoted segments. Simple state machine.
  const parts: string[] = [];
  let depth = 0;
  let cur = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i] as string;
    if (c === '"') {
      depth = depth === 0 ? 1 : 0;
      cur += c;
    } else if (c === "," && depth === 0) {
      parts.push(cur);
      cur = "";
    } else {
      cur += c;
    }
  }
  if (cur.length > 0) parts.push(cur);
  for (const raw of parts) {
    const piece = raw.trim();
    if (piece.length === 0) continue;
    // `"Brand";v="123"`
    const semi = piece.indexOf(";");
    if (semi === -1) {
      out.push({ brand: unquote(piece), version: "" });
      continue;
    }
    const brandPart = piece.slice(0, semi).trim();
    const rest = piece.slice(semi + 1).trim();
    let version = "";
    if (rest.startsWith("v=")) {
      version = unquote(rest.slice(2).trim());
    }
    out.push({ brand: unquote(brandPart), version });
  }
  return out;
}

export function emitClientHintsModule(matrix: MatrixV1): string {
  const ua = matrix.uaCh;

  // Parse the Sec-CH-UA bag. Required for the brands list — without it we
  // skip the whole module.
  const secChUa = ua["sec-ch-ua"];
  if (typeof secChUa !== "string" || secChUa.length === 0) {
    return `
// ---- client-hints spoof (skipped — no matrix.uaCh["sec-ch-ua"]) -----------
`;
  }
  const brands = parseSecChUa(secChUa);

  const platformRaw = ua["sec-ch-ua-platform"];
  const platform = typeof platformRaw === "string" ? unquote(platformRaw) : "";

  const platformVersionRaw = ua["sec-ch-ua-platform-version"];
  const platformVersion = typeof platformVersionRaw === "string" ? unquote(platformVersionRaw) : "";

  // Optional high-entropy fields.
  const arch = typeof ua["sec-ch-ua-arch"] === "string" ? unquote(ua["sec-ch-ua-arch"]) : "";
  const bitness =
    typeof ua["sec-ch-ua-bitness"] === "string" ? unquote(ua["sec-ch-ua-bitness"]) : "";
  const model = typeof ua["sec-ch-ua-model"] === "string" ? unquote(ua["sec-ch-ua-model"]) : "";

  const mobileRaw = ua["sec-ch-ua-mobile"];
  // sec-ch-ua-mobile is "?0" or "?1" on the wire.
  const mobile = mobileRaw === "?1";

  // R-031 emits a tip-locked full brand list (e.g. `"147.0.7727.138"`) under
  // `uaCh.ua-full-version-list` — match what
  // `userAgentData.getHighEntropyValues(["fullVersionList"])` returns on
  // captured-device baselines. Fall back to `brands` (brand-list majors)
  // when the tip table doesn't carry the major.
  const fullVersionListRaw = ua["ua-full-version-list"];
  let fullVersionList: BrandEntry[] = brands;
  if (typeof fullVersionListRaw === "string" && fullVersionListRaw.length > 0) {
    try {
      const parsed = JSON.parse(fullVersionListRaw) as unknown;
      if (Array.isArray(parsed)) {
        fullVersionList = parsed
          .filter(
            (e): e is BrandEntry =>
              typeof e === "object" &&
              e !== null &&
              typeof (e as { brand?: unknown }).brand === "string" &&
              typeof (e as { version?: unknown }).version === "string",
          )
          .map((e) => ({ brand: e.brand, version: e.version }));
      }
    } catch {
      // Fall through to brands.
    }
  }

  // Single-string `Sec-CH-UA-Full-Version` (legacy hint, still surfaced via
  // `getHighEntropyValues({hints:["uaFullVersion"]})`). R-046 derives this
  // from the branded entry of `ua-full-version-list`. Falls back to the
  // first entry when the matrix doesn't carry the explicit field — keeps
  // the byte-for-byte parity guarantee with `Network.setUserAgentOverride`'s
  // `userAgentMetadata.fullVersion` (which has the same fallback).
  const uaFullVersionRaw = ua["ua-full-version"];
  const uaFullVersion =
    typeof uaFullVersionRaw === "string" && uaFullVersionRaw.length > 0
      ? uaFullVersionRaw
      : (fullVersionList[0]?.version ?? "");

  const brandsLiteral = JSON.stringify(brands);
  const fullVersionListLiteral = JSON.stringify(fullVersionList);

  return `
// ---- client-hints spoof ----------------------------------------------------
(function() {
  if (typeof navigator === "undefined") return;
  var SPOOF_BRANDS = ${brandsLiteral};
  var SPOOF_FULL_VERSION_LIST = ${fullVersionListLiteral};
  var SPOOF_PLATFORM = ${JSON.stringify(platform)};
  var SPOOF_PLATFORM_VERSION = ${JSON.stringify(platformVersion)};
  var SPOOF_ARCH = ${JSON.stringify(arch)};
  var SPOOF_BITNESS = ${JSON.stringify(bitness)};
  var SPOOF_MODEL = ${JSON.stringify(model)};
  var SPOOF_MOBILE = ${mobile ? "true" : "false"};
  var SPOOF_UA_FULL_VERSION = ${JSON.stringify(uaFullVersion)};

  // Re-freeze brand entries on every read (Chrome returns frozen objects).
  function freezeBrands(arr) {
    var out = [];
    for (var i = 0; i < arr.length; i++) {
      out.push(Object.freeze({ brand: arr[i].brand, version: arr[i].version }));
    }
    return Object.freeze(out);
  }

  function toJSON() {
    return { brands: freezeBrands(SPOOF_BRANDS), mobile: SPOOF_MOBILE, platform: SPOOF_PLATFORM };
  }
  __mochi_register_native__(toJSON, "toJSON");

  function getHighEntropyValues(hints) {
    return new Promise(function(resolve) {
      var out = {
        brands: freezeBrands(SPOOF_BRANDS),
        mobile: SPOOF_MOBILE,
        platform: SPOOF_PLATFORM,
      };
      if (Array.isArray(hints)) {
        for (var i = 0; i < hints.length; i++) {
          var h = hints[i];
          if (h === "architecture" && SPOOF_ARCH) out.architecture = SPOOF_ARCH;
          else if (h === "bitness" && SPOOF_BITNESS) out.bitness = SPOOF_BITNESS;
          else if (h === "model") out.model = SPOOF_MODEL;
          else if (h === "platformVersion") out.platformVersion = SPOOF_PLATFORM_VERSION;
          else if (h === "uaFullVersion" && SPOOF_UA_FULL_VERSION) out.uaFullVersion = SPOOF_UA_FULL_VERSION;
          else if (h === "fullVersionList") out.fullVersionList = freezeBrands(SPOOF_FULL_VERSION_LIST);
          else if (h === "wow64") out.wow64 = false;
          else if (h === "formFactor" && SPOOF_MOBILE) out.formFactor = ["Mobile"];
        }
      }
      resolve(out);
    });
  }
  __mochi_register_native__(getHighEntropyValues, "getHighEntropyValues");

  // Build a userAgentData object. Match the live Chrome shape: brands,
  // mobile, platform are direct accessors; toJSON + getHighEntropyValues
  // are methods.
  var spoof = Object.create(null);

  __mochi_defineProperty__(spoof, "brands", {
    configurable: true,
    enumerable: true,
    get: function() { return freezeBrands(SPOOF_BRANDS); },
  });
  __mochi_defineProperty__(spoof, "mobile", {
    configurable: true,
    enumerable: true,
    get: function() { return SPOOF_MOBILE; },
  });
  __mochi_defineProperty__(spoof, "platform", {
    configurable: true,
    enumerable: true,
    get: function() { return SPOOF_PLATFORM; },
  });
  __mochi_defineProperty__(spoof, "toJSON", {
    configurable: true, enumerable: false, writable: true, value: toJSON,
  });
  __mochi_defineProperty__(spoof, "getHighEntropyValues", {
    configurable: true, enumerable: false, writable: true, value: getHighEntropyValues,
  });

  // Install on Navigator.prototype so .userAgentData reads return our spoof.
  var navProto = __mochi_getPrototypeOf__(navigator);
  __mochi_define__(navProto, "userAgentData", spoof);
})();
`;
}
