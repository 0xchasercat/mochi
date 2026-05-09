/**
 * Contract test for `mochi.connect` over a WebSocket CDP endpoint.
 *
 * Stands up a minimal in-process CDP WebSocket server via Bun.serve's
 * `.upgrade()` handler — the server speaks the JSON-RPC subset
 * `MessageRouter` exercises (request/response correlation, no events
 * needed for this contract). Verifies:
 *
 *   1. `mochi.connect({ wsEndpoint, profile: null })` resolves a Session
 *      whose router routes a `Browser.getVersion` call to the WebSocket
 *      and returns the server's response.
 *   2. `session.close()` disconnects the WebSocket without throwing AND
 *      WITHOUT killing the server (the server keeps accepting new
 *      connections after close).
 *   3. The `browserURL` discovery path (`/json/version`) resolves a
 *      direct HTTP base into a working WebSocket URL.
 *   4. Validation: `mochi.connect({})` rejects with a clear error.
 *
 * No real Chromium is spawned; the test runs in CI / offline.
 *
 * @see ../../packages/core/src/connect.ts
 * @see ../../packages/core/src/cdp/transport-ws.ts
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { Server, ServerWebSocket } from "bun";
import { connect } from "../../packages/core/src/connect";

interface ServerHandle {
  server: Server;
  port: number;
  /** All in-flight client sockets — used to broadcast or assert connect counts. */
  sockets: Set<ServerWebSocket<unknown>>;
  /** How many times the server received a `Browser.getVersion` call. */
  browserGetVersionCount: number;
  stop(): Promise<void>;
}

/**
 * Spin up a minimal CDP-over-WebSocket server. Responds to:
 *
 *   - `Browser.getVersion` → a synthetic version blob.
 *   - everything else      → CDP error `-32601 method not found`.
 *
 * Also exposes an HTTP `/json/version` route so the `browserURL`
 * discovery path can be exercised end-to-end.
 */
function startCdpServer(): ServerHandle {
  const handle: Partial<ServerHandle> & {
    sockets: Set<ServerWebSocket<unknown>>;
    browserGetVersionCount: number;
  } = {
    sockets: new Set(),
    browserGetVersionCount: 0,
  };
  const server = Bun.serve({
    port: 0,
    fetch(req, srv) {
      const url = new URL(req.url);
      if (url.pathname === "/json/version") {
        const wsUrl = `ws://localhost:${srv.port}/devtools/browser/test-fixture-id`;
        return new Response(
          JSON.stringify({
            Browser: "Chrome/contract-test",
            "Protocol-Version": "1.3",
            webSocketDebuggerUrl: wsUrl,
          }),
          { headers: { "content-type": "application/json" } },
        );
      }
      // Otherwise upgrade if WebSocket; else 404.
      const upgraded = srv.upgrade(req);
      if (upgraded) return undefined;
      return new Response("not found", { status: 404 });
    },
    websocket: {
      open(ws) {
        handle.sockets.add(ws);
      },
      close(ws) {
        handle.sockets.delete(ws);
      },
      message(ws, raw) {
        if (typeof raw !== "string") return;
        let parsed: { id?: number; method?: string; params?: unknown };
        try {
          parsed = JSON.parse(raw) as typeof parsed;
        } catch {
          return;
        }
        if (typeof parsed.id !== "number" || typeof parsed.method !== "string") return;
        const id = parsed.id;
        if (parsed.method === "Browser.getVersion") {
          handle.browserGetVersionCount += 1;
          ws.send(
            JSON.stringify({
              id,
              result: {
                protocolVersion: "1.3",
                product: "Chrome/contract-test",
                revision: "@deadbeef",
                userAgent:
                  "Mozilla/5.0 (Test Fixture) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/0.0.0.0 Safari/537.36",
                jsVersion: "12.0.0",
              },
            }),
          );
          return;
        }
        ws.send(
          JSON.stringify({
            id,
            error: { code: -32601, message: `method not found: ${parsed.method}` },
          }),
        );
      },
    },
  });

  handle.server = server;
  handle.port = server.port;
  handle.stop = async () => {
    for (const sock of handle.sockets) {
      try {
        sock.close();
      } catch {
        // ignore
      }
    }
    handle.sockets.clear();
    server.stop(true);
  };
  return handle as ServerHandle;
}

