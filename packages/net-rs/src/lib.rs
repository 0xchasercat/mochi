//! mochi-net — FFI surface for the @mochi/net Bun:FFI binding.
//!
//! Phase 0.6: wraps `wreq` (Apache-2.0) behind a stable C ABI per
//! PLAN.md §10.1. The companion crate `wreq-util`, which ships pre-built
//! `Emulation::Chrome131` profiles, is GPL-3.0 / LGPL-3.0 — incompatible
//! with mochi's I-2 invariant — so we use `wreq` only and author Chrome-
//! style profiles locally; see `ffi::preset`.
//!
//! ABI contract (stable across mochi versions; breaking changes bump
//! `@mochi.js/net-rs` major):
//!
//! ```c
//! typedef struct mochi_net_ctx mochi_net_ctx;
//! typedef struct mochi_net_response mochi_net_response;
//!
//! mochi_net_ctx*  mochi_net_open(const char* preset_json);
//! mochi_net_response* mochi_net_request(mochi_net_ctx*, const char* request_json);
//! int             mochi_net_response_status(mochi_net_response*);
//! char*           mochi_net_response_headers_json(mochi_net_response*);
//! const uint8_t*  mochi_net_response_body(mochi_net_response*, size_t* out_len);
//! void            mochi_net_response_free(mochi_net_response*);
//! void            mochi_net_close(mochi_net_ctx*);
//! char*           mochi_net_last_error(void);
//! void            mochi_net_string_free(char*);
//! ```

pub(crate) mod ffi;

use std::ffi::{CStr, CString};
use std::os::raw::{c_char, c_int};

use crate::ffi::ctx::MochiNetCtx;
use crate::ffi::error;
use crate::ffi::preset::PresetSpec;
use crate::ffi::request::RequestSpec;
use crate::ffi::response::MochiNetResponse;

// ---- legacy/utility entry points (kept from v0.0.1) -------------------------

/// Returns the cdylib's compiled `CARGO_PKG_VERSION` as a heap-owned C string.
/// Caller MUST free with `mochi_net_string_free`.
#[unsafe(no_mangle)]
pub extern "C" fn mochi_net_version() -> *mut c_char {
    let s = CString::new(env!("CARGO_PKG_VERSION")).expect("static valid utf8");
    s.into_raw()
}

/// Free a heap-owned C string previously returned from this crate.
///
/// # Safety
/// `ptr` must be either null or a pointer originally returned from a
/// `mochi_net_*` function whose contract documents heap-owned C-string
/// ownership transfer. Calling with an unrelated pointer is UB.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn mochi_net_string_free(ptr: *mut c_char) {
    if ptr.is_null() {
        return;
    }
    unsafe { drop(CString::from_raw(ptr)) };
}

// ---- Ctx lifecycle ----------------------------------------------------------

/// Open a network context configured per `preset_json`. Returns null on
/// failure; the caller can read `mochi_net_last_error()` for a reason.
///
/// # Safety
/// `preset_json` must be a valid pointer to a NUL-terminated UTF-8 byte
/// sequence, or null.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn mochi_net_open(preset_json: *const c_char) -> *mut MochiNetCtx {
    error::clear();
    let json = match unsafe { read_cstr(preset_json) } {
        Ok(s) => s,
        Err(msg) => {
            error::set(msg);
            return std::ptr::null_mut();
        }
    };
    let spec: PresetSpec = match serde_json::from_str(json) {
        Ok(s) => s,
        Err(e) => {
            error::set(format!("invalid preset_json: {e}"));
            return std::ptr::null_mut();
        }
    };
    match MochiNetCtx::new(spec) {
        Ok(ctx) => Box::into_raw(Box::new(ctx)),
        Err(e) => {
            error::set(e);
            std::ptr::null_mut()
        }
    }
}

/// Close a Ctx previously returned from `mochi_net_open`. Safe to call with
/// null. Drops the Tokio runtime and the wreq Client.
///
/// # Safety
/// `ctx` must be either null or a pointer originally returned from
/// `mochi_net_open`. Must not be used after this call.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn mochi_net_close(ctx: *mut MochiNetCtx) {
    if ctx.is_null() {
        return;
    }
    unsafe { drop(Box::from_raw(ctx)) };
}

// ---- Request / Response -----------------------------------------------------

