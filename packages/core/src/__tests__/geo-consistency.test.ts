/**
 * Unit tests for the geo-consistency reconciler — covers all 4 modes
 * × {match, mismatch, probe-null} cases per the brief, plus the
 * timezone-OFFSET-not-zone-name compare and the locale-region extraction.
 *
 * Pure JS — no FFI, no CDP, no network. The {@link reconcileGeoConsistency}
 * function is a pure transform on `(matrix, geo, mode)`.
 *
 * @see packages/core/src/geo-consistency.ts
 */

import { describe, expect, it } from "bun:test";
import { deriveMatrix, type MatrixV1, type ProfileV1 } from "@mochi.js/consistency";
import {
  GeoMismatchError,
  localeRegion,
  reconcileGeoConsistency,
  tzOffsetMinutes,
} from "../geo-consistency";
import type { ExitGeo } from "../geo-probe";

const PROFILE_US: ProfileV1 = {
  id: "test-us",
  version: "0.0.0-test",
  engine: "chromium",
  browser: { name: "chrome", channel: "stable", minVersion: "131", maxVersion: "133" },
  os: { name: "macos", version: "14", arch: "arm64" },
  device: {
    vendor: "apple",
    model: "macbook-air-m2",
    cpuFamily: "apple-m2",
    cores: 8,
    memoryGB: 16,
  },
  display: { width: 1512, height: 982, dpr: 2, colorDepth: 30, pixelDepth: 30 },
  gpu: {
    vendor: "Apple Inc.",
    renderer: "Apple M2",
    webglUnmaskedVendor: "Apple Inc.",
    webglUnmaskedRenderer: "Apple M2",
    webglMaxTextureSize: 16384,
    webglMaxColorAttachments: 8,
    webglExtensions: [],
  },
  audio: { contextSampleRate: 48000, audioWorkletLatency: 0.005, destinationMaxChannelCount: 2 },
  fonts: { family: "macos-baseline", list: ["Helvetica"] },
  timezone: "America/Los_Angeles",
  locale: "en-US",
  languages: ["en-US", "en"],
  behavior: { hand: "right", tremor: 0.18, wpm: 65, scrollStyle: "smooth" },
  wreqPreset: "chrome_131_macos",
  userAgent: "Mozilla/5.0 ... Chrome/131.0.0.0 Safari/537.36",
  uaCh: {},
  entropyBudget: { fixed: [], perSeed: [] },
};

function makeMatrix(): MatrixV1 {
  return deriveMatrix(PROFILE_US, "geo-test");
}

const GEO_US: ExitGeo = {
  ip: "8.8.8.8",
  country: "US",
  city: "Los Angeles",
  region: "CA",
  timezone: "America/Los_Angeles",
  source: "test",
};

const GEO_DETROIT: ExitGeo = {
  // Same offset family as Los_Angeles? No — Detroit is Eastern, LA is Pacific.
  // Use Detroit as a US-East but same country to test "same country, diff tz"
  ip: "1.2.3.4",
  country: "US",
  timezone: "America/Detroit",
  source: "test",
};

const GEO_DE: ExitGeo = {
  ip: "5.6.7.8",
  country: "DE",
  city: "Berlin",
  timezone: "Europe/Berlin",
  source: "test",
};

const GEO_GB: ExitGeo = {
  ip: "9.10.11.12",
  country: "GB",
  city: "London",
  timezone: "Europe/London",
  source: "test",
};

describe("tzOffsetMinutes — offset compare, not zone-name compare", () => {
  it("returns 0 for UTC", () => {
    expect(tzOffsetMinutes("UTC", new Date("2026-05-09T12:00:00Z"))).toBe(0);
  });

  it("returns -480 for America/Los_Angeles in winter (PST)", () => {
    expect(tzOffsetMinutes("America/Los_Angeles", new Date("2026-01-15T12:00:00Z"))).toBe(-480);
  });

  it("returns +330 for Asia/Kolkata (no DST)", () => {
    expect(tzOffsetMinutes("Asia/Kolkata", new Date("2026-05-09T12:00:00Z"))).toBe(330);
  });

  it("returns same offset for America/New_York and America/Detroit (equivalent for fingerprinting)", () => {
    const ref = new Date("2026-05-09T12:00:00Z");
    const ny = tzOffsetMinutes("America/New_York", ref);
    const det = tzOffsetMinutes("America/Detroit", ref);
    expect(ny).not.toBeNull();
    expect(ny).toBe(det);
  });

  it("returns null for an unknown zone", () => {
    expect(tzOffsetMinutes("Bogus/Made_Up")).toBeNull();
  });
});

describe("localeRegion", () => {
  it("'en-US' → 'US'", () => {
    expect(localeRegion("en-US")).toBe("US");
  });
  it("'de-DE' → 'DE'", () => {
    expect(localeRegion("de-DE")).toBe("DE");
  });
  it("'en' → null (no region)", () => {
    expect(localeRegion("en")).toBeNull();
  });
  it("returns null on garbage input", () => {
    expect(localeRegion("!!not a locale!!")).toBeNull();
  });
});

describe("reconcileGeoConsistency — mode: off", () => {
  it("returns the matrix unchanged regardless of geo", () => {
    const m = makeMatrix();
    const r = reconcileGeoConsistency(m, GEO_DE, "off");
    expect(r.action).toBe("off");
    expect(r.matrix).toBe(m);
    expect(r.matrix.timezone).toBe("America/Los_Angeles");
    expect(r.matrix.locale).toBe("en-US");
  });

  it("ignores null geo too", () => {
    const m = makeMatrix();
    const r = reconcileGeoConsistency(m, null, "off");
    expect(r.action).toBe("off");
    expect(r.matrix).toBe(m);
  });
});

