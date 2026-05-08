/**
 * Proxy authentication via CDP `Fetch.authRequired`.
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
 * The CDP path is invariant-clean: enable `Fetch` with `handleAuthRequests`
 * and *empty* request patterns. Chromium fires `Fetch.authRequired` ONLY for
 * proxy auth challenges; regular request flow is unaffected (no
 * `Fetch.requestPaused` events when patterns is `[]`). We answer with
 * `Fetch.continueWithAuth` carrying the parsed credentials.
 *
 * PLAN.md §8.2 invariant check
 * ----------------------------
 * `Fetch.enable` is NOT on the forbidden list. Only `Runtime.enable`
 * (leaks execution-context-created events to page-observable side
 * channels) and `Page.createIsolatedWorld` (creates a fingerprintable
 * isolated world) are forbidden. `Fetch.enable` operates at the network
 * layer below page script — it does not produce execution-context-creation
 * events, does not surface a `chrome.devtools` global, and is not
 * detectable from page JavaScript. The defensive `Fetch.requestPaused`
 * handler below is unreachable when `patterns: []` is set, but registered
 * as belt-and-braces in case a Chromium quirk triggers a pause.
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
 */

import type { MessageRouter, Unsubscribe } from "./cdp/router";

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
 * Wire proxy-auth handling into a {@link MessageRouter}. No-op when
 * `auth` is undefined — saves the `Fetch.enable` round-trip and avoids
 * any protocol surface for sessions that don't need it.
 *
 * Behavior:
 *   - Sends `Fetch.enable { handleAuthRequests: true, patterns: [] }` once.
 *   - On `Fetch.authRequired`, replies with `Fetch.continueWithAuth` and
 *     the parsed creds.
 *   - On `Fetch.requestPaused` (defensive — should never fire with empty
 *     patterns), forwards `Fetch.continueRequest` so we don't hang.
 *
 * The empty `patterns` array is critical: any non-empty patterns turn
 * Chromium into an interception proxy for matching requests, which tanks
 * page perf and changes the network model. Empty patterns +
 * `handleAuthRequests: true` is the documented contract for "auth-only
 * interception".
 */
export async function installProxyAuth(
  router: MessageRouter,
  auth: { username: string; password: string },
): Promise<ProxyAuthHandle> {
  // Subscribe FIRST so we don't miss the very first authRequired event the
  // browser fires after Fetch.enable.
  const offAuth: Unsubscribe = router.on("Fetch.authRequired", (params) => {
    const requestId = (params as { requestId?: string } | null)?.requestId;
    if (typeof requestId !== "string") return;
    // Fire-and-forget — failures here are non-fatal (the request will
    // simply 407 and the page-level fetch will see it). We log on
    // unexpected errors so users can diagnose creds issues.
    router
      .send("Fetch.continueWithAuth", {
        requestId,
        authChallengeResponse: {
          response: "ProvideCredentials",
          username: auth.username,
          password: auth.password,
        },
      })
      .catch((err: unknown) => {
        if (!isClosedError(err)) {
          console.warn("[mochi] Fetch.continueWithAuth failed:", err);
        }
      });
  });

  // Defensive — `patterns: []` means this event should never fire, but
  // some Chromium builds may pause requests adjacent to auth challenges.
  // If it ever fires, immediately continue so we don't hang the request.
  const offPaused: Unsubscribe = router.on("Fetch.requestPaused", (params) => {
    const requestId = (params as { requestId?: string } | null)?.requestId;
    if (typeof requestId !== "string") return;
    router.send("Fetch.continueRequest", { requestId }).catch((err: unknown) => {
      if (!isClosedError(err)) {
        console.warn("[mochi] Fetch.continueRequest (defensive) failed:", err);
      }
    });
  });

  await router.send("Fetch.enable", {
    handleAuthRequests: true,
    patterns: [],
  });

  let disposed = false;
  return {
    async dispose(): Promise<void> {
      if (disposed) return;
      disposed = true;
      offAuth();
      offPaused();
      try {
        await router.send("Fetch.disable");
      } catch (err) {
        // Closed-pipe failures are expected during session teardown.
        if (!isClosedError(err)) {
          console.warn("[mochi] Fetch.disable failed:", err);
        }
      }
    },
  };
}

/** True when an error reflects the transport already being closed. */
function isClosedError(err: unknown): boolean {
  if (err instanceof Error) {
    return (
      err.name === "BrowserCrashedError" ||
      /transport already closed|pipe closed|browser process exited/i.test(err.message)
    );
  }
  return false;
}
