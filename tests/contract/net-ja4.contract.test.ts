/**
 * Phase 0.6 gate — `Session.fetch` against `tls.peet.ws/api/all` returns a
 * profile-fingerprinted TLS handshake.
 *
 * The peet endpoint reflects back the JA3/JA4 hashes it computed from the
 * incoming ClientHello. We assert two things:
 *
 *   1. The request actually went out via wreq (the response is well-formed
 *      and contains a JA4 string).
 *   2. The JA4 hash matches the value we pin for the configured preset.
 *
 * ### JA4 pin policy (per task brief §Implementation notes)
 *
 * `wreq` fingerprints depend on:
 *   - the wreq version pin (`5.3.0` at time of writing — see `Cargo.toml`),
 *   - the BoringSSL version `wreq` is linked against,
 *   - the per-preset `EmulationProvider` config in our crate
 *     (`packages/net-rs/src/ffi/preset.rs`).
 *
 * v0.6 ships a *minimal* in-tree EmulationProvider — see preset.rs's module
 * docstring for why we don't use `wreq-util::Emulation::Chrome131` (GPL-3.0
 * incompatible with PLAN.md I-2). The emitted JA4 is therefore wreq's
 * default-EmulationProvider fingerprint, NOT a per-version Chrome JA4. We
 * pin the actual observed value here; replacing this pin requires the
 * orchestrator to authorise either an Apache-licensed Chrome profile catalog
 * or a relicensed wreq-util.
 *
 * If `EXPECTED_JA4` is null the test treats the run as "discovery mode":
 * it logs the observed JA4 and asserts only the structural shape. Set
 * `MOCHI_NET_PIN_JA4=<value>` to seed the pin from a one-off run.
 *
 * Runs only with `MOCHI_NET_E2E=1` (network gate).
 */

import { afterAll, describe, expect, it } from "bun:test";
import { fetch as mochiFetch, openCtx, requestOnCtx } from "../../packages/net/src/index";

const E2E = process.env.MOCHI_NET_E2E === "1";

/**
 * Pinned JA4_R for the default `EmulationProvider` used by our v0.6 Chrome
 * preset. Value observed against tls.peet.ws on 2026-05-08 with wreq 5.3.0
 * + BoringSSL bundled by wreq + our minimal in-tree EmulationProvider.
 *
 * If this pin breaks on a future bump, run with MOCHI_NET_PIN_JA4=<new>
 * (env override below) to confirm the new value, then update this constant.
 *
 * Update this constant if the underlying wreq + BoringSSL combo
 * intentionally changes — phase 0.7+ may swap to a richer EmulationProvider
 * (relicensed catalog) at which point this pin will move to a Chrome-shaped
 * value.
 */
const EXPECTED_JA4_R: string | null =
  process.env.MOCHI_NET_PIN_JA4 ??
  "t13d2812h2_002f,0033,0035,0039,003c,003d,0067,006b,009c,009d,009e,009f,1301,1302,1303,c009,c00a,c013,c014,c023,c024,c028,c02b,c02c,c02f,c030,cca8,cca9_000a,000b,000d,0017,0023,002b,002d,0033,ff01_0403,0804,0401,0503,0805,0501,0806,0601,0201";

interface PeetResponse {
  readonly tls: {
    readonly ja3?: string;
    readonly ja3_hash?: string;
    readonly ja4?: string;
    readonly ja4_r?: string;
  };
  readonly http_version?: string;
  readonly user_agent?: string;
}

(E2E ? describe : describe.skip)(
  "phase 0.6 gate — Session.fetch wire fingerprint via tls.peet.ws",
  () => {
    let observed: PeetResponse | undefined;

    it("fetches /api/all and returns a Web Response with TLS reflection", async () => {
      const res = await mochiFetch("https://tls.peet.ws/api/all", {
        preset: "chrome_131_macos",
        timeoutMs: 20_000,
      });
      expect(res.status).toBe(200);
      const data = (await res.json()) as PeetResponse;
      observed = data;

      expect(data.tls).toBeDefined();
      // Both JA4 and the raw JA4_R must be present — peet always returns
      // them when TLS was negotiated. If absent, wreq used a non-TLS
      // transport, which would be a hard regression.
      expect(typeof data.tls.ja4).toBe("string");
      expect(typeof data.tls.ja4_r).toBe("string");
      expect((data.tls.ja4 ?? "").length).toBeGreaterThan(0);
      expect((data.tls.ja4_r ?? "").length).toBeGreaterThan(0);
    }, 30_000);

    it("Ctx reuse produces the same fingerprint on repeat requests", async () => {
      const ctx = openCtx({ preset: "chrome_131_macos" });
      try {
        const r1 = requestOnCtx(ctx, "https://tls.peet.ws/api/all", {
          preset: "chrome_131_macos",
        });
        const r2 = requestOnCtx(ctx, "https://tls.peet.ws/api/all", {
          preset: "chrome_131_macos",
        });
        const j1 = (await r1.json()) as PeetResponse;
        const j2 = (await r2.json()) as PeetResponse;
        expect(j2.tls.ja4_r).toBe(j1.tls.ja4_r ?? "");
      } finally {
        ctx.close();
      }
    }, 60_000);

    it("matches the pinned JA4_R (or logs for discovery)", () => {
      if (observed === undefined) {
        throw new Error("preceding test did not populate observed");
      }
      const ja4r = observed.tls.ja4_r ?? "";
      const ja4 = observed.tls.ja4 ?? "";
      // biome-ignore lint/suspicious/noConsole: phase-0.6 diagnostic — reports the actual JA4 wreq emitted
      console.log(
        `[mochi-net] tls.peet.ws JA4=${ja4} JA4_R=${ja4r} ` +
          `http=${observed.http_version ?? "?"} ua="${observed.user_agent ?? "?"}"`,
      );
      if (EXPECTED_JA4_R === null) {
        // Discovery mode — only assert structural shape.
        expect(ja4r).toMatch(/^t1[0-9d]_/);
      } else {
        expect(ja4r).toBe(EXPECTED_JA4_R);
      }
    });

    afterAll(() => {
      if (observed !== undefined && EXPECTED_JA4_R === null) {
        // biome-ignore lint/suspicious/noConsole: phase-0.6 discovery hint
        console.log(
          "[mochi-net] discovery mode: pin this value into EXPECTED_JA4_R " +
            "(set MOCHI_NET_PIN_JA4 in CI to seed) once stable: " +
            `ja4_r=${observed.tls.ja4_r ?? ""}`,
        );
      }
    });
  },
);
