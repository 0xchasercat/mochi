/**
 * Belt-and-braces: scan every test source file under `tests/` and
 * `packages/*\/src/__tests__/` and assert NONE of them contains a literal
 * `0x00` byte.
 *
 * Background: CDP pipe-mode framing is NUL-delimited. Several historical
 * fixtures encoded the delimiter as a literal `\x00` inside a template
 * literal. Those bytes rendered as whitespace in `Read` / `cat`, were
 * invisible to `grep`, and routinely cost ~10 minutes of debugging when
 * the next contract test got copy-pasted from the affected file.
 *
 * `tests/helpers/cdp-fixture.ts` encapsulates the framing so test sources
 * NEVER need to embed a NUL. This contract pins the invariant: any future
 * regression that reintroduces a literal NUL fails the build immediately.
 *
 * @see tests/helpers/cdp-fixture.ts
 * @see tasks/0264-cdp-fixture-helper.md
 */

import { describe, expect, it } from "bun:test";
import { readdir, readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..", "..");

/**
 * Recursively walk `dir` and yield every file path matching `accept`.
 * Skips `node_modules`, `dist`, `target`, `.git`, `worktrees` for speed +
 * sanity (they contain binary artifacts).
 */
async function* walk(dir: string, accept: (path: string) => boolean): AsyncGenerator<string> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (
      entry === "node_modules" ||
      entry === "dist" ||
      entry === "target" ||
      entry === ".git" ||
      entry === "worktrees" ||
      entry === "generated"
    ) {
      continue;
    }
    const full = join(dir, entry);
    let st: Awaited<ReturnType<typeof stat>>;
    try {
      st = await stat(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      yield* walk(full, accept);
    } else if (st.isFile() && accept(full)) {
      yield full;
    }
  }
}

function isTestSource(path: string): boolean {
  // Test sources only — skip data fixtures (HTML, JSON, binary) which may
  // legitimately contain NULs. Helper TS files count.
  return (
    /\.(test|contract\.test)\.(ts|tsx|mts|js|mjs)$/.test(path) || /helpers\/.*\.ts$/.test(path)
  );
}

async function findFilesWithNul(roots: string[]): Promise<string[]> {
  const offenders: string[] = [];
  for (const root of roots) {
    for await (const file of walk(root, isTestSource)) {
      const bytes = await readFile(file);
      if (bytes.includes(0x00)) {
        offenders.push(file);
      }
    }
  }
  return offenders;
}

describe("contract: no test source file contains a literal NUL byte", () => {
  it("tests/ contains zero NUL bytes across every test + helper source", async () => {
    const offenders = await findFilesWithNul([join(ROOT, "tests")]);
    if (offenders.length > 0) {
      throw new Error(
        `[cdp-fixture-no-source-nuls] literal 0x00 byte found in test source(s):\n` +
          offenders.map((f) => `  - ${f}`).join("\n") +
          `\nUse tests/helpers/cdp-fixture.ts (programmatic framing) instead.`,
      );
    }
    expect(offenders.length).toBe(0);
  });

  it("packages/*/src/__tests__/ contains zero NUL bytes across every test source", async () => {
    const offenders = await findFilesWithNul([join(ROOT, "packages")]);
    // Only flag files under `__tests__/` — built native binaries (.dylib /
    // .so) under packages/net-rs/native/ legitimately contain NULs and are
    // never read by mochi's TypeScript test scaffold.
    const testOffenders = offenders.filter((f) => f.includes("/__tests__/"));
    if (testOffenders.length > 0) {
      throw new Error(
        `[cdp-fixture-no-source-nuls] literal 0x00 byte found in package test source(s):\n` +
          testOffenders.map((f) => `  - ${f}`).join("\n") +
          `\nUse tests/helpers/cdp-fixture.ts (programmatic framing) instead.`,
      );
    }
    expect(testOffenders.length).toBe(0);
  });
});