/// Issue a single request synchronously. Returns null on failure; caller can
/// read `mochi_net_last_error()`.
///
/// On success, returns an opaque `mochi_net_response*` that the caller MUST
/// free with `mochi_net_response_free` exactly once.
///
/// # Safety
/// `ctx` must be a valid pointer from `mochi_net_open`. `request_json` must
/// point to a NUL-terminated UTF-8 string.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn mochi_net_request(
    ctx: *mut MochiNetCtx,
    request_json: *const c_char,
) -> *mut MochiNetResponse {
    error::clear();
    if ctx.is_null() {
        error::set("mochi_net_request: ctx is null");
        return std::ptr::null_mut();
    }
    let json = match unsafe { read_cstr(request_json) } {
        Ok(s) => s,
        Err(msg) => {
            error::set(msg);
            return std::ptr::null_mut();
        }
    };
    let spec: RequestSpec = match serde_json::from_str(json) {
        Ok(s) => s,
        Err(e) => {
            error::set(format!("invalid request_json: {e}"));
            return std::ptr::null_mut();
        }
    };
    // SAFETY: caller-provided pointer; we re-borrow as &MochiNetCtx for the
    // duration of this call. The Ctx remains owned by the caller; we do not
    // free it here.
    let ctx_ref: &MochiNetCtx = unsafe { &*ctx };
    match ctx_ref.execute(spec) {
        Ok(resp) => Box::into_raw(Box::new(resp)),
        Err(e) => {
            error::set(e);
            std::ptr::null_mut()
        }
    }
}

/// Return the response status code, or `-1` if `res` is null.
///
/// # Safety
/// `res` must be either null or a valid pointer from `mochi_net_request`.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn mochi_net_response_status(res: *const MochiNetResponse) -> c_int {
    if res.is_null() {
        return -1;
    }
    unsafe { (&*res).status as c_int }
}

/// Return a heap-owned JSON object string of the response headers.
/// Caller MUST free with `mochi_net_string_free`. Returns null if `res` is
/// null.
///
/// # Safety
/// `res` must be either null or a valid pointer from `mochi_net_request`.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn mochi_net_response_headers_json(
    res: *const MochiNetResponse,
) -> *mut c_char {
    if res.is_null() {
        return std::ptr::null_mut();
    }
    let json = unsafe { (&*res).headers_json() };
    match CString::new(json) {
        Ok(c) => c.into_raw(),
        Err(_) => std::ptr::null_mut(),
    }
}

/// Return a borrowed pointer to the response body bytes and write the length
/// into `out_len`. The pointer is valid until `mochi_net_response_free` is
/// called. Returns null if `res` is null or `out_len` is null.
///
/// # Safety
/// `res` must be either null or valid from `mochi_net_request`. `out_len`
/// must be a valid `*mut usize`.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn mochi_net_response_body(
    res: *const MochiNetResponse,
    out_len: *mut usize,
) -> *const u8 {
    if res.is_null() || out_len.is_null() {
        return std::ptr::null();
    }
    let body = unsafe { &(*res).body };
    unsafe { *out_len = body.len() };
    body.as_ptr()
}

/// Free a response handle. Safe to call with null.
///
/// # Safety
/// `res` must be either null or a pointer originally returned from
/// `mochi_net_request`. Must not be used after this call.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn mochi_net_response_free(res: *mut MochiNetResponse) {
    if res.is_null() {
        return;
    }
    unsafe { drop(Box::from_raw(res)) };
}

// ---- Last-error accessor ----------------------------------------------------

/// Return the current thread's last-error message as a heap-owned C string,
/// or null if none. Caller MUST free with `mochi_net_string_free`.
///
/// Repeated calls return successively the same message until a new FFI call
/// either clears or sets it.
///
/// # Safety
/// Always safe — pure read.
#[unsafe(no_mangle)]
pub extern "C" fn mochi_net_last_error() -> *mut c_char {
    error::take_cstring()
}

// ---- helpers ----------------------------------------------------------------

/// Borrow a `*const c_char` as `&str` if non-null and valid UTF-8.
///
/// # Safety
/// `ptr` must be either null or a pointer to a NUL-terminated byte sequence.
unsafe fn read_cstr<'a>(ptr: *const c_char) -> Result<&'a str, String> {
    if ptr.is_null() {
        return Err("null pointer".into());
    }
    let cstr = unsafe { CStr::from_ptr(ptr) };
    cstr.to_str()
        .map_err(|e| format!("non-utf8 string: {e}"))
}

