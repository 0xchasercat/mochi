#!/usr/bin/env bun
/**
 * scripts/codegen.ts — JSON Schema → TypeScript type generator.
 *
 * Reads canonical schemas from `schemas/*.json` and writes generated TS modules
 * to per-package `src/generated/` directories. The contract:
 *
 *   schemas/profile.schema.json       → packages/consistency/src/generated/profile.ts
 *   schemas/matrix.schema.json        → packages/consistency/src/generated/matrix.ts
 *   (consistency owns the canonical) → packages/profiles/src/generated/profile.ts
 *                                        (re-export only — keeps profiles a pure data
 *                                         consumer of the type without duplicating it)
 *   schemas/probe-manifest.schema.json → packages/harness/src/generated/probe-manifest.ts
 *   schemas/diff-report.schema.json    → packages/harness/src/generated/diff-report.ts
 *
 * Idempotent: running twice produces no diff. Enforced by the contract test in
 * tests/contract/codegen.contract.test.ts — change the schema, re-run codegen,
 * commit both, or CI fails.
 *
 * @see PLAN.md §6 and tasks/0003-schemas-and-codegen.md
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { JSONSchema4 } from "json-schema";
import { compile, type Options } from "json-schema-to-typescript";

const REPO_ROOT = resolve(import.meta.dir, "..");
const SCHEMAS_DIR = join(REPO_ROOT, "schemas");

const BANNER =
  "// AUTO-GENERATED — do not edit. Run `bun run codegen` to regenerate.\n" +
  "// Source schema lives in schemas/. See scripts/codegen.ts.\n";

/**
 * Build the per-target compile options. We carry `cwd` to resolve $ref siblings,
 * and a `customName` callback that pins the *root* type name to the target's
 * desired symbol — overriding the library's title-derived default. This lets us
 * keep schemas' original `title` (mandatory for the verbatim Probe Manifest copy)
 * while exporting `ProbeManifestV1` etc. to match PLAN.md's naming.
 */
function compileOptionsFor(target: GenTarget): Partial<Options> {
  return {
    bannerComment: BANNER,
    cwd: SCHEMAS_DIR,
    declareExternallyReferenced: true,
    enableConstEnums: false,
    unknownAny: true,
    strictIndexSignatures: true,
    format: true,
    additionalProperties: false,
    style: {
      semi: true,
      singleQuote: false,
      trailingComma: "all",
      printWidth: 100,
      tabWidth: 2,
      useTabs: false,
    },
    customName: (schema, _keyNameFromDefinition) => {
      // Only override the *root* schema's name. Sub-schemas (titled $defs / nested
      // objects) keep their library-default behaviour.
      if (schema.$id === target.rootId) return target.typeName;
      return undefined;
    },
  };
}

interface GenTarget {
  /** Path to the source schema file relative to SCHEMAS_DIR. */
  readonly schema: string;
  /** The schema's `$id` — used by `customName` to identify the root vs. sub-schemas. */
  readonly rootId: string;
  /** Top-level type name to emit (overrides the schema title). */
  readonly typeName: string;
  /** Output paths relative to REPO_ROOT. Multi-target = same content written to many places. */
  readonly outputs: readonly string[];
}

const TARGETS: readonly GenTarget[] = [
  {
    schema: "profile.schema.json",
    rootId: "https://mochi.js/schemas/profile.schema.json",
    typeName: "ProfileV1",
    outputs: ["packages/consistency/src/generated/profile.ts"],
  },
  {
    schema: "matrix.schema.json",
    rootId: "https://mochi.js/schemas/matrix.schema.json",
    typeName: "MatrixV1",
    outputs: ["packages/consistency/src/generated/matrix.ts"],
  },
  {
    schema: "probe-manifest.schema.json",
    rootId: "https://mochijs.com/schemas/probe-manifest.schema.json",
    typeName: "ProbeManifestV1",
    outputs: ["packages/harness/src/generated/probe-manifest.ts"],
  },
  {
    schema: "diff-report.schema.json",
    rootId: "https://mochi.js/schemas/diff-report.schema.json",
    typeName: "DiffReportV1",
    outputs: ["packages/harness/src/generated/diff-report.ts"],
  },
];

