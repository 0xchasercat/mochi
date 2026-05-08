/**
 * Unit tests for the geo-probe — exercises the full registry against a
 * mocked `ProbeFetch` (we never hit ipinfo.io in unit tests, per the
 * brief). Covers:
 *   - all 7 adapters parse their canonical happy-path JSON.
 *   - schema-mismatch JSON returns `null` (not throw).
 *   - {@link probeExitGeo} falls through on per-endpoint timeout / non-2xx
 *     / parser-null and respects the 4-attempt cap.
 *   - all-fail returns `null`.
 *
 * The probe's `fetch` injection seam is an internal — production wires it
 * to `@mochi.js/net`'s `fetch`, which carries the matrix's wreq preset.
 *
 * @see tasks/0262-ip-tz-locale-exit-consistency.md
 * @see packages/core/src/geo-probe.ts
 */

import { describe, expect, it } from "bun:test";
import { ADAPTERS, type ProbeFetch, probeExitGeo } from "../geo-probe";

const MATRIX_STUB = { wreqPreset: "chrome_131_macos" };

/** Build a `ProbeFetch` that returns canned JSON for each URL. */
function fakeFetch(
  map: Record<string, { status?: number; body: unknown; delayMs?: number }>,
): ProbeFetch {
  return async (url, _init) => {
    const entry = map[url];
    if (entry === undefined) {
      // Default: connection refused / non-2xx 599.
      return new Response("", { status: 599 });
    }
    if (entry.delayMs !== undefined && entry.delayMs > 0) {
      await new Promise((r) => setTimeout(r, entry.delayMs));
    }
    const status = entry.status ?? 200;
    return new Response(JSON.stringify(entry.body), {
      status,
      headers: { "content-type": "application/json" },
    });
  };
}

/** Identity shuffle so adapter order is stable per test. */
const noShuffle = <T>(xs: readonly T[]): readonly T[] => xs;

describe("ADAPTERS — happy-path schema parsing", () => {
  function parseFor(url: string): (json: unknown) => unknown {
    const adapter = ADAPTERS.find((a) => a.url === url);
    if (adapter === undefined) throw new Error(`no adapter for ${url}`);
    return adapter.parse;
  }

  it("ip.decodo.com/json", () => {
    const parsed = parseFor("https://ip.decodo.com/json")({
      proxy: { ip: "1.1.1.1" },
      country: { code: "us" },
      city: {
        name: "San Francisco",
        state: "California",
        time_zone: "America/Los_Angeles",
        zip_code: "94103",
        latitude: 37.77,
        longitude: -122.41,
      },
    });
    expect(parsed).toEqual({
      ip: "1.1.1.1",
      country: "US",
      city: "San Francisco",
      region: "California",
      timezone: "America/Los_Angeles",
      postalCode: "94103",
      lat: 37.77,
      lng: -122.41,
      source: "decodo",
    });
  });

  it("ipinfo.io/json (parses loc)", () => {
    const parsed = parseFor("https://ipinfo.io/json")({
      ip: "2.2.2.2",
      country: "DE",
      city: "Berlin",
      region: "Berlin",
      timezone: "Europe/Berlin",
      postal: "10115",
      loc: "52.52,13.40",
    });
    expect(parsed).toEqual({
      ip: "2.2.2.2",
      country: "DE",
      city: "Berlin",
      region: "Berlin",
      timezone: "Europe/Berlin",
      postalCode: "10115",
      lat: 52.52,
      lng: 13.4,
      source: "ipinfo",
    });
  });

  it("ipwho.is/", () => {
    const parsed = parseFor("https://ipwho.is/")({
      ip: "3.3.3.3",
      country_code: "TH",
      city: "Bangkok",
      region: "Bangkok",
      timezone: { id: "Asia/Bangkok" },
      postal: "10100",
      latitude: 13.75,
      longitude: 100.5,
    });
    expect(parsed).toEqual({
      ip: "3.3.3.3",
      country: "TH",
      city: "Bangkok",
      region: "Bangkok",
      timezone: "Asia/Bangkok",
      postalCode: "10100",
      lat: 13.75,
      lng: 100.5,
      source: "ipwhois",
    });
  });

  it("ipwho.is — success:false returns null", () => {
    const parsed = parseFor("https://ipwho.is/")({ success: false, message: "blocked" });
    expect(parsed).toBeNull();
  });

  it("api.ip.sb/geoip", () => {
    const parsed = parseFor("https://api.ip.sb/geoip")({
      ip: "4.4.4.4",
      country_code: "JP",
      country: "Japan",
      city: "Tokyo",
      region: "Tokyo",
      timezone: "Asia/Tokyo",
      latitude: 35.68,
      longitude: 139.69,
    });
    expect(parsed).toEqual({
      ip: "4.4.4.4",
      country: "JP",
      city: "Tokyo",
      region: "Tokyo",
      timezone: "Asia/Tokyo",
      lat: 35.68,
      lng: 139.69,
      source: "ipsb",
    });
  });

  it("ifconfig.co/json", () => {
    const parsed = parseFor("https://ifconfig.co/json")({
      ip: "5.5.5.5",
      country_iso: "GB",
      country: "United Kingdom",
      city: "London",
      region_name: "England",
      time_zone: "Europe/London",
      zip_code: "SW1A",
      latitude: 51.5,
      longitude: -0.12,
    });
    expect(parsed).toEqual({
      ip: "5.5.5.5",
      country: "GB",
      city: "London",
      region: "England",
      timezone: "Europe/London",
      postalCode: "SW1A",
      lat: 51.5,
      lng: -0.12,
      source: "ifconfig",
    });
  });

  it("api.iplocation.net — always null (country-only schema, no tz)", () => {
    const parsed = parseFor("https://api.iplocation.net/")({
      ip: "6.6.6.6",
      country_code2: "US",
    });
    expect(parsed).toBeNull();
  });

  it("ipapi.co/json — error:true returns null (rate-limited)", () => {
    const parsed = parseFor("https://ipapi.co/json/")({ error: true, reason: "RateLimited" });
    expect(parsed).toBeNull();
  });

  it("ipapi.co/json — happy path", () => {
    const parsed = parseFor("https://ipapi.co/json/")({
      ip: "7.7.7.7",
      country_code: "FR",
      country: "France",
      city: "Paris",
      region: "Île-de-France",
      timezone: "Europe/Paris",
      postal: "75001",
      latitude: 48.85,
      longitude: 2.35,
    });
    expect(parsed).toEqual({
      ip: "7.7.7.7",
      country: "FR",
      city: "Paris",
      region: "Île-de-France",
      timezone: "Europe/Paris",
      postalCode: "75001",
      lat: 48.85,
      lng: 2.35,
      source: "ipapi",
    });
  });
});

