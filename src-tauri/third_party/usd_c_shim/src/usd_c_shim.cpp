// SPDX-License-Identifier: Apache-2.0
//
// usd_c_shim implementation. See include/usd_c_shim.h for API contract.
//
// All functions catch C++ exceptions at the FFI boundary. Best-effort
// enumeration paths swallow exceptions silently after emitting whatever
// was gathered before the failure; APIs that return a single value
// surface the exception through UsdcError**.

// Must be defined before including the header so that USDC_API expands
// to the "export" form (dllexport on Windows, default visibility on
// POSIX) for every public declaration pulled in below. CMake also
// defines this via target_compile_definitions, but defining it here
// guards against accidental builds that forget to pass it through.
#ifndef USD_C_SHIM_BUILDING
#  define USD_C_SHIM_BUILDING 1
#endif

#include "usd_c_shim.h"

#include <cmath>
#include <exception>
#include <mutex>
#include <string>

#ifdef _WIN32
/* NOMINMAX keeps <windows.h> from defining `min`/`max` macros that
 * collide with std::numeric_limits and friends used by OpenUSD's
 * ilmbase half-float limit traits. WIN32_LEAN_AND_MEAN drops rarely-
 * used headers (cryptography, DDE, ...) so the shim's compile stays
 * quick and doesn't leak even more tokens into the global scope. */
#  ifndef NOMINMAX
#    define NOMINMAX
#  endif
#  define WIN32_LEAN_AND_MEAN
#  include <windows.h>
#else
#  include <dlfcn.h>
#endif

#include <pxr/base/plug/registry.h>
#include <pxr/base/tf/token.h>
#include <pxr/usd/sdf/fileFormat.h>
#include <pxr/usd/sdf/layer.h>
#include <pxr/usd/sdf/path.h>
#include <pxr/usd/sdf/payload.h>
#include <pxr/usd/sdf/reference.h>
#include <pxr/usd/usd/payloads.h>
#include <pxr/usd/usd/prim.h>
#include <pxr/usd/usd/primRange.h>
#include <pxr/usd/usd/references.h>
#include <pxr/usd/usd/stage.h>
#include <pxr/usd/usd/variantSets.h>
#include <pxr/base/gf/matrix4d.h>
#include <pxr/base/gf/vec2d.h>
#include <pxr/base/gf/vec2f.h>
#include <pxr/base/gf/vec3d.h>
#include <pxr/base/gf/vec3f.h>
#include <pxr/base/vt/array.h>
#include <pxr/usd/usdGeom/imageable.h>
#include <pxr/usd/usdGeom/mesh.h>
#include <pxr/usd/usdGeom/metrics.h>
#include <pxr/usd/usdGeom/primvarsAPI.h>
#include <pxr/usd/usdGeom/tokens.h>
#include <pxr/usd/usdGeom/xformable.h>
#include <pxr/usd/sdf/assetPath.h>
#include <pxr/usd/usdShade/connectableAPI.h>
#include <pxr/usd/usdShade/input.h>
#include <pxr/usd/usdShade/material.h>
#include <pxr/usd/usdShade/materialBindingAPI.h>
#include <pxr/usd/usdShade/output.h>
#include <pxr/usd/usdShade/shader.h>
#include <pxr/usd/usdShade/tokens.h>

PXR_NAMESPACE_USING_DIRECTIVE

struct UsdcError_s {
    std::string msg;
};

struct UsdcStage_s {
    UsdStageRefPtr stage;
    /* Remembered at open time so `usdc_stage_skipped_payloads` can
     * short-circuit for LoadAll stages without having to query the
     * stage for load rules — the OpenUSD API for introspecting a
     * composed UsdStageLoadRules has shifted between versions, but
     * the policy we opened with is stable for the handle's lifetime. */
    UsdcLoadPolicy policy;
    /* One-shot buffer backing scalar C-string returns. Overwritten on
     * every call that produces a string result. */
    std::string scratch;
};

