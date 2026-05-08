/**
 * MediaDevices lookup tables — typical device shape per OS, plus the full
 * `MediaTrackSupportedConstraints` map Chrome exposes via
 * `mediaDevices.getSupportedConstraints()`.
 *
 * Captured Mac M4 baseline reports 3 devices in headless capture (audio
 * input + audio output + video input, all label-blanked / id-blanked
 * because permissions weren't prompted). Real Chrome with mic+cam grants
 * lights up the same shape with non-empty `deviceId` / `groupId` strings.
 *
 * `deviceId` and `groupId` MUST be deterministic per `(profile, seed)` to
 * survive harness normalization (which sentinelizes those leaves). The
 * inject layer feeds the seeded xoshiro to derive 32-byte hex IDs.
 *
 * @see PLAN.md §9.5 / tasks/0070-consistency-rules-full.md (media-devices)
 */

import type { ProfileV1 } from "../../generated/profile";

/** OS key matching `ProfileV1["os"]["name"]`. */
export type OsKey = ProfileV1["os"]["name"];

/** A single enumerated device entry (sans deviceId/groupId, those are seeded). */
export interface DeviceShape {
  readonly kind: "audioinput" | "audiooutput" | "videoinput";
  readonly label: string;
}

/**
 * The default device shape per OS. Chrome with mic+cam grants typically
 * reports one of each kind — additional devices stack as users plug them
 * in. v0.7 baseline matches the captured-headless shape (3 devices, blank
 * labels) so the harness can structurally diff against the live session.
 */
export const DEVICES_BY_OS: Readonly<Record<OsKey, readonly DeviceShape[]>> = {
  macos: [
    { kind: "audioinput", label: "" },
    { kind: "videoinput", label: "" },
    { kind: "audiooutput", label: "" },
  ],
  windows: [
    { kind: "audioinput", label: "" },
    { kind: "videoinput", label: "" },
    { kind: "audiooutput", label: "" },
  ],
  linux: [
    { kind: "audioinput", label: "" },
    { kind: "videoinput", label: "" },
    { kind: "audiooutput", label: "" },
  ],
};

/**
 * The full `MediaTrackSupportedConstraints` map Chrome ≥ 130 reports.
 * Captured verbatim from the Mac M4 baseline — every key present is `true`.
 * Stable across desktop OS at this Chrome major.
 */
export const SUPPORTED_CONSTRAINTS: Readonly<Record<string, true>> = {
  aspectRatio: true,
  autoGainControl: true,
  brightness: true,
  channelCount: true,
  colorTemperature: true,
  contrast: true,
  deviceId: true,
  displaySurface: true,
  echoCancellation: true,
  exposureCompensation: true,
  exposureMode: true,
  exposureTime: true,
  facingMode: true,
  focusDistance: true,
  focusMode: true,
  frameRate: true,
  groupId: true,
  height: true,
  iso: true,
  latency: true,
  noiseSuppression: true,
  pan: true,
  pointsOfInterest: true,
  resizeMode: true,
  restrictOwnAudio: true,
  sampleRate: true,
  sampleSize: true,
  saturation: true,
  sharpness: true,
  suppressLocalAudioPlayback: true,
  tilt: true,
  torch: true,
  voiceIsolation: true,
  whiteBalanceMode: true,
  width: true,
  zoom: true,
};
