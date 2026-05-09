/**
 * Spoof module: `navigator.mediaDevices.{enumerateDevices,getSupportedConstraints}`.
 *
 * Reads from the matrix:
 *   - `matrix.uaCh["media-devices"]` (R-034) — JSON `[{kind,label}, ...]`
 *   - `matrix.uaCh["media-supported-constraints"]` (R-035) — JSON map
 *
 * `deviceId` and `groupId` MUST be deterministic per `(profile, seed)`. We
 * derive them via SHA-256(`<profile.id>:<seed>:mediaDevices:<index>:<kind>`)
 * truncated to 32 hex chars. This is computed at build time (Bun has
 * `crypto.subtle`) and embedded in the payload so the payload itself is
 * still byte-stable per (profile, seed).
 *
 * @see PLAN.md §9.5
 */

import type { MatrixV1 } from "@mochi.js/consistency";

interface DeviceShape {
  readonly kind: "audioinput" | "audiooutput" | "videoinput";
  readonly label: string;
}

function tryParse<T>(s: unknown): T | null {
  if (typeof s !== "string" || s.length === 0) return null;
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
}

/**
 * Compute a deterministic 32-hex-char ID from a key string. Uses Bun's
 * `CryptoHasher` (sync) when available; matches the SHA-256 path used by
 * the inject payload's builder.
 */
function sha256Hex(input: string): string {
  type CryptoHasherCtor = new (
    algo: "sha256",
  ) => {
    update(data: string): void;
    digest(encoding: "hex"): string;
  };
  const maybeBun = (globalThis as { Bun?: { CryptoHasher?: CryptoHasherCtor } }).Bun;
  if (maybeBun !== undefined && maybeBun.CryptoHasher !== undefined) {
    const h = new maybeBun.CryptoHasher("sha256");
    h.update(input);
    return h.digest("hex");
  }
  throw new Error("[mochi/inject] media-devices requires Bun CryptoHasher");
}

export function emitMediaDevicesModule(matrix: MatrixV1): string {
  const devices = tryParse<readonly DeviceShape[]>(matrix.uaCh["media-devices"]) ?? [];
  const constraints =
    tryParse<Record<string, true>>(matrix.uaCh["media-supported-constraints"]) ?? {};

  if (devices.length === 0 && Object.keys(constraints).length === 0) {
    return `
// ---- mediaDevices spoof (skipped — no matrix.uaCh["media-*"]) -------------
`;
  }

  // Derive deterministic IDs at build time. The harness's normalize layer
  // sentinelizes mediaDevices.devices[*].deviceId/groupId, so the exact
  // bytes don't need to match across runs — they just need to be
  // structurally consistent and seed-stable.
  const profileBase = `${matrix.id}:${matrix.seed}:mediaDevices`;
  const enriched = devices.map((d, i) => {
    const deviceId = sha256Hex(`${profileBase}:${i}:${d.kind}:deviceId`).slice(0, 64);
    const groupId = sha256Hex(`${profileBase}:${i}:${d.kind}:groupId`).slice(0, 64);
    return { kind: d.kind, label: d.label, deviceId, groupId };
  });

  const devicesLiteral = JSON.stringify(enriched);
  const constraintsLiteral = JSON.stringify(constraints);

  return `
// ---- mediaDevices spoof ----------------------------------------------------
(function() {
  if (typeof navigator === "undefined") return;
  var md = navigator.mediaDevices;
  if (md === undefined || md === null) return;

  var SPOOF_DEVICES = ${devicesLiteral};
  var SPOOF_CONSTRAINTS = ${constraintsLiteral};

  // Build MediaDeviceInfo-shape stand-ins. Real Chrome's MediaDeviceInfo
  // exposes deviceId/kind/label/groupId via prototype getters; a plain
  // frozen object with the same keys reads identically through probe code.
  function buildDeviceInfos() {
    var out = [];
    for (var i = 0; i < SPOOF_DEVICES.length; i++) {
      var s = SPOOF_DEVICES[i];
      out.push(Object.freeze({
        deviceId: s.deviceId,
        kind: s.kind,
        label: s.label,
        groupId: s.groupId,
        toJSON: function() {
          return { deviceId: this.deviceId, kind: this.kind, label: this.label, groupId: this.groupId };
        },
      }));
    }
    return out;
  }

  function enumerateDevices() {
    return Promise.resolve(buildDeviceInfos());
  }
  __mochi_register_native__(enumerateDevices, "enumerateDevices");

  function getSupportedConstraints() {
    // Return a frozen map matching the captured shape.
    var out = {};
    for (var k in SPOOF_CONSTRAINTS) {
      if (Object.prototype.hasOwnProperty.call(SPOOF_CONSTRAINTS, k)) out[k] = true;
    }
    return out;
  }
  __mochi_register_native__(getSupportedConstraints, "getSupportedConstraints");

  // Patch on the MediaDevices prototype if reachable (matches Chrome's
  // native slot layout). Fall back to the instance otherwise.
  var proto = __mochi_getPrototypeOf__(md);
  var target = proto !== null && proto !== undefined && typeof proto.enumerateDevices === "function"
    ? proto
    : md;

  try {
    __mochi_defineProperty__(target, "enumerateDevices", {
      configurable: true, enumerable: false, writable: true, value: enumerateDevices,
    });
  } catch (_e) {}

  try {
    __mochi_defineProperty__(target, "getSupportedConstraints", {
      configurable: true, enumerable: false, writable: true, value: getSupportedConstraints,
    });
  } catch (_e) {}
})();
`;
}
