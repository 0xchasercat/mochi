/**
 * Chromium binary resolution.
 *
 * Resolution order (per task brief 0011):
 *   1. `LaunchOptions.binary` (explicit override)
 *   2. `process.env.MOCHI_CHROMIUM_PATH`
 *   3. `@mochi.js/cli`'s `resolveChromiumBinary()` if installed
 *   4. error with actionable message
 *
 * The cli import is dynamic + lazy; absence of `@mochi.js/cli` (or absence of
 * the `resolveChromiumBinary` export — it lands in task 0010) is non-fatal.
 *
 * @see PLAN.md §5.1 / §8 / §15
 */

/**
 * Thrown when no Chromium binary can be found via any resolution path.
 * The message names the exact remediation steps.
 */
export class ChromiumNotFoundError extends Error {
  constructor() {
    super(
      "[mochi] could not locate a Chromium binary.\n" +
        "  Resolution order: LaunchOptions.binary > MOCHI_CHROMIUM_PATH env > @mochi.js/cli " +
        "resolveChromiumBinary().\n" +
        "  Fix: either\n" +
        "    • install Chromium-for-Testing via `mochi browsers install` (lands in phase 0.11), or\n" +
        "    • set MOCHI_CHROMIUM_PATH to a stock Chromium binary, or\n" +
        '    • pass `binary: "/path/to/chromium"` to mochi.launch().',
    );
    this.name = "ChromiumNotFoundError";
  }
}

/**
 * The shape `@mochi.js/cli`'s `resolveChromiumBinary` returns (per task 0010).
 * Defined inline so we don't take a hard dep on the cli package's type surface.
 *
 * The function returns `{ path, channel, version, platform }` on success; it
 * THROWS when no install is found (with a friendly "run `mochi browsers
 * install`" message). We wrap in try/catch and treat both throw + missing
 * symbol as "not resolvable from cli", letting the caller surface the
 * canonical {@link ChromiumNotFoundError}.
 *
 * Earlier versions of this binding incorrectly typed the return as
 * `string | null` and discarded the resolved object — the integration broke
 * silently on every host where MOCHI_CHROMIUM_PATH wasn't set (local M4 with
 * the env var set masked it; CI without it caught it). Pinned by
 * `tests/contract/core-cli-binary-resolution.contract.test.ts`.
 */
type CliResolveResult = {
  readonly path: string;
  readonly channel?: string;
  readonly version?: string;
  readonly platform?: string;
};
type CliResolveFn = (
  opts?: Record<string, unknown>,
) => Promise<CliResolveResult> | CliResolveResult;

async function tryCliResolve(): Promise<string | null> {
  try {
    // @mochi.js/cli is a lazy, optional dependency at v0.1: task 0010 hasn't
    // necessarily landed in every consumer's lockfile, and `resolveChromiumBinary`
    // is a forward-looking export. Importing dynamically + catching keeps the
    // env-var path working when the cli isn't installed.
    // @ts-expect-error — optional peer; resolved at runtime if present.
    const mod = (await import("@mochi.js/cli")) as Record<string, unknown>;
    const fn = mod.resolveChromiumBinary;
    if (typeof fn !== "function") return null;
    const result = await (fn as CliResolveFn)();
    if (
      result !== null &&
      typeof result === "object" &&
      typeof result.path === "string" &&
      result.path.length > 0
    ) {
      return result.path;
    }
    return null;
  } catch {
    // cli not installed, the symbol's not exported yet, OR resolveChromiumBinary
    // threw because no install is registered — all flow to the canonical
    // ChromiumNotFoundError below. The thrown error from the cli is
    // intentionally NOT propagated — the core's error message is more
    // actionable in this layer.
    return null;
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    return await Bun.file(path).exists();
  } catch {
    return false;
  }
}

/**
 * Resolve a Chromium binary path. Returns the first working candidate; throws
 * {@link ChromiumNotFoundError} if every option is empty.
 *
 * @param explicit `LaunchOptions.binary` from the user, if any.
 */
export async function resolveBinary(explicit?: string): Promise<string> {
  if (explicit !== undefined && explicit.length > 0) {
    if (!(await pathExists(explicit))) {
      throw new Error(`[mochi] LaunchOptions.binary points to a non-existent path: ${explicit}`);
    }
    return explicit;
  }
  const fromEnv = process.env.MOCHI_CHROMIUM_PATH;
  if (typeof fromEnv === "string" && fromEnv.length > 0) {
    if (!(await pathExists(fromEnv))) {
      throw new Error(`[mochi] MOCHI_CHROMIUM_PATH points to a non-existent path: ${fromEnv}`);
    }
    return fromEnv;
  }
  const fromCli = await tryCliResolve();
  if (fromCli !== null) {
    if (!(await pathExists(fromCli))) {
      throw new Error(
        `[mochi] @mochi.js/cli resolveChromiumBinary returned a non-existent path: ${fromCli}`,
      );
    }
    return fromCli;
  }
  throw new ChromiumNotFoundError();
}