describe("reconcileGeoConsistency — mode: privacy-fallback", () => {
  it("on probe-null → UTC + en-US fallback", () => {
    const m = makeMatrix();
    const r = reconcileGeoConsistency(m, null, "privacy-fallback");
    expect(r.action).toBe("privacy-fallback");
    expect(r.matrix.timezone).toBe("UTC");
    expect(r.matrix.locale).toBe("en-US");
    expect(r.matrix.languages).toEqual(["en-US", "en"]);
    expect(r.reason).toContain("probe returned null");
  });

  it("on tz mismatch (US matrix, DE proxy) → UTC + en-US fallback", () => {
    const m = makeMatrix();
    const r = reconcileGeoConsistency(m, GEO_DE, "privacy-fallback");
    expect(r.action).toBe("privacy-fallback");
    expect(r.matrix.timezone).toBe("UTC");
    expect(r.matrix.locale).toBe("en-US");
    expect(r.reason).toContain("tz offset");
    expect(r.reason).toContain("locale region");
  });

  it("on locale-only mismatch (US tz, GB country, en-US locale) → UTC + en-US fallback", () => {
    // GB has same offset as UTC in winter and +60 in summer; pick a date so
    // the offsets DO match — only the country differs.
    const m: MatrixV1 = { ...makeMatrix(), timezone: "Europe/London" };
    // Force a date where London is in BST (UTC+60) for predictability — we
    // pass GEO_GB which is also Europe/London, so offsets match exactly.
    const r = reconcileGeoConsistency(m, GEO_GB, "privacy-fallback");
    expect(r.action).toBe("privacy-fallback");
    expect(r.matrix.timezone).toBe("UTC");
    expect(r.reason).toContain("locale region US");
  });

  it("on full match (US matrix, US proxy, same offset) → passthrough", () => {
    const m = makeMatrix();
    const r = reconcileGeoConsistency(m, GEO_US, "privacy-fallback");
    expect(r.action).toBe("ok");
    expect(r.matrix).toBe(m);
    expect(r.geo).toBe(GEO_US);
  });

  it("zone-name diff but offset match (NY vs Detroit) → passthrough when in same country/offset", () => {
    // Set matrix to NY; geo says Detroit (same offset, same country).
    const m: MatrixV1 = { ...makeMatrix(), timezone: "America/New_York" };
    const r = reconcileGeoConsistency(m, GEO_DETROIT, "privacy-fallback");
    expect(r.action).toBe("ok");
  });
});

describe("reconcileGeoConsistency — mode: auto-correct", () => {
  it("on probe-null → passthrough (best effort)", () => {
    const m = makeMatrix();
    const r = reconcileGeoConsistency(m, null, "auto-correct");
    expect(r.action).toBe("no-probe");
    expect(r.matrix).toBe(m);
  });

  it("on mismatch → override to IP-derived tz + locale", () => {
    const m = makeMatrix();
    const r = reconcileGeoConsistency(m, GEO_DE, "auto-correct");
    expect(r.action).toBe("auto-correct");
    expect(r.matrix.timezone).toBe("Europe/Berlin");
    expect(r.matrix.locale).toBe("de-DE");
    expect(r.matrix.languages[0]).toBe("de-DE");
    expect(r.matrix.languages).toContain("de");
    expect(r.matrix.languages).toContain("en");
  });

  it("on match → passthrough", () => {
    const m = makeMatrix();
    const r = reconcileGeoConsistency(m, GEO_US, "auto-correct");
    expect(r.action).toBe("ok");
  });
});

describe("reconcileGeoConsistency — mode: strict", () => {
  it("on probe-null → passthrough (no probe = no provable mismatch)", () => {
    const m = makeMatrix();
    const r = reconcileGeoConsistency(m, null, "strict");
    expect(r.action).toBe("no-probe");
    expect(r.matrix).toBe(m);
  });

  it("on match → passthrough", () => {
    const m = makeMatrix();
    const r = reconcileGeoConsistency(m, GEO_US, "strict");
    expect(r.action).toBe("ok");
  });

  it("on mismatch → throws GeoMismatchError", () => {
    const m = makeMatrix();
    expect(() => reconcileGeoConsistency(m, GEO_DE, "strict")).toThrow(GeoMismatchError);
  });

  it("GeoMismatchError carries the diagnostic", () => {
    const m = makeMatrix();
    try {
      reconcileGeoConsistency(m, GEO_DE, "strict");
      expect(false).toBe(true);
    } catch (err) {
      expect(err).toBeInstanceOf(GeoMismatchError);
      const e = err as GeoMismatchError;
      expect(e.matrix.locale).toBe("en-US");
      expect(e.geo.country).toBe("DE");
      expect(e.message).toContain("strict");
      expect(e.message).toContain("America/Los_Angeles");
      expect(e.message).toContain("Europe/Berlin");
    }
  });
});

describe("reconcileGeoConsistency — relational invariant: input matrix is never mutated", () => {
  it("override path returns a fresh object; inputs untouched", () => {
    const m = makeMatrix();
    const tzBefore = m.timezone;
    const localeBefore = m.locale;
    const r = reconcileGeoConsistency(m, GEO_DE, "privacy-fallback");
    expect(r.matrix).not.toBe(m);
    expect(m.timezone).toBe(tzBefore);
    expect(m.locale).toBe(localeBefore);
    expect(r.matrix.timezone).toBe("UTC");
  });
});