// ---- Inline tests for ABI smoke (string/version) ----------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn version_returns_cargo_pkg_version() {
        let p = mochi_net_version();
        assert!(!p.is_null());
        let s = unsafe { CStr::from_ptr(p) }
            .to_str()
            .expect("utf8")
            .to_string();
        assert_eq!(s, env!("CARGO_PKG_VERSION"));
        unsafe { mochi_net_string_free(p) };
    }

    #[test]
    fn null_string_free_is_safe() {
        unsafe { mochi_net_string_free(std::ptr::null_mut()) };
    }

    #[test]
    fn open_with_null_preset_returns_null_and_sets_error() {
        let ctx = unsafe { mochi_net_open(std::ptr::null()) };
        assert!(ctx.is_null());
        let err = mochi_net_last_error();
        assert!(!err.is_null());
        let msg = unsafe { CStr::from_ptr(err) }.to_str().unwrap().to_string();
        assert!(msg.contains("null pointer"));
        unsafe { mochi_net_string_free(err) };
    }

    #[test]
    fn open_with_garbage_returns_null_and_sets_error() {
        let bad = CString::new("not json at all").unwrap();
        let ctx = unsafe { mochi_net_open(bad.as_ptr()) };
        assert!(ctx.is_null());
        let err = mochi_net_last_error();
        assert!(!err.is_null());
        let msg = unsafe { CStr::from_ptr(err) }.to_str().unwrap().to_string();
        assert!(msg.contains("invalid preset_json"));
        unsafe { mochi_net_string_free(err) };
    }

    #[test]
    fn open_close_roundtrip() {
        let preset = CString::new(r#"{"preset":"chrome_131_macos","proxy":null}"#).unwrap();
        let ctx = unsafe { mochi_net_open(preset.as_ptr()) };
        assert!(!ctx.is_null());
        unsafe { mochi_net_close(ctx) };
        unsafe { mochi_net_close(std::ptr::null_mut()) }; // null safe
    }

    #[test]
    fn request_with_null_ctx_returns_null() {
        let body = CString::new(r#"{"method":"GET","url":"https://example.com"}"#).unwrap();
        let res = unsafe { mochi_net_request(std::ptr::null_mut(), body.as_ptr()) };
        assert!(res.is_null());
        let err = mochi_net_last_error();
        assert!(!err.is_null());
        unsafe { mochi_net_string_free(err) };
    }

    #[test]
    fn response_status_handles_null() {
        assert_eq!(unsafe { mochi_net_response_status(std::ptr::null()) }, -1);
    }

    #[test]
    fn response_body_handles_null() {
        let mut len: usize = 999;
        let p = unsafe { mochi_net_response_body(std::ptr::null(), &mut len) };
        assert!(p.is_null());
        // out_len untouched on null branch.
        assert_eq!(len, 999);
    }

    #[test]
    fn response_headers_json_handles_null() {
        let p = unsafe { mochi_net_response_headers_json(std::ptr::null()) };
        assert!(p.is_null());
    }

    #[test]
    fn response_free_null_is_safe() {
        unsafe { mochi_net_response_free(std::ptr::null_mut()) };
    }

    #[test]
    fn last_error_is_null_when_not_set() {
        // Pull whatever is in the slot from prior tests, then assert empty.
        let p = mochi_net_last_error();
        if !p.is_null() {
            unsafe { mochi_net_string_free(p) };
        }
        let p2 = mochi_net_last_error();
        assert!(p2.is_null());
    }

    #[test]
    fn request_with_valid_ctx_and_garbage_body_sets_error() {
        let preset = CString::new(r#"{"preset":"chrome_131_macos"}"#).unwrap();
        let ctx = unsafe { mochi_net_open(preset.as_ptr()) };
        assert!(!ctx.is_null());
        let bad_req = CString::new("not json").unwrap();
        let res = unsafe { mochi_net_request(ctx, bad_req.as_ptr()) };
        assert!(res.is_null());
        let err = mochi_net_last_error();
        assert!(!err.is_null());
        let msg = unsafe { CStr::from_ptr(err) }.to_str().unwrap().to_string();
        assert!(msg.contains("invalid request_json"));
        unsafe { mochi_net_string_free(err) };
        unsafe { mochi_net_close(ctx) };
    }
}
