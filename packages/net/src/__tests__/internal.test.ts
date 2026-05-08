/**
 * Live-FFI integration test for `@mochi.js/net`.
 *
 * Skipped unless `MOCHI_NET_E2E=1`. Requires:
 *   - `cargo build --release --manifest-path packages/net-rs/Cargo.toml`
 *     to have produced `target/release/libmochi_net.<suffix>`.
 *   - Network access for the `Session.fetch` smoke (httpbin / nghttp2 echo).
 *
 * The JA4 contract — pinning the actual fingerprint hash returned by
 * `tls.peet.ws/api/all` for our preset — lives in
 * `tests/contract/net-ja4.contract.test.ts` (also gated by the same env
 * flag).
 */

import { describe, expect, it } from "bun:test";
import { fetch as mochiFetch, nativeVersion, openCtx, requestOnCtx } from "../index";

const E2E = process.env.MOCHI_NET_E2E === "1";

(E2E ? describe : describe.skip)("@mochi.js/net live FFI", () => {
  it("nativeVersion reports a semver string", () => {
    expect(nativeVersion()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("opens a Ctx and closes it idempotently", () => {
    const ctx = openCtx({ preset: "chrome_131_macos" });
    expect(ctx.handle).toBeTruthy();
    ctx.close();
    ctx.close(); // idempotent
  });

  it("fetches a 200 from a public HTTP/2 endpoint and decodes JSON", async () => {
    const res = await mochiFetch("https://www.cloudflare.com/cdn-cgi/trace", {
      preset: "chrome_131_macos",
      timeoutMs: 20_000,
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text.length).toBeGreaterThan(10);
    expect(text).toMatch(/uag=/);
  }, 30_000);

  it("reuses a Ctx across multiple requests", async () => {
    const ctx = openCtx({ preset: "chrome_131_macos" });
    try {
      const r1 = requestOnCtx(ctx, "https://www.cloudflare.com/cdn-cgi/trace", {
        preset: "chrome_131_macos",
      });
      expect(r1.status).toBe(200);
      const r2 = requestOnCtx(ctx, "https://www.cloudflare.com/cdn-cgi/trace", {
        preset: "chrome_131_macos",
      });
      expect(r2.status).toBe(200);
    } finally {
      ctx.close();
    }
  }, 30_000);

  it("propagates wreq error as a thrown Error", async () => {
    await expect(
      mochiFetch("https://this-domain-definitely-does-not-resolve-mochi-net.invalid", {
        preset: "chrome_131_macos",
        timeoutMs: 3_000,
      }),
    ).rejects.toThrow(/mochi_net_request failed/);
  }, 10_000);

  it("forwards request headers to the wire", async () => {
    const res = await mochiFetch("https://httpbin.org/headers", {
      preset: "chrome_131_macos",
      headers: { "x-mochi-test": "phase-0.6" },
      timeoutMs: 20_000,
    });
    expect(res.status).toBe(200);
    const data = (await res.json()) as { headers: Record<string, string> };
    expect(data.headers["X-Mochi-Test"] ?? data.headers["x-mochi-test"]).toBe("phase-0.6");
  }, 30_000);
});
