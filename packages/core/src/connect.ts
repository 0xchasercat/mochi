/**
 * `mochi.connect()` — attach to a CDP browser endpoint mochi did NOT spawn.
 *
 * Mirrors `puppeteer.connect`'s shape: takes a WebSocket URL (or an HTTP
 * `browserURL` we resolve to a WS URL via `/json/version`) and returns a
 * `Session` wired to the existing browser. Use cases:
 *
 *   - BrowserBase / Browserless / any remote-CDP gateway.
 *   - Chromium running in a Docker container the user manages.
 *   - A patched Chrome the user wants mochi to drive.
 *   - Re-attaching to a Chromium that mochi (or another tool) launched
 *     earlier in the same session.
 *
 * The connect path supports the same `profile` semantics as `mochi.launch`:
 *
 *   - `profile: "id" | ProfileV1`  — derive a matrix, install the inject
 *     pipeline + CDP overrides on top of the remote browser.
 *   - `profile: null`              — no spoof at all; mochi just drives
 *     the browser through its API surface.
 *   - `profile: undefined`         — TypeScript-level invalid (the brief
 *     locks the contract: the auto-pick path is `launch`-only because it
 *     keys off the local `process.platform`, which is meaningless for a
 *     remote browser whose host OS we don't know).
 *
 * Lifecycle deviation from `launch`:
 *
 *   - Connect does NOT spawn a process. There's nothing to wait on.
 *   - `session.close()` disconnects the WebSocket but leaves the browser
 *     running, matching `puppeteer.connect`'s convention.
 *
 * @see ./launch.ts (sibling spawn-and-attach path)
 * @see ./cdp/transport-ws.ts (the WebSocket transport adapter)
 */

import { deriveMatrix, type ProfileV1 } from "@mochi.js/consistency";
import type { PipeReader, PipeWriter } from "./cdp/transport";
import {
  ConnectionLostError,
  connectWebSocketCdp,
  type WebSocketCdpAdapter,
} from "./cdp/transport-ws";
import type { GeoConsistencyMode } from "./geo-consistency";
import { type ChallengeLaunchOptions, type ProfileId, resolveProfileSource } from "./launch";
import { Session } from "./session";

/**
 * Options accepted by `mochi.connect`. Strict subset of `LaunchOptions`:
 * launch-only fields (`binary`, `headless`, `proxy`, `extraArgs`,
 * `hermetic`, `allowRootWithSandbox`, `bypassInject`) are deliberately
 * omitted — the browser is already running, the launcher's fingerprint
 * trade-offs don't apply.
 *
 * Pass either `wsEndpoint` (preferred — already the canonical CDP URL)
 * or `browserURL` (HTTP base — mochi fetches `${browserURL}/json/version`
 * to discover the WS URL). Supplying both with consistent values is
 * fine; supplying neither throws.
 */
export interface ConnectOptions {
  /**
   * Direct WebSocket URL of the CDP browser endpoint, e.g.
   * `ws://localhost:9222/devtools/browser/abcd-…`. Takes precedence
   * over {@link browserURL} when both are set.
   */
  wsEndpoint?: string;
  /**
   * Base HTTP URL of the browser, e.g. `http://localhost:9222`. When
   * set (and `wsEndpoint` is not), mochi GETs `${browserURL}/json/version`
   * and reads `webSocketDebuggerUrl` from the JSON response. This is
   * the same discovery dance Puppeteer / Playwright run.
   */
  browserURL?: string;
  /**
   * Same semantics as `LaunchOptions.profile`, plus `null` = no spoof.
   * Note that the `undefined` (auto-pick by host OS) branch is NOT
   * supported here: the host the remote browser runs on may not match
   * the local `process.platform`, so the auto-pick decision would be
   * wrong by construction. Pass an explicit profile (or `null`).
   */
  profile?: ProfileId | ProfileV1 | null;
  /**
   * Required when `profile` is set to a non-null value. Unused (and
   * warned-on) when `profile === null`.
   */
  seed?: string;
  /**
   * Same as `LaunchOptions.geoConsistency`. Defaults to
   * `"privacy-fallback"` when a profile is set; ignored under
   * `profile: null`.
   */
  geoConsistency?: GeoConsistencyMode;
  /**
   * Same as `LaunchOptions.challenges` — convenience auto-installation
   * of the Turnstile auto-click handler on every `newPage`.
   */
  challenges?: ChallengeLaunchOptions;
  /**
   * Optional extra HTTP headers for the WebSocket upgrade request,
   * e.g. `{ Authorization: "Bearer ..." }` for a proxied / authenticated
   * CDP gateway. Applied to the upgrade only; in-band CDP requests are
   * unaffected.
   */
  headers?: Record<string, string>;
  /**
   * Override the default per-CDP-request timeout (ms). Defaults to
   * 30_000 (matches `MessageRouter`'s default).
   */
  timeout?: number;
}

