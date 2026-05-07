/**
 * Unit tests for `subcommand.ts` — argv parsing + the table formatter.
 *
 * Behavioral coverage of the CLI dispatch (e.g. `runBrowsers ["list"]`) is in
 * the cli's smoke test; these tests pin the pure helpers.
 */
import { describe, expect, it } from "bun:test";
import { formatInstallTable, parseFlags } from "../subcommand";

describe("parseFlags", () => {
  it("collects positional arguments", () => {
    const r = parseFlags(["uninstall", "131.0.6778.85"]);
    expect(r.positional).toEqual(["uninstall", "131.0.6778.85"]);
    expect(r.flags).toEqual({});
  });

  it("handles --flag value form", () => {
    const r = parseFlags(["--channel", "beta", "--version", "131.0.6778.85"]);
    expect(r.flags.channel).toBe("beta");
    expect(r.flags.version).toBe("131.0.6778.85");
  });

  it("handles --flag=value form", () => {
    const r = parseFlags(["--channel=beta", "--version=131.0.6778.85"]);
    expect(r.flags.channel).toBe("beta");
    expect(r.flags.version).toBe("131.0.6778.85");
  });

  it("handles boolean flags", () => {
    const r = parseFlags(["--force", "--yes", "--no-cache", "--offline"]);
    expect(r.flags.force).toBe(true);
    expect(r.flags.yes).toBe(true);
    expect(r.flags["no-cache"]).toBe(true);
    expect(r.flags.offline).toBe(true);
  });

  it("does not consume the next arg as a value for a known boolean flag", () => {
    const r = parseFlags(["--force", "131.0.6778.85"]);
    expect(r.flags.force).toBe(true);
    expect(r.positional).toEqual(["131.0.6778.85"]);
  });

  it("treats -- as positional separator", () => {
    const r = parseFlags(["install", "--", "--version", "x"]);
    expect(r.positional).toEqual(["install", "--version", "x"]);
  });

  it("normalizes flag names to lowercase", () => {
    const r = parseFlags(["--Channel", "beta"]);
    expect(r.flags.channel).toBe("beta");
  });
});

describe("formatInstallTable", () => {
  it("renders empty table with just the header when input is empty", () => {
    const out = formatInstallTable([]);
    // Just the header row.
    expect(out.split("\n").length).toBe(1);
    expect(out).toContain("CHANNEL");
    expect(out).toContain("VERSION");
    expect(out).toContain("PLATFORM");
    expect(out).toContain("PATH");
  });

  it("renders rows with column-aligned widths", () => {
    const out = formatInstallTable([
      {
        installDir: "/r/stable-131.0.6778.85-mac-arm64",
        binaryPath: "/r/.../Google Chrome for Testing",
        meta: { channel: "stable", version: "131.0.6778.85", platform: "mac-arm64" },
      },
      {
        installDir: "/r/beta-149.0.7827.3-linux64",
        binaryPath: "/r/chrome-linux64/chrome",
        meta: { channel: "beta", version: "149.0.7827.3", platform: "linux64" },
      },
    ]);
    const lines = out.split("\n");
    expect(lines.length).toBe(3); // header + 2 rows
    expect(lines[0]).toContain("CHANNEL");
    expect(lines[1]).toContain("stable");
    expect(lines[1]).toContain("131.0.6778.85");
    expect(lines[2]).toContain("beta");
    expect(lines[2]).toContain("149.0.7827.3");
  });
});
