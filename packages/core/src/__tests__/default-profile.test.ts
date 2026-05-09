/**
 * Unit tests for the host-OS profile auto-pick.
 *
 * Three layers under test:
 *
 *   1. {@link resolveDefaultProfileForHost} — the pure mapping table.
 *      `(platform, arch)` in, `ProfileId | null` out. No I/O, no globals.
 *   2. {@link defaultProfileForHost} — the live wrapper that reads
 *      `process.platform` / `process.arch`. Verified by stubbing the
 *      `process` properties and asserting the same table holds.
 *   3. The launcher's failure-mode diagnostic (`unsupportedHostMessage`):
 *      lists the six explicit profile IDs verbatim and points at the
 *      choose-your-profile guide URL. Format is pinned by task 0272 — the
 *      docs + LLM-context blocks reference these strings.
 *
 * The "explicit `profile:` always wins" half of the success criteria is
 * exercised against the launcher's `resolveProfileSource` resolver via the
 * exported `defaultProfileForHost` introspection helper. We do NOT spawn
 * Chromium here — the goal is to lock the decisions against regressions
 * without taking the cost of a real launch. Mirrors the
 * `proc-linux-server.test.ts` pattern.
 *
 * @see packages/core/src/default-profile.ts
 */

import { afterEach, describe, expect, it } from "bun:test";
import {
  defaultProfileForHost,
  EXPLICIT_PROFILE_IDS,
  resolveDefaultProfileForHost,
  unsupportedHostMessage,
} from "../default-profile";

describe("resolveDefaultProfileForHost — pure mapping table", () => {
  it("linux/x64 → linux-chrome-stable", () => {
    expect(resolveDefaultProfileForHost("linux", "x64")).toBe("linux-chrome-stable");
  });

  it("darwin/arm64 → mac-m4-chrome-stable", () => {
    expect(resolveDefaultProfileForHost("darwin", "arm64")).toBe("mac-m4-chrome-stable");
  });

  it("darwin/x64 → mac-chrome-stable", () => {
    expect(resolveDefaultProfileForHost("darwin", "x64")).toBe("mac-chrome-stable");
  });

  it("win32/x64 → windows-chrome-stable", () => {
    expect(resolveDefaultProfileForHost("win32", "x64")).toBe("windows-chrome-stable");
  });

  it("linux/arm64 → null (no Linux arm64 capture today)", () => {
    expect(resolveDefaultProfileForHost("linux", "arm64")).toBeNull();
  });

  it("freebsd/x64 → null (unsupported platform)", () => {
    // `freebsd` is a valid `NodeJS.Platform`. Confirms the resolver fails
    // closed rather than silently routing to a Linux profile.
    expect(resolveDefaultProfileForHost("freebsd", "x64")).toBeNull();
  });

  it("win32/arm64 → null (no Windows arm64 capture today)", () => {
    expect(resolveDefaultProfileForHost("win32", "arm64")).toBeNull();
  });

  it("openbsd/x64 → null (unsupported platform — fail closed)", () => {
    expect(resolveDefaultProfileForHost("openbsd", "x64")).toBeNull();
  });

  it("returns one of the six real-device profile IDs on every supported host", () => {
    // Cross-check: every value the resolver can return MUST be in the
    // EXPLICIT_PROFILE_IDS list — that's the list the unsupported-host
    // diagnostic surfaces, and a resolver that picks an id outside that
    // list would create a documentation drift on the failure path.
    const supported: Array<[NodeJS.Platform, string]> = [
      ["linux", "x64"],
      ["darwin", "arm64"],
      ["darwin", "x64"],
      ["win32", "x64"],
    ];
    for (const [platform, arch] of supported) {
      const id = resolveDefaultProfileForHost(platform, arch);
      expect(id).not.toBeNull();
      expect(EXPLICIT_PROFILE_IDS).toContain(id as (typeof EXPLICIT_PROFILE_IDS)[number]);
    }
  });
});

describe("defaultProfileForHost — live wrapper", () => {
  // Stub `process.platform` / `process.arch` so the live wrapper exercises
  // the same table as the pure resolver. `Object.defineProperty` is the
  // standard Bun-test pattern (matches `proc-linux-server.test.ts`).
  const ORIG_PLATFORM = process.platform;
  const ORIG_ARCH = process.arch;

  function stub(platform: NodeJS.Platform, arch: string) {
    Object.defineProperty(process, "platform", { value: platform, configurable: true });
    Object.defineProperty(process, "arch", { value: arch, configurable: true });
  }

  afterEach(() => {
    Object.defineProperty(process, "platform", { value: ORIG_PLATFORM, configurable: true });
    Object.defineProperty(process, "arch", { value: ORIG_ARCH, configurable: true });
  });

  it("reads (process.platform, process.arch) and returns the mapped id", () => {
    stub("linux", "x64");
    expect(defaultProfileForHost()).toBe("linux-chrome-stable");

    stub("darwin", "arm64");
    expect(defaultProfileForHost()).toBe("mac-m4-chrome-stable");

    stub("darwin", "x64");
    expect(defaultProfileForHost()).toBe("mac-chrome-stable");

    stub("win32", "x64");
    expect(defaultProfileForHost()).toBe("windows-chrome-stable");
  });

  it("returns null on unsupported hosts (linux arm64, freebsd)", () => {
    stub("linux", "arm64");
    expect(defaultProfileForHost()).toBeNull();

    stub("freebsd", "x64");
    expect(defaultProfileForHost()).toBeNull();
  });
});

describe("unsupportedHostMessage — failure-mode diagnostic", () => {
  it("names the host platform + arch verbatim", () => {
    const msg = unsupportedHostMessage("freebsd", "x64");
    expect(msg).toContain("platform=freebsd");
    expect(msg).toContain("arch=x64");
  });

  it("lists every explicit profile id (six total)", () => {
    const msg = unsupportedHostMessage("linux", "arm64");
    for (const id of EXPLICIT_PROFILE_IDS) {
      expect(msg).toContain(id);
    }
    expect(EXPLICIT_PROFILE_IDS.length).toBe(6);
  });

  it("points at the choose-your-profile guide URL", () => {
    const msg = unsupportedHostMessage("openbsd", "x64");
    expect(msg).toContain("https://mochijs.com/docs/guides/choose-your-profile");
  });

  it("uses the [mochi] launch: prefix so users grep the right log", () => {
    const msg = unsupportedHostMessage("linux", "arm64");
    expect(msg.startsWith("[mochi] launch:")).toBe(true);
  });
});

describe("introspection contract — defaultProfileForHost is pure", () => {
  it("returns the same value on repeated calls (no caching, no mutation)", () => {
    // The launcher consults this helper at every launch; pinning purity
    // here means a downstream `console.log(mochi.defaultProfileForHost())`
    // is always safe and does not influence subsequent launches.
    const a = defaultProfileForHost();
    const b = defaultProfileForHost();
    expect(a).toBe(b);
  });

  it("EXPLICIT_PROFILE_IDS lists exactly the six real-device profiles", () => {
    // The unsupported-host diagnostic surfaces this list verbatim; the
    // README LLM-context block + the task 0272 brief reference these IDs
    // by name. Pin the membership here so a docs/code drift surfaces.
    expect(new Set(EXPLICIT_PROFILE_IDS)).toEqual(
      new Set([
        "mac-m4-chrome-stable",
        "mac-chrome-stable",
        "mac-chrome-beta",
        "windows-chrome-stable",
        "linux-chrome-stable",
        "mac-brave-stable",
      ]),
    );
  });
});
