/**
 * Permissions defaults — `Permissions.query({name})` answers that real
 * Chrome reports for a fresh, never-prompted profile.
 *
 * Chrome's defaults observed in the captured baselines:
 *   - geolocation, notifications, camera, microphone → `"prompt"`
 *   - clipboard-read → `"prompt"`
 *   - clipboard-write, accelerometer, gyroscope, magnetometer → `"granted"`
 *
 * The values are stable across desktop OS so v0.7 doesn't key by OS yet.
 *
 * @see tasks/0070-consistency-rules-full.md (permissions)
 */

/** Chrome's default permission states for a fresh profile, by name. */
export const PERMISSIONS_DEFAULT_STATE: Readonly<Record<string, "granted" | "prompt" | "denied">> =
  {
    geolocation: "prompt",
    notifications: "prompt",
    camera: "prompt",
    microphone: "prompt",
    "clipboard-read": "prompt",
    "clipboard-write": "granted",
    accelerometer: "granted",
    gyroscope: "granted",
    magnetometer: "granted",
    midi: "prompt",
    push: "prompt",
    "background-sync": "granted",
    "persistent-storage": "prompt",
    "ambient-light-sensor": "granted",
    "screen-wake-lock": "prompt",
    "storage-access": "prompt",
    "window-management": "prompt",
    "system-wake-lock": "prompt",
  };
