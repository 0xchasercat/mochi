/**
 * Spoof module: `navigator.connection` (Network Information API).
 *
 * Reads from the matrix:
 *   - `matrix.uaCh["connection"]` (R-037) — JSON
 *     `{effectiveType, downlink, rtt, saveData}`.
 *
 * Defines `navigator.connection.{effectiveType, downlink, rtt, saveData,
 * type}` so that probes pulling these values get matrix-locked answers.
 * Chrome's native `connection` is a `NetworkInformation` instance — we
 * don't reconstruct the full prototype; the probe page only reads the
 * four (now five) properties below.
 *
 * @see tasks/0070-consistency-rules-full.md (network-info)
 */

import type { MatrixV1 } from "@mochi.js/consistency";

interface Connection {
  readonly effectiveType?: string;
  readonly downlink?: number;
  readonly rtt?: number;
  readonly saveData?: boolean;
}

function tryParse<T>(s: unknown): T | null {
  if (typeof s !== "string" || s.length === 0) return null;
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
}

export function emitNetworkInfoModule(matrix: MatrixV1): string {
  const conn = tryParse<Connection>(matrix.uaCh.connection) ?? {};
  if (
    conn.effectiveType === undefined &&
    conn.downlink === undefined &&
    conn.rtt === undefined &&
    conn.saveData === undefined
  ) {
    return `
// ---- network-info spoof (skipped — no matrix.uaCh["connection"]) ----------
`;
  }

  const effectiveType = conn.effectiveType ?? "4g";
  const downlink = typeof conn.downlink === "number" ? conn.downlink : 10;
  const rtt = typeof conn.rtt === "number" ? conn.rtt : 50;
  const saveData = conn.saveData === true;

  return `
// ---- network-info spoof ----------------------------------------------------
(function() {
  if (typeof navigator === "undefined") return;
  var c = navigator.connection;
  if (c === undefined || c === null) return;

  // The values are accessor-style on real Chrome's NetworkInformation
  // prototype; redefining on the instance is the simplest faithful match.
  // configurable:false matches __mochi_define__'s contract.
  __mochi_define__(c, "effectiveType", ${JSON.stringify(effectiveType)});
  __mochi_define__(c, "downlink", ${downlink});
  __mochi_define__(c, "rtt", ${rtt});
  __mochi_define__(c, "saveData", ${saveData ? "true" : "false"});
})();
`;
}
