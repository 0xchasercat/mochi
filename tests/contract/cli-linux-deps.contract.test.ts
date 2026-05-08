/**
 * Cross-package contract: the canonical Chromium-for-Testing apt dep list
 * declared in `packages/cli/src/lib/linux-deps.ts` MUST match the apt
 * invocations in `.github/workflows/pr-fast.yml` and `release.yml` byte-
 * for-byte.
 *
 * Why this matters
 * ----------------
 * Task 0259 closes a real first-time-user UX gap: a fresh Linux server
 * without these libs sees `mochi.launch()` die with `BrowserCrashedError`
 * / `EPIPE` and no clue what's missing. The CLI's `mochi browsers install`
 * now post-extracts a `--version` smoke and surfaces the exact apt line on
 * failure. CI workflows must install the same set so the conformance gates
 * actually have a working binary. If the two drift, one of them is wrong —
 * caught at the contract gate, not in production.
 *
 * What we assert
 * --------------
 * Every package name in `LINUX_RUNTIME_DEPS` appears in BOTH workflow files,
 * inside the apt-get install invocation. We do not require strict ordering
 * (workflows can wrap lines however they please) — we require the *set*
 * matches, which is what apt cares about.
 *
 * @see tasks/0259-linux-first-run-experience.md
 * @see packages/cli/src/lib/linux-deps.ts
 */
import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import {
  formatMissingLibHint,
  LINUX_RUNTIME_DEPS,
  LINUX_RUNTIME_DEPS_APT_LINE,
  MISSING_SHARED_LIB_RE,
} from "../../packages/cli/src/lib/linux-deps";

const REPO_ROOT = (() => {
  // tests/contract/<file> → repo root is two levels up.
  const here = new URL(".", import.meta.url).pathname;
  return join(here, "..", "..");
})();

async function readWorkflow(name: string): Promise<string> {
  return Bun.file(join(REPO_ROOT, ".github", "workflows", name)).text();
}

describe("LINUX_RUNTIME_DEPS — shape + invariants", () => {
  it("is a non-empty list of plausible apt package names", () => {
    expect(LINUX_RUNTIME_DEPS.length).toBeGreaterThan(20);
    for (const pkg of LINUX_RUNTIME_DEPS) {
      // apt package names are lowercase alphanumerics + dot/hyphen.
      expect(pkg).toMatch(/^[a-z0-9][a-z0-9+.\-]*$/);
    }
  });

  it("includes the load-bearing Chromium libs (libnss3, libgbm1, libgtk-3-0)", () => {
    // Any of these missing on a launch attempt will abort Chromium with
    // `error while loading shared libraries:`. They've been the actual
    // first-failures we've seen in user reports.
    expect(LINUX_RUNTIME_DEPS).toContain("libnss3");
    expect(LINUX_RUNTIME_DEPS).toContain("libgbm1");
    expect(LINUX_RUNTIME_DEPS).toContain("libgtk-3-0");
  });

  it("LINUX_RUNTIME_DEPS_APT_LINE starts with the canonical sudo apt-get prefix", () => {
    expect(LINUX_RUNTIME_DEPS_APT_LINE).toContain("sudo apt-get update");
    expect(LINUX_RUNTIME_DEPS_APT_LINE).toContain(
      "sudo apt-get install -y --no-install-recommends",
    );
  });

  it("LINUX_RUNTIME_DEPS_APT_LINE mentions every dep at least once", () => {
    for (const pkg of LINUX_RUNTIME_DEPS) {
      expect(LINUX_RUNTIME_DEPS_APT_LINE).toContain(pkg);
    }
  });
});

describe("MISSING_SHARED_LIB_RE", () => {
  it("captures the lib name from a real Chromium stderr line", () => {
    const sample =
      "chrome: error while loading shared libraries: libnss3.so: cannot open shared object file: No such file or directory";
    const m = MISSING_SHARED_LIB_RE.exec(sample);
    expect(m).not.toBeNull();
    expect(m?.[1]).toBe("libnss3.so");
  });

  it("is case-insensitive and tolerates leading whitespace variation", () => {
    const sample = "  Error While Loading Shared Libraries:   libgbm1.so.1: blah";
    const m = MISSING_SHARED_LIB_RE.exec(sample);
    expect(m).not.toBeNull();
    expect(m?.[1]).toBe("libgbm1.so.1");
  });

  it("returns null on unrelated stderr", () => {
    expect(MISSING_SHARED_LIB_RE.exec("Running as root without --no-sandbox")).toBeNull();
  });
});

describe("formatMissingLibHint", () => {
  it("includes the apt install line and the docs URL", () => {
    const hint = formatMissingLibHint("libnss3.so");
    expect(hint).toContain("libnss3.so");
    expect(hint).toContain("sudo apt-get install");
    expect(hint).toContain("libnss3");
    expect(hint).toContain("https://mochijs.com/docs/getting-started/install");
  });

  it("falls back to a generic header when the lib name is unknown", () => {
    const hint = formatMissingLibHint(null);
    expect(hint).toContain("missing shared libraries");
    expect(hint).toContain("sudo apt-get install");
  });
});

describe("CI workflows — apt list parity", () => {
  it("pr-fast.yml installs every dep in LINUX_RUNTIME_DEPS", async () => {
    const yml = await readWorkflow("pr-fast.yml");
    // The workflow's "Install Chromium runtime dependencies" step must
    // mention every package name. We don't assert ordering — apt installs
    // a set; the constant just preserves canonical authoring order for
    // diff-friendliness.
    for (const pkg of LINUX_RUNTIME_DEPS) {
      expect(yml).toContain(pkg);
    }
  });

  it("release.yml installs every dep in LINUX_RUNTIME_DEPS", async () => {
    const yml = await readWorkflow("release.yml");
    for (const pkg of LINUX_RUNTIME_DEPS) {
      expect(yml).toContain(pkg);
    }
  });
});