describe("probeExitGeo — strategy", () => {
  it("first endpoint OK → returns immediately, doesn't probe further", async () => {
    let calls = 0;
    const fetchSpy: ProbeFetch = async (url) => {
      calls += 1;
      if (url === "https://ip.decodo.com/json") {
        return new Response(
          JSON.stringify({
            proxy: { ip: "1.1.1.1" },
            country: { code: "US" },
            city: { time_zone: "America/Los_Angeles" },
          }),
          { status: 200 },
        );
      }
      return new Response("", { status: 599 });
    };
    const geo = await probeExitGeo({
      matrix: MATRIX_STUB,
      fetch: fetchSpy,
      shuffle: noShuffle,
      maxAttempts: 4,
      perEndpointTimeoutMs: 100,
    });
    expect(geo).not.toBeNull();
    expect(geo?.country).toBe("US");
    expect(geo?.source).toBe("decodo");
    expect(calls).toBe(1);
  });

  it("non-2xx → falls through to next adapter", async () => {
    const fetchSpy = fakeFetch({
      "https://ip.decodo.com/json": { status: 500, body: {} },
      "https://ipinfo.io/json": {
        body: {
          ip: "2.2.2.2",
          country: "GB",
          timezone: "Europe/London",
        },
      },
    });
    const geo = await probeExitGeo({
      matrix: MATRIX_STUB,
      fetch: fetchSpy,
      shuffle: noShuffle,
      maxAttempts: 4,
      perEndpointTimeoutMs: 100,
    });
    expect(geo?.source).toBe("ipinfo");
    expect(geo?.country).toBe("GB");
  });

  it("schema mismatch (parser returns null) → falls through", async () => {
    const fetchSpy = fakeFetch({
      "https://ip.decodo.com/json": {
        // Missing country.code → adapter returns null.
        body: { proxy: { ip: "1.1.1.1" } },
      },
      "https://ipinfo.io/json": {
        body: { ip: "9.9.9.9", country: "TH", timezone: "Asia/Bangkok" },
      },
    });
    const geo = await probeExitGeo({
      matrix: MATRIX_STUB,
      fetch: fetchSpy,
      shuffle: noShuffle,
      maxAttempts: 4,
      perEndpointTimeoutMs: 100,
    });
    expect(geo?.country).toBe("TH");
  });

  it("per-endpoint timeout fires → falls through", async () => {
    const fetchSpy = fakeFetch({
      "https://ip.decodo.com/json": { delayMs: 200, body: {} }, // overshoots 50ms cap
      "https://ipinfo.io/json": {
        body: { ip: "1.1.1.1", country: "US", timezone: "America/Los_Angeles" },
      },
    });
    const geo = await probeExitGeo({
      matrix: MATRIX_STUB,
      fetch: fetchSpy,
      shuffle: noShuffle,
      maxAttempts: 4,
      perEndpointTimeoutMs: 50,
    });
    expect(geo?.source).toBe("ipinfo");
  });

  it("all attempts fail (non-2xx + parser-null) → returns null", async () => {
    // Empty map → every URL returns 599.
    const fetchSpy = fakeFetch({});
    const geo = await probeExitGeo({
      matrix: MATRIX_STUB,
      fetch: fetchSpy,
      shuffle: noShuffle,
      maxAttempts: 4,
      perEndpointTimeoutMs: 50,
    });
    expect(geo).toBeNull();
  });

  it("respects 4-attempt cap (doesn't burn through all 7)", async () => {
    let calls = 0;
    const fetchSpy: ProbeFetch = async () => {
      calls += 1;
      return new Response("", { status: 599 });
    };
    const geo = await probeExitGeo({
      matrix: MATRIX_STUB,
      fetch: fetchSpy,
      shuffle: noShuffle,
      maxAttempts: 4,
      perEndpointTimeoutMs: 50,
    });
    expect(geo).toBeNull();
    expect(calls).toBe(4);
  });

  it("forwards proxy + matrix.wreqPreset to the fetch impl", async () => {
    let captured: { url?: string; preset?: string; proxy?: string } = {};
    const fetchSpy: ProbeFetch = async (url, init) => {
      captured = { url, preset: init.preset, proxy: init.proxy };
      return new Response(
        JSON.stringify({
          proxy: { ip: "1" },
          country: { code: "US" },
          city: { time_zone: "America/Los_Angeles" },
        }),
        { status: 200 },
      );
    };
    await probeExitGeo({
      matrix: { wreqPreset: "chrome_131_linux" },
      proxy: "http://user:pass@proxy.example:8080",
      fetch: fetchSpy,
      shuffle: noShuffle,
      maxAttempts: 1,
      perEndpointTimeoutMs: 100,
    });
    expect(captured.preset).toBe("chrome_131_linux");
    expect(captured.proxy).toBe("http://user:pass@proxy.example:8080");
  });

  it("synchronous throw from fetch (e.g. dlopen failure) → null, NEVER propagates", async () => {
    const fetchSpy: ProbeFetch = () => {
      // Simulate the cdylib-missing case: throws synchronously off the
      // top of the body, before Promise.resolve.
      throw new Error("dlopen: libmochi-net.dylib not found");
    };
    const geo = await probeExitGeo({
      matrix: MATRIX_STUB,
      fetch: fetchSpy,
      shuffle: noShuffle,
      maxAttempts: 4,
      perEndpointTimeoutMs: 50,
    });
    expect(geo).toBeNull();
  });

  it("rejected fetch promise → falls through, never throws out", async () => {
    const fetchSpy: ProbeFetch = () => Promise.reject(new Error("connection refused"));
    const geo = await probeExitGeo({
      matrix: MATRIX_STUB,
      fetch: fetchSpy,
      shuffle: noShuffle,
      maxAttempts: 4,
      perEndpointTimeoutMs: 50,
    });
    expect(geo).toBeNull();
  });

  it("malformed JSON body → falls through (parser doesn't throw)", async () => {
    const fetchSpy: ProbeFetch = async (url) => {
      if (url === "https://ip.decodo.com/json") {
        // Real `Response` whose .json() will reject.
        return new Response("not-json{{{", { status: 200 });
      }
      return new Response(
        JSON.stringify({
          ip: "2",
          country: "GB",
          timezone: "Europe/London",
        }),
        { status: 200 },
      );
    };
    const geo = await probeExitGeo({
      matrix: MATRIX_STUB,
      fetch: fetchSpy,
      shuffle: noShuffle,
      maxAttempts: 4,
      perEndpointTimeoutMs: 100,
    });
    expect(geo?.country).toBe("GB");
  });
});
