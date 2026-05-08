//! `mochi_net_ctx` — opaque per-Session handle.
//!
//! Owns:
//!   - One Tokio runtime (single-threaded, multi-task) — per task brief §10.
//!     One runtime *per Ctx*, never shared. The runtime lives until
//!     `mochi_net_close` is called.
//!   - One `wreq::Client` configured for the preset's TLS/H2 fingerprint.
//!   - The resolved preset for diagnostics.
//!
//! `mochi_net_request` blocks the calling thread on the runtime's `block_on`.
//! Bun:FFI dispatches FFI calls on a worker thread (per Bun docs), so this
//! does not block Bun's main event loop.

use std::collections::BTreeMap;
use std::time::Duration;

use tokio::runtime::Runtime;
use wreq::Client;
use wreq::header::{HeaderName, HeaderValue};

use super::preset::{ResolvedPreset, build_client, PresetSpec};
use super::request::RequestSpec;
use super::response::MochiNetResponse;

/// Opaque per-Session handle. Never destructured by the FFI caller.
#[repr(C)]
pub struct MochiNetCtx {
    runtime: Runtime,
    client: Client,
    resolved: ResolvedPreset,
}

impl MochiNetCtx {
    /// Build a Ctx from a parsed preset spec. Each Ctx owns its own
    /// single-threaded Tokio runtime.
    pub(crate) fn new(spec: PresetSpec) -> Result<Self, String> {
        let (client, resolved) = build_client(&spec)?;
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .map_err(|e| format!("failed to build tokio runtime: {e}"))?;
        Ok(Self {
            runtime,
            client,
            resolved,
        })
    }

    /// Diagnostic accessor — used by Rust unit tests.
    #[cfg(test)]
    pub(crate) fn resolved_preset(&self) -> ResolvedPreset {
        self.resolved
    }

    /// Issue a single request synchronously, blocking on the Ctx's Tokio
    /// runtime. Returns a fully-buffered response on success.
    pub(crate) fn execute(&self, req: RequestSpec) -> Result<MochiNetResponse, String> {
        let RequestSpec {
            method,
            url,
            headers,
            body,
        } = req;

        let parsed_method = method.parse::<wreq::Method>()
            .map_err(|e| format!("invalid HTTP method '{method}': {e}"))?;

        let _ = self.resolved; // resolved is informational; preset already baked into client

        self.runtime.block_on(async move {
            let mut req_builder = self.client.request(parsed_method, &url);
            for (k, v) in headers.iter() {
                let name = HeaderName::from_bytes(k.as_bytes())
                    .map_err(|e| format!("invalid header name '{k}': {e}"))?;
                let value = HeaderValue::from_str(v)
                    .map_err(|e| format!("invalid header value for '{k}': {e}"))?;
                req_builder = req_builder.header(name, value);
            }
            if let Some(b) = body {
                req_builder = req_builder.body(b);
            }
            // Per-call timeout backstop: if the client-builder timeout was
            // misconfigured, this prevents wall-of-hangs in Rust unit tests.
            req_builder = req_builder.timeout(Duration::from_secs(60));

            let resp = req_builder.send().await
                .map_err(|e| format!("request failed: {e}"))?;
            let status = resp.status().as_u16();

            // Collapse multi-value headers into comma-joined strings — the
            // wire shape expected by Web `Response`.
            let mut headers_out: BTreeMap<String, String> = BTreeMap::new();
            for (name, value) in resp.headers().iter() {
                let name_s = name.as_str().to_lowercase();
                let v_s = value.to_str().unwrap_or("").to_string();
                headers_out
                    .entry(name_s)
                    .and_modify(|existing| {
                        existing.push_str(", ");
                        existing.push_str(&v_s);
                    })
                    .or_insert(v_s);
            }
            let body_bytes = resp.bytes().await
                .map_err(|e| format!("body read failed: {e}"))?;
            let body_vec = body_bytes.to_vec();
            Ok::<_, String>(MochiNetResponse::from_wreq(status, headers_out, body_vec))
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn spec(preset: &str) -> PresetSpec {
        PresetSpec {
            preset: preset.to_string(),
            proxy: None,
            connect_timeout_ms: Some(2_000),
            timeout_ms: Some(10_000),
        }
    }

    #[test]
    fn ctx_constructs_with_chrome_preset() {
        let ctx = MochiNetCtx::new(spec("chrome_131_macos")).expect("ctx builds");
        assert_eq!(ctx.resolved_preset(), ResolvedPreset::Chrome);
    }

    #[test]
    fn ctx_constructs_with_unknown_preset_via_fallback() {
        let ctx = MochiNetCtx::new(spec("totally-fake-preset")).expect("ctx falls back");
        assert_eq!(ctx.resolved_preset(), ResolvedPreset::UnknownFallbackChrome);
    }

    #[test]
    fn ctx_rejects_invalid_proxy() {
        let mut s = spec("chrome_131_macos");
        s.proxy = Some("::busted::".to_string());
        match MochiNetCtx::new(s) {
            Ok(_) => panic!("expected proxy parse failure"),
            Err(err) => assert!(err.contains("invalid proxy"), "err: {err}"),
        }
    }

    #[test]
    fn execute_rejects_invalid_method() {
        let ctx = MochiNetCtx::new(spec("chrome_131_macos")).expect("ctx builds");
        let req = RequestSpec {
            method: "🚫BAD".to_string(),
            url: "https://example.com".to_string(),
            headers: BTreeMap::new(),
            body: None,
        };
        match ctx.execute(req) {
            Ok(_) => panic!("expected method failure"),
            Err(err) => assert!(err.contains("invalid HTTP method"), "err: {err}"),
        }
    }

    #[test]
    fn execute_rejects_invalid_header_name() {
        let ctx = MochiNetCtx::new(spec("chrome_131_macos")).expect("ctx builds");
        let mut h = BTreeMap::new();
        h.insert("not a valid header name!!".to_string(), "v".to_string());
        let req = RequestSpec {
            method: "GET".to_string(),
            url: "https://example.com".to_string(),
            headers: h,
            body: None,
        };
        match ctx.execute(req) {
            Ok(_) => panic!("expected header failure"),
            Err(err) => assert!(err.contains("invalid header name"), "err: {err}"),
        }
    }
}
