/**
 * Unit tests for `parseProxyUrl` + `installProxyAuth`.
 *
 * `parseProxyUrl`: pure function — exercises HTTP/HTTPS/SOCKS5/SOCKS4 ×
 * with-auth/no-auth × edge cases (missing port, IPv6 host, percent-encoded
 * creds, empty password).
 *
 * `installProxyAuth`: drives a fake CDP router via the shared
 * `tests/helpers/cdp-fixture.ts` helper. Verifies:
 *   - `Fetch.enable` is sent with `handleAuthRequests: true, patterns: [{ urlPattern: "*" }]`.
 *   - `Fetch.authRequired` events trigger `Fetch.continueWithAuth` carrying
 *     the configured creds.
 *   - The defensive `Fetch.requestPaused` handler issues `Fetch.continueRequest`.
 *   - `dispose()` sends `Fetch.disable` and is idempotent.
 *
 */

import { describe, expect, it } from "bun:test";
import { type FakePipe, makeFakePipe } from "../../../../tests/helpers/cdp-fixture";
import { MessageRouter } from "../cdp/router";
import { installProxyAuth, parseProxyUrl } from "../proxy-auth";

describe("parseProxyUrl", () => {
  it("HTTP with user:pass — splits server + auth", () => {
    expect(parseProxyUrl("http://user:pass@host.example:8080")).toEqual({
      server: "http://host.example:8080",
      auth: { username: "user", password: "pass" },
      protocol: "http",
    });
  });

  it("HTTPS with user:pass", () => {
    expect(parseProxyUrl("https://u:p@proxy.tld:443")).toEqual({
      server: "https://proxy.tld:443",
      auth: { username: "u", password: "p" },
      protocol: "https",
    });
  });

  it("SOCKS5 with user:pass", () => {
    expect(parseProxyUrl("socks5://u:p@socks.example:1080")).toEqual({
      server: "socks5://socks.example:1080",
      auth: { username: "u", password: "p" },
      protocol: "socks5",
    });
  });

  it("SOCKS4 with user (no pass) — password is empty string, not undefined", () => {
    expect(parseProxyUrl("socks4://lone@socks.example:1080")).toEqual({
      server: "socks4://socks.example:1080",
      auth: { username: "lone", password: "" },
      protocol: "socks4",
    });
  });

  it("SOCKS5 with user only — empty password", () => {
    expect(parseProxyUrl("socks5://lone@socks.example:1080")).toEqual({
      server: "socks5://socks.example:1080",
      auth: { username: "lone", password: "" },
      protocol: "socks5",
    });
  });

  it("HTTP with no auth — auth is undefined", () => {
    const out = parseProxyUrl("http://host.example:8080");
    expect(out.server).toBe("http://host.example:8080");
    expect(out.auth).toBeUndefined();
    expect(out.protocol).toBe("http");
  });

  it("percent-encoded creds round-trip decoded", () => {
    expect(parseProxyUrl("http://user%40domain:p%40ss@host.example:8080")).toEqual({
      server: "http://host.example:8080",
      auth: { username: "user@domain", password: "p@ss" },
      protocol: "http",
    });
  });

  it("colon in encoded password decodes", () => {
    expect(parseProxyUrl("http://u:p%3Aass@host:8080")).toEqual({
      server: "http://host:8080",
      auth: { username: "u", password: "p:ass" },
      protocol: "http",
    });
  });

  it("IPv6 host with brackets — preserved in server URL", () => {
    expect(parseProxyUrl("http://user:pass@[::1]:8080")).toEqual({
      server: "http://[::1]:8080",
      auth: { username: "user", password: "pass" },
      protocol: "http",
    });
  });

  it("IPv6 host without auth", () => {
    const out = parseProxyUrl("http://[2001:db8::1]:8080");
    expect(out.server).toBe("http://[2001:db8::1]:8080");
    expect(out.auth).toBeUndefined();
  });

  it("missing port — applies protocol default (HTTP=80)", () => {
    expect(parseProxyUrl("http://host.example").server).toBe("http://host.example:80");
  });

  it("missing port — applies protocol default (HTTPS=443)", () => {
    expect(parseProxyUrl("https://host.example").server).toBe("https://host.example:443");
  });

  it("missing port — applies protocol default (SOCKS5=1080)", () => {
    expect(parseProxyUrl("socks5://host.example").server).toBe("socks5://host.example:1080");
  });

  it("missing port — applies protocol default (SOCKS4=1080)", () => {
    expect(parseProxyUrl("socks4://host.example").server).toBe("socks4://host.example:1080");
  });

  it("rejects unsupported protocol", () => {
    expect(() => parseProxyUrl("ftp://host:21")).toThrow(/unsupported proxy protocol/);
  });

  it("rejects malformed URL", () => {
    expect(() => parseProxyUrl("not a url")).toThrow(/invalid proxy URL/);
  });

  it("uppercase protocol normalizes to lowercase", () => {
    expect(parseProxyUrl("HTTP://host.example:8080").protocol).toBe("http");
  });
});