namespace {

/* Returns the directory containing the shim's own shared library, so
 * we can bootstrap OpenUSD's plugin registry against the `usd/`
 * subdirectory that `build.rs` mirrors next to the shim. Without this
 * the plugin registry only sees the vcpkg install prefix baked in at
 * build time, which does not exist on the target machine — meaning
 * `UsdStage::Open` cannot find the `usda`/`usdc` file-format plugins
 * and aborts during stage composition. */
std::string shim_library_directory() {
#ifdef _WIN32
    HMODULE handle = nullptr;
    if (!::GetModuleHandleExA(
            GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS
                | GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT,
            reinterpret_cast<LPCSTR>(&shim_library_directory),
            &handle)) {
        return {};
    }
    char buf[MAX_PATH];
    DWORD n = ::GetModuleFileNameA(handle, buf, MAX_PATH);
    if (n == 0 || n == MAX_PATH) return {};
    std::string path(buf, n);
    auto pos = path.find_last_of("\\/");
    return (pos == std::string::npos) ? std::string() : path.substr(0, pos);
#else
    Dl_info info{};
    if (!::dladdr(reinterpret_cast<void *>(&shim_library_directory),
                  &info)
        || info.dli_fname == nullptr) {
        return {};
    }
    std::string path = info.dli_fname;
    auto pos = path.find_last_of('/');
    return (pos == std::string::npos) ? std::string() : path.substr(0, pos);
#endif
}

/* Idempotent plugin-registration bootstrap. Called lazily from every
 * public entry point that may touch the UsdStage / Plug registry so
 * the shim stays usable regardless of which function a caller hits
 * first. PlugRegistry is itself a singleton and RegisterPlugins is
 * additive, so calling it once is sufficient, but we guard with
 * std::call_once for clarity and to avoid the rare double-registration
 * cost in case the internal noop check ever changes.
 *
 * Probes several candidate locations because the plugin tree lands
 * in different relative positions depending on the deployment:
 *
 *   - `<dll_dir>/usd`                — dev builds on every OS (build.rs
 *                                      mirrors next to the shim) and
 *                                      Windows MSI (resources live next
 *                                      to the exe).
 *   - `<dll_dir>/../Resources/usd`   — macOS .app bundle (shim dylib
 *                                      sits in Contents/Frameworks/,
 *                                      plugin tree in Contents/Resources/
 *                                      because Tauri's macOS bundler
 *                                      puts `resources:` there).
 *
 * RegisterPlugins is additive, so probing both is safe even when only
 * one exists.
 */
void register_plugins_once() {
    static std::once_flag flag;
    std::call_once(flag, []() {
        const std::string dir = shim_library_directory();
        if (dir.empty()) return;
        /* Windows accepts both '\' and '/' as separators for
         * RegisterPlugins; use '/' for portability with the macOS
         * branch of the same call. */
        try {
            PlugRegistry::GetInstance().RegisterPlugins(dir + "/usd");
            PlugRegistry::GetInstance().RegisterPlugins(
                dir + "/../Resources/usd");
        } catch (...) {
            /* Swallow: failure here will surface shortly as a
             * UsdStage::Open error, and letting an exception unwind
             * across the FFI boundary is UB. */
        }
    });
}

UsdcError *make_err(const char *msg) {
    auto *e = new UsdcError_s();
    e->msg.assign(msg ? msg : "unknown error");
    return e;
}

UsdcError *make_err(const std::string &msg) {
    auto *e = new UsdcError_s();
    e->msg = msg;
    return e;
}

/* Safely look up a prim without raising. Returns an invalid UsdPrim
 * on any failure. */
UsdPrim prim_at(UsdcStage *h, const char *prim_path) {
    if (!h || !prim_path) return UsdPrim();
    try {
        SdfPath path(prim_path);
        return h->stage->GetPrimAtPath(path);
    } catch (...) {
        return UsdPrim();
    }
}

/* Small RAII scope used by the enumeration helpers: catches all
 * exceptions so a single failing prim doesn't terminate the walk. */
template <typename F>
void swallow(F &&f) {
    try {
        f();
    } catch (...) {
        /* best-effort */
    }
}

} // namespace

/* -------------------- error -------------------- */

extern "C" USDC_API const char *usdc_error_message(const UsdcError *err) {
    return (err != nullptr) ? err->msg.c_str() : "";
}

extern "C" USDC_API void usdc_error_free(UsdcError *err) {
    delete err;
}

/* -------------------- stage lifecycle -------------------- */

extern "C" USDC_API UsdcStage *usdc_stage_open(const char *path,
                                               UsdcLoadPolicy policy,
                                               UsdcError **out_err) {
    if (out_err) *out_err = nullptr;

    if (path == nullptr) {
        if (out_err) *out_err = make_err("usdc_stage_open: path is null");
        return nullptr;
    }

    register_plugins_once();

    try {
        const auto load = (policy == USDC_LOAD_NO_PAYLOADS)
                              ? UsdStage::LoadNone
                              : UsdStage::LoadAll;
        UsdStageRefPtr stage = UsdStage::Open(path, load);
        if (!stage) {
            if (out_err) *out_err = make_err("UsdStage::Open returned null");
            return nullptr;
        }
        auto *h = new UsdcStage_s();
        h->stage = stage;
        h->policy = policy;
        return h;
    } catch (const std::exception &e) {
        if (out_err) *out_err = make_err(e.what());
        return nullptr;
    } catch (...) {
        if (out_err) *out_err = make_err("unknown exception in usdc_stage_open");
        return nullptr;
    }
}

extern "C" USDC_API void usdc_stage_close(UsdcStage *stage) {
    delete stage;
}

/* -------------------- scalar queries -------------------- */

extern "C" USDC_API const char *usdc_stage_default_prim(UsdcStage *stage) {
    if (!stage) return nullptr;
    try {
        UsdPrim prim = stage->stage->GetDefaultPrim();
        if (!prim) return nullptr;
        stage->scratch = prim.GetName().GetString();
        return stage->scratch.c_str();
    } catch (...) {
        return nullptr;
    }
}

extern "C" USDC_API int usdc_stage_up_axis(UsdcStage *stage) {
    if (!stage) return -1;
    try {
        TfToken axis = UsdGeomGetStageUpAxis(stage->stage);
        if (axis == UsdGeomTokens->y) return 0;
        if (axis == UsdGeomTokens->z) return 1;
        return -1;
    } catch (...) {
        return -1;
    }
}

extern "C" USDC_API double usdc_stage_meters_per_unit(UsdcStage *stage) {
    if (!stage) return std::nan("");
    try {
        /* UsdGeomGetStageMetersPerUnit returns 0.01 as the default.
         * We return NaN when the metadata is not authored so the
         * caller can distinguish "unset" from "explicit centimeter". */
        if (!stage->stage->HasAuthoredMetadata(UsdGeomTokens->metersPerUnit)) {
            return std::nan("");
        }
        return UsdGeomGetStageMetersPerUnit(stage->stage);
    } catch (...) {
        return std::nan("");
    }
}

