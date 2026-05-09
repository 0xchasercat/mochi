# @mochi.js/net-rs

Prebuilt Rust + [wreq](https://github.com/0x676e67/wreq) cdylib for [mochi](https://github.com/0xchasercat/mochi)'s out-of-band networking.

This package distributes platform-specific native artifacts (`darwin-arm64`, `darwin-x64`, `linux-x64`, `linux-arm64`, `windows-x64`) via npm postinstall, exposed to Bun via `bun:ffi`.

Internal package consumed by `@mochi.js/net`.

**Status:** shipping in v0.2. Full wreq integration plus prebuilt-binary distribution for `darwin-{arm64,x64}`, `linux-{x64,arm64}`, and `win32-x64`. On unsupported targets (FreeBSD / OpenBSD / Alpine musl / Windows arm64), the loader walks both the postinstall `native/` directory and `target/release/`, so a local `cargo build` Just Works. Set `MOCHI_NET_SKIP_POSTINSTALL=1` to bypass the download entirely.

```sh
# build the cdylib locally
cargo build --release --manifest-path packages/net-rs/Cargo.toml
```

See [PLAN.md §10](https://github.com/0xchasercat/mochi/blob/main/PLAN.md) for the C ABI surface.

## Documentation

- Package reference: <https://mochijs.com/docs/api/net>
- Concept deep-dive: <https://mochijs.com/docs/concepts/network-ffi>
- Cookbook: <https://mochijs.com/docs/guides/pick-a-scenario>
