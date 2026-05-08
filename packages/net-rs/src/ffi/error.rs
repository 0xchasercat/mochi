//! Thread-local last-error storage.
//!
//! The C ABI returns null/sentinel values on failure; the FFI caller is then
//! expected to read `mochi_net_last_error()` to retrieve a human-readable
//! reason. Stored thread-local because Bun:FFI may dispatch calls on a worker
//! thread pool — keeping the slot per-thread avoids cross-thread races.
//!
//! See PLAN.md §10.

use std::cell::RefCell;
use std::ffi::CString;
use std::os::raw::c_char;

thread_local! {
    static LAST_ERROR: RefCell<Option<CString>> = const { RefCell::new(None) };
}

/// Replace the current thread's last-error message. The previous slot value
/// is dropped.
pub(crate) fn set(msg: impl Into<String>) {
    let s = msg.into();
    let cstr = CString::new(s.replace('\0', "?")).unwrap_or_else(|_| {
        // Safe fallback: empty string. Should be unreachable since we replaced
        // interior NULs above.
        CString::new("").expect("static empty")
    });
    LAST_ERROR.with(|slot| {
        *slot.borrow_mut() = Some(cstr);
    });
}

/// Clear the current thread's last-error slot. Useful at the top of a public
/// FFI function so callers don't read a stale message from a prior call.
pub(crate) fn clear() {
    LAST_ERROR.with(|slot| {
        *slot.borrow_mut() = None;
    });
}

/// Return a heap-owned C string with the current thread's last-error message,
/// or null if none. Caller must free with `mochi_net_string_free`.
///
/// This is exposed via the C ABI as `mochi_net_last_error`.
pub(crate) fn take_cstring() -> *mut c_char {
    LAST_ERROR.with(|slot| {
        let mut borrow = slot.borrow_mut();
        match borrow.take() {
            Some(cstr) => cstr.into_raw(),
            None => std::ptr::null_mut(),
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::ffi::CStr;

    #[test]
    fn last_error_round_trip() {
        clear();
        set("boom");
        let p = take_cstring();
        assert!(!p.is_null());
        let s = unsafe { CStr::from_ptr(p) }.to_str().expect("utf8");
        assert_eq!(s, "boom");
        unsafe { drop(CString::from_raw(p)) };
        // After take, slot is empty.
        assert!(take_cstring().is_null());
    }

    #[test]
    fn null_when_unset() {
        clear();
        assert!(take_cstring().is_null());
    }

    #[test]
    fn interior_nul_is_replaced() {
        clear();
        set("bad\0msg");
        let p = take_cstring();
        assert!(!p.is_null());
        let s = unsafe { CStr::from_ptr(p) }.to_str().expect("utf8");
        assert_eq!(s, "bad?msg");
        unsafe { drop(CString::from_raw(p)) };
    }
}