extern "C" USDC_API int usdc_stage_root_layer_is_binary(UsdcStage *stage) {
    if (!stage) return -1;
    try {
        SdfLayerHandle root = stage->stage->GetRootLayer();
        if (!root) return -1;
        /* USDC layers report GetFileFormat()->GetFormatId() == "usdc".
         * USDA reports "usda". A USDZ package reports "usdz" regardless
         * of the inner root layer's flavor. For the purposes of yw-look's
         * "should this go through the GLB pipeline?" router, both USDC
         * and USDZ need to be classified as binary — the Three.js
         * USDLoader can only handle a plain USDA text buffer, so routing
         * a USDZ archive through it produces an empty scene. The Rust
         * fork backend (see openusd::layer::open_layer_with_format)
         * already reports `is_binary == true` for USDZ packages for the
         * same reason. */
        const TfToken &fmt = root->GetFileFormat()->GetFormatId();
        static const TfToken kUsdc("usdc");
        static const TfToken kUsdz("usdz");
        return (fmt == kUsdc || fmt == kUsdz) ? 1 : 0;
    } catch (...) {
        return -1;
    }
}

extern "C" USDC_API size_t usdc_stage_layer_count(UsdcStage *stage) {
    if (!stage) return 0;
    try {
        /* GetUsedLayers returns every layer contributing to stage
         * composition, including the always-present session layer
         * even when a caller opens a stage without one explicitly.
         * yw-look's inspector matches the Rust fork's semantics,
         * which counts only "authored" composed layers — session
         * layer excluded — so subtract when it is present. */
        const auto used = stage->stage->GetUsedLayers();
        const SdfLayerHandle session = stage->stage->GetSessionLayer();
        size_t count = used.size();
        if (session) {
            for (const auto &l : used) {
                if (l == session) {
                    --count;
                    break;
                }
            }
        }
        return count;
    } catch (...) {
        return 0;
    }
}

/* -------------------- enumeration -------------------- */

extern "C" USDC_API void usdc_stage_traverse(UsdcStage *stage,
                                             UsdcStringCallback cb,
                                             void *user) {
    if (!stage || !cb) return;
    swallow([&] {
        for (const UsdPrim &prim : stage->stage->Traverse()) {
            swallow([&] {
                const std::string s = prim.GetPath().GetAsString();
                cb(s.c_str(), user);
            });
        }
    });
}

extern "C" USDC_API void usdc_stage_layer_identifiers(UsdcStage *stage,
                                                      UsdcStringCallback cb,
                                                      void *user) {
    if (!stage || !cb) return;
    swallow([&] {
        const SdfLayerHandle session = stage->stage->GetSessionLayer();
        /* Emit the root layer first so the Rust backend can strip it
         * to derive the "composed layers" list in the same single-
         * step way as the Rust-fork backend. Remaining authored
         * layers follow in their GetUsedLayers order; the implicit
         * session layer is skipped because the inspector UI treats
         * it as non-authored infrastructure. */
        const SdfLayerHandle root = stage->stage->GetRootLayer();
        if (root) {
            cb(root->GetIdentifier().c_str(), user);
        }
        for (const SdfLayerHandle &layer : stage->stage->GetUsedLayers()) {
            if (!layer) continue;
            if (layer == root) continue;
            if (layer == session) continue;
            cb(layer->GetIdentifier().c_str(), user);
        }
    });
}

extern "C" USDC_API void usdc_stage_references_in(UsdcStage *stage,
                                                  const char *prim_path,
                                                  UsdcArcCallback cb,
                                                  void *user) {
    if (!cb) return;
    UsdPrim prim = prim_at(stage, prim_path);
    if (!prim) return;

    swallow([&] {
        /* We walk the prim's authored metadata directly to collect
         * references without mutating anything (the editable proxy
         * from GetReferences() is not needed for a read-only pass). */
        SdfReferenceListOp op;
        if (prim.GetMetadata(SdfFieldKeys->References, &op)) {
            std::vector<SdfReference> items;
            op.ApplyOperations(&items);
            for (const SdfReference &r : items) {
                swallow([&] {
                    const std::string asset = r.GetAssetPath();
                    const std::string source = prim.GetPath().GetAsString();
                    std::string target;
                    if (!r.GetPrimPath().IsEmpty()) {
                        target = r.GetPrimPath().GetAsString();
                    }
                    UsdcArc arc;
                    arc.source_prim = source.c_str();
                    arc.asset_path = asset.c_str();
                    arc.target_prim = target.empty() ? nullptr : target.c_str();
                    /* references are always composed (no deferred load
                     * mode for references in USD), so loaded = 1 unless
                     * the asset is in unresolved_assets list (the
                     * caller reclassifies). */
                    arc.is_loaded = 1;
                    cb(&arc, user);
                });
            }
        }
    });
}

extern "C" USDC_API void usdc_stage_payloads_in(UsdcStage *stage,
                                                const char *prim_path,
                                                UsdcArcCallback cb,
                                                void *user) {
    if (!cb) return;
    UsdPrim prim = prim_at(stage, prim_path);
    if (!prim) return;

    swallow([&] {
        SdfPayloadListOp op;
        if (prim.GetMetadata(SdfFieldKeys->Payload, &op)) {
            std::vector<SdfPayload> items;
            op.ApplyOperations(&items);
            for (const SdfPayload &p : items) {
                swallow([&] {
                    const std::string asset = p.GetAssetPath();
                    const std::string source = prim.GetPath().GetAsString();
                    std::string target;
                    if (!p.GetPrimPath().IsEmpty()) {
                        target = p.GetPrimPath().GetAsString();
                    }
                    UsdcArc arc;
                    arc.source_prim = source.c_str();
                    arc.asset_path = asset.c_str();
                    arc.target_prim = target.empty() ? nullptr : target.c_str();
                    /* Loaded status depends on the stage's load set and
                     * whether the resolver found the asset. Here we
                     * report 1 if the prim is Loaded; callers cross-
                     * reference unresolved/skipped lists for the final
                     * state classification. */
                    arc.is_loaded = prim.IsLoaded() ? 1 : 0;
                    cb(&arc, user);
                });
            }
        }
    });
}