// ---- installProxyAuth -------------------------------------------------------

interface FakeRouter {
  router: MessageRouter;
  pipe: FakePipe;
  pushEvent(method: string, params: unknown): void;
}

function makeRouter(): FakeRouter {
  // Default responders auto-answer Fetch.enable / Fetch.disable / etc with
  // `{}` — that's everything `installProxyAuth` waits on.
  const pipe = makeFakePipe();
  const router = new MessageRouter(pipe.reader, pipe.writer);
  router.start();
  return {
    router,
    pipe,
    pushEvent(method: string, params: unknown): void {
      pipe.inject({ method, params });
    },
  };
}

describe("installProxyAuth", () => {
  it("sends Fetch.enable with handleAuthRequests:true and Document-first patterns", async () => {
    const f = makeRouter();
    const handle = await installProxyAuth(f.router, { username: "u", password: "p" });
    const enable = f.pipe.written.find((c) => c.parsed.method === "Fetch.enable");
    expect(enable).toBeDefined();
    expect(enable?.parsed.params).toEqual({
      handleAuthRequests: true,
      patterns: [{ urlPattern: "*", resourceType: "Document" }, { urlPattern: "*" }],
    });
    await handle.dispose();
    await f.router.close();
  });

  it("answers Fetch.authRequired with Fetch.continueWithAuth(ProvideCredentials)", async () => {
    const f = makeRouter();
    const handle = await installProxyAuth(f.router, { username: "alice", password: "s3cret" });
    f.pushEvent("Fetch.authRequired", { requestId: "req-42", authChallenge: { source: "Proxy" } });
    // Allow microtasks + the writer push to flush.
    await new Promise((r) => setTimeout(r, 10));
    const reply = f.pipe.written.find((c) => c.parsed.method === "Fetch.continueWithAuth");
    expect(reply).toBeDefined();
    expect(reply?.parsed.params).toEqual({
      requestId: "req-42",
      authChallengeResponse: {
        response: "ProvideCredentials",
        username: "alice",
        password: "s3cret",
      },
    });
    await handle.dispose();
    await f.router.close();
  });

  it("forwards Fetch.requestPaused via Fetch.continueRequest (defensive handler)", async () => {
    const f = makeRouter();
    const handle = await installProxyAuth(f.router, { username: "u", password: "p" });
    f.pushEvent("Fetch.requestPaused", { requestId: "rp-1" });
    await new Promise((r) => setTimeout(r, 10));
    const reply = f.pipe.written.find((c) => c.parsed.method === "Fetch.continueRequest");
    expect(reply).toBeDefined();
    expect(reply?.parsed.params).toEqual({ requestId: "rp-1" });
    await handle.dispose();
    await f.router.close();
  });

  it("dispose() sends Fetch.disable and is idempotent", async () => {
    const f = makeRouter();
    const handle = await installProxyAuth(f.router, { username: "u", password: "p" });
    await handle.dispose();
    await handle.dispose();
    const disables = f.pipe.written.filter((c) => c.parsed.method === "Fetch.disable");
    expect(disables.length).toBe(1);
    await f.router.close();
  });

  it("after dispose, further authRequired events do not produce continueWithAuth", async () => {
    const f = makeRouter();
    const handle = await installProxyAuth(f.router, { username: "u", password: "p" });
    await handle.dispose();
    f.pushEvent("Fetch.authRequired", { requestId: "late" });
    await new Promise((r) => setTimeout(r, 10));
    const replies = f.pipe.written.filter((c) => c.parsed.method === "Fetch.continueWithAuth");
    expect(replies.length).toBe(0);
    await f.router.close();
  });
});
