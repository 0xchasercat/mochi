/**
 * tests/contract/codegen.contract.test.ts — schemas/codegen idempotency gate.
 *
 * Runs `bun run codegen` and asserts that no file under `packages/*\/src/generated/`
 * changed. Catches PRs that mutate a schema without committing the regenerated TS,
 * or that hand-edit a generated file. See tasks/0003-schemas-and-codegen.md.
 *
 * The test executes only against the on-disk repo state; it does not stage,
 * commit, or modify anything outside of (re-)writing the same generated files.
 *
 * @see PLAN.md §6
 */
import { describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const REPO_ROOT = resolve(import.meta.dir, "..", "..");

interface RunResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

function run(cmd: string, args: readonly string[]): RunResult {
  const result = spawnSync(cmd, args, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: { ...process.env, FORCE_COLOR: "0" },
  });
  return {
    exitCode: result.status ?? -1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

describe("codegen idempotency contract", () => {
  it("running `bun run codegen` produces no diff under packages/*/src/generated/", () => {
    const codegen = run("bun", ["run", "codegen"]);
    expect(codegen.exitCode).toBe(0);

    // `git diff --exit-code` returns 0 when no diff exists, non-zero when a diff
    // is detected. This is the same gate the brief specifies in its Validation
    // section (and the same one CI runs).
    const diff = run("git", [
      "diff",
      "--exit-code",
      "--",
      "packages/consistency/src/generated/",
      "packages/profiles/src/generated/",
      "packages/harness/src/generated/",
    ]);

    if (diff.exitCode !== 0) {
      // Surface the offending diff in the failure message — much faster than
      // re-running the command by hand.
      throw new Error(
        `codegen produced a diff. Either re-run \`bun run codegen\` and commit\n` +
          `the result, or stop hand-editing files under packages/*/src/generated/.\n\n` +
          `--- diff (truncated to 4 KiB) ---\n${diff.stdout.slice(0, 4096)}`,
      );
    }
    expect(diff.exitCode).toBe(0);
  });
});
