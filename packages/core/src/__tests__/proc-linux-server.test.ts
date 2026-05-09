/**
 * Unit tests for the Linux-server environment auto-detection that drives
 * `LaunchOptions.headlessMode` defaulting (task 0258).
 *
 * Two layers under test:
 *
 *   1. {@link detectLinuxServerEnv} — the pure classifier. Stub
 *      `(platform, env, uid, container probes)` and assert the
 *      `LinuxServerEnv` summary it returns.
 *   2. {@link resolveHeadlessMode} — the resolution table that maps
 *      `(LaunchOptions, LinuxServerEnv)` → `"new" | "legacy" | "off"`. Order
 *      of precedence is load-bearing for the docs we ship; tests pin it.
 *
 * We DO NOT spawn Chromium here — the goal is to lock the decisions against
 * regressions without taking the cost of a real launch. The flag-emit
 * behaviour for the resolved mode is covered separately in
 * `proc.test.ts` ("appends --headless=new when headless is true" et al.).
 *
 * @see packages/core/src/linux-server.ts
 * @see packages/core/src/launch.ts (resolveHeadlessMode)
 * @see tasks/0258 (Linux server env auto-detection)
 */

import { describe, expect, it } from "bun:test";
import { resolveHeadlessMode } from "../launch";
import { detectLinuxServerEnv, type LinuxServerProbes } from "../linux-server";
import { buildChromiumArgs, type SpawnConfig } from "../proc";

const FAKE_BINARY = "/usr/bin/chromium-stub";
const FAKE_UDD = "/tmp/mochi-test-udd";

function probes(overrides: Partial<LinuxServerProbes> = {}): LinuxServerProbes {
  return {
    platform: "linux",
    display: undefined,
    waylandDisplay: undefined,
    uid: 1000,
    hasDockerEnvFile: false,
    cgroup: undefined,
    ...overrides,
  };
}

describe("detectLinuxServerEnv — server-no-display classifier (task 0258)", () => {
  it("flags Linux + no DISPLAY + no WAYLAND_DISPLAY as serverNoDisplay=true", () => {
    const env = detectLinuxServerEnv(probes());
    expect(env.serverNoDisplay).toBe(true);
  });

  it("clears serverNoDisplay when DISPLAY is set (X11 dev workstation)", () => {
    const env = detectLinuxServerEnv(probes({ display: ":0" }));
    expect(env.serverNoDisplay).toBe(false);
  });

  it("clears serverNoDisplay when WAYLAND_DISPLAY is set (Wayland session)", () => {
    const env = detectLinuxServerEnv(probes({ waylandDisplay: "wayland-0" }));
    expect(env.serverNoDisplay).toBe(false);
  });

  it("treats empty-string DISPLAY as 'no display' (matches Chromium)", () => {
    // An empty DISPLAY value means no usable X server; Chromium itself rejects
    // the connection. Mirror that — an empty string must not gate us out of
    // headless defaulting.
    const env = detectLinuxServerEnv(probes({ display: "" }));
    expect(env.serverNoDisplay).toBe(true);
  });

  it("never flags serverNoDisplay on darwin / win32 (rule is Linux-only)", () => {
    expect(detectLinuxServerEnv(probes({ platform: "darwin" })).serverNoDisplay).toBe(false);
    expect(detectLinuxServerEnv(probes({ platform: "win32" })).serverNoDisplay).toBe(false);
  });

  it("flags root=true when uid === 0 on Linux (orthogonal axis)", () => {
    const env = detectLinuxServerEnv(probes({ uid: 0 }));
    expect(env.root).toBe(true);
    expect(env.serverNoDisplay).toBe(true);
  });

  it("clears root when uid !== 0", () => {
    expect(detectLinuxServerEnv(probes({ uid: 1000 })).root).toBe(false);
    expect(detectLinuxServerEnv(probes({ uid: undefined })).root).toBe(false);
  });

  it("never flags root on non-Linux (uid 0 on macOS root shell is not the same axis)", () => {
    // The auto-`--no-sandbox` fallback in proc.ts is Linux-specific; the
    // classifier mirrors that.
    expect(detectLinuxServerEnv(probes({ platform: "darwin", uid: 0 })).root).toBe(false);
  });

  it("flags container=true when /.dockerenv is present", () => {
    const env = detectLinuxServerEnv(probes({ hasDockerEnvFile: true }));
    expect(env.container).toBe(true);
  });

  it("flags container=true when /proc/1/cgroup mentions docker", () => {
    const env = detectLinuxServerEnv(
      probes({ cgroup: "12:devices:/docker/abc123\n11:freezer:/docker/abc123\n" }),
    );
    expect(env.container).toBe(true);
  });

  it("flags container=true when cgroup mentions containerd", () => {
    const env = detectLinuxServerEnv(probes({ cgroup: "0::/system.slice/containerd.service\n" }));
    expect(env.container).toBe(true);
  });

  it("flags container=true when cgroup mentions kubepods (Kubernetes)", () => {
    const env = detectLinuxServerEnv(
      probes({ cgroup: "0::/kubepods.slice/kubepods-pod123.slice/\n" }),
    );
    expect(env.container).toBe(true);
  });

  it("clears container when neither indicator hits", () => {
    expect(
      detectLinuxServerEnv(probes({ cgroup: "0::/user.slice/user-1000.slice\n" })).container,
    ).toBe(false);
    expect(detectLinuxServerEnv(probes()).container).toBe(false);
  });

  it("rationale string surfaces every probed axis for debug logging", () => {
    const env = detectLinuxServerEnv(
      probes({ display: ":0", uid: 0, hasDockerEnvFile: true, waylandDisplay: undefined }),
    );
    expect(env.rationale).toContain("platform=linux");
    expect(env.rationale).toContain("display=:0");
    expect(env.rationale).toContain("uid=0");
    expect(env.rationale).toContain("container=true");
    expect(env.rationale).toContain("serverNoDisplay=false");
  });
});

