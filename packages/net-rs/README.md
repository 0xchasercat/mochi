# @mochi.js/net-rs

Prebuilt Rust + [wreq](https://github.com/0x676e67/wreq) cdylib for [mochi](https://github.com/0xchasercat/mochi)'s out-of-band networking.

This package distributes platform-specific native artifacts (`darwin-arm64`, `darwin-x64`, `linux-x64`, `linux-arm64`, `windows-x64`) via npm postinstall, exposed to Bun via `bun:ffi`.

Internal package consumed by `@mochi.js/net`.

**Status:** v0.0.1 claim release — only `mochi_net_version()` symbol implemented. Real wreq integration + prebuilt-binary distribution lands in phase 0.6 / 0.10.

```sh
# build the cdylib locally
cargo build --release --manifest-path packages/net-rs/Cargo.toml
```

See [PLAN.md §10](https://github.com/0xchasercat/mochi/blob/main/PLAN.md) for the C ABI surface.
