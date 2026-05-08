# 0100: cross-platform Rust prebuilds + npm postinstall

**Package:** primarily `net-rs` + repo-level CI/release infra
**Phase:** `0.10`
**Estimated size:** XL
**Dependencies:** 0001, 0060 (Rust crate + Bun:FFI binding), 0004 (Changesets release pipeline)

## Goal

Eliminate the `cargo build` requirement for `@mochi.js/net-rs` consumers. After this lands, `bun add @mochi.js/core` Just Works on supported platforms — npm postinstall downloads the right cdylib from a GitHub Release artifact, and the Bun:FFI loader picks it up. The release pipeline (changesets/action@v1) builds prebuilt binaries on a CI matrix per push to `changeset-release/main` AND attaches them to the published version tag.

After this, v1.0 install path is: `bun add @mochi.js/core && mochi browsers install` → working session in under 5 minutes on any supported platform.

## Success criteria

### Build matrix

- [ ] GitHub Actions workflow (`.github/workflows/build-prebuilds.yml`) builds `@mochi.js/net-rs` cdylib on a 5-platform matrix:
  - `darwin-arm64` (macos-latest with `--target aarch64-apple-darwin`)
  - `darwin-x64` (macos-latest with `--target x86_64-apple-darwin`)
  - `linux-x64` (ubuntu-latest with `--target x86_64-unknown-linux-gnu`)
  - `linux-arm64` (ubuntu-latest with `--target aarch64-unknown-linux-gnu` via `cross` or `cargo-zigbuild`)
  - `windows-x64` (windows-latest with `--target x86_64-pc-windows-msvc`)
- [ ] Each job produces a single artifact: `mochi_net-{platform}.{dylib|so|dll}` with consistent naming. Plus a `mochi_net-{platform}.sha256` companion.
- [ ] Workflow trigger: `release` event (`{ types: [published] }`) — runs once per real npm publish. Plus `workflow_dispatch` for manual rebuild. Plus `pull_request` against the workflow file itself for CI sanity (with `if: matrix.target == 'darwin-arm64'` to keep PR runs fast — full matrix only on release).
- [ ] Build is reproducible: pinned Rust toolchain (`stable`, version pinned in `rust-toolchain.toml`), pinned `wreq` version (already `5.3.0` from 0060), `--frozen-lockfile` semantics on `Cargo.lock` (committed).

### Distribution: prebuilt artifacts attached to GitHub Release

- [ ] When `changesets/action@v1` publishes a new version (the `bun run release` step in `release.yml`), the build-prebuilds workflow runs against the resulting tag, builds the 5 cdylibs, and uploads them as **release assets** on the corresponding GH Release.
- [ ] The release tag corresponds to the `@mochi.js/net-rs` version exactly (changesets writes per-package tags like `@mochi.js/net-rs@0.1.0`).
- [ ] If a release fails partway (some platforms succeed, some fail), the published npm package is rolled back via `npm deprecate` and the release is marked as draft. Document the recovery path.

### npm postinstall: download + verify