extern "C" USDC_API void usdc_stage_unresolved_assets(UsdcStage *stage,
                                                      UsdcStringCallback cb,
                                                      void *user) {
    if (!stage || !cb) return;
    /* OpenUSD has no direct "list of unresolved asset paths" API like
     * our Rust fork does. We approximate by walking every authored
     * reference / payload and emitting paths whose Ar resolver could
     * not resolve them. This is the minimum viable implementation
     * suitable for Inspector-only use; refine later. */
    swallow([&] {
        for (const UsdPrim &prim : stage->stage->TraverseAll()) {
            SdfReferenceListOp refOp;
            if (prim.GetMetadata(SdfFieldKeys->References, &refOp)) {
                std::vector<SdfReference> items;
                refOp.ApplyOperations(&items);
                for (const SdfReference &r : items) {
                    const std::string asset = r.GetAssetPath();
                    if (asset.empty()) continue;
                    const std::string resolved =
                        stage->stage->ResolveIdentifierToEditTarget(asset);
                    if (resolved.empty()) {
                        cb(asset.c_str(), user);
                    }
                }
            }
            SdfPayloadListOp payOp;
            if (prim.GetMetadata(SdfFieldKeys->Payload, &payOp)) {
                std::vector<SdfPayload> items;
                payOp.ApplyOperations(&items);
                for (const SdfPayload &p : items) {
                    const std::string asset = p.GetAssetPath();
                    if (asset.empty()) continue;
                    const std::string resolved =
                        stage->stage->ResolveIdentifierToEditTarget(asset);
                    if (resolved.empty()) {
                        cb(asset.c_str(), user);
                    }
                }
            }
        }
    });
}

extern "C" USDC_API void usdc_stage_skipped_payloads(UsdcStage *stage,
                                                     UsdcArcCallback cb,
                                                     void *user) {
    if (!stage || !cb) return;
    /* A stage opened with LoadNone leaves every payload unloaded.
     * Emit one UsdcArc per (prim, payload) pair so callers can
     * classify by (asset_path, source_prim) — matching the Rust
     * fork's skipped_payloads keying.
     *
     * Stages opened with LoadAll have nothing to report here; we
     * short-circuit by consulting the policy stored on the handle
     * at open time. Querying the stage's current UsdStageLoadRules
     * would be more "live" but the API surface for that has shifted
     * between OpenUSD releases, and the policy we were opened with
     * is stable for the handle's lifetime. */
    if (stage->policy != USDC_LOAD_NO_PAYLOADS) return;
    swallow([&] {
        for (const UsdPrim &prim : stage->stage->TraverseAll()) {
            SdfPayloadListOp op;
            if (!prim.GetMetadata(SdfFieldKeys->Payload, &op)) continue;
            std::vector<SdfPayload> items;
            op.ApplyOperations(&items);
            if (items.empty()) continue;

            const std::string source = prim.GetPath().GetAsString();
            for (const SdfPayload &p : items) {
                swallow([&] {
                    const std::string asset = p.GetAssetPath();
                    if (asset.empty()) return;
                    std::string target;
                    if (!p.GetPrimPath().IsEmpty()) {
                        target = p.GetPrimPath().GetAsString();
                    }
                    UsdcArc arc;
                    arc.source_prim = source.c_str();
                    arc.asset_path = asset.c_str();
                    arc.target_prim = target.empty() ? nullptr : target.c_str();
                    /* Skipped-payload emissions always represent an
                     * Unloaded arc; reference assets that were also
                     * unresolved still get reclassified to Missing
                     * on the Rust side by cross-checking against
                     * unresolved_assets. */
                    arc.is_loaded = 0;
                    cb(&arc, user);
                });
            }
        }
    });
}

/* -------------------- per-prim queries -------------------- */

extern "C" USDC_API int usdc_prim_type_is_mesh(UsdcStage *stage, const char *prim_path) {
    UsdPrim prim = prim_at(stage, prim_path);
    if (!prim) return 0;
    try {
        return prim.IsA<UsdGeomMesh>() ? 1 : 0;
    } catch (...) {
        return 0;
    }
}

extern "C" USDC_API int usdc_prim_has_variants(UsdcStage *stage, const char *prim_path) {
    UsdPrim prim = prim_at(stage, prim_path);
    if (!prim) return 0;
    try {
        return prim.HasVariantSets() ? 1 : 0;
    } catch (...) {
        return 0;
    }
}

extern "C" USDC_API void usdc_prim_variant_set_names(UsdcStage *stage,
                                                     const char *prim_path,
                                                     UsdcStringCallback cb,
                                                     void *user) {
    if (!cb) return;
    UsdPrim prim = prim_at(stage, prim_path);
    if (!prim) return;
    swallow([&] {
        UsdVariantSets vsets = prim.GetVariantSets();
        const std::vector<std::string> names = vsets.GetNames();
        for (const std::string &n : names) {
            cb(n.c_str(), user);
        }
    });
}

extern "C" USDC_API const char *usdc_prim_variant_selection(UsdcStage *stage,
                                                            const char *prim_path,
                                                            const char *set_name) {
    UsdPrim prim = prim_at(stage, prim_path);
    if (!prim || !set_name || !stage) return nullptr;
    try {
        UsdVariantSet vset = prim.GetVariantSet(set_name);
        if (!vset.IsValid()) return nullptr;
        const std::string sel = vset.GetVariantSelection();
        if (sel.empty()) return nullptr;
        stage->scratch = sel;
        return stage->scratch.c_str();
    } catch (...) {
        return nullptr;
    }
}

/* -------------------- geometry -------------------- */

