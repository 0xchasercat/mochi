# 0001: monorepo scaffold

**Package:** `repo`
**Phase:** `0.0`
**Estimated size:** M
**Dependencies:** none

## Goal

Stand up the Bun-workspace monorepo skeleton so subsequent tasks have a working `bun install` / `bun typecheck` / `bun test` / `bun lint` foundation. CI gates pass on an empty repo. Every package directory exists with a minimal `package.json` + `tsconfig.json` and an exported placeholder.

This is the foundation every other task builds on. Be conservative; do not pre-implement anything beyond scaffolding.

## Success criteria

- [ ] Root `package.json` is a Bun workspace (`workspaces: ["packages/*"]`), engines `bun >= 1.1`, private `true`, license MIT.
- [ ] Each package under `packages/` exists with: `package.json` (name, version `0.0.0`, private if appropriate, exports placeholder, scripts: build/typecheck/test/lint), `tsconfig.json` extending `tsconfig.base.json`, `src/index.ts` exporting a placeholder, `src/__tests__/smoke.test.ts` that asserts the placeholder export.
- [ ] Packages exist (in this order, matching PLAN.md §5): `core`, `consistency`, `inject`, `net`, `net-rs` (Rust crate placeholder + `package.json` shim for npm), `behavioral`, `profiles`, `harness`, `cli`. **Nine packages total.** No umbrella package (PLAN.md §5.9).
- [ ] `tsconfig.base.json` at root with `strict: true`, `noUncheckedIndexedAccess: true`, `noImplicitAny: true`, `target: "esnext"`, `module: "esnext"`, `moduleResolution: "bundler"`, `lib: ["esnext", "dom"]`, `jsx: "preserve"`, `composite: true`.
- [ ] `biome.json` at root with sensible defaults; `bun lint` clean.
- [ ] `bun typecheck` runs across all packages and is clean.
- [ ] `bun test` runs and all smoke tests pass.
- [ ] `.github/workflows/pr-fast.yml` exists and runs typecheck + lint + test on `pull_request` against `main`.
- [ ] `package.json` `scripts` at root: `typecheck`, `lint`, `test`, `test:contract`, `harness:smoke`, `harness:full`, `harness:diff`, `codegen` (the last four are placeholders that exit 0 in v0.0).
- [ ] `commitlint` config + `commit-msg` hook installed via `bun install` postinstall (using `simple-git-hooks` or equivalent that's Bun-compatible).
- [ ] `Cargo.toml` at root (Rust workspace) referencing `packages/net-rs` as a member; `packages/net-rs/Cargo.toml` is a placeholder `cdylib` crate that builds (no functionality yet, just `pub extern "C" fn mochi_net_version() -> *const c_char`).
- [ ] All packages publish-ready metadata: `publishConfig.access: "public"`, `repository`, `keywords`, `description`. Versions all `0.0.0`.

## Out of scope

- Any actual CDP, consistency, inject, network, or behavioral logic. **Strictly scaffolding.**
- The `mochi-work` CLI (separate task: 0002).
- Schema files (separate task: 0003).
- Profile data (deferred until a real device captures one).
- Changesets configuration (separate task: 0004).
- Docs site (deferred until later phases).

## Implementation notes

- Read `PLAN.md` §15.1 (monorepo layout) and §15.6 (CI gates). The layout in §15.1 is normative.
- Use `bun init` only as a starting reference; the actual scaffolding will be hand-written to match the layout exactly.
- For the Rust workspace member: `Cargo.toml` `[lib] crate-type = ["cdylib", "rlib"]`. Build with `cargo build --release --manifest-path packages/net-rs/Cargo.toml`.
- For tests, prefer Bun's built-in `bun:test` over Vitest. Bun-native is the runtime invariant.
- `biome.json` should match the modern defaults — see https://biomejs.dev/. Set `formatter.indentStyle: "space"`, `linter.rules.recommended: true`. Disable `noConsole` for `@mochi.js/cli` only.
- The `simple-git-hooks` config goes in root `package.json`. Hook command: `bunx commitlint --edit $1`.
- For `commitlint`, use `@commitlint/config-conventional` and customize `scope-enum` to match PLAN.md §15.4 allowed scopes.
- The `.github/workflows/pr-fast.yml` should run on Ubuntu only at v0.0; the macos/windows matrix lands later when those packages are ready.
- Don't add Changesets yet — task 0004 handles that. Just leave a TODO comment in the root `package.json`.

## Validation

```sh
# Clone the worktree fresh, then:
bun install
bun typecheck
bun lint
bun test
cargo build --release --manifest-path packages/net-rs/Cargo.toml

# Sanity check that every package is reachable:
ls packages/*/package.json | wc -l    # expect 9

# CI-equivalent local run:
bun run typecheck && bun run lint && bun run test
```

When all of the above succeeds and the PR template's gates checklist is honestly all green, run `mochi-work submit 0001`.