/** Shape of the JSON returned by `${browserURL}/json/version`. */
interface JsonVersionResponse {
  /** WebSocket URL of the browser endpoint, e.g. `ws://host:port/devtools/browser/<id>`. */
  webSocketDebuggerUrl?: string;
  /** Other fields are documented at https://chromedevtools.github.io/devtools-protocol/ — we don't read them. */
  [k: string]: unknown;
}

/**
 * Attach to a remote CDP browser and return a `Session`. The session
 * mirrors what `mochi.launch` returns — same `Page`, same `humanClick`,
 * same `cookies` jar, same lifecycle ergonomics — but `session.close()`
 * disconnects the WebSocket without killing the browser.
 *
 * @throws if neither `wsEndpoint` nor `browserURL` is set, if the WS
 *   upgrade fails, or if `browserURL` returns a malformed
 *   `/json/version` body.
 */
export async function connect(opts: ConnectOptions): Promise<Session> {
  if (
    (opts.wsEndpoint === undefined || opts.wsEndpoint.length === 0) &&
    (opts.browserURL === undefined || opts.browserURL.length === 0)
  ) {
    throw new Error(
      "[mochi] connect: pass either `wsEndpoint` (e.g. ws://host:9222/devtools/browser/<id>) " +
        "or `browserURL` (e.g. http://host:9222) so mochi can attach to the remote browser.",
    );
  }

  // Profile-side validation matches `launch.ts`: seed required when
  // profile is set; warn (don't throw) when null + seed is supplied.
  if (opts.profile === undefined) {
    throw new Error(
      "[mochi] connect: `profile` is required (string id, inline ProfileV1, or null for no-spoof). " +
        "The auto-pick path keys off the local OS, which is meaningless for a remote browser.",
    );
  }
  const profileSource = await resolveProfileSource(opts.profile);
  if (profileSource.profile !== null && (opts.seed === undefined || opts.seed.length === 0)) {
    throw new Error(
      "[mochi] connect: `seed` is required when `profile` is set " +
        "(string id or inline ProfileV1). Pass `profile: null` to skip the spoof entirely.",
    );
  }
  if (profileSource.profile === null && opts.seed !== undefined && opts.seed.length > 0) {
    console.warn(
      "[mochi] connect: `seed` was supplied alongside `profile: null`. " +
        "Seeds are only consumed when a profile is set; ignoring.",
    );
  }

  // Derive the matrix when a profile is set. Geo reconciliation is
  // currently launch-only — connect rides whatever proxy the remote
  // browser was launched with, which we can't introspect without
  // additional CDP roundtrips. (Future work: probe through the
  // attached browser the same way `launch` does, gated on
  // `geoConsistency !== "off"`.)
  const matrix =
    profileSource.profile === null
      ? null
      : deriveMatrix(profileSource.profile, opts.seed as string);

  // Resolve the WebSocket endpoint.
  const wsEndpoint = await resolveWsEndpoint(opts);

  // Open the WebSocket and adapt it onto the PipeReader/PipeWriter
  // shape `MessageRouter` already speaks. Failures (DNS, ECONNREFUSED,
  // 4xx upgrade rejection, TLS) surface as `ConnectionLostError` here
  // before any Session resources are allocated.
  const adapter = await connectWebSocketCdp({
    wsEndpoint,
    ...(opts.headers !== undefined ? { headers: opts.headers } : {}),
  });

  const proc = makeBorrowedProcessShim(adapter, wsEndpoint);

  const session = new Session({
    proc,
    matrix,
    seed: opts.seed ?? "",
    owned: false,
    ...(opts.timeout !== undefined ? { defaultTimeoutMs: opts.timeout } : {}),
    ...(opts.challenges !== undefined ? { challenges: opts.challenges } : {}),
  });
  return session;
}

