# @mochi.js/net-rs

## 0.1.0

### Minor Changes

- 70a1eb2: Cross-platform prebuilds for `@mochi.js/net-rs` (PLAN.md §14 phase 0.10).

  The `@mochi.js/net-rs` package now ships an `npm postinstall` script
  (`scripts/install-prebuild.ts`, Bun-native) that downloads a prebuilt
  `mochi_net-${platform}.${ext}` cdylib from the matching GitHub Release
  tag and verifies it against a sibling `.sha256`. Five platforms are
  covered: `darwin-arm64`, `darwin-x64`, `linux-x64`, `linux-arm64`,
  `win32-x64`. Set `MOCHI_NET_SKIP_POSTINSTALL=1` to opt out (cargo-build
  dev workflow). Unsupported platforms emit a friendly message and exit 0
  — install never breaks.

  `@mochi.js/net`'s FFI loader (`packages/net/src/ffi.ts`) gains a new
  resolution chain: `MOCHI_NET_DYLIB` env override → `<net-rs>/native/…`
  (postinstall asset) → `target/release/…` (developer cargo build) →
  `target/debug/…`. The cargo-build dev workflow continues to work
  without any download.

  Build pipeline: `.github/workflows/build-prebuilds.yml` runs a 5-platform
  matrix on every `release: { types: [published] }` whose tag names
  `@mochi.js/net-rs` and uploads each binary + sha256 to the GH Release.
  PR runs build only `darwin-arm64` (cost control). Linux arm64 cross-
  compiles via `cargo-zigbuild`.

### Patch Changes

- 4f09750: Initial v0.0.1 claim release with placeholder exports. Surface lands incrementally per PLAN.md §14.
