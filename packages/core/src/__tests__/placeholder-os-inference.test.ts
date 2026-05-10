/**
 * Unit: `inferPlaceholderOsFromId` — pattern-match a profile id to the OS
 * axis used by `synthesizePlaceholderProfile`.
 *
 * Regression guard for the "Linux profile forced on macOS / Windows" bug:
 * pre-fix, `synthesizePlaceholderProfile` was unconditionally Linux. The
 * 5 catalog ids without captured baselines (`mac-m2-`, `mac-m1-`,
 * `mac-intel-`, `win11-`, `win11-edge-`) all silently produced a Linux
 * UA + Linux `os.name` regardless of the id's implied platform.
 */

import { describe, expect, it } from "bun:test";
import { inferPlaceholderOsFromId } from "../launch";

describe("inferPlaceholderOsFromId", () => {
  it("infers macOS for mac-* prefixes", () => {
    expect(inferPlaceholderOsFromId("mac-m4-chrome-stable")).toBe("macos");
    expect(inferPlaceholderOsFromId("mac-m2-chrome-stable")).toBe("macos");
    expect(inferPlaceholderOsFromId("mac-m1-chrome-stable")).toBe("macos");
    expect(inferPlaceholderOsFromId("mac-intel-chrome-stable")).toBe("macos");
    expect(inferPlaceholderOsFromId("mac-chrome-stable")).toBe("macos");
    expect(inferPlaceholderOsFromId("mac-chrome-beta")).toBe("macos");
    expect(inferPlaceholderOsFromId("mac-brave-stable")).toBe("macos");
  });

  it("infers macOS for the legacy macos-* prefix", () => {
    expect(inferPlaceholderOsFromId("macos-arm64")).toBe("macos");
  });

  it("infers Windows for win11-*, windows-*, win10-* prefixes", () => {
    expect(inferPlaceholderOsFromId("win11-chrome-stable")).toBe("windows");
    expect(inferPlaceholderOsFromId("win11-edge-stable")).toBe("windows");
    expect(inferPlaceholderOsFromId("windows-chrome-stable")).toBe("windows");
    expect(inferPlaceholderOsFromId("win10-chrome-stable")).toBe("windows");
  });

  it("infers Linux for linux-* and the unknown-prefix fallback", () => {
    expect(inferPlaceholderOsFromId("linux-chrome-stable")).toBe("linux");
    // Unknown prefix → linux fallback (preserves long-standing default).
    expect(inferPlaceholderOsFromId("test-humanize")).toBe("linux");
    expect(inferPlaceholderOsFromId("custom-profile-xyz")).toBe("linux");
    expect(inferPlaceholderOsFromId("")).toBe("linux");
  });

  it("does NOT match `macarena` or other false-positive prefixes", () => {
    // The hyphen requirement after `mac` rules out arbitrary words that
    // happen to start with the same three letters.
    expect(inferPlaceholderOsFromId("macarena-chrome")).toBe("linux");
    expect(inferPlaceholderOsFromId("machine-learning")).toBe("linux");
  });
});