describe("resolveHeadlessMode — precedence table (task 0258)", () => {
  const SERVER_ENV = detectLinuxServerEnv(probes());
  const DEV_ENV = detectLinuxServerEnv(probes({ display: ":0" }));

  it("explicit headlessMode='new' wins on a dev workstation", () => {
    expect(resolveHeadlessMode({ headlessMode: "new" }, DEV_ENV)).toBe("new");
  });

  it("explicit headlessMode='legacy' wins on a server", () => {
    expect(resolveHeadlessMode({ headlessMode: "legacy" }, SERVER_ENV)).toBe("legacy");
  });

  it("explicit headlessMode='off' wins on a server (caller knows what they want)", () => {
    expect(resolveHeadlessMode({ headlessMode: "off" }, SERVER_ENV)).toBe("off");
  });

  it("legacy headless: true maps to 'new' regardless of env", () => {
    expect(resolveHeadlessMode({ headless: true }, DEV_ENV)).toBe("new");
    expect(resolveHeadlessMode({ headless: true }, SERVER_ENV)).toBe("new");
  });

  it("legacy headless: false maps to 'off' regardless of env", () => {
    // Even on a server, an explicit `headless: false` must be honored —
    // we are not in the business of ignoring user input. The user will
    // crash, but they asked for it.
    expect(resolveHeadlessMode({ headless: false }, SERVER_ENV)).toBe("off");
    expect(resolveHeadlessMode({ headless: false }, DEV_ENV)).toBe("off");
  });

  it("env default: server-no-display → 'new' (the task 0258 fix)", () => {
    expect(resolveHeadlessMode({}, SERVER_ENV)).toBe("new");
  });

  it("env default: dev workstation with DISPLAY → 'off' (run headful)", () => {
    expect(resolveHeadlessMode({}, DEV_ENV)).toBe("off");
  });

  it("env default: macOS / Windows → 'off' (no Linux-only fallback)", () => {
    const macEnv = detectLinuxServerEnv(probes({ platform: "darwin" }));
    const winEnv = detectLinuxServerEnv(probes({ platform: "win32" }));
    expect(resolveHeadlessMode({}, macEnv)).toBe("off");
    expect(resolveHeadlessMode({}, winEnv)).toBe("off");
  });

  it("headlessMode supersedes a contradicting legacy headless flag", () => {
    expect(resolveHeadlessMode({ headlessMode: "off", headless: true }, SERVER_ENV)).toBe("off");
    expect(resolveHeadlessMode({ headlessMode: "new", headless: false }, DEV_ENV)).toBe("new");
  });

  it("server + root still resolves to 'new' (orthogonal axes — task 0258 §detection)", () => {
    // The root/no-sandbox auto-flag is owned by proc.ts, not the headless
    // resolver. This test pins that resolveHeadlessMode does NOT bake root
    // into its decision — the user could be running the new-headless flow
    // as root inside a container without that influencing the mode.
    const rootServer = detectLinuxServerEnv(probes({ uid: 0 }));
    expect(resolveHeadlessMode({}, rootServer)).toBe("new");
  });

  it("container + DISPLAY (rare but valid) → 'off' (developer in a devcontainer)", () => {
    const devcontainer = detectLinuxServerEnv(
      probes({ display: ":0", hasDockerEnvFile: true, cgroup: "0::/docker/abc\n" }),
    );
    expect(devcontainer.container).toBe(true);
    expect(devcontainer.serverNoDisplay).toBe(false);
    expect(resolveHeadlessMode({}, devcontainer)).toBe("off");
  });
});

describe("buildChromiumArgs — headlessMode dispatch (task 0258)", () => {
  function baseCfg(overrides: Partial<SpawnConfig> = {}): SpawnConfig {
    return { binary: FAKE_BINARY, headless: false, ...overrides };
  }

  it("headlessMode='new' emits --headless=new", () => {
    const args = buildChromiumArgs(baseCfg({ headlessMode: "new" }), FAKE_UDD, undefined);
    expect(args).toContain("--headless=new");
    expect(args).not.toContain("--headless");
  });

  it("headlessMode='legacy' emits bare --headless", () => {
    const args = buildChromiumArgs(baseCfg({ headlessMode: "legacy" }), FAKE_UDD, undefined);
    expect(args).toContain("--headless");
    expect(args).not.toContain("--headless=new");
  });

  it("headlessMode='off' emits no headless flag at all", () => {
    const args = buildChromiumArgs(baseCfg({ headlessMode: "off" }), FAKE_UDD, undefined);
    expect(args.some((a) => a === "--headless" || a.startsWith("--headless="))).toBe(false);
  });

  it("headlessMode='new' supersedes headless: false", () => {
    // The launcher resolves the mode; by the time we reach buildChromiumArgs,
    // the resolved mode is canonical.
    const args = buildChromiumArgs(
      baseCfg({ headless: false, headlessMode: "new" }),
      FAKE_UDD,
      undefined,
    );
    expect(args).toContain("--headless=new");
  });

  it("legacy: headless: true with no headlessMode falls back to --headless=new", () => {
    const args = buildChromiumArgs(baseCfg({ headless: true }), FAKE_UDD, undefined);
    expect(args).toContain("--headless=new");
  });

  it("legacy: headless: false with no headlessMode emits no headless flag", () => {
    const args = buildChromiumArgs(baseCfg({ headless: false }), FAKE_UDD, undefined);
    expect(args.some((a) => a === "--headless" || a.startsWith("--headless="))).toBe(false);
  });
});
