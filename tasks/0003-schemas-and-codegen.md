# 0003: schemas + codegen

**Package:** `schemas` (touches `schemas/`, `scripts/codegen.ts`, `@mochi.js/{consistency,profiles,harness}`)
**Phase:** `0.0`
**Estimated size:** M
**Dependencies:** 0001 (already merged)

## Goal

Land the canonical JSON Schema sources for `ProfileV1`, `MatrixV1`, `ProbeManifestV1`, `DiffReportV1`, plus a codegen pipeline that emits TypeScript types from those schemas. Replace the hand-written placeholder types in `@mochi.js/{consistency,profiles,harness}` with codegen output. After this lands, every type referencing one of those four shapes derives from a single schema source of truth, and a CI check guarantees committed types match the schemas.

## Success criteria

- [ ] `schemas/profile.schema.json` — JSON Schema 2020-12, validates the shape sketched in PLAN.md §6.1. Required fields: `id`, `version`, `engine`, `browser`, `os`, `device`, `display`, `gpu`, `audio`, `fonts`, `timezone`, `locale`, `languages`, `behavior`, `wreqPreset`, `userAgent`, `uaCh`, `entropyBudget`. Use `additionalProperties: false`. `engine` enum is `["chromium"]` (v1 invariant). `browser.name` enum is `["chrome", "edge", "brave", "arc", "opera"]`.
- [ ] `schemas/matrix.schema.json` — extends the profile shape with required `seed: string`, `derivedAt: string (date-time)`, `consistencyEngineVersion: string`. Use `$ref` to import profile.schema.json where shapes overlap.
- [ ] `schemas/probe-manifest.schema.json` — **verbatim copy** of `~/Peekaboo/peekaboo/schemas/probe-manifest.schema.json` (the file at `/Users/marcxavier/Peekaboo/peekaboo/schemas/probe-manifest.schema.json` on this machine). Add a top-level `$comment` declaring "Vendored from Peekaboo's schema. Sync quarterly per PLAN.md §6.3. Do not hand-edit." Keep the original `$id` and `title` intact.
- [ ] `schemas/diff-report.schema.json` — JSON Schema 2020-12, matches PLAN.md §6.4. Required fields: `reportVersion: "1"`, `generatedAt`, `profile`, `verdict` (enum `["EQUIVALENT", "DIVERGED"]`), `counts: {material, intentional, guidClass}`, `structuralMatchPct`, `diffs`.
- [ ] `scripts/codegen.ts` — Bun-native TypeScript script that:
  1. Reads each schema in `schemas/*.json`.
  2. Generates a TS module with exported types using `json-schema-to-typescript` (added as devDep).
  3. Writes outputs to: `packages/consistency/src/generated/profile.ts`, `packages/consistency/src/generated/matrix.ts`, `packages/profiles/src/generated/profile.ts` (re-exports for type stability), `packages/harness/src/generated/{probe-manifest.ts,diff-report.ts}`.
  4. Each generated file starts with `// AUTO-GENERATED — do not edit. Run \`bun run codegen\` to regenerate.`
  5. The script is idempotent: running it twice produces no diff.
- [ ] Each consumer package replaces its hand-written placeholder types with `export type { ... } from "./generated/...";` in `src/index.ts`.
- [ ] Root `package.json` `"codegen"` script: replace placeholder `echo` with `bun scripts/codegen.ts`.
- [ ] CI gate: a `tests/contract/codegen.contract.test.ts` that runs `bun run codegen` and asserts `git diff --exit-code packages/*/src/generated/` reports no changes. Catches PRs that change schemas without re-running codegen.
- [ ] All existing smoke tests in consistency/profiles/harness continue to pass with the new codegen'd types (you may need to widen test fixtures since the real types are stricter than placeholders).
- [ ] `@types/json-schema-to-typescript` and `json-schema-to-typescript` added as **root** devDependencies.
- [ ] All package gates green: typecheck, lint, test, test:contract.

## Out of scope

- Runtime schema validation (Ajv, Zod, etc.). v0 is types-only; runtime validation is a separate concern, deferred to a phase where it's actually needed (probably 0.4 when `mochi capture` writes real profiles).
- Actual profile *data* — only the schema shape lands here. Real `profile.json` and `baseline.manifest.json` files are captured in phase 0.4.
- Schema migration logic (v1 → v2). v1 only.
- A schema bundling/inlining step. Schemas live as separate JSON files at `schemas/*.json`; codegen reads them directly.
- Generating types for the `@mochi.js/inject` package (it consumes `MatrixV1` from consistency, doesn't define new shapes).

## Implementation notes

- Use [`json-schema-to-typescript`](https://www.npmjs.com/package/json-schema-to-typescript) v15.x. It supports JSON Schema 2020-12 well. API: `compile(schema, name, options)`.
- For `matrix.schema.json` to `$ref` `profile.schema.json`, set the `$id`s correctly and use the library's `cwd` option so refs resolve.
- The Probe Manifest schema is large (~270 lines, heavily nested with `$defs`). The library handles `$defs` correctly. Verify the generated types compile by running typecheck; expect a few hundred lines of generated output.
- Generated files go to `src/generated/` per package. Add to each package's `tsconfig.json` `include` if needed (already covered by `src/**/*`).
- `src/generated/` is **committed** (not gitignored). Easier review, no codegen-on-install dance, the contract test catches drift.
- Place a `packages/<pkg>/src/generated/.gitkeep` in each before generating, so the directory exists in fresh checkouts even if codegen output ever goes empty.
- The `@mochi.js/profiles` package re-exports `ProfileV1` from `@mochi.js/consistency` via the generated module — both packages share the *type*, but the consistency engine *owns* the canonical source. Keep this single-source pattern.
- For the contract test, isolate the codegen run from the rest of the test suite — wrap in `describe.skip` if running on Bun versions where some Bun.spawn semantics break unit-test cwd handling. Document the workaround if needed.

## Validation

```sh
bun install
bun run codegen
git diff --exit-code packages/*/src/generated/   # idempotency
bun typecheck
bun lint
bun test
bun test:contract --pkg=schemas
```

Touch `schemas/profile.schema.json` (e.g., add a description), then `bun run codegen`, then `git diff` should show new generated content. Revert.

## Touch list (rough)

- `schemas/profile.schema.json` (new)
- `schemas/matrix.schema.json` (new)
- `schemas/probe-manifest.schema.json` (new — verbatim from Peekaboo with $comment)
- `schemas/diff-report.schema.json` (new)
- `scripts/codegen.ts` (new)
- `packages/consistency/src/generated/{profile.ts,matrix.ts}` (generated)
- `packages/profiles/src/generated/profile.ts` (generated re-export)
- `packages/harness/src/generated/{probe-manifest.ts,diff-report.ts}` (generated)
- `packages/{consistency,profiles,harness}/src/index.ts` (replace placeholder types with generated)
- `packages/{consistency,profiles,harness}/src/__tests__/smoke.test.ts` (widen fixtures as needed)
- `tests/contract/codegen.contract.test.ts` (new)
- `package.json` (root): replace `codegen` placeholder, add devDeps