describe("contract: mochi.connect over WebSocket transport", () => {
  let handle: ServerHandle;

  beforeEach(() => {
    handle = startCdpServer();
  });
  afterEach(async () => {
    await handle.stop();
  });

  it("connects, routes Browser.getVersion, and closes the WS without error", async () => {
    const wsEndpoint = `ws://localhost:${handle.port}/devtools/browser/test-fixture-id`;
    const session = await connect({ wsEndpoint, profile: null });

    // Profile null → no spoof: profile field surfaces null.
    expect(session.profile).toBeNull();
    // Borrowed (connect-mode) sessions are NOT owned.
    expect(session.owned).toBe(false);

    // Drive a real CDP roundtrip through the transport.
    const router = session._internalRouter();
    const result = await router.send<{ product: string; userAgent: string }>("Browser.getVersion");
    expect(result.product).toBe("Chrome/contract-test");
    expect(result.userAgent).toContain("Test Fixture");
    expect(handle.browserGetVersionCount).toBe(1);

    // close() disconnects the WS but doesn't error and doesn't take down the server.
    await session.close();
    // Server is still up: accept a fresh connection after close.
    const second = await connect({ wsEndpoint, profile: null });
    try {
      const r2 = await second._internalRouter().send<{ product: string }>("Browser.getVersion");
      expect(r2.product).toBe("Chrome/contract-test");
      expect(handle.browserGetVersionCount).toBe(2);
    } finally {
      await second.close();
    }
  }, 10_000);

  it("resolves browserURL via /json/version and connects to the WS it advertises", async () => {
    const browserURL = `http://localhost:${handle.port}`;
    const session = await connect({ browserURL, profile: null });
    try {
      const result = await session
        ._internalRouter()
        .send<{ product: string }>("Browser.getVersion");
      expect(result.product).toBe("Chrome/contract-test");
    } finally {
      await session.close();
    }
  }, 10_000);

  it("rejects when neither wsEndpoint nor browserURL is supplied", async () => {
    let err: Error | undefined;
    try {
      await connect({ profile: null });
    } catch (e) {
      err = e as Error;
    }
    expect(err).toBeDefined();
    expect(err?.message).toContain("wsEndpoint");
    expect(err?.message).toContain("browserURL");
  });

  it("rejects when browserURL fetch fails (no /json/version)", async () => {
    // Point at a port where nothing is listening.
    const browserURL = "http://localhost:1"; // privileged-port, no server
    let err: Error | undefined;
    try {
      await connect({ browserURL, profile: null });
    } catch (e) {
      err = e as Error;
    }
    expect(err).toBeDefined();
    expect(err?.message).toContain("/json/version");
  });

  it("requires `seed` when a profile is set", async () => {
    const wsEndpoint = `ws://localhost:${handle.port}/devtools/browser/test-fixture-id`;
    let err: Error | undefined;
    try {
      await connect({ wsEndpoint, profile: "linux-chrome-stable" });
    } catch (e) {
      err = e as Error;
    }
    expect(err).toBeDefined();
    expect(err?.message).toContain("seed");
  });

  it("requires an explicit profile (undefined → throws, since auto-pick is meaningless for a remote browser)", async () => {
    const wsEndpoint = `ws://localhost:${handle.port}/devtools/browser/test-fixture-id`;
    let err: Error | undefined;
    try {
      // `profile` is intentionally omitted to drive the validation path.
      await connect({ wsEndpoint });
    } catch (e) {
      err = e as Error;
    }
    expect(err).toBeDefined();
    expect(err?.message).toMatch(/profile.*required/i);
  });
});
