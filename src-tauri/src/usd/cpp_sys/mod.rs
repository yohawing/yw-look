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
use std::os::raw::{c_char, c_int, c_void};
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

/// Primvar interpolation token returned alongside mesh attribute reads.
/// Mirrors the shim's `UsdcInterpolation`; `Unknown` covers both
/// "shim returned USDC_INTERP_UNKNOWN" and "attribute not authored".
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum Interpolation {
    Unknown,
    Constant,
    Uniform,
    Varying,
    Vertex,
    FaceVarying,
}

impl Interpolation {
    fn from_raw(raw: UsdcInterpolation) -> Self {
        match raw {
            USDC_INTERP_CONSTANT => Self::Constant,
            USDC_INTERP_UNIFORM => Self::Uniform,
            USDC_INTERP_VARYING => Self::Varying,
            USDC_INTERP_VERTEX => Self::Vertex,
            USDC_INTERP_FACE_VARYING => Self::FaceVarying,
            _ => Self::Unknown,
        }
    }
}

/// UsdGeomMesh `orientation` token. Defaults to [`Self::RightHanded`]
/// when the attribute is unauthored.
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum Orientation {
    RightHanded,
    LeftHanded,
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
        // Require UTF-8 paths up-front rather than silently round-
        // tripping through `to_string_lossy()`, which would replace
        // invalid sequences with U+FFFD and hand OpenUSD a path that
        // no longer matches the file on disk. The Rust fork backend
        // also errors out on non-UTF-8 paths, so the two backends
        // stay consistent for Tauri callers that compare results.
        let path_str = path.to_str().ok_or_else(|| {
            CError(format!(
                "path is not valid UTF-8: {}",
                path.display()
            ))
        })?;
        let c_path = CString::new(path_str)
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

    /// Returns one [`Arc`] per (prim, payload) pair that was skipped
    /// under [`LoadPolicy::NoPayloads`]. `is_loaded` is always `false`
    /// on the emitted arcs; callers cross-check the `asset_path`
    /// against [`Self::unresolved_assets`] to promote an entry to the
    /// `Missing` classification when appropriate.
    ///
    /// Empty under [`LoadPolicy::All`].
    pub fn skipped_payloads(&self) -> Vec<Arc> {
        let mut out = Vec::<Arc>::new();
        unsafe {
            usdc_stage_skipped_payloads(
                self.raw,
                Some(arc_trampoline),
                &mut out as *mut Vec<Arc> as *mut c_void,
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

    // ---------- geometry ----------

    /// Returns `true` iff the prim at `prim_path` is a UsdGeomMesh and
    /// its effective visibility / purpose / active state renders under
    /// the default render purpose. The shim delegates to pxr's
    /// UsdGeomImageable inheritance, so this matches what usdview would
    /// display by default.
    pub fn prim_is_renderable_mesh(&self, prim_path: &str) -> bool {
        let Ok(c) = CString::new(prim_path) else {
            return false;
        };
        unsafe { usdc_prim_is_renderable_mesh(self.raw, c.as_ptr()) != 0 }
    }

    /// Computes the prim's local-to-world transform at the default
    /// time code. Returns 16 column-major `f64`s (glTF convention) or
    /// `None` if the prim is not xformable.
    pub fn prim_world_matrix(&self, prim_path: &str) -> Option<[f64; 16]> {
        let c = CString::new(prim_path).ok()?;
        let mut out = [0.0f64; 16];
        let ok = unsafe { usdc_prim_world_matrix(self.raw, c.as_ptr(), out.as_mut_ptr()) };
        (ok != 0).then_some(out)
    }

    pub fn mesh_orientation(&self, prim_path: &str) -> Orientation {
        let Ok(c) = CString::new(prim_path) else {
            return Orientation::RightHanded;
        };
        match unsafe { usdc_mesh_orientation(self.raw, c.as_ptr()) } {
            USDC_ORIENT_LEFT_HANDED => Orientation::LeftHanded,
            _ => Orientation::RightHanded,
        }
    }

    pub fn mesh_points(&self, prim_path: &str) -> Vec<f32> {
        self.read_float_attr(prim_path, |s, cb, u| unsafe {
            usdc_mesh_points(self.raw, s, cb, u)
        })
    }

    pub fn mesh_face_vertex_counts(&self, prim_path: &str) -> Vec<i32> {
        self.read_i32_attr(prim_path, |s, cb, u| unsafe {
            usdc_mesh_face_vertex_counts(self.raw, s, cb, u)
        })
    }

    pub fn mesh_face_vertex_indices(&self, prim_path: &str) -> Vec<i32> {
        self.read_i32_attr(prim_path, |s, cb, u| unsafe {
            usdc_mesh_face_vertex_indices(self.raw, s, cb, u)
        })
    }

    pub fn mesh_normals(&self, prim_path: &str) -> (Vec<f32>, Interpolation) {
        self.read_float_attr_with_interp(prim_path, |s, cb, u, out| unsafe {
            usdc_mesh_normals(self.raw, s, cb, u, out)
        })
    }

    pub fn mesh_uvs(&self, prim_path: &str) -> (Vec<f32>, Interpolation) {
        self.read_float_attr_with_interp(prim_path, |s, cb, u, out| unsafe {
            usdc_mesh_uvs(self.raw, s, cb, u, out)
        })
    }

    pub fn mesh_uv_indices(&self, prim_path: &str) -> Vec<i32> {
        self.read_i32_attr(prim_path, |s, cb, u| unsafe {
            usdc_mesh_uv_indices(self.raw, s, cb, u)
        })
    }

    pub fn mesh_display_color(&self, prim_path: &str) -> (Vec<f32>, Interpolation) {
        self.read_float_attr_with_interp(prim_path, |s, cb, u, out| unsafe {
            usdc_mesh_display_color(self.raw, s, cb, u, out)
        })
    }

    /// Direct `UsdShadeMaterialBinding` lookup (allPurpose) on a prim.
    /// Returns the bound material's SdfPath as a Rust `String`. `None`
    /// when no binding is authored.
    pub fn prim_bound_material(&self, prim_path: &str) -> Option<String> {
        let c = CString::new(prim_path).ok()?;
        let p = unsafe { usdc_prim_bound_material(self.raw, c.as_ptr()) };
        ptr_to_opt_string(p)
    }

    /// Path of the Shader prim connected to `outputs:surface` on the
    /// Material. Universal render context first, then `mtlx` fallback.
    pub fn material_surface_shader(&self, mat_path: &str) -> Option<String> {
        let c = CString::new(mat_path).ok()?;
        let p = unsafe { usdc_material_surface_shader(self.raw, c.as_ptr()) };
        ptr_to_opt_string(p)
    }

    /// `info:id` token authored on a Shader prim (e.g.
    /// `"UsdPreviewSurface"`, `"UsdUVTexture"`, `"UsdTransform2d"`).
    pub fn shader_id(&self, shader_path: &str) -> Option<String> {
        let c = CString::new(shader_path).ok()?;
        let p = unsafe { usdc_shader_id(self.raw, c.as_ptr()) };
        ptr_to_opt_string(p)
    }

    /// Scalar float input read on a shader prim. Accepts either
    /// `"inputs:roughness"` or just `"roughness"`. Returns `None` when
    /// unauthored or wrong type.
    pub fn shader_input_float(&self, shader_path: &str, input_name: &str) -> Option<f32> {
        let sp = CString::new(shader_path).ok()?;
        let ip = CString::new(input_name).ok()?;
        let mut out: f32 = 0.0;
        let ok = unsafe {
            usdc_shader_input_float(self.raw, sp.as_ptr(), ip.as_ptr(), &mut out as *mut f32)
        };
        if ok == 1 { Some(out) } else { None }
    }

    /// Returns true when the named shader input has an authored
    /// connection source (e.g. `diffuseColor.connect` → UsdUVTexture).
    /// Used to neutralize `baseColorFactor` to white on meshes whose
    /// `UsdPreviewSurface.inputs:diffuseColor` is driven by a texture
    /// we have not yet loaded.
    pub fn shader_input_has_connection(&self, shader_path: &str, input_name: &str) -> bool {
        let Ok(sp) = CString::new(shader_path) else { return false };
        let Ok(ip) = CString::new(input_name) else { return false };
        let ok = unsafe {
            usdc_shader_input_has_connection(self.raw, sp.as_ptr(), ip.as_ptr())
        };
        ok == 1
    }

    /// `color3f` / `color3d` input read on a shader prim. Returns
    /// `None` when unauthored or wrong type.
    pub fn shader_input_color3f(&self, shader_path: &str, input_name: &str) -> Option<[f32; 3]> {
        let sp = CString::new(shader_path).ok()?;
        let ip = CString::new(input_name).ok()?;
        let mut out: [f32; 3] = [0.0; 3];
        let ok = unsafe {
            usdc_shader_input_color3f(self.raw, sp.as_ptr(), ip.as_ptr(), out.as_mut_ptr())
        };
        if ok == 1 { Some(out) } else { None }
    }

    fn read_float_attr<F>(&self, prim_path: &str, call: F) -> Vec<f32>
    where
        F: FnOnce(*const c_char, UsdcFloatBufferCallback, *mut c_void),
    {
        let Ok(c) = CString::new(prim_path) else {
            return Vec::new();
        };
        let mut out = Vec::<f32>::new();
        call(
            c.as_ptr(),
            Some(float_buffer_trampoline),
            &mut out as *mut Vec<f32> as *mut c_void,
        );
        out
    }

    fn read_i32_attr<F>(&self, prim_path: &str, call: F) -> Vec<i32>
    where
        F: FnOnce(*const c_char, UsdcI32BufferCallback, *mut c_void),
    {
        let Ok(c) = CString::new(prim_path) else {
            return Vec::new();
        };
        let mut out = Vec::<i32>::new();
        call(
            c.as_ptr(),
            Some(i32_buffer_trampoline),
            &mut out as *mut Vec<i32> as *mut c_void,
        );
        out
    }

    fn read_float_attr_with_interp<F>(
        &self,
        prim_path: &str,
        call: F,
    ) -> (Vec<f32>, Interpolation)
    where
        F: FnOnce(
            *const c_char,
            UsdcFloatBufferCallback,
            *mut c_void,
            *mut UsdcInterpolation,
        ),
    {
        let Ok(c) = CString::new(prim_path) else {
            return (Vec::new(), Interpolation::Unknown);
        };
        let mut out = Vec::<f32>::new();
        let mut interp: UsdcInterpolation = USDC_INTERP_UNKNOWN;
        call(
            c.as_ptr(),
            Some(float_buffer_trampoline),
            &mut out as *mut Vec<f32> as *mut c_void,
            &mut interp,
        );
        (out, Interpolation::from_raw(interp))
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

// Trampoline: the shim calls this once per mesh attribute with the
// entire flat float buffer. `user` is a `&mut Vec<f32>` that we extend
// with a copy of the borrowed slice before the callback returns; the
// pointer becomes invalid as soon as the shim unwinds.
//
// Safety:
//   - `data` must point to `count` contiguous valid `f32`s (or be
//     null with `count == 0`).
//   - `user` must be a `*mut Vec<f32>` as set up by `read_float_attr`.
unsafe extern "C" fn float_buffer_trampoline(
    data: *const f32,
    count: usize,
    user: *mut c_void,
) {
    if user.is_null() || data.is_null() || count == 0 {
        return;
    }
    let out = unsafe { &mut *(user as *mut Vec<f32>) };
    let slice = unsafe { std::slice::from_raw_parts(data, count) };
    out.extend_from_slice(slice);
}

// Same pattern for i32 integer buffers (faceVertexCounts / indices).
// `c_int` on Windows MSVC and macOS x64/arm64 is 32-bit, so a reinterpret
// to `i32` is safe for the platforms the C++ backend targets.
unsafe extern "C" fn i32_buffer_trampoline(
    data: *const c_int,
    count: usize,
    user: *mut c_void,
) {
    if user.is_null() || data.is_null() || count == 0 {
        return;
    }
    let out = unsafe { &mut *(user as *mut Vec<i32>) };
    let slice = unsafe { std::slice::from_raw_parts(data as *const i32, count) };
    out.extend_from_slice(slice);
}
