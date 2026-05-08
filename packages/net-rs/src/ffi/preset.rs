//! Translate a `(preset, proxy)` JSON shape into a `wreq::Client` configured
//! for browser-style HTTP.
//!
//! ## Licensing constraint (PLAN.md I-2)
//!
//! `wreq` itself is Apache-2.0 and ships the *primitives* for fingerprint
//! emulation (`EmulationProvider`, `TlsConfig`, `Http2Config`, header order).
//! The companion crate `wreq-util` ships ready-made `Emulation::Chrome131`
//! profiles, **but is GPL-3.0 / LGPL-3.0** — a copyleft license incompatible
//! with mochi's I-2 invariant ("fully open-source, MIT-licensed").
//!
//! We therefore depend on `wreq` only and author Chrome-style profiles in this
//! file. v0.6 is a minimal, intentionally lightweight profile that uses
//! `EmulationProvider::default()` plus a Chrome User-Agent header. The wire
//! JA4 emitted by `wreq` + BoringSSL with the default `EmulationProvider`
//! is **not** a per-version Chrome JA4 — it is documented in
//! `docs/limits.md` and pinned by the JA4 contract test as the actual
//! observed value. Authoring per-version Chrome profiles (cipher list, ALPN
//! ordering, supported groups, signature algorithms, GREASE permutation,
//! HTTP/2 SETTINGS frame, header order) is deferred until either:
//!   (a) `wreq-util` relicenses to Apache/MIT, or
//!   (b) we vendor a clean-room Apache-2.0 profile catalog.
//!
//! See PLAN.md §10.3 and the brief at `tasks/0060-network-ffi.md`.

use serde::Deserialize;
use std::time::Duration;
use wreq::{Client, EmulationProvider, Proxy};

use super::error;

/// JSON shape the FFI caller sends as `preset_json` to `mochi_net_open`.
#[derive(Debug, Deserialize)]
pub(crate) struct PresetSpec {
    /// Profile preset name, e.g. `chrome_131_macos`. Always lowercased before
    /// lookup.
    pub preset: String,
    /// Optional outbound proxy: `http://host:port`, `https://host:port`,
    /// `socks5://host:port`, with optional `user:pass@` userinfo.
    pub proxy: Option<String>,
    /// Optional connect timeout in milliseconds. Defaults to 10_000.
    pub connect_timeout_ms: Option<u64>,
    /// Optional total timeout in milliseconds. Defaults to 30_000.
    pub timeout_ms: Option<u64>,
}

/// What we resolved a preset name to.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ResolvedPreset {
    Chrome,
    Edge,
    Safari,
    Firefox,
    /// Preset string was unknown — caller's `last_error` was populated with a
    /// warning and we fell back to `Chrome`.
    UnknownFallbackChrome,
}

impl ResolvedPreset {
    /// User-Agent string for this preset family. The minor version is fixed
    /// per-family at v0.6; later phases will derive this from the Matrix.
    pub(crate) fn user_agent(self) -> &'static str {
        match self {
            Self::Chrome | Self::UnknownFallbackChrome => {
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
            }
            Self::Edge => {
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0"
            }
            Self::Safari => {
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15"
            }
            Self::Firefox => {
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:131.0) Gecko/20100101 Firefox/131.0"
            }
        }
    }
}

/// Look up a preset string. Returns the resolved family and surfaces a
/// `last_error` warning when the input was unrecognised (caller can still
/// read the response — but it's served from the Chrome fallback profile).
pub(crate) fn resolve_preset(raw: &str) -> ResolvedPreset {
    let key = raw.trim().to_ascii_lowercase();
    if key.starts_with("chrome") {
        return ResolvedPreset::Chrome;
    }
    if key.starts_with("edge") {
        return ResolvedPreset::Edge;
    }
    if key.starts_with("safari") {
        return ResolvedPreset::Safari;
    }
    if key.starts_with("firefox") {
        return ResolvedPreset::Firefox;
    }
    error::set(format!(
        "[mochi-net] unknown preset '{raw}', falling back to chrome"
    ));
    ResolvedPreset::UnknownFallbackChrome
}

/// Build a `wreq::Client` for the given preset spec. Returns the client and
/// the resolved preset (for diagnostic logging).
pub(crate) fn build_client(spec: &PresetSpec) -> Result<(Client, ResolvedPreset), String> {
    let resolved = resolve_preset(&spec.preset);

    let connect_to = Duration::from_millis(spec.connect_timeout_ms.unwrap_or(10_000));
    let total_to = Duration::from_millis(spec.timeout_ms.unwrap_or(30_000));

    // v0.6 emulation profile: minimal default. See module docstring for why
    // we don't ship per-version Chrome fingerprints today.
    let emulation = EmulationProvider::builder().build();

    let mut builder = Client::builder()
        .user_agent(resolved.user_agent())
        .connect_timeout(connect_to)
        .timeout(total_to)
        .emulation(emulation);

    if let Some(proxy_url) = spec.proxy.as_deref().filter(|s| !s.is_empty()) {
        let proxy = Proxy::all(proxy_url)
            .map_err(|e| format!("invalid proxy '{proxy_url}': {e}"))?;
        builder = builder.proxy(proxy);
    }

    let client = builder
        .build()
        .map_err(|e| format!("failed to build wreq client: {e}"))?;
    Ok((client, resolved))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolves_chrome_aliases() {
        assert_eq!(resolve_preset("chrome_131_macos"), ResolvedPreset::Chrome);
        assert_eq!(resolve_preset("Chrome131"), ResolvedPreset::Chrome);
        assert_eq!(resolve_preset("CHROME_131_LINUX"), ResolvedPreset::Chrome);
    }

    #[test]
    fn resolves_edge_safari_firefox() {
        assert_eq!(resolve_preset("edge_120_windows"), ResolvedPreset::Edge);
        assert_eq!(resolve_preset("safari_18"), ResolvedPreset::Safari);
        assert_eq!(resolve_preset("firefox_131"), ResolvedPreset::Firefox);
    }

    #[test]
    fn unknown_preset_falls_back_with_warning() {
        error::clear();
        let r = resolve_preset("not_a_real_browser_999");
        assert_eq!(r, ResolvedPreset::UnknownFallbackChrome);
        let p = error::take_cstring();
        assert!(!p.is_null(), "warning should be set on fallback");
        unsafe { drop(std::ffi::CString::from_raw(p)) };
    }

    #[test]
    fn user_agent_is_chrome_for_chrome() {
        let ua = ResolvedPreset::Chrome.user_agent();
        assert!(ua.contains("Chrome/"), "ua: {ua}");
    }

    #[test]
    fn build_client_with_no_proxy_succeeds() {
        let spec = PresetSpec {
            preset: "chrome_131_macos".to_string(),
            proxy: None,
            connect_timeout_ms: Some(5_000),
            timeout_ms: Some(15_000),
        };
        let (_client, resolved) = build_client(&spec).expect("client builds");
        assert_eq!(resolved, ResolvedPreset::Chrome);
    }

    #[test]
    fn build_client_rejects_invalid_proxy() {
        let spec = PresetSpec {
            preset: "chrome_131_macos".to_string(),
            proxy: Some("::not a url::".to_string()),
            connect_timeout_ms: None,
            timeout_ms: None,
        };
        let err = build_client(&spec).expect_err("invalid proxy must fail");
        assert!(err.contains("invalid proxy"));
    }
}
