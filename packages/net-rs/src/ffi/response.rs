//! `mochi_net_response` — opaque response handle returned to FFI.
//!
//! Holds a fully-buffered status, headers, and body. v0.6 buffers the body
//! eagerly; streaming is deferred. The pointer the caller receives is a
//! `Box<MochiNetResponse>` cast to its raw pointer; the caller MUST free
//! with `mochi_net_response_free` exactly once, and the headers JSON string
//! returned from `mochi_net_response_headers_json` MUST be freed with
//! `mochi_net_string_free`.

use serde::Serialize;
use std::collections::BTreeMap;

#[repr(C)]
#[derive(Debug)]
pub struct MochiNetResponse {
    /// HTTP status code.
    pub(crate) status: u16,
    /// Response headers, as a name→value map. Multi-value headers are joined
    /// by `, ` (the standard HTTP delimiter for repeated header names).
    pub(crate) headers: BTreeMap<String, String>,
    /// Response body bytes (fully buffered).
    pub(crate) body: Vec<u8>,
}

/// JSON wire shape for the headers map.
#[derive(Debug, Serialize)]
pub(crate) struct HeadersWire<'a>(pub(crate) &'a BTreeMap<String, String>);

impl MochiNetResponse {
    pub(crate) fn from_wreq(resp_status: u16, headers: BTreeMap<String, String>, body: Vec<u8>) -> Self {
        Self {
            status: resp_status,
            headers,
            body,
        }
    }

    pub(crate) fn headers_json(&self) -> String {
        serde_json::to_string(&HeadersWire(&self.headers))
            .unwrap_or_else(|_| String::from("{}"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn headers_json_serializes_in_sorted_order() {
        let mut h = BTreeMap::new();
        h.insert("z-last".to_string(), "1".to_string());
        h.insert("a-first".to_string(), "2".to_string());
        let r = MochiNetResponse::from_wreq(200, h, b"hi".to_vec());
        let j = r.headers_json();
        // BTreeMap serialises keys in sorted order; pin that.
        assert_eq!(j, r#"{"a-first":"2","z-last":"1"}"#);
    }

    #[test]
    fn empty_headers_serialize_as_empty_object() {
        let r = MochiNetResponse::from_wreq(204, BTreeMap::new(), Vec::new());
        assert_eq!(r.headers_json(), "{}");
    }
}
