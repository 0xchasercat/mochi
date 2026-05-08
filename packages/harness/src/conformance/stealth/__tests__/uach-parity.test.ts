/**
 * Stealth conformance — Layer 1 — UA-CH parity (`Sec-CH-UA*` headers ↔
 * `navigator.userAgentData.getHighEntropyValues`).
 *
 * Closes the cross-layer leak that 0255 left open and 0261 fixed: without
 * `Network.setUserAgentOverride.userAgentMetadata`, the request
 * `Sec-CH-UA*` headers carried Chromium-for-Testing's binary defaults
 * while the JS-side `navigator.userAgentData` was matrix-derived. A
 * fingerprinter doing `getHighEntropyValues({hints:[...]})` and comparing
 * against the request headers saw a mismatch — direct PLAN.md I-5
 * violation.
 *
 * The test asserts byte-for-byte parity:
 *   1. Drive a real Mochi `Session` against an ephemeral `Bun.serve`
 *      fixture bound to `127.0.0.1:0` (hermetic — no network egress).
 *   2. Capture the `Sec-CH-UA*` headers Chromium emits on the navigation
 *      request. To force the high-entropy headers up the stack, the
 *      fixture's first response carries `Accept-CH: <every-hint>` so
 *      Chromium sends them on the second navigation per the UA-CH client
 *      hint negotiation protocol.
 *   3. From the page JS, call
 *      `navigator.userAgentData.getHighEntropyValues(["platform",
 *      "platformVersion", "model", "mobile", "architecture", "bitness",
 *      "fullVersionList"])`.
 *   4. Assert each captured request-header value equals the corresponding
 *      JS-API value byte-for-byte.
 *
 * Gated by `MOCHI_E2E=1`. Profile: `mac-m4-chrome-stable`.
 *
 * @see tasks/0261-uach-network-metadata.md
 * @see PLAN.md §2 I-5 (relational consistency or nothing)
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { Session } from "@mochi.js/core";
import {
  CONFORMANCE_PROFILE,
  E2E_ENABLED,
  evalExpr,
  launchSharedSession,
  withPage,
  withRetries,
} from "../helpers";

const TEST_TIMEOUT_MS = 30_000;
const SUITE_TIMEOUT_MS = 90_000;

const describeOrSkip = E2E_ENABLED ? describe : describe.skip;

interface CapturedHeaders {
  "sec-ch-ua": string | null;
  "sec-ch-ua-platform": string | null;
  "sec-ch-ua-platform-version": string | null;
  "sec-ch-ua-arch": string | null;
  "sec-ch-ua-bitness": string | null;
  "sec-ch-ua-mobile": string | null;
  "sec-ch-ua-model": string | null;
  "sec-ch-ua-full-version-list": string | null;
  "user-agent": string | null;
}

interface BrandEntry {
  brand: string;
  version: string;
}

interface JsHints {
  brands: BrandEntry[];
  mobile: boolean;
  platform: string;
  platformVersion?: string;
  architecture?: string;
  bitness?: string;
  model?: string;
  fullVersionList?: BrandEntry[];
}

describeOrSkip(
  `stealth conformance / Layer 1 — UA-CH parity (profile=${CONFORMANCE_PROFILE})`,
  () => {
    let session: Session;
    let server: { stop: () => void; url: string; lastHeaders: () => CapturedHeaders | null };

    beforeAll(async () => {
      session = await launchSharedSession();
      server = startEphemeralServer();
    }, SUITE_TIMEOUT_MS);

    afterAll(async () => {
      try {
        server?.stop();
      } catch {
        // best effort
      }
      if (session !== undefined) {
        await session.close();
      }
    }, SUITE_TIMEOUT_MS);

    it(
      "Sec-CH-UA* request headers match getHighEntropyValues() byte-for-byte",
      async () => {
        await withRetries(async () => {
          await withPage(session, async (page) => {
            // Two navigations: the first primes Chromium with `Accept-CH:`
            // for the high-entropy hints; the second navigation actually
            // emits them. UA-CH is a request-response negotiation per the
            // spec — high-entropy hints are NOT sent on the first hit
            // unless the origin previously announced them.
            await page.goto(server.url);
            await page.goto(server.url);

            const headers = server.lastHeaders();
            expect(headers).not.toBeNull();
            if (headers === null) throw new Error("unreachable");

            // Parse the JS-API values out of the page.
            const jsHints = await evalExpr<JsHints>(
              page,
              `navigator.userAgentData.getHighEntropyValues([
                "platform",
                "platformVersion",
                "model",
                "mobile",
                "architecture",
                "bitness",
                "fullVersionList"
              ])`,
            );

            // ---- field-by-field parity ----------------------------------

            // Sec-CH-UA-Platform: header is RFC 8941 quoted-string
            // (`"macOS"`); JS-API value is unquoted (`macOS`). Strip.
            expect(unquoteHeader(headers["sec-ch-ua-platform"])).toBe(jsHints.platform);

            // Sec-CH-UA-Platform-Version: same quoted-string treatment.
            expect(unquoteHeader(headers["sec-ch-ua-platform-version"])).toBe(
              jsHints.platformVersion ?? "",
            );

            // Sec-CH-UA-Arch / -Bitness / -Model: quoted strings on the
            // wire, unquoted JS-side.
            expect(unquoteHeader(headers["sec-ch-ua-arch"])).toBe(jsHints.architecture ?? "");
            expect(unquoteHeader(headers["sec-ch-ua-bitness"])).toBe(jsHints.bitness ?? "");
            expect(unquoteHeader(headers["sec-ch-ua-model"])).toBe(jsHints.model ?? "");

            // Sec-CH-UA-Mobile: Structured-Headers boolean (?0 / ?1).
            const mobileHeader = headers["sec-ch-ua-mobile"];
            expect(mobileHeader === "?1").toBe(jsHints.mobile);

            // Sec-CH-UA: brand-list ordered-string. Parse and compare to
            // the JS-API `brands` array.
            const headerBrands = parseBrandList(headers["sec-ch-ua"] ?? "");
            expect(headerBrands).toEqual(jsHints.brands);

            // Sec-CH-UA-Full-Version-List: same shape, but uses tip-locked
            // versions instead of brand-list majors.
            const headerFullList = parseBrandList(headers["sec-ch-ua-full-version-list"] ?? "");
            expect(headerFullList).toEqual(jsHints.fullVersionList ?? []);

            // User-Agent header parity (covered by 0255 already, but
            // re-asserted here so a regression surfaces in this test
            // suite as well).
            expect(headers["user-agent"]).toBe(session.profile.userAgent);
          });
        });
      },
      TEST_TIMEOUT_MS,
    );
  },
);

/**
 * Spin up a `Bun.serve` listener on an ephemeral port. Captures every
 * Sec-CH-UA* request header. The first response sets `Accept-CH:` so
 * Chromium populates the high-entropy hints on the next navigation.
 */
