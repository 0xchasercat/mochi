import { describe, expect, it } from "bun:test";
import { main, SUBCOMMANDS, VERSION } from "../index";

describe("@mochi.js/cli (claim release)", () => {
  it("exports VERSION", () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("declares the v1 subcommand surface", () => {
    expect(SUBCOMMANDS).toContain("browsers");
    expect(SUBCOMMANDS).toContain("capture");
    expect(SUBCOMMANDS).toContain("harness");
    expect(SUBCOMMANDS).toContain("work");
  });

  it("main('version') returns 0", async () => {
    const code = await main(["version"]);
    expect(code).toBe(0);
  });

  it("main with unknown subcommand returns nonzero", async () => {
    const code = await main(["nope"]);
    expect(code).not.toBe(0);
  });

  it("main(['work', 'list']) proxies to scripts/mochi-work.ts and returns 0", async () => {
    // `list` works even with zero worktrees; the proxy resolves the repo root
    // automatically by walking up from cwd.
    const code = await main(["work", "list"]);
    expect(code).toBe(0);
  });
});
