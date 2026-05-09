# @mochi.js/net

TypeScript facade for [@mochi.js/net-rs](../net-rs). Provides `Session.fetch` semantics with profile-matching JA3/JA4/H2-Akamai fingerprints via the Rust+wreq backend, bridged through Bun:FFI.

Internal package consumed by `@mochi.js/core`.

**Status:** shipping in v0.2. `Session.fetch` is wired through Bun:FFI to the Rust+wreq cdylib; prebuilt artifacts cover `darwin-{arm64,x64}`, `linux-{x64,arm64}`, and `win32-x64` with a local `cargo build` fallback for other targets.

See [PLAN.md §10](https://github.com/0xchasercat/mochi/blob/main/PLAN.md).
