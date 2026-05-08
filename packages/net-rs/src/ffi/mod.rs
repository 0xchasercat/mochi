//! Internal modules backing the C ABI.
//!
//! The actual `extern "C"` functions live in `lib.rs`; the modules here
//! contain the safe Rust internals so that `cargo test` can exercise them
//! without going through `unsafe` FFI calls.

pub(crate) mod ctx;
pub(crate) mod error;
pub(crate) mod preset;
pub(crate) mod request;
pub(crate) mod response;