- [ ] `packages/net-rs/scripts/install-prebuild.ts` (Bun-native) — runs as `postinstall` for `@mochi.js/net-rs`. Behavior:
  1. Detect `process.platform + process.arch` → resolve to one of the 5 supported platform tuples; if unsupported, print a friendly error pointing at `cargo build` fallback and exit 0 (don't break install — the `@mochi.js/net` facade returns a clearer error at first `fetch()` call).
  2. Compute the GitHub Release asset URL for the current `package.json` version. URL pattern: `https://github.com/0xchasercat/mochi/releases/download/@mochi.js/net-rs@${version}/mochi_net-${platform}.{ext}`.
  3. Download via Bun's native `fetch`. Stream to a temp file in `os.tmpdir()`.
  4. Download the companion `.sha256`. Verify the binary's hash via `Bun.CryptoHasher`. If mismatch: delete temp, exit non-zero with a clear message.
  5. Atomic rename to `packages/net-rs/native/mochi_net-${platform}.{ext}`.
  6. Skip download entirely if the file already exists at the right path with the right hash (idempotent re-install).
  7. Skip download entirely if `MOCHI_NET_SKIP_POSTINSTALL=1` is set (allows `cargo build` workflow for development).
- [ ] `packages/net-rs/native/` is gitignored AND added to `packages/net-rs/package.json` `files` (so npm includes the directory in the published tarball even though local `native/` is gitignored — npm's `files` is independent of git). Empty `.npmignore` at `packages/net-rs/native/` to ensure the dir survives tarballing.

### Bun:FFI loader resolution

- [ ] `packages/net/src/ffi.ts` resolution order (modify the existing dlopen call):
  1. `MOCHI_NET_DYLIB` env var override (if set, dlopen exactly that path).
  2. `packages/net-rs/native/mochi_net-${platform}.${ext}` (the postinstall-downloaded location).
  3. `packages/net-rs/target/release/libmochi_net.${ext}` (the cargo build location, for development).
  4. Friendly error: "no @mochi.js/net-rs binary found for ${platform}. Either: (a) verify your platform is supported, (b) run cargo build, or (c) set MOCHI_NET_DYLIB."
- [ ] Document this in JSDoc on the loader.

### Workflow integration: chain build-prebuilds AFTER changesets publish

- [ ] Modify `.github/workflows/release.yml`: after the `changesets/action@v1` publish step succeeds, trigger the build-prebuilds workflow via `peter-evans/repository-dispatch@v3` or `workflow_dispatch` with the published version as input.
- [ ] OR (simpler): make `build-prebuilds.yml` listen on `release: { types: [published] }` directly. GH Releases are created by changesets/action when publish succeeds. This keeps `release.yml` unchanged and makes the prebuild workflow self-contained.
- [ ] When the prebuild artifacts are uploaded to the existing GH Release for `@mochi.js/net-rs@<version>`, that completes the release.

### Tests

- [ ] Unit test for `install-prebuild.ts` against a mocked `fetch` + `Bun.file`. Cover: happy path, unsupported platform graceful skip, network failure, sha256 mismatch, idempotent re-install, env var skip.
- [ ] Cross-package contract test: `@mochi.js/net`'s loader correctly picks up a binary at `packages/net-rs/native/` over `packages/net-rs/target/`. Use a stub binary file (just any bytes; loader should `dlopen` and fail later — we only test path resolution).
- [ ] All gates green.
- [ ] **Don't break the existing dev workflow**: `cargo build --release --manifest-path packages/net-rs/Cargo.toml && bun test:contract --pkg=net` must continue to work locally without any prebuilt download.

### Other

- [ ] `docs/limits.md` — remove the v0.6 entry that said "prebuilt binaries deferred to phase 0.10". Add a v0.10 entry naming the supported platforms + the cargo-build fallback for unsupported platforms.
- [ ] Changeset: `@mochi.js/net-rs` + `@mochi.js/net` minor (postinstall + loader behavior change is user-visible).
- [ ] Update root `package.json` postinstall script to NOT block on `@mochi.js/net-rs` postinstall failure (so dev workflows still install successfully even when offline / on unsupported platforms).
- [ ] `rust-toolchain.toml` at repo root: pin to `stable` (or specific version), `targets = ["x86_64-unknown-linux-gnu", "aarch64-unknown-linux-gnu", "x86_64-apple-darwin", "aarch64-apple-darwin", "x86_64-pc-windows-msvc"]`.

## Out of scope

- HTTP/3 / QUIC — already in `wreq`, exposed when needed.
- A relicensed Chrome catalog to replace wreq-default — phase 0.7 / future.
- WASM build of `@mochi.js/net-rs` for browsers — different shape, later.
- Per-architecture optimization flags beyond `--release` defaults.
- Mirror server / CDN for prebuilds — GitHub Releases is sufficient at v0.10.
- Prebuilds for FreeBSD / OpenBSD / Alpine musl — defer; consumers cargo-build.
- Reproducible-builds attestation (SLSA Level 2+) — v1.x.

## Implementation notes

- For Linux ARM cross-compilation: `cargo-zigbuild` is simpler than `cross` (no Docker), works on ubuntu-latest, and produces a glibc binary without container ceremony. Recommend.
- For macOS universal binaries: NOT v0.10. Ship separate arm64 and x64 binaries; loader picks based on `process.arch`.
- For Windows: stick with `x86_64-pc-windows-msvc`. The `gnu` target requires a different runtime (mingw); `msvc` is what real Chrome ships with.
- For the postinstall: `Bun.spawn(["bun", "scripts/install-prebuild.ts"])` from `package.json` `postinstall`. The script handles its own platform detection + download; npm/yarn/pnpm-on-Bun all flow through Bun execution.
- For the `release` event listener: `release.yml`'s `permissions: { contents: write }` is already set; that's sufficient to upload assets to the release. Use `softprops/action-gh-release@v2` for the upload step.
- `Cargo.lock` is already committed (per 0001's setup).
- `bun.lock` will pick up the postinstall script reference when the `@mochi.js/net-rs` package's postinstall is registered.
- The npm published-tarball for `@mochi.js/net-rs` does NOT include the prebuilt binary — it includes the postinstall script that downloads it. This keeps the npm tarball small (~50KB) instead of ~50MB.

## Validation

```sh
# locally:
bun typecheck
bun lint
bun test
bun test:contract --pkg=net

# Rust still builds cleanly:
cargo build --release --manifest-path packages/net-rs/Cargo.toml
cargo test --manifest-path packages/net-rs/Cargo.toml

# postinstall script runs without breaking install (offline-tolerant):
MOCHI_NET_SKIP_POSTINSTALL=1 bun install
bun install   # with network, should download the prebuild for current platform OR gracefully skip

# the JA4 E2E (from 0060) must still work — but now via the prebuilt path,
# not via cargo build:
rm -rf packages/net-rs/target/release    # nuke local cargo build
MOCHI_NET_E2E=1 bun test tests/contract/net-ja4.contract.test.ts
# expect: pass (loader found the postinstall-downloaded binary OR cargo
#         built one fresh OR cargo wasn't run because we just nuked it
#         and we're testing the prebuild path)
```

When everything's green: `bun work submit 0100 --draft`.

## Touch list (rough)

- `.github/workflows/build-prebuilds.yml` (new)
- `rust-toolchain.toml` (new at repo root)
- `packages/net-rs/scripts/install-prebuild.ts` (new)
- `packages/net-rs/scripts/__tests__/install-prebuild.test.ts` (new)
- `packages/net-rs/package.json` (postinstall script + files entry for native/)
- `packages/net-rs/native/.gitkeep` (new — placeholder)
- `packages/net-rs/.npmignore` (new — empties the local rule for native/)
- `packages/net/src/ffi.ts` (loader resolution chain)
- `packages/net/src/__tests__/ffi-resolution.test.ts` (new)
- `tests/contract/net-prebuild-resolution.contract.test.ts` (new)
- `docs/limits.md` (cross off "prebuilds deferred")
- `.changeset/cross-platform-prebuilds.md` (new)
- `.gitignore` (add `packages/net-rs/native/*` except `.gitkeep`)
