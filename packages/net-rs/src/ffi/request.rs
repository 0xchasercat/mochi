//! Decode the JSON request envelope sent across the FFI boundary.
//!
//! `request_json` shape (per task brief):
//! ```json
//! {
//!   "method": "GET",
//!   "url": "https://...",
//!   "headers": { "k": "v", ... },
//!   "body": "..." | null
//! }
//! ```
//!
//! v0.6 only supports UTF-8 string bodies. Binary bodies / streaming bodies
//! are explicitly deferred (task brief §Deferred).

use std::collections::BTreeMap;

use serde::Deserialize;

#[derive(Debug, Deserialize)]
pub(crate) struct RequestSpec {
    pub method: String,
    pub url: String,
    #[serde(default)]
    pub headers: BTreeMap<String, String>,
    #[serde(default)]
    pub body: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_minimum_request() {
        let json = r#"{"method":"GET","url":"https://example.com"}"#;
        let req: RequestSpec = serde_json::from_str(json).expect("parses");
        assert_eq!(req.method, "GET");
        assert_eq!(req.url, "https://example.com");
        assert!(req.headers.is_empty());
        assert!(req.body.is_none());
    }

    #[test]
    fn parses_full_request() {
        let json = r#"{
            "method": "POST",
            "url": "https://api.example.com/v1",
            "headers": {"x-mochi": "1", "accept": "application/json"},
            "body": "hello"
        }"#;
        let req: RequestSpec = serde_json::from_str(json).expect("parses");
        assert_eq!(req.method, "POST");
        assert_eq!(req.headers.get("x-mochi").map(String::as_str), Some("1"));
        assert_eq!(req.body.as_deref(), Some("hello"));
    }

    #[test]
    fn rejects_garbage_json() {
        let err = serde_json::from_str::<RequestSpec>("{not json}").expect_err("must fail");
        assert!(err.is_syntax() || err.is_data());
    }
}