namespace {

/* Map a pxr interpolation token to the shim's vocabulary. Unknown /
 * missing tokens map to USDC_INTERP_UNKNOWN so the Rust side can
 * fall back to a safe default. */
UsdcInterpolation map_interp(const TfToken &tok) {
    if (tok == UsdGeomTokens->constant)    return USDC_INTERP_CONSTANT;
    if (tok == UsdGeomTokens->uniform)     return USDC_INTERP_UNIFORM;
    if (tok == UsdGeomTokens->varying)     return USDC_INTERP_VARYING;
    if (tok == UsdGeomTokens->vertex)      return USDC_INTERP_VERTEX;
    if (tok == UsdGeomTokens->faceVarying) return USDC_INTERP_FACE_VARYING;
    return USDC_INTERP_UNKNOWN;
}

/* Call `cb(data, count, user)` with the contents of a VtArray, coerced
 * to a flat view of the element type's underlying scalar. Handles
 * VtArray<GfVec3f>, <GfVec2f>, <float> uniformly because the memory
 * layout is contiguous and VtArray guarantees a trivially-copyable
 * storage for these types. Emits (NULL, 0) on empty or on failure. */
template <typename T>
void emit_float_array(const VtArray<T> &arr,
                      UsdcFloatBufferCallback cb,
                      void *user,
                      size_t stride) {
    if (!cb) return;
    if (arr.empty()) {
        cb(nullptr, 0, user);
        return;
    }
    const float *data = reinterpret_cast<const float *>(arr.cdata());
    cb(data, arr.size() * stride, user);
}

void emit_empty_floats(UsdcFloatBufferCallback cb, void *user) {
    if (cb) cb(nullptr, 0, user);
}
void emit_empty_ints(UsdcI32BufferCallback cb, void *user) {
    if (cb) cb(nullptr, 0, user);
}

/* Walks the imageable ancestor chain, returning false if any ancestor
 * deactivates the subtree. `active` is not strictly inheritable, but
 * UsdPrim::IsActive already collapses that — a deactivated ancestor
 * suppresses IsActive on every descendant. */
bool is_visible_under_default_purpose(const UsdPrim &prim) {
    if (!prim || !prim.IsActive()) return false;
    UsdGeomImageable img(prim);
    if (!img) return true; /* non-imageable prim; inherit visibility */
    /* ComputeVisibility returns "invisible" if the prim or any
     * ancestor authored visibility = invisible. */
    TfToken vis = img.ComputeVisibility();
    if (vis == UsdGeomTokens->invisible) return false;
    /* ComputePurpose resolves to the effective purpose after
     * inheritance. Default + render are both renderable under the
     * default viewer purpose; proxy and guide are hidden. */
    TfToken purpose = img.ComputePurpose();
    if (purpose == UsdGeomTokens->proxy || purpose == UsdGeomTokens->guide) {
        return false;
    }
    return true;
}

} // namespace

extern "C" USDC_API int usdc_prim_is_renderable_mesh(UsdcStage *stage,
                                                     const char *prim_path) {
    UsdPrim prim = prim_at(stage, prim_path);
    if (!prim) return 0;
    try {
        if (!prim.IsA<UsdGeomMesh>()) return 0;
        return is_visible_under_default_purpose(prim) ? 1 : 0;
    } catch (...) {
        return 0;
    }
}

extern "C" USDC_API int usdc_prim_world_matrix(UsdcStage *stage,
                                               const char *prim_path,
                                               double out_matrix[16]) {
    UsdPrim prim = prim_at(stage, prim_path);
    if (!prim || !out_matrix) return 0;
    try {
        UsdGeomXformable xf(prim);
        if (!xf) return 0;
        bool reset = false;
        GfMatrix4d m =
            xf.ComputeLocalToWorldTransform(UsdTimeCode::Default());
        (void)reset;
        /* GfMatrix4d is row-major in memory (M[row][col]); glTF expects
         * column-major. Transpose during the copy so Rust receives
         * glTF-compatible layout directly. */
        for (int r = 0; r < 4; ++r) {
            for (int c = 0; c < 4; ++c) {
                out_matrix[c * 4 + r] = m[r][c];
            }
        }
        return 1;
    } catch (...) {
        return 0;
    }
}

extern "C" USDC_API UsdcOrientation usdc_mesh_orientation(UsdcStage *stage,
                                                          const char *prim_path) {
    UsdPrim prim = prim_at(stage, prim_path);
    if (!prim) return USDC_ORIENT_RIGHT_HANDED;
    try {
        UsdGeomMesh mesh(prim);
        if (!mesh) return USDC_ORIENT_RIGHT_HANDED;
        TfToken tok;
        if (!mesh.GetOrientationAttr().Get(&tok)) {
            return USDC_ORIENT_RIGHT_HANDED;
        }
        return (tok == UsdGeomTokens->leftHanded)
                   ? USDC_ORIENT_LEFT_HANDED
                   : USDC_ORIENT_RIGHT_HANDED;
    } catch (...) {
        return USDC_ORIENT_RIGHT_HANDED;
    }
}

extern "C" USDC_API void usdc_mesh_points(UsdcStage *stage,
                                          const char *prim_path,
                                          UsdcFloatBufferCallback cb,
                                          void *user) {
    UsdPrim prim = prim_at(stage, prim_path);
    if (!prim) { emit_empty_floats(cb, user); return; }
    try {
        UsdGeomMesh mesh(prim);
        if (!mesh) { emit_empty_floats(cb, user); return; }
        VtArray<GfVec3f> pts;
        if (!mesh.GetPointsAttr().Get(&pts)) {
            emit_empty_floats(cb, user);
            return;
        }
        emit_float_array(pts, cb, user, 3);
    } catch (...) {
        emit_empty_floats(cb, user);
    }
}

