//! mochi-net — FFI surface for the @mochi/net Bun:FFI binding.
//!
//! v0.0.1 claim placeholder. Real implementation lands in phase 0.6 (wraps wreq).
//! See PLAN.md §10 for the C ABI surface.

use std::ffi::CString;
use std::os::raw::c_char;

/// Returns the cdylib's compiled CARGO_PKG_VERSION as a heap-owned C string.
/// Caller MUST free with `mochi_net_string_free`.
#[unsafe(no_mangle)]
pub extern "C" fn mochi_net_version() -> *mut c_char {
    let s = CString::new(env!("CARGO_PKG_VERSION")).expect("static valid utf8");
    s.into_raw()
}

/// Free a string previously returned from this crate.
///
/// # Safety
/// `ptr` must be a pointer originally returned from a `mochi_net_*` function
/// that documents a heap-owned C string.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn mochi_net_string_free(ptr: *mut c_char) {
    if ptr.is_null() {
        return;
    }
    unsafe { drop(CString::from_raw(ptr)) };
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::ffi::CStr;

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
    fn null_free_is_safe() {
        unsafe { mochi_net_string_free(std::ptr::null_mut()) };
    }
}