/**
 * Re-exports kept *outside* the codegen library — these are stable shims that
 * point a consumer package's generated/ folder at another package's canonical
 * source. The shim itself is generated (so a future schema-rename rewrites it),
 * but its content is hand-templated, not produced by json-schema-to-typescript.
 *
 * Per PLAN.md §5.6 and the brief: @mochi.js/profiles re-exports ProfileV1 from
 * @mochi.js/consistency rather than owning a duplicate type.
 */
interface ReExportTarget {
  readonly output: string;
  readonly content: string;
}

const REEXPORTS: readonly ReExportTarget[] = [
  {
    output: "packages/profiles/src/generated/profile.ts",
    content:
      BANNER +
      "// Re-export of the canonical ProfileV1 type from @mochi.js/consistency.\n" +
      "// @mochi.js/profiles is a data-fixture package; the type lives in consistency\n" +
      "// (PLAN.md §5.6) and consumers share a single source of truth.\n" +
      "\n" +
      'export type { ProfileV1 } from "@mochi.js/consistency";\n',
  },
];

async function ensureDir(filePath: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
}

async function readSchema(schemaPath: string): Promise<JSONSchema4> {
  const raw = await readFile(schemaPath, "utf8");
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error(`schema at ${schemaPath} did not parse to an object`);
  }
  return parsed as JSONSchema4;
}

/**
 * Write only when content differs. Avoids touching mtimes on no-op runs.
 * Idempotency is guaranteed by `compile`'s deterministic output for a fixed
 * input + options pair.
 */
async function writeIfChanged(filePath: string, content: string): Promise<boolean> {
  await ensureDir(filePath);
  let prev: string | null = null;
  try {
    prev = await readFile(filePath, "utf8");
  } catch {
    // file doesn't exist; fall through to write
  }
  if (prev === content) return false;
  await writeFile(filePath, content, "utf8");
  return true;
}

async function generateTarget(target: GenTarget): Promise<{ wrote: number; total: number }> {
  const schemaPath = join(SCHEMAS_DIR, target.schema);
  const schema = await readSchema(schemaPath);
  const compiled = await compile(schema, target.typeName, compileOptionsFor(target));

  let wrote = 0;
  for (const rel of target.outputs) {
    const absolute = join(REPO_ROOT, rel);
    if (await writeIfChanged(absolute, compiled)) wrote += 1;
  }
  return { wrote, total: target.outputs.length };
}

async function generateReExport(reExport: ReExportTarget): Promise<boolean> {
  const absolute = join(REPO_ROOT, reExport.output);
  return writeIfChanged(absolute, reExport.content);
}

async function main(): Promise<void> {
  let totalChanged = 0;
  let totalWritten = 0;

  for (const target of TARGETS) {
    const { wrote, total } = await generateTarget(target);
    totalChanged += wrote;
    totalWritten += total;
    process.stdout.write(
      `[codegen] ${target.schema} -> ${target.typeName} (${wrote}/${total} changed)\n`,
    );
  }

  for (const reExport of REEXPORTS) {
    const changed = await generateReExport(reExport);
    if (changed) totalChanged += 1;
    totalWritten += 1;
    process.stdout.write(
      `[codegen] re-export ${reExport.output} (${changed ? "changed" : "unchanged"})\n`,
    );
  }

  process.stdout.write(`[codegen] done. ${totalChanged}/${totalWritten} files updated.\n`);
}

main().catch((err: unknown) => {
  // codegen is a CLI script; console.error is allowed by biome.json's noConsole config.
  console.error("[codegen] failed:", err);
  process.exit(1);
});