extern "C" USDC_API void
usdc_mesh_face_vertex_counts(UsdcStage *stage,
                             const char *prim_path,
                             UsdcI32BufferCallback cb,
                             void *user) {
    UsdPrim prim = prim_at(stage, prim_path);
    if (!prim || !cb) { emit_empty_ints(cb, user); return; }
    try {
        UsdGeomMesh mesh(prim);
        if (!mesh) { emit_empty_ints(cb, user); return; }
        VtArray<int> counts;
        if (!mesh.GetFaceVertexCountsAttr().Get(&counts) || counts.empty()) {
            emit_empty_ints(cb, user);
            return;
        }
        cb(counts.cdata(), counts.size(), user);
    } catch (...) {
        emit_empty_ints(cb, user);
    }
}

extern "C" USDC_API void
usdc_mesh_face_vertex_indices(UsdcStage *stage,
                              const char *prim_path,
                              UsdcI32BufferCallback cb,
                              void *user) {
    UsdPrim prim = prim_at(stage, prim_path);
    if (!prim || !cb) { emit_empty_ints(cb, user); return; }
    try {
        UsdGeomMesh mesh(prim);
        if (!mesh) { emit_empty_ints(cb, user); return; }
        VtArray<int> indices;
        if (!mesh.GetFaceVertexIndicesAttr().Get(&indices) || indices.empty()) {
            emit_empty_ints(cb, user);
            return;
        }
        cb(indices.cdata(), indices.size(), user);
    } catch (...) {
        emit_empty_ints(cb, user);
    }
}

extern "C" USDC_API void usdc_mesh_normals(UsdcStage *stage,
                                           const char *prim_path,
                                           UsdcFloatBufferCallback cb,
                                           void *user,
                                           UsdcInterpolation *out_interp) {
    if (out_interp) *out_interp = USDC_INTERP_UNKNOWN;
    UsdPrim prim = prim_at(stage, prim_path);
    if (!prim) { emit_empty_floats(cb, user); return; }
    try {
        UsdGeomMesh mesh(prim);
        if (!mesh) { emit_empty_floats(cb, user); return; }
        VtArray<GfVec3f> normals;
        if (!mesh.GetNormalsAttr().Get(&normals) || normals.empty()) {
            emit_empty_floats(cb, user);
            return;
        }
        if (out_interp) {
            *out_interp = map_interp(mesh.GetNormalsInterpolation());
        }
        emit_float_array(normals, cb, user, 3);
    } catch (...) {
        emit_empty_floats(cb, user);
    }
}

extern "C" USDC_API void usdc_mesh_uvs(UsdcStage *stage,
                                       const char *prim_path,
                                       UsdcFloatBufferCallback cb,
                                       void *user,
                                       UsdcInterpolation *out_interp) {
    if (out_interp) *out_interp = USDC_INTERP_UNKNOWN;
    UsdPrim prim = prim_at(stage, prim_path);
    if (!prim) { emit_empty_floats(cb, user); return; }
    try {
        UsdGeomPrimvarsAPI api(prim);
        UsdGeomPrimvar uv = api.GetPrimvar(TfToken("primvars:st"));
        /* Fall back to the alternate primvars:uv spelling that some
         * authoring tools emit. */
        if (!uv) {
            uv = api.GetPrimvar(TfToken("primvars:uv"));
        }
        if (!uv || !uv.HasValue()) {
            emit_empty_floats(cb, user);
            return;
        }
        VtArray<GfVec2f> values;
        if (!uv.Get(&values) || values.empty()) {
            emit_empty_floats(cb, user);
            return;
        }
        if (out_interp) {
            *out_interp = map_interp(uv.GetInterpolation());
        }
        emit_float_array(values, cb, user, 2);
    } catch (...) {
        emit_empty_floats(cb, user);
    }
}

extern "C" USDC_API void usdc_mesh_uv_indices(UsdcStage *stage,
                                              const char *prim_path,
                                              UsdcI32BufferCallback cb,
                                              void *user) {
    UsdPrim prim = prim_at(stage, prim_path);
    if (!prim || !cb) { emit_empty_ints(cb, user); return; }
    try {
        UsdGeomPrimvarsAPI api(prim);
        UsdGeomPrimvar uv = api.GetPrimvar(TfToken("primvars:st"));
        if (!uv) uv = api.GetPrimvar(TfToken("primvars:uv"));
        if (!uv || !uv.IsIndexed()) { emit_empty_ints(cb, user); return; }
        VtArray<int> indices;
        if (!uv.GetIndices(&indices) || indices.empty()) {
            emit_empty_ints(cb, user);
            return;
        }
        cb(indices.cdata(), indices.size(), user);
    } catch (...) {
        emit_empty_ints(cb, user);
    }
}

extern "C" USDC_API void
usdc_mesh_display_color(UsdcStage *stage,
                        const char *prim_path,
                        UsdcFloatBufferCallback cb,
                        void *user,
                        UsdcInterpolation *out_interp) {
    if (out_interp) *out_interp = USDC_INTERP_UNKNOWN;
    UsdPrim prim = prim_at(stage, prim_path);
    if (!prim) { emit_empty_floats(cb, user); return; }
    try {
        UsdGeomPrimvarsAPI api(prim);
        UsdGeomPrimvar dc = api.GetPrimvar(TfToken("primvars:displayColor"));
        if (!dc || !dc.HasValue()) {
            emit_empty_floats(cb, user);
            return;
        }
        VtArray<GfVec3f> colors;
        if (!dc.Get(&colors) || colors.empty()) {
            emit_empty_floats(cb, user);
            return;
        }
        if (out_interp) {
            *out_interp = map_interp(dc.GetInterpolation());
        }
        emit_float_array(colors, cb, user, 3);
    } catch (...) {
        emit_empty_floats(cb, user);
    }
}

/* -------------------- generic prim attribute reads (Phase 2.H) -------------------- */

