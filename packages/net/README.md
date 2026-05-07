# @mochi.js/net

TypeScript facade for [@mochi.js/net-rs](../net-rs). Provides `Session.fetch` semantics with profile-matching JA3/JA4/H2-Akamai fingerprints via the Rust+wreq backend, bridged through Bun:FFI.

Internal package consumed by `@mochi.js/core`.

**Status:** v0.0.1 claim release. FFI binding lands in phase 0.6.

See [PLAN.md §10](https://github.com/0xchasercat/mochi/blob/main/PLAN.md).
