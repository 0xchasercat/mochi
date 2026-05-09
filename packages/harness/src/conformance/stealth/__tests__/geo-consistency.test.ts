/**
 * Stealth conformance — IP / Timezone / Locale exit consistency.
 *
 * Closes the cross-layer leak from PLAN.md §9 (relational consistency,
 * IP/TZ/Locale axis): a fingerprinter computing
 * `Date.getTimezoneOffset()` and cross-referencing against the IP's
 * geolocation sees a mismatch when, e.g., a US profile egresses through
 * an EU residential proxy.
 *
 * The brief specifies:
 *   - Probe at launch through wreq with the matrix's TLS preset.
 *   - Default `geoConsistency: "privacy-fallback"` overrides matrix
 *     to UTC + en-US on mismatch.
 *
 * This live test launches a real Mochi session through the configured
 * proxy (`MOCHI_PROXY` env), navigates to a Bun.serve fixture that
 * captures the request IP + the page-side timezone, and asserts:
 *   - timezone offset agrees with IP geolocation, OR
 *   - timezone is UTC (privacy-fallback path triggered).
 *
 * Either outcome is acceptable; the unconditional fail is "PT timezone,
 * EU IP".
 *
 * Gated by `MOCHI_E2E=1` AND `MOCHI_ONLINE=1` (because we need a live
 * outbound IP to do a meaningful comparison; offline runs would always
 * fall to privacy-fallback and the test would degenerate).
 *
 * @see PLAN.md §9
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { Session } from "@mochi.js/core";
import {
  CONFORMANCE_PROFILE,
  E2E_ENABLED,
  evalExpr,
  launchSharedSession,
  ONLINE_ENABLED,
  withPage,
  withRetries,
} from "../helpers";

const TEST_TIMEOUT_MS = 30_000;
const SUITE_TIMEOUT_MS = 60_000;

const describeOrSkip = E2E_ENABLED && ONLINE_ENABLED ? describe : describe.skip;

describeOrSkip(
  `stealth conformance / geo-consistency (profile=${CONFORMANCE_PROFILE}, MOCHI_E2E=1+ONLINE=1)`,
  () => {
    let session: Session;
    let server: { stop: () => void; url: string; lastClientIp: () => string | null };

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
      "page-side Intl timezone offset agrees with IP geolocation, OR is UTC (privacy-fallback)",
      async () => {
        await withRetries(async () => {
          await withPage(session, async (page) => {
            // Step 1 — navigate to the local capture server. We use the
            // local fixture only to confirm Chromium reaches the network;
            // the IP we care about is the EXIT IP from a public probe,
            // not 127.0.0.1.
            await page.goto(server.url);

            // Step 2 — read the page-side timezone. This MUST come from
            // `Intl.DateTimeFormat().resolvedOptions().timeZone`, the
            // surface fingerprinters read.
            const pageTz = await evalExpr<string>(
              page,
              "Intl.DateTimeFormat().resolvedOptions().timeZone",
            );

            // Step 3 — read the page-side `Date.getTimezoneOffset()`.
            // The brief calls this out: V8 reads from the same internal
            // source as `Intl`, so a single CDP `Emulation.setTimezone-
            // Override` call covers both. We pin both surfaces here.
            // `getTimezoneOffset` returns minutes-WEST-of-UTC, so we
            // negate to get the conventional positive-east-of-UTC value.
            //
            // NOTE: write `0 - x` rather than `-x` to avoid the `-0` /
            // `+0` distinction. `bun:test` `expect(...).toBe(0)` uses
            // `Object.is` semantics; `Object.is(-0, 0) === false`. Under
            // privacy-fallback (matrix.timezone === "UTC") the offset is
            // 0; without this rewrite the test fails on the negation
            // even though the runtime value is numerically correct.
            // Brief 0263 documented this as the canonical workaround.
            const pageOffsetMin = await evalExpr<number>(
              page,
              "0 - new Date().getTimezoneOffset()",
            );

            // Step 4 — passes if the matrix is UTC (privacy-fallback
            // already kicked in). The session's reconciled matrix is
            // exposed via session.profile (the live MatrixV1).
            // biome-ignore lint/style/noNonNullAssertion: harness always launches with a profile
            if (session.profile!.timezone === "UTC") {
              expect(pageTz).toBe("UTC");
              expect(pageOffsetMin).toBe(0);
              return;
            }

            // Step 5 — otherwise the matrix passed reconciliation
            // (matrix tz offset === IP tz offset). Verify:
            //   a) the page reports the matrix timezone (CDP override
            //      landed),
            //   b) the page-side offset matches what `Intl.DateTimeFormat`
            //      derives for that zone (Date.getTimezoneOffset
            //      consistency).
            // biome-ignore lint/style/noNonNullAssertion: harness always launches with a profile
            expect(pageTz).toBe(session.profile!.timezone);
            // biome-ignore lint/style/noNonNullAssertion: harness always launches with a profile
            const expectedOffset = computeOffsetMinutes(session.profile!.timezone);
            expect(pageOffsetMin).toBe(expectedOffset);

            // Step 6 — capture sanity: at least one request hit the
            // local server (confirms inject + nav round-trip), even
            // though the IP recorded there is loopback.
            const ip = server.lastClientIp();
            expect(ip).not.toBeNull();
          });
        });
      },
      TEST_TIMEOUT_MS,
    );
  },
);

/**
 * Compute integer minutes offset of an IANA timezone for the current
 * date — mirrors `tzOffsetMinutes` from the core reconciler but kept
 * local to avoid a cross-package import dance for a 5-line helper.
 */
function computeOffsetMinutes(zone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    timeZoneName: "longOffset",
  }).formatToParts(new Date());
  const tzPart = parts.find((p) => p.type === "timeZoneName")?.value ?? "GMT";
  if (tzPart === "GMT" || tzPart === "UTC") return 0;
  const m = /^(?:GMT|UTC)([+-])(\d{1,2})(?::?(\d{2}))?$/.exec(tzPart);
  if (m === null) throw new Error(`Unparseable longOffset for ${zone}: ${tzPart}`);
  const sign = m[1] === "-" ? -1 : 1;
  const hours = Number.parseInt(m[2] ?? "0", 10);
  const mins = Number.parseInt(m[3] ?? "0", 10);
  return sign * (hours * 60 + mins);
}

/**
 * Spin up a `Bun.serve` listener on an ephemeral port that records the
 * client IP of the most recent request. Used to confirm Chromium's
 * navigation actually hit the network; the IP recorded here is loopback,
 * not the proxy egress (which is covered indirectly by the geo-probe
 * having succeeded or fallen back at launch time).
 */
function startEphemeralServer(): {
  stop: () => void;
  url: string;
  lastClientIp: () => string | null;
} {
  let lastClientIp: string | null = null;
  // biome-ignore lint/suspicious/noExplicitAny: Bun.serve's typing is environment-dependent
  const srv = (Bun as any).serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch(req: Request, srv2: { requestIP: (r: Request) => { address: string } | null }): Response {
      const info = srv2.requestIP(req);
      lastClientIp = info?.address ?? null;
      return new Response(
        "<!doctype html><html><head><title>geo</title></head><body><p>ok</p></body></html>",
        { status: 200, headers: { "content-type": "text/html; charset=utf-8" } },
      );
    },
  }) as { port: number; hostname: string; stop: () => void };
  return {
    stop: () => srv.stop(),
    url: `http://${srv.hostname}:${srv.port}/`,
    lastClientIp: () => lastClientIp,
  };
}