extern "C" USDC_API const char *
usdc_prim_type_name(UsdcStage *stage, const char *prim_path) {
    UsdPrim prim = prim_at(stage, prim_path);
    if (!prim) return nullptr;
    try {
        TfToken t = prim.GetTypeName();
        if (t.IsEmpty()) return nullptr;
        stage->scratch = t.GetString();
        return stage->scratch.c_str();
    } catch (...) {
        return nullptr;
    }
}

extern "C" USDC_API int
usdc_prim_attr_float(UsdcStage *stage,
                     const char *prim_path,
                     const char *attr_name,
                     float *out) {
    if (!out || !attr_name) return 0;
    UsdPrim prim = prim_at(stage, prim_path);
    if (!prim) return 0;
    try {
        UsdAttribute attr = prim.GetAttribute(TfToken(attr_name));
        if (!attr) return 0;
        VtValue v;
        if (!attr.Get(&v)) return 0;
        if (v.IsHolding<float>()) {
            *out = v.UncheckedGet<float>();
            return 1;
        }
        if (v.IsHolding<double>()) {
            *out = static_cast<float>(v.UncheckedGet<double>());
            return 1;
        }
        return 0;
    } catch (...) {
        return 0;
    }
}

extern "C" USDC_API int
usdc_prim_attr_float2(UsdcStage *stage,
                      const char *prim_path,
                      const char *attr_name,
                      float out[2]) {
    if (!out || !attr_name) return 0;
    UsdPrim prim = prim_at(stage, prim_path);
    if (!prim) return 0;
    try {
        UsdAttribute attr = prim.GetAttribute(TfToken(attr_name));
        if (!attr) return 0;
        VtValue v;
        if (!attr.Get(&v)) return 0;
        if (v.IsHolding<GfVec2f>()) {
            const GfVec2f &c = v.UncheckedGet<GfVec2f>();
            out[0] = c[0]; out[1] = c[1];
            return 1;
        }
        if (v.IsHolding<GfVec2d>()) {
            const GfVec2d &c = v.UncheckedGet<GfVec2d>();
            out[0] = static_cast<float>(c[0]);
            out[1] = static_cast<float>(c[1]);
            return 1;
        }
        return 0;
    } catch (...) {
        return 0;
    }
}

extern "C" USDC_API int
usdc_prim_attr_color3f(UsdcStage *stage,
                       const char *prim_path,
                       const char *attr_name,
                       float out[3]) {
    if (!out || !attr_name) return 0;
    UsdPrim prim = prim_at(stage, prim_path);
    if (!prim) return 0;
    try {
        UsdAttribute attr = prim.GetAttribute(TfToken(attr_name));
        if (!attr) return 0;
        VtValue v;
        if (!attr.Get(&v)) return 0;
        if (v.IsHolding<GfVec3f>()) {
            const GfVec3f &c = v.UncheckedGet<GfVec3f>();
            out[0] = c[0]; out[1] = c[1]; out[2] = c[2];
            return 1;
        }
        if (v.IsHolding<GfVec3d>()) {
            const GfVec3d &c = v.UncheckedGet<GfVec3d>();
            out[0] = static_cast<float>(c[0]);
            out[1] = static_cast<float>(c[1]);
            out[2] = static_cast<float>(c[2]);
            return 1;
        }
        return 0;
    } catch (...) {
        return 0;
    }
}

/* -------------------- material / shading (Phase 2.E.1) -------------------- */

extern "C" USDC_API const char *
usdc_prim_bound_material(UsdcStage *stage, const char *prim_path) {
    UsdPrim prim = prim_at(stage, prim_path);
    if (!prim) return nullptr;
    try {
        UsdShadeMaterialBindingAPI binding(prim);
        /* Direct binding only — yw-look's Rust backend also reads the
         * direct binding via `stage.bound_material`, so parity is
         * maintained by avoiding the full collection-lookup path here. */
        UsdShadeMaterial mat = binding.ComputeBoundMaterial();
        if (!mat) return nullptr;
        stage->scratch = mat.GetPath().GetString();
        return stage->scratch.c_str();
    } catch (...) {
        return nullptr;
    }
}

extern "C" USDC_API const char *
usdc_material_surface_shader(UsdcStage *stage, const char *mat_path) {
    UsdPrim prim = prim_at(stage, mat_path);
    if (!prim) return nullptr;
    try {
        UsdShadeMaterial mat(prim);
        if (!mat) return nullptr;
        /* Try each common render context in decreasing priority:
         *   - universal (no-context): every USD asset author should
         *     set this, matches `UsdShadeTokens->universalRenderContext`.
         *   - glslfx: Storm / UsdImagingGL's native surface.
         *     UsdPreviewSurface fixtures emitted by Houdini and some
         *     Pixar tools only populate this one.
         *   - mtlx: MaterialX-authored assets.
         * First hit wins; an asset that only emits `outputs:surface:glslfx`
         * would otherwise look unbound, matching a Rust-backend parity
         * gap flagged in the Phase 2.F/2.H code review. */
        UsdShadeShader shader = mat.ComputeSurfaceSource();
        if (!shader) {
            shader = mat.ComputeSurfaceSource({TfToken("glslfx")});
        }
        if (!shader) {
            shader = mat.ComputeSurfaceSource({TfToken("mtlx")});
        }
        if (!shader) return nullptr;
        stage->scratch = shader.GetPath().GetString();
        return stage->scratch.c_str();
    } catch (...) {
        return nullptr;
    }
}

extern "C" USDC_API const char *
usdc_shader_id(UsdcStage *stage, const char *shader_path) {
    UsdPrim prim = prim_at(stage, shader_path);
    if (!prim) return nullptr;
    try {
        UsdShadeShader shader(prim);
        if (!shader) return nullptr;
        TfToken id;
        if (!shader.GetShaderId(&id) || id.IsEmpty()) return nullptr;
        stage->scratch = id.GetString();
        return stage->scratch.c_str();
    } catch (...) {
        return nullptr;
    }
}