function startEphemeralServer(): {
  stop: () => void;
  url: string;
  lastHeaders: () => CapturedHeaders | null;
} {
  let lastHeaders: CapturedHeaders | null = null;
  // biome-ignore lint/suspicious/noExplicitAny: Bun.serve's typing is environment-dependent
  const srv = (Bun as any).serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch(req: Request): Response {
      lastHeaders = {
        "sec-ch-ua": req.headers.get("sec-ch-ua"),
        "sec-ch-ua-platform": req.headers.get("sec-ch-ua-platform"),
        "sec-ch-ua-platform-version": req.headers.get("sec-ch-ua-platform-version"),
        "sec-ch-ua-arch": req.headers.get("sec-ch-ua-arch"),
        "sec-ch-ua-bitness": req.headers.get("sec-ch-ua-bitness"),
        "sec-ch-ua-mobile": req.headers.get("sec-ch-ua-mobile"),
        "sec-ch-ua-model": req.headers.get("sec-ch-ua-model"),
        "sec-ch-ua-full-version-list": req.headers.get("sec-ch-ua-full-version-list"),
        "user-agent": req.headers.get("user-agent"),
      };
      // Negotiate the high-entropy hints into the next request via
      // Accept-CH. Subsequent navigations on this origin will carry the
      // populated headers.
      const acceptCh = [
        "Sec-CH-UA",
        "Sec-CH-UA-Platform",
        "Sec-CH-UA-Platform-Version",
        "Sec-CH-UA-Arch",
        "Sec-CH-UA-Bitness",
        "Sec-CH-UA-Mobile",
        "Sec-CH-UA-Model",
        "Sec-CH-UA-Full-Version-List",
      ].join(", ");
      return new Response('<!doctype html><html><body><p id="probe">ok</p></body></html>', {
        status: 200,
        headers: {
          "content-type": "text/html; charset=utf-8",
          "accept-ch": acceptCh,
          "critical-ch": acceptCh,
        },
      });
    },
  }) as { port: number; hostname: string; stop: () => void };
  return {
    stop: () => srv.stop(),
    url: `http://${srv.hostname}:${srv.port}/`,
    lastHeaders: () => lastHeaders,
  };
}

/**
 * Strip RFC 8941 surrounding double-quotes if present. Sec-CH-UA-* enum
 * headers all use the quoted-string form (`"macOS"`, `"arm"`, `"64"`).
 */
function unquoteHeader(s: string | null): string {
  if (s === null) return "";
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) {
    return s.slice(1, -1);
  }
  return s;
}

/**
 * Parse a Sec-CH-UA brand-list header into `[{brand, version}, ...]`.
 * Mirrors the parser in `@mochi.js/core/src/session.ts` byte-for-byte.
 */
function parseBrandList(s: string): BrandEntry[] {
  const out: BrandEntry[] = [];
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
    const semi = piece.indexOf(";");
    if (semi === -1) {
      out.push({ brand: unquoteHeader(piece), version: "" });
      continue;
    }
    const brandPart = piece.slice(0, semi).trim();
    const rest = piece.slice(semi + 1).trim();
    let version = "";
    if (rest.startsWith("v=")) {
      version = unquoteHeader(rest.slice(2).trim());
    }
    out.push({ brand: unquoteHeader(brandPart), version });
  }
  return out;
}
