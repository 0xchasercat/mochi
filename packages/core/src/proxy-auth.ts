/**
 * Proxy URL parsing helpers + (legacy) `Fetch.authRequired` installer.
 *
 * Background
 * ----------
 * Chromium's `--proxy-server=` flag accepts the address but rejects inline
 * credentials in the URL — `--proxy-server=http://user:pass@host:8080` is
 * silently stripped. The historical "proxy-auth-extension" workaround ships
 * a tiny chrome-extension that subscribes to `chrome.webRequest.onAuthRequired`,
 * but `--load-extension` is itself a fingerprint leak (chrome.runtime
 * weirdness, observable extension ids) and so is forbidden by mochi's
 * stealth invariants.
 *
 * Task 0266 unifies proxy auth + init-script delivery under a single
 * `Fetch.enable` call (see {@link installInitInjector} in
 * `cdp/init-injector.ts`). `Session` now installs ONE Fetch handler that
 * owns BOTH the document-body splice (for the inject payload) AND
 * `Fetch.authRequired` answering (when proxy creds are present). The
 * legacy {@link installProxyAuth} export below is preserved as a thin
 * delegating wrapper for any out-of-tree caller still wiring it directly,
 * but the session no longer uses it.
 *
 * PLAN.md §8.2 invariant check
 * ----------------------------
 * `Fetch.enable` is NOT on the forbidden list. Only `Runtime.enable`
 * (leaks execution-context-created events to page-observable side
 * channels) and `Page.createIsolatedWorld` (creates a fingerprintable
 * isolated world) are forbidden. `Fetch.enable` operates at the network
 * layer below page script — it does not produce execution-context-creation
 * events, does not surface a `chrome.devtools` global, and is not
 * detectable from page JavaScript.
 *
 * Protocols
 * ---------
 * Chromium surfaces both HTTP and SOCKS5 auth challenges through the same
 * `Fetch.authRequired` event. SOCKS5 user/pass auth happens at the SOCKS
 * handshake (before any HTTP request) but Chromium wraps it as an
 * `authRequired` for the first request through the proxy, so the same
 * handler covers both.
 *
 * @see PLAN.md §8.2 / §10
 * @see tasks/0160-proxy-auth-and-ci-fix.md
 * @see tasks/0266-fetch-fulfill-init-script.md
 */

import { installInitInjector } from "./cdp/init-injector";
import type { MessageRouter } from "./cdp/router";

/** Parsed proxy URL — what `parseProxyUrl` returns. */
export interface ParsedProxy {
  /**
   * The auth-stripped server URL safe to pass to Chromium's
   * `--proxy-server=` flag. Format: `<protocol>//<host>:<port>`.
   */
  server: string;
  /**
   * Decoded credentials, present only when the input URL carried a
   * `user[:pass]@` segment. `password` is `""` (empty string) when the
   * URL had a username but no password (`http://user@host:8080`).
   */
  auth?: { username: string; password: string };
  /** Lowercased protocol (`http`, `https`, `socks5`, `socks4`). */
  protocol: "http" | "https" | "socks5" | "socks4";
}

/** Default ports used when the input URL omits one. */
const DEFAULT_PORTS: Record<string, string> = {
  http: "80",
  https: "443",
  socks5: "1080",
  socks4: "1080",
};

/**
 * Parse a proxy URL string into `{ server, auth?, protocol }`.
 *
 * Handles:
 *   - `http://user:pass@host:port`      → auth + server
 *   - `socks5://user@host:1080`         → auth.password = ""
 *   - `http://host:8080`                → no auth
 *   - `http://user%40d:p%40ss@host:80`  → percent-decoded credentials
 *   - `http://user:pass@[::1]:8080`     → IPv6 hosts (URL parser handles)
 *   - `http://host`                     → port defaults per protocol
 *
 * Implementation uses `new URL()` so percent-decoding and IPv6 host
 * bracketing are handled natively.
 */
export function parseProxyUrl(input: string): ParsedProxy {
  let url: URL;
  try {
    url = new URL(input);
  } catch (err) {
    throw new Error(
      `[mochi] invalid proxy URL ${JSON.stringify(input)}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const rawProto = url.protocol.replace(/:$/, "").toLowerCase();
  if (
    rawProto !== "http" &&
    rawProto !== "https" &&
    rawProto !== "socks5" &&
    rawProto !== "socks4"
  ) {
    throw new Error(
      `[mochi] unsupported proxy protocol ${JSON.stringify(rawProto)} — supported: http, https, socks5, socks4`,
    );
  }
  const protocol = rawProto;
  // `URL.hostname` may keep or strip IPv6 brackets depending on the
  // runtime — normalize to a single `[…]`-bracketed form so we can format
  // the server URL deterministically.
  const rawHost = url.hostname;
  const stripped =
    rawHost.startsWith("[") && rawHost.endsWith("]") ? rawHost.slice(1, -1) : rawHost;
  const isIpv6 = stripped.includes(":");
  const host = isIpv6 ? `[${stripped}]` : stripped;
  const port = url.port.length > 0 ? url.port : DEFAULT_PORTS[protocol];
  if (host.length === 0) {
    throw new Error(`[mochi] proxy URL ${JSON.stringify(input)} is missing a host`);
  }
  const server = `${protocol}://${host}:${port}`;

  // `URL.username`/`URL.password` are already percent-decoded.
  if (url.username.length > 0) {
    return {
      server,
      auth: {
        username: decodeURIComponent(url.username),
        password: url.password.length > 0 ? decodeURIComponent(url.password) : "",
      },
      protocol,
    };
  }
  return { server, protocol };
}

/**
 * Result of {@link installProxyAuth}: an unsubscriber that removes the
 * router listeners and disables the Fetch domain. Idempotent.
 */
export interface ProxyAuthHandle {
  /** Tear down the listeners + send `Fetch.disable`. Idempotent. */
  dispose(): Promise<void>;
}

/**
 * Wire proxy-auth handling into a {@link MessageRouter}. Thin compatibility
 * shim — delegates to {@link installInitInjector} with `payloadCode: null`
 * so the proxy-auth-only call path still works for any out-of-tree caller.
 *
 * The Session no longer uses this directly (task 0266); proxy auth and
 * init-script delivery share a single `Fetch.enable` owner.
 *
 * Behavior (unchanged contract):
 *   - Sends `Fetch.enable { handleAuthRequests: true, patterns: [{
 *     urlPattern: "*", resourceType: "Document" }, { urlPattern: "*" }] }`.
 *   - On `Fetch.authRequired`, replies with `Fetch.continueWithAuth` and
 *     the parsed creds.
 *   - On `Fetch.requestPaused`, forwards `Fetch.continueRequest`
 *     immediately (no body splice when `payloadCode` is null).
 *
 * @deprecated Prefer {@link installInitInjector} directly. This wrapper is
 * preserved only for backward compatibility.
 */
export async function installProxyAuth(
  router: MessageRouter,
  auth: { username: string; password: string },
): Promise<ProxyAuthHandle> {
  const handle = await installInitInjector(router, { payloadCode: null, auth });
  return handle;
}
