//! Safe Rust wrapper over the handwritten `usd_c_shim` C ABI.
//!
//! `build.rs` generates raw bindings from `third_party/usd_c_shim/include/usd_c_shim.h`
//! via `bindgen` and writes them to `$OUT_DIR/usd_c_shim_bindings.rs`. This
//! module `include!`s that file, then wraps the unsafe surface behind:
//!
//!   - A `CStage` RAII handle that closes the underlying `UsdcStage*` on drop.
//!   - A `LoadPolicy` enum mirroring [`super::types::StageLoadPolicy`].
//!   - Callback trampolines that let collection APIs populate a `Vec` via a
//!     `*mut c_void` user pointer. This is the standard pattern for passing
//!     closures across a C boundary without heap-allocating a closure trait
//!     object per call site.
//!
//! Safety note: OpenUSD stages are not safe to mutate concurrently from
//! multiple threads. yw-look's Tauri commands run on a blocking task pool
//! where each command opens its own stage and drops it at the end of the
//! call, so the handle is `Send` (it can be moved onto a blocking task)
//! but intentionally not `Sync`.

#![allow(
    non_camel_case_types,
    non_snake_case,
    non_upper_case_globals,
    dead_code
)]

use std::ffi::{CStr, CString};
use std::os::raw::{c_char, c_void};
use std::path::Path;

// Raw bindings produced by bindgen from usd_c_shim.h.
include!(concat!(env!("OUT_DIR"), "/usd_c_shim_bindings.rs"));

/// Error surfaced by the C shim. The message is captured via the
/// shim's `UsdcError*` out-parameter and the C handle is freed
/// immediately so callers never need to touch `UsdcError` directly.
#[derive(Debug, Clone)]
pub struct CError(pub String);

impl std::fmt::Display for CError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for CError {}

/// Mirror of [`super::types::StageLoadPolicy`] at the FFI layer. Kept
/// separate from the wire enum so the two can evolve independently if
/// the shim ever grows new load modes ahead of the frontend.
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum LoadPolicy {
    All,
    NoPayloads,
}

impl LoadPolicy {
    fn to_raw(self) -> UsdcLoadPolicy {
        match self {
            LoadPolicy::All => USDC_LOAD_ALL,
            LoadPolicy::NoPayloads => USDC_LOAD_NO_PAYLOADS,
        }
    }
}

/// Up-axis authored on the stage's root layer.
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum UpAxis {
    Y,
    Z,
}

/// One composition arc (reference or payload) emitted by the shim.
#[derive(Debug, Clone)]
pub struct Arc {
    pub source_prim: String,
    pub asset_path: String,
    pub target_prim: Option<String>,
    pub is_loaded: bool,
}

/// RAII wrapper around a `UsdcStage*`. Freed on drop.
pub struct CStage {
    raw: *mut UsdcStage,
}

// A `UsdcStage` is only touched by one thread at a time in yw-look's
// usage: every Tauri command opens its own stage inside a blocking
// task, reads from it, and drops it. The handle can move across task
// boundaries (Send) but must not be shared (no Sync).
unsafe impl Send for CStage {}

impl CStage {
    pub fn open(path: &Path, policy: LoadPolicy) -> Result<Self, CError> {
        let c_path = CString::new(path.to_string_lossy().as_ref())
            .map_err(|_| CError("path contains interior NUL byte".to_string()))?;
        let mut err: *mut UsdcError = std::ptr::null_mut();
        let raw = unsafe { usdc_stage_open(c_path.as_ptr(), policy.to_raw(), &mut err) };
        if raw.is_null() {
            let msg = if err.is_null() {
                "usdc_stage_open returned null without an error".to_string()
            } else {
                let s = unsafe { CStr::from_ptr(usdc_error_message(err)) }
                    .to_string_lossy()
                    .into_owned();
                unsafe { usdc_error_free(err) };
                s
            };
            return Err(CError(msg));
        }
        Ok(Self { raw })
    }

    pub fn default_prim(&self) -> Option<String> {
        let p = unsafe { usdc_stage_default_prim(self.raw) };
        ptr_to_opt_string(p)
    }

    pub fn up_axis(&self) -> Option<UpAxis> {
        match unsafe { usdc_stage_up_axis(self.raw) } {
            0 => Some(UpAxis::Y),
            1 => Some(UpAxis::Z),
            _ => None,
        }
    }

    /// Returns the authored `metersPerUnit`, or `None` when the stage
    /// does not author the metadata. NaN is surfaced as `None` so the
    /// caller always deals with a concrete floating-point value.
    pub fn meters_per_unit(&self) -> Option<f64> {
        let v = unsafe { usdc_stage_meters_per_unit(self.raw) };
        if v.is_nan() {
            None
        } else {
            Some(v)
        }
    }

    pub fn root_layer_is_binary(&self) -> Option<bool> {
        match unsafe { usdc_stage_root_layer_is_binary(self.raw) } {
            1 => Some(true),
            0 => Some(false),
            _ => None,
        }
    }

    pub fn layer_count(&self) -> usize {
        unsafe { usdc_stage_layer_count(self.raw) }
    }

    pub fn traverse(&self) -> Vec<String> {
        let mut out = Vec::<String>::new();
        unsafe {
            usdc_stage_traverse(
                self.raw,
                Some(string_trampoline),
                &mut out as *mut Vec<String> as *mut c_void,
            );
        }
        out
    }