extern "C" USDC_API int
usdc_shader_input_float(UsdcStage *stage,
                        const char *shader_path,
                        const char *input_name,
                        float *out) {
    if (!out || !input_name) return 0;
    UsdPrim prim = prim_at(stage, shader_path);
    if (!prim) return 0;
    try {
        UsdShadeShader shader(prim);
        if (!shader) return 0;
        /* Accept both the leading-"inputs:" form and the bare input
         * name, matching how Rust callers spell the attribute. */
        TfToken token(input_name);
        std::string raw = input_name;
        if (raw.rfind("inputs:", 0) == 0) {
            token = TfToken(raw.substr(7));
        }
        UsdShadeInput in = shader.GetInput(token);
        if (!in) return 0;
        UsdAttribute attr = in.GetAttr();
        if (!attr) return 0;
        VtValue v;
        if (!attr.Get(&v)) return 0;
        if (v.IsHolding<float>()) {
            *out = v.UncheckedGet<float>();
            return 1;
        }
        if (v.IsHolding<double>()) {
            *out = static_cast<float>(v.UncheckedGet<double>());
            return 1;
        }
        return 0;
    } catch (...) {
        return 0;
    }
}

extern "C" USDC_API const char *
usdc_shader_input_connected_source_prim(UsdcStage *stage,
                                        const char *shader_path,
                                        const char *input_name) {
    if (!input_name) return nullptr;
    UsdPrim prim = prim_at(stage, shader_path);
    if (!prim) return nullptr;
    try {
        UsdShadeShader shader(prim);
        if (!shader) return nullptr;
        TfToken token(input_name);
        std::string raw = input_name;
        if (raw.rfind("inputs:", 0) == 0) {
            token = TfToken(raw.substr(7));
        }
        UsdShadeInput in = shader.GetInput(token);
        if (!in) return nullptr;
        SdfPathVector sources;
        if (!in.GetRawConnectedSourcePaths(&sources) || sources.empty()) {
            return nullptr;
        }
        /* Source entries are property paths like `/Mat/Tex.outputs:rgb`;
         * strip the property suffix so the caller sees just the prim. */
        stage->scratch = sources.front().GetPrimPath().GetString();
        return stage->scratch.c_str();
    } catch (...) {
        return nullptr;
    }
}

extern "C" USDC_API const char *
usdc_shader_input_asset(UsdcStage *stage,
                        const char *shader_path,
                        const char *input_name) {
    if (!input_name) return nullptr;
    UsdPrim prim = prim_at(stage, shader_path);
    if (!prim) return nullptr;
    try {
        UsdShadeShader shader(prim);
        if (!shader) return nullptr;
        TfToken token(input_name);
        std::string raw = input_name;
        if (raw.rfind("inputs:", 0) == 0) {
            token = TfToken(raw.substr(7));
        }
        UsdShadeInput in = shader.GetInput(token);
        if (!in) return nullptr;
        UsdAttribute attr = in.GetAttr();
        if (!attr) return nullptr;
        VtValue v;
        if (!attr.Get(&v)) return nullptr;
        if (!v.IsHolding<SdfAssetPath>()) return nullptr;
        /* `GetAssetPath()` returns the authored string; the yw-look
         * texture loader handles USDZ-archive vs filesystem resolve on
         * the Rust side, so we intentionally skip `GetResolvedPath()`. */
        const SdfAssetPath &ap = v.UncheckedGet<SdfAssetPath>();
        stage->scratch = ap.GetAssetPath();
        if (stage->scratch.empty()) return nullptr;
        return stage->scratch.c_str();
    } catch (...) {
        return nullptr;
    }
}

extern "C" USDC_API int
usdc_shader_input_has_connection(UsdcStage *stage,
                                 const char *shader_path,
                                 const char *input_name) {
    if (!input_name) return 0;
    UsdPrim prim = prim_at(stage, shader_path);
    if (!prim) return 0;
    try {
        UsdShadeShader shader(prim);
        if (!shader) return 0;
        TfToken token(input_name);
        std::string raw = input_name;
        if (raw.rfind("inputs:", 0) == 0) {
            token = TfToken(raw.substr(7));
        }
        UsdShadeInput in = shader.GetInput(token);
        if (!in) return 0;
        return in.HasConnectedSource() ? 1 : 0;
    } catch (...) {
        return 0;
    }
}

extern "C" USDC_API int
usdc_shader_input_color3f(UsdcStage *stage,
                          const char *shader_path,
                          const char *input_name,
                          float out[3]) {
    if (!out || !input_name) return 0;
    UsdPrim prim = prim_at(stage, shader_path);
    if (!prim) return 0;
    try {
        UsdShadeShader shader(prim);
        if (!shader) return 0;
        TfToken token(input_name);
        std::string raw = input_name;
        if (raw.rfind("inputs:", 0) == 0) {
            token = TfToken(raw.substr(7));
        }
        UsdShadeInput in = shader.GetInput(token);
        if (!in) return 0;
        UsdAttribute attr = in.GetAttr();
        if (!attr) return 0;
        VtValue v;
        if (!attr.Get(&v)) return 0;
        if (v.IsHolding<GfVec3f>()) {
            const GfVec3f &c = v.UncheckedGet<GfVec3f>();
            out[0] = c[0]; out[1] = c[1]; out[2] = c[2];
            return 1;
        }
        if (v.IsHolding<GfVec3d>()) {
            const GfVec3d &c = v.UncheckedGet<GfVec3d>();
            out[0] = static_cast<float>(c[0]);
            out[1] = static_cast<float>(c[1]);
            out[2] = static_cast<float>(c[2]);
            return 1;
        }
        return 0;
    } catch (...) {
        return 0;
    }
}