/**
 * Resolve `(wsEndpoint, browserURL)` to a single concrete WebSocket URL.
 * Direct `wsEndpoint` wins; otherwise fetch `${browserURL}/json/version`
 * and read `webSocketDebuggerUrl`.
 */
async function resolveWsEndpoint(opts: ConnectOptions): Promise<string> {
  if (opts.wsEndpoint !== undefined && opts.wsEndpoint.length > 0) {
    return opts.wsEndpoint;
  }
  const browserURL = opts.browserURL as string;
  const versionUrl = browserURL.endsWith("/")
    ? `${browserURL}json/version`
    : `${browserURL}/json/version`;
  let res: Response;
  try {
    res = await fetch(versionUrl);
  } catch (err) {
    throw new Error(
      `[mochi] connect: failed to fetch ${versionUrl}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (!res.ok) {
    throw new Error(`[mochi] connect: ${versionUrl} returned HTTP ${res.status} ${res.statusText}`);
  }
  let body: JsonVersionResponse;
  try {
    body = (await res.json()) as JsonVersionResponse;
  } catch (err) {
    throw new Error(
      `[mochi] connect: ${versionUrl} did not return valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const wsUrl = body.webSocketDebuggerUrl;
  if (typeof wsUrl !== "string" || wsUrl.length === 0) {
    throw new Error(
      `[mochi] connect: ${versionUrl} JSON had no \`webSocketDebuggerUrl\` field — ` +
        "is the URL pointing at a Chromium with --remote-debugging-port?",
    );
  }
  return wsUrl;
}

/**
 * Build a {@link import("./proc").ChromiumProcess}-shaped shim for a
 * borrowed (connected) browser. The Session constructor needs the
 * `proc.reader` / `proc.writer` pair to drive the router; the rest of
 * the shape is filled with no-op / never-resolves values that match
 * what an attached-but-not-owned Chromium "looks like" from mochi's
 * side: no PID we own, no exit promise (the browser outlives us),
 * `close()` is a no-op (the connect-side `WebSocketCdpAdapter.close`
 * is invoked separately when the router tears the transport down).
 */
function makeBorrowedProcessShim(
  adapter: WebSocketCdpAdapter,
  wsEndpoint: string,
): {
  reader: PipeReader;
  writer: PipeWriter;
  userDataDir: string;
  pid: number;
  exited: Promise<number>;
  close: () => Promise<void>;
  /** Diagnostic — surfaces in `BorrowedSession` debug strings. @internal */
  readonly endpoint: string;
} {
  return {
    reader: adapter.reader,
    writer: adapter.writer,
    // Connect mode has no user-data-dir on our side; the remote owns
    // its own. Surface a sentinel so any code that reads it for a
    // diagnostic gets a meaningful string.
    userDataDir: "(borrowed — mochi.connect)",
    pid: 0,
    // Never resolves — the borrowed process keeps running past our
    // lifetime by definition. The Session's crash guard subscribes to
    // this promise; it'll just stay pending until process exit.
    exited: new Promise<number>(() => {
      /* never resolves — the remote browser outlives this Session */
    }),
    // Close: drain the WebSocket adapter. Idempotent. The Session
    // calls this from `Session.close()` AFTER the router has been torn
    // down; ordering matters because `router.close` issues a final
    // `Fetch.disable` over the live transport.
    close: async () => {
      try {
        await adapter.close();
      } catch (err) {
        // We're closing; surface as a warning but don't block.
        if (!(err instanceof ConnectionLostError)) {
          console.warn("[mochi] connect: WebSocket close failed:", err);
        }
      }
    },
    endpoint: wsEndpoint,
  };
}