    pub fn layer_identifiers(&self) -> Vec<String> {
        let mut out = Vec::<String>::new();
        unsafe {
            usdc_stage_layer_identifiers(
                self.raw,
                Some(string_trampoline),
                &mut out as *mut Vec<String> as *mut c_void,
            );
        }
        out
    }

    pub fn references_in(&self, prim_path: &str) -> Vec<Arc> {
        self.arcs(prim_path, |s, cb, u| unsafe {
            usdc_stage_references_in(self.raw, s, cb, u)
        })
    }

    pub fn payloads_in(&self, prim_path: &str) -> Vec<Arc> {
        self.arcs(prim_path, |s, cb, u| unsafe {
            usdc_stage_payloads_in(self.raw, s, cb, u)
        })
    }

    pub fn unresolved_assets(&self) -> Vec<String> {
        let mut out = Vec::<String>::new();
        unsafe {
            usdc_stage_unresolved_assets(
                self.raw,
                Some(string_trampoline),
                &mut out as *mut Vec<String> as *mut c_void,
            );
        }
        out
    }

    pub fn skipped_payloads(&self) -> Vec<String> {
        let mut out = Vec::<String>::new();
        unsafe {
            usdc_stage_skipped_payloads(
                self.raw,
                Some(string_trampoline),
                &mut out as *mut Vec<String> as *mut c_void,
            );
        }
        out
    }

    pub fn prim_type_is_mesh(&self, prim_path: &str) -> bool {
        let c = match CString::new(prim_path) {
            Ok(c) => c,
            Err(_) => return false,
        };
        unsafe { usdc_prim_type_is_mesh(self.raw, c.as_ptr()) != 0 }
    }

    pub fn prim_has_variants(&self, prim_path: &str) -> bool {
        let c = match CString::new(prim_path) {
            Ok(c) => c,
            Err(_) => return false,
        };
        unsafe { usdc_prim_has_variants(self.raw, c.as_ptr()) != 0 }
    }

    pub fn variant_set_names(&self, prim_path: &str) -> Vec<String> {
        let c = match CString::new(prim_path) {
            Ok(c) => c,
            Err(_) => return Vec::new(),
        };
        let mut out = Vec::<String>::new();
        unsafe {
            usdc_prim_variant_set_names(
                self.raw,
                c.as_ptr(),
                Some(string_trampoline),
                &mut out as *mut Vec<String> as *mut c_void,
            );
        }
        out
    }

    pub fn variant_selection(&self, prim_path: &str, set_name: &str) -> Option<String> {
        let p = CString::new(prim_path).ok()?;
        let s = CString::new(set_name).ok()?;
        let raw = unsafe { usdc_prim_variant_selection(self.raw, p.as_ptr(), s.as_ptr()) };
        ptr_to_opt_string(raw)
    }

    fn arcs<F>(&self, prim_path: &str, call: F) -> Vec<Arc>
    where
        F: FnOnce(*const c_char, UsdcArcCallback, *mut c_void),
    {
        let c = match CString::new(prim_path) {
            Ok(c) => c,
            Err(_) => return Vec::new(),
        };
        let mut out = Vec::<Arc>::new();
        call(
            c.as_ptr(),
            Some(arc_trampoline),
            &mut out as *mut Vec<Arc> as *mut c_void,
        );
        out
    }
}

impl Drop for CStage {
    fn drop(&mut self) {
        unsafe { usdc_stage_close(self.raw) }
    }
}

fn ptr_to_opt_string(p: *const c_char) -> Option<String> {
    if p.is_null() {
        None
    } else {
        Some(unsafe { CStr::from_ptr(p) }.to_string_lossy().into_owned())
    }
}

// Trampoline: the shim calls this once per enumerated C string; we
// reinterpret `user` as `&mut Vec<String>` and push a clone.
//
// Safety:
//   - `s` must point to a valid, null-terminated C string for the
//     duration of this call.
//   - `user` must be a valid `*mut Vec<String>` produced by the
//     corresponding `CStage` method.
unsafe extern "C" fn string_trampoline(s: *const c_char, user: *mut c_void) {
    if user.is_null() {
        return;
    }
    let out = unsafe { &mut *(user as *mut Vec<String>) };
    if s.is_null() {
        return;
    }
    let value = unsafe { CStr::from_ptr(s) }
        .to_string_lossy()
        .into_owned();
    out.push(value);
}

// Same pattern for `UsdcArc`: copy each field into an owned Rust
// struct so nothing borrows from the shim's scratch buffer.
unsafe extern "C" fn arc_trampoline(arc: *const UsdcArc, user: *mut c_void) {
    if arc.is_null() || user.is_null() {
        return;
    }
    let out = unsafe { &mut *(user as *mut Vec<Arc>) };
    let r = unsafe { &*arc };
    let source_prim = if r.source_prim.is_null() {
        String::new()
    } else {
        unsafe { CStr::from_ptr(r.source_prim) }
            .to_string_lossy()
            .into_owned()
    };
    let asset_path = if r.asset_path.is_null() {
        String::new()
    } else {
        unsafe { CStr::from_ptr(r.asset_path) }
            .to_string_lossy()
            .into_owned()
    };
    let target_prim = ptr_to_opt_string(r.target_prim);
    out.push(Arc {
        source_prim,
        asset_path,
        target_prim,
        is_loaded: r.is_loaded != 0,
    });
}
