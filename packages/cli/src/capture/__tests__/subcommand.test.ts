/**
 * Unit tests for the `mochi capture` argv parser.
 *
 * The runtime path (actually launching Chromium) is gated by MOCHI_E2E and
 * lives in `capture.e2e.test.ts`. This file exercises only the parsing
 * + dispatch surface.
 */

import { describe, expect, it } from "bun:test";
import { parseFlags, runCaptureCommand } from "../subcommand";

describe("parseFlags()", () => {
  it("parses --flag value and --flag=value forms", () => {
    const r = parseFlags([
      "--profile-id",
      "mac-m2-chrome-stable",
      "--out",
      "/tmp/x",
      "--browser=/path/to/chrome",
      "--seed=hello",
    ]);
    expect(r.flags["profile-id"]).toBe("mac-m2-chrome-stable");
    expect(r.flags.out).toBe("/tmp/x");
    expect(r.flags.browser).toBe("/path/to/chrome");
    expect(r.flags.seed).toBe("hello");
  });

  it("handles boolean flags", () => {
    const r = parseFlags(["--no-headless", "--interactive"]);
    expect(r.flags["no-headless"]).toBe(true);
    expect(r.flags.interactive).toBe(true);
  });

  it("recognizes --help / -h", () => {
    expect(parseFlags(["--help"]).flags.help).toBe(true);
    expect(parseFlags(["-h"]).flags.help).toBe(true);
  });
});

describe("runCaptureCommand()", () => {
  it("returns 0 for --help", async () => {
    const code = await runCaptureCommand(["--help"]);
    expect(code).toBe(0);
  });

  it("returns 1 when no args (prints help)", async () => {
    const code = await runCaptureCommand([]);
    expect(code).toBe(1);
  });

  it("returns 2 on missing --profile-id", async () => {
    const code = await runCaptureCommand(["--out", "/tmp/x"]);
    expect(code).toBe(2);
  });
});
