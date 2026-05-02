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

#include <algorithm>
#include <cmath>
#include <exception>
#include <mutex>
#include <set>
#include <sstream>
#include <string>
#include <vector>

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
#include <pxr/base/tf/stringUtils.h>
#include <pxr/base/tf/token.h>
#include <pxr/usd/sdf/fileFormat.h>
#include <pxr/usd/sdf/layer.h>
#include <pxr/usd/sdf/path.h>
#include <pxr/usd/sdf/schema.h>
#include <pxr/usd/sdf/payload.h>
#include <pxr/usd/sdf/reference.h>
#include <pxr/usd/usd/payloads.h>
#include <pxr/usd/usd/prim.h>
#include <pxr/usd/usd/primRange.h>
#include <pxr/usd/usd/references.h>
#include <pxr/usd/usd/inherits.h>
#include <pxr/usd/usd/specializes.h>
#include <pxr/usd/usd/stage.h>
#include <pxr/usd/usd/editContext.h>
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
#include <pxr/base/gf/quatd.h>
#include <pxr/base/gf/quatf.h>
#include <pxr/base/gf/quath.h>
#include <pxr/base/gf/vec3h.h>
#include <pxr/usd/usdSkel/animation.h>
#include <pxr/usd/usdSkel/bindingAPI.h>
#include <pxr/usd/usdSkel/skeleton.h>
#include <pxr/usd/usdSkel/tokens.h>
#include <pxr/base/vt/value.h>
#include <pxr/usd/usdLux/lightAPI.h>
#include <pxr/usd/usdLux/domeLight.h>
#include <pxr/usd/usdLux/shapingAPI.h>
#include <pxr/usd/usdGeom/pointInstancer.h>
#include <cstdint>

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

/* -------------------- stage flatten (#39) -------------------- */

extern "C" USDC_API const char *usdc_stage_flatten(UsdcStage *stage,
                                                   UsdcError **out_err) {
    if (out_err) *out_err = nullptr;
    if (!stage || !stage->stage) {
        if (out_err) *out_err = make_err("usdc_stage_flatten: stage is null");
        return nullptr;
    }
    try {
        std::string text;
        /* ExportToString writes the flattened stage to `text`.
         * addSourceFileComment=false keeps the output clean (no
         * "# Exported from ..." header that usdcat also omits by
         * default). The result is a fully composed USDA string with
         * every reference / payload / sublayer inlined. */
        bool ok = stage->stage->ExportToString(&text,
                                               /*addSourceFileComment=*/false);
        if (!ok) {
            if (out_err) *out_err = make_err("UsdStage::ExportToString returned false");
            return nullptr;
        }
        if (text.empty()) {
            if (out_err) *out_err = make_err("UsdStage::ExportToString returned empty output");
            return nullptr;
        }
        /* Heap-allocate an independent copy so the caller can safely
         * free it via usdc_free_string without affecting stage->scratch
         * or any other per-stage state. */
        char *result = new char[text.size() + 1];
        std::copy(text.begin(), text.end(), result);
        result[text.size()] = '\0';
        return result;
    } catch (const std::exception &e) {
        if (out_err) *out_err = make_err(std::string("usdc_stage_flatten: ") + e.what());
        return nullptr;
    } catch (...) {
        if (out_err) *out_err = make_err("usdc_stage_flatten: unknown exception");
        return nullptr;
    }
}

extern "C" USDC_API void usdc_free_string(const char *str) {
    delete[] str;
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

/* -------------------- stage metadata (#40) -------------------- */

namespace {
/* Shared body for the four authored-time-metadata readers. Returns 1
 * iff the root layer authors `field` and the value is convertible to
 * a double. We deliberately query the root layer directly (via
 * `HasField` / `Get`) rather than `UsdStage::GetMetadata` because the
 * latter substitutes spec defaults for unauthored fields, which the
 * inspector wants to distinguish. */
int read_authored_root_field_double(UsdcStage *stage,
                                    const TfToken &field,
                                    double *out) {
    if (!stage || !out) return 0;
    try {
        SdfLayerHandle root = stage->stage->GetRootLayer();
        if (!root) return 0;
        VtValue v;
        if (!root->HasField(SdfPath::AbsoluteRootPath(), field, &v)) return 0;
        if (v.IsHolding<double>()) {
            *out = v.UncheckedGet<double>();
            return 1;
        }
        if (v.IsHolding<float>()) {
            *out = static_cast<double>(v.UncheckedGet<float>());
            return 1;
        }
        return 0;
    } catch (...) {
        return 0;
    }
}
} /* namespace */

extern "C" USDC_API int
usdc_stage_authored_time_codes_per_second(UsdcStage *stage, double *out) {
    return read_authored_root_field_double(stage, SdfFieldKeys->TimeCodesPerSecond, out);
}

extern "C" USDC_API int
usdc_stage_authored_frames_per_second(UsdcStage *stage, double *out) {
    return read_authored_root_field_double(stage, SdfFieldKeys->FramesPerSecond, out);
}

extern "C" USDC_API int
usdc_stage_authored_start_time_code(UsdcStage *stage, double *out) {
    return read_authored_root_field_double(stage, SdfFieldKeys->StartTimeCode, out);
}

extern "C" USDC_API int
usdc_stage_authored_end_time_code(UsdcStage *stage, double *out) {
    return read_authored_root_field_double(stage, SdfFieldKeys->EndTimeCode, out);
}

extern "C" USDC_API const char *
usdc_stage_comment(UsdcStage *stage) {
    if (!stage) return nullptr;
    try {
        SdfLayerHandle root = stage->stage->GetRootLayer();
        if (!root) return nullptr;
        const std::string &comment = root->GetComment();
        if (comment.empty()) return nullptr;
        stage->scratch = comment;
        return stage->scratch.c_str();
    } catch (...) {
        return nullptr;
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

/* -------------------- layer stack (#29) -------------------- */

namespace {

/* Recursive DFS helper for usdc_stage_layer_stack. Walks the subLayers
 * graph of `layer`, emitting each entry via `cb`. `depth` is the
 * current nesting level (root = 0). `visited` prevents infinite loops
 * in the rare case of cyclic sublayer references. The stage handle is
 * needed to query the muted-layer set. */
void emit_layer_info_recursive(UsdcStage *stage,
                                const SdfLayerHandle &layer,
                                int depth,
                                const SdfLayerOffsetVector &offsets_from_parent,
                                size_t sublayer_index,
                                std::set<std::string> &visited,
                                UsdcLayerInfoCallback cb,
                                void *user) {
    if (!layer) return;
    const std::string &id = layer->GetIdentifier();
    if (!visited.insert(id).second) return; /* cycle guard */

    UsdcLayerInfo info{};
    info.identifier = id.c_str();
    info.depth      = depth;

    /* Muted check: UsdStage maintains a muted-layers list. */
    const std::vector<std::string> &muted = stage->stage->GetMutedLayers();
    info.muted = (std::find(muted.begin(), muted.end(), id) != muted.end()) ? 1 : 0;

    /* Offset from the parent's subLayerOffsets vector, if provided. */
    if (!offsets_from_parent.empty() &&
        sublayer_index < offsets_from_parent.size()) {
        const SdfLayerOffset &off = offsets_from_parent[sublayer_index];
        info.offset_time  = off.GetOffset();
        info.offset_scale = off.GetScale();
    } else {
        info.offset_time  = 0.0;
        info.offset_scale = 1.0;
    }

    /* Comment on this layer (not the stage comment — this is the
     * layer-level SdfLayer::GetComment()). */
    const std::string comment_str = layer->GetComment();
    info.comment = comment_str.empty() ? nullptr : comment_str.c_str();

    cb(&info, user);

    /* Recurse into sublayers. GetSubLayerPaths returns identifiers in
     * the order they appear in the layer's `subLayers` list (highest
     * strength first). GetSubLayerOffsets is parallel to that list. */
    swallow([&] {
        const SdfSubLayerProxy sub_paths   = layer->GetSubLayerPaths();
        const SdfLayerOffsetVector sub_offs = layer->GetSubLayerOffsets();

        for (size_t i = 0; i < sub_paths.size(); ++i) {
            swallow([&] {
                /* Resolve the sublayer path relative to the parent layer
                 * so that relative `subLayers` entries (the common case —
                 * e.g. `subLayers = ["./materials.usda"]`) open correctly.
                 * FindOrOpenRelativeToLayer calls the asset resolver with
                 * the anchor layer's identifier as context, matching what
                 * UsdStage itself does when composing the layer stack.
                 * Fall back to the absolute FindOrOpen path if the relative
                 * resolve returns null (e.g. anonymous layer identifiers). */
                SdfLayerRefPtr sub =
                    SdfLayer::FindOrOpenRelativeToLayer(layer, sub_paths[i]);
                if (!sub) {
                    sub = SdfLayer::FindOrOpen(sub_paths[i]);
                }
                if (!sub) return;
                emit_layer_info_recursive(stage, sub,
                                          depth + 1,
                                          sub_offs, i,
                                          visited, cb, user);
            });
        }
    });
}

} /* namespace */

extern "C" USDC_API void usdc_stage_layer_stack(UsdcStage *stage,
                                                UsdcLayerInfoCallback cb,
                                                void *user) {
    if (!stage || !cb) return;
    swallow([&] {
        SdfLayerHandle root = stage->stage->GetRootLayer();
        if (!root) return;
        std::set<std::string> visited;
        /* Root layer has no parent offset. */
        SdfLayerOffsetVector empty_offsets;
        emit_layer_info_recursive(stage, root,
                                  /*depth=*/0,
                                  empty_offsets, /*sublayer_index=*/0,
                                  visited, cb, user);
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

extern "C" USDC_API void usdc_stage_inherits_in(UsdcStage *stage,
                                                const char *prim_path,
                                                UsdcArcCallback cb,
                                                void *user) {
    if (!cb) return;
    UsdPrim prim = prim_at(stage, prim_path);
    if (!prim) return;

    swallow([&] {
        /* UsdInherits::GetAllDirectInherits() is available in this pxr
         * version and returns all inherit paths from the local layer
         * stack that directly compose into this prim (strong-to-weak).
         * It is read-only and does not modify any stage state. */
        UsdInherits inherits = prim.GetInherits();
        SdfPathVector paths = inherits.GetAllDirectInherits();
        const std::string source = prim.GetPath().GetAsString();
        for (const SdfPath &target_path : paths) {
            swallow([&] {
                const std::string target = target_path.GetAsString();
                UsdcArc arc;
                arc.source_prim = source.c_str();
                arc.asset_path  = "";          /* always stage-internal */
                arc.target_prim = target.c_str();
                arc.is_loaded   = 1;
                cb(&arc, user);
            });
        }
    });
}

extern "C" USDC_API void usdc_stage_specializes_in(UsdcStage *stage,
                                                    const char *prim_path,
                                                    UsdcArcCallback cb,
                                                    void *user) {
    if (!cb) return;
    UsdPrim prim = prim_at(stage, prim_path);
    if (!prim) return;

    swallow([&] {
        /* UsdSpecializes has no GetAllDirectSpecializes() in this pxr
         * version. Read the authored specializes paths directly from
         * the prim's metadata using SdfFieldKeys->Specializes, which
         * stores an SdfPathListOp — the same approach used by
         * usdc_stage_references_in / usdc_stage_payloads_in above. */
        SdfPathListOp op;
        if (prim.GetMetadata(SdfFieldKeys->Specializes, &op)) {
            std::vector<SdfPath> items;
            op.ApplyOperations(&items);
            const std::string source = prim.GetPath().GetAsString();
            for (const SdfPath &target_path : items) {
                swallow([&] {
                    const std::string target = target_path.GetAsString();
                    UsdcArc arc;
                    arc.source_prim = source.c_str();
                    arc.asset_path  = "";      /* always stage-internal */
                    arc.target_prim = target.c_str();
                    arc.is_loaded   = 1;
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

extern "C" USDC_API void usdc_prim_variant_names(UsdcStage *stage,
                                                  const char *prim_path,
                                                  const char *set_name,
                                                  UsdcStringCallback cb,
                                                  void *user) {
    if (!cb || !set_name) return;
    UsdPrim prim = prim_at(stage, prim_path);
    if (!prim) return;
    swallow([&] {
        UsdVariantSet vset = prim.GetVariantSet(set_name);
        if (!vset.IsValid()) return;
        const std::vector<std::string> names = vset.GetVariantNames();
        for (const std::string &n : names) {
            cb(n.c_str(), user);
        }
    });
}

extern "C" USDC_API int usdc_prim_set_variant_selection(UsdcStage *stage,
                                                        const char *prim_path,
                                                        const char *set_name,
                                                        const char *variant_name) {
    if (!stage || !set_name || !variant_name) return 0;
    UsdPrim prim = prim_at(stage, prim_path);
    if (!prim) return 0;
    try {
        /* Switch the edit target to the session layer so that the
         * selection is authored as a session-layer opinion, not into
         * the root layer (which may be read-only for package-backed
         * files like USDZ). The session layer is always anonymous and
         * writable — this is the standard pattern for transient
         * run-time overrides in OpenUSD. */
        UsdStageRefPtr stageRef = stage->stage;
        SdfLayerHandle sessionLayer = stageRef->GetSessionLayer();
        if (!sessionLayer) return 0;
        UsdEditContext ctx(stageRef, sessionLayer);
        UsdVariantSet vset = prim.GetVariantSet(set_name);
        if (!vset.IsValid()) return 0;
        return vset.SetVariantSelection(variant_name) ? 1 : 0;
    } catch (...) {
        return 0;
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

/* Enumerate a `token[]` / `string[]` attribute one entry at a time
 * via the string callback. Defined here (not in a later anonymous
 * namespace) so earlier extern "C" shims can reuse it. */
void emit_token_array(const UsdAttribute &attr,
                      UsdcStringCallback cb,
                      void *user) {
    if (!cb) return;
    VtArray<TfToken> arr;
    if (!attr || !attr.Get(&arr)) return;
    for (const TfToken &t : arr) {
        cb(t.GetString().c_str(), user);
    }
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
        /* USD uses row-vector convention (`v * M`) with translation
         * authored in the last *row*, and `GfMatrix4d::operator[]` is
         * row-major (`m[row][col]`). glTF uses column-vector
         * convention (`M * v`) with translation in the last *column*
         * and stores matrices column-major. The two semantics are
         * related by `M_gltf = transpose(M_usd)`, and the column-
         * major memory layout of `M_gltf` is identical to the
         * row-major memory layout of `M_usd`. So the correct copy is
         * `out[i*4+j] = m[i][j]` — no transpose at the float level.
         * An earlier version wrote `out[c*4+r] = m[r][c]` and
         * silently mis-rendered every non-identity world xform
         * (translation landed on the bottom row of the glTF matrix
         * instead of the last column). */
        for (int i = 0; i < 4; ++i) {
            for (int j = 0; j < 4; ++j) {
                out_matrix[i * 4 + j] = m[i][j];
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

extern "C" USDC_API const char *
usdc_prim_attr_token(UsdcStage *stage,
                     const char *prim_path,
                     const char *attr_name) {
    if (!attr_name) return nullptr;
    UsdPrim prim = prim_at(stage, prim_path);
    if (!prim) return nullptr;
    try {
        UsdAttribute attr = prim.GetAttribute(TfToken(attr_name));
        if (!attr) return nullptr;
        VtValue v;
        if (!attr.Get(&v)) return nullptr;
        if (v.IsHolding<TfToken>()) {
            stage->scratch = v.UncheckedGet<TfToken>().GetString();
            if (stage->scratch.empty()) return nullptr;
            return stage->scratch.c_str();
        }
        if (v.IsHolding<std::string>()) {
            stage->scratch = v.UncheckedGet<std::string>();
            if (stage->scratch.empty()) return nullptr;
            return stage->scratch.c_str();
        }
        return nullptr;
    } catch (...) {
        return nullptr;
    }
}

extern "C" USDC_API void
usdc_prim_attr_i32_array(UsdcStage *stage,
                         const char *prim_path,
                         const char *attr_name,
                         UsdcI32BufferCallback cb,
                         void *user) {
    if (!attr_name) { emit_empty_ints(cb, user); return; }
    UsdPrim prim = prim_at(stage, prim_path);
    if (!prim) { emit_empty_ints(cb, user); return; }
    try {
        UsdAttribute attr = prim.GetAttribute(TfToken(attr_name));
        if (!attr) { emit_empty_ints(cb, user); return; }
        VtArray<int> arr;
        if (!attr.Get(&arr) || arr.empty()) { emit_empty_ints(cb, user); return; }
        cb(arr.cdata(), arr.size(), user);
    } catch (...) {
        emit_empty_ints(cb, user);
    }
}

extern "C" USDC_API void
usdc_prim_attr_vec3f_array(UsdcStage *stage,
                           const char *prim_path,
                           const char *attr_name,
                           UsdcFloatBufferCallback cb,
                           void *user) {
    if (!attr_name) { emit_empty_floats(cb, user); return; }
    UsdPrim prim = prim_at(stage, prim_path);
    if (!prim) { emit_empty_floats(cb, user); return; }
    try {
        UsdAttribute attr = prim.GetAttribute(TfToken(attr_name));
        if (!attr) { emit_empty_floats(cb, user); return; }
        VtArray<GfVec3f> arr;
        if (!attr.Get(&arr) || arr.empty()) {
            emit_empty_floats(cb, user);
            return;
        }
        emit_float_array(arr, cb, user, 3);
    } catch (...) {
        emit_empty_floats(cb, user);
    }
}

extern "C" USDC_API void
usdc_prim_attr_token_array(UsdcStage *stage,
                           const char *prim_path,
                           const char *attr_name,
                           UsdcStringCallback cb,
                           void *user) {
    if (!attr_name || !cb) return;
    UsdPrim prim = prim_at(stage, prim_path);
    if (!prim) return;
    try {
        UsdAttribute attr = prim.GetAttribute(TfToken(attr_name));
        emit_token_array(attr, cb, user);
    } catch (...) {
        /* drop silently */
    }
}

extern "C" USDC_API void
usdc_prim_rel_targets(UsdcStage *stage,
                      const char *prim_path,
                      const char *rel_name,
                      UsdcStringCallback cb,
                      void *user) {
    if (!rel_name || !cb) return;
    UsdPrim prim = prim_at(stage, prim_path);
    if (!prim) return;
    try {
        UsdRelationship rel = prim.GetRelationship(TfToken(rel_name));
        if (!rel) return;
        SdfPathVector targets;
        if (!rel.GetForwardedTargets(&targets)) return;
        for (const SdfPath &p : targets) {
            cb(p.GetString().c_str(), user);
        }
    } catch (...) {
        /* drop silently */
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

/* -------------------- UsdSkel (Phase 2.G) -------------------- */

namespace {

/* Flatten a `GfMatrix4d` into 16 floats matching the glTF column-
 * major convention. See `usdc_prim_world_matrix` for why this is
 * "just copy the bytes" rather than a transpose: USD row-major
 * memory of `M_usd` has the same layout as glTF column-major memory
 * of `transpose(M_usd)`, which is exactly the matrix Three.js needs
 * to apply the USD-authored transform. */
void push_matrix_column_major_f32(std::vector<float> &out, const GfMatrix4d &m) {
    for (int i = 0; i < 4; ++i) {
        for (int j = 0; j < 4; ++j) {
            out.push_back(static_cast<float>(m[i][j]));
        }
    }
}

/* Read a VtArray<GfMatrix4d> attribute and emit the flattened
 * column-major float buffer through `cb`. Emits an empty buffer
 * when the attribute is unauthored. */
void emit_matrix_array_column_major(const UsdAttribute &attr,
                                    UsdcFloatBufferCallback cb,
                                    void *user) {
    if (!cb) return;
    VtArray<GfMatrix4d> arr;
    if (!attr || !attr.Get(&arr) || arr.empty()) {
        cb(nullptr, 0, user);
        return;
    }
    std::vector<float> flat;
    flat.reserve(arr.size() * 16);
    for (const GfMatrix4d &m : arr) {
        push_matrix_column_major_f32(flat, m);
    }
    cb(flat.data(), flat.size(), user);
}

} /* anonymous namespace */

extern "C" USDC_API const char *
usdc_mesh_bound_skeleton(UsdcStage *stage, const char *mesh_path) {
    UsdPrim prim = prim_at(stage, mesh_path);
    if (!prim) return nullptr;
    try {
        UsdSkelBindingAPI binding(prim);
        UsdSkelSkeleton skel = binding.GetInheritedSkeleton();
        if (!skel) return nullptr;
        stage->scratch = skel.GetPath().GetString();
        return stage->scratch.c_str();
    } catch (...) {
        return nullptr;
    }
}

extern "C" USDC_API void
usdc_skel_joints(UsdcStage *stage,
                 const char *skel_path,
                 UsdcStringCallback cb,
                 void *user) {
    UsdPrim prim = prim_at(stage, skel_path);
    if (!prim || !cb) return;
    try {
        UsdSkelSkeleton skel(prim);
        if (!skel) return;
        emit_token_array(skel.GetJointsAttr(), cb, user);
    } catch (...) {
        /* best-effort; drop the enumeration silently */
    }
}

extern "C" USDC_API void
usdc_skel_bind_transforms(UsdcStage *stage,
                          const char *skel_path,
                          UsdcFloatBufferCallback cb,
                          void *user) {
    UsdPrim prim = prim_at(stage, skel_path);
    if (!prim) { emit_empty_floats(cb, user); return; }
    try {
        UsdSkelSkeleton skel(prim);
        if (!skel) { emit_empty_floats(cb, user); return; }
        emit_matrix_array_column_major(skel.GetBindTransformsAttr(), cb, user);
    } catch (...) {
        emit_empty_floats(cb, user);
    }
}

extern "C" USDC_API void
usdc_skel_rest_transforms(UsdcStage *stage,
                          const char *skel_path,
                          UsdcFloatBufferCallback cb,
                          void *user) {
    UsdPrim prim = prim_at(stage, skel_path);
    if (!prim) { emit_empty_floats(cb, user); return; }
    try {
        UsdSkelSkeleton skel(prim);
        if (!skel) { emit_empty_floats(cb, user); return; }
        emit_matrix_array_column_major(skel.GetRestTransformsAttr(), cb, user);
    } catch (...) {
        emit_empty_floats(cb, user);
    }
}

extern "C" USDC_API void
usdc_mesh_skel_joints(UsdcStage *stage,
                      const char *mesh_path,
                      UsdcStringCallback cb,
                      void *user) {
    UsdPrim prim = prim_at(stage, mesh_path);
    if (!prim || !cb) return;
    try {
        /* `skel:joints` is a schema attribute on UsdSkelBindingAPI. A
         * mesh that carries the API may or may not advertise the
         * schema name; read the attribute directly for robustness
         * against minimal authoring. */
        UsdAttribute attr = prim.GetAttribute(TfToken("skel:joints"));
        emit_token_array(attr, cb, user);
    } catch (...) {
        /* drop silently */
    }
}

extern "C" USDC_API void
usdc_mesh_joint_indices(UsdcStage *stage,
                        const char *mesh_path,
                        UsdcI32BufferCallback cb,
                        void *user) {
    UsdPrim prim = prim_at(stage, mesh_path);
    if (!prim) { emit_empty_ints(cb, user); return; }
    try {
        UsdGeomPrimvarsAPI api(prim);
        UsdGeomPrimvar pv = api.GetPrimvar(TfToken("primvars:skel:jointIndices"));
        if (!pv || !pv.HasValue()) { emit_empty_ints(cb, user); return; }
        VtArray<int> arr;
        if (!pv.Get(&arr) || arr.empty()) { emit_empty_ints(cb, user); return; }
        cb(arr.cdata(), arr.size(), user);
    } catch (...) {
        emit_empty_ints(cb, user);
    }
}

extern "C" USDC_API void
usdc_mesh_joint_weights(UsdcStage *stage,
                        const char *mesh_path,
                        UsdcFloatBufferCallback cb,
                        void *user) {
    UsdPrim prim = prim_at(stage, mesh_path);
    if (!prim) { emit_empty_floats(cb, user); return; }
    try {
        UsdGeomPrimvarsAPI api(prim);
        UsdGeomPrimvar pv = api.GetPrimvar(TfToken("primvars:skel:jointWeights"));
        if (!pv || !pv.HasValue()) { emit_empty_floats(cb, user); return; }
        VtArray<float> arr;
        if (!pv.Get(&arr) || arr.empty()) { emit_empty_floats(cb, user); return; }
        cb(arr.cdata(), arr.size(), user);
    } catch (...) {
        emit_empty_floats(cb, user);
    }
}

extern "C" USDC_API int
usdc_mesh_joints_per_vertex(UsdcStage *stage, const char *mesh_path) {
    UsdPrim prim = prim_at(stage, mesh_path);
    if (!prim) return 0;
    try {
        UsdGeomPrimvarsAPI api(prim);
        UsdGeomPrimvar pv = api.GetPrimvar(TfToken("primvars:skel:jointIndices"));
        if (!pv) return 0;
        int sz = pv.GetElementSize();
        /* UsdGeomPrimvar::GetElementSize defaults to 1 when unauthored;
         * a single influence per vertex effectively means "no skinning"
         * so treat that the same as unauthored. Apple ARKit exports
         * typically author 4. */
        return sz > 1 ? sz : 0;
    } catch (...) {
        return 0;
    }
}

/* -------------------- UsdSkel animation (Phase 2.G.3) -------------------- */

extern "C" USDC_API double
usdc_stage_time_codes_per_second(UsdcStage *stage) {
    if (!stage || !stage->stage) return 24.0;
    try {
        double v = stage->stage->GetTimeCodesPerSecond();
        return v > 0.0 ? v : 24.0;
    } catch (...) {
        return 24.0;
    }
}

extern "C" USDC_API const char *
usdc_skel_animation_source(UsdcStage *stage, const char *skel_path) {
    UsdPrim prim = prim_at(stage, skel_path);
    if (!prim) return nullptr;
    try {
        UsdSkelBindingAPI binding(prim);
        UsdPrim anim_prim = binding.GetInheritedAnimationSource();
        if (!anim_prim) {
            /* `GetInheritedAnimationSource` only resolves the rel
             * when UsdSkelBindingAPI is applied as an API schema.
             * Assets in the wild (tiny_rigged fixture, older Pixar
             * examples) frequently author `rel skel:animationSource`
             * directly on a Skeleton without the apiSchemas stanza.
             * Walk the rel manually as a fallback so those still
             * animate. */
            UsdRelationship rel = prim.GetRelationship(TfToken("skel:animationSource"));
            if (rel) {
                SdfPathVector targets;
                if (rel.GetForwardedTargets(&targets) && !targets.empty()) {
                    anim_prim = stage->stage->GetPrimAtPath(targets.front());
                }
            }
            if (!anim_prim) return nullptr;
        }
        UsdSkelAnimation anim(anim_prim);
        if (!anim) return nullptr;
        stage->scratch = anim.GetPath().GetString();
        return stage->scratch.c_str();
    } catch (...) {
        return nullptr;
    }
}

extern "C" USDC_API void
usdc_skel_anim_joints(UsdcStage *stage,
                      const char *anim_path,
                      UsdcStringCallback cb,
                      void *user) {
    UsdPrim prim = prim_at(stage, anim_path);
    if (!prim || !cb) return;
    try {
        UsdSkelAnimation anim(prim);
        if (!anim) return;
        emit_token_array(anim.GetJointsAttr(), cb, user);
    } catch (...) {
        /* drop silently */
    }
}

namespace {

/* Merge the time samples from the three per-channel attributes into
 * a single ascending-order vector. We inspect each attribute's
 * authored samples (via `UsdAttribute::GetTimeSamples`) and union
 * them; duplicate time codes collapse. This matches how the Rust
 * fork's `align_samples_to_times` exposes a single per-animation
 * frame grid to the preview. */
std::vector<double> collect_anim_times(const UsdSkelAnimation &anim) {
    std::vector<double> out;
    const UsdAttribute attrs[] = {
        anim.GetTranslationsAttr(),
        anim.GetRotationsAttr(),
        anim.GetScalesAttr(),
    };
    std::set<double> times;
    for (const UsdAttribute &a : attrs) {
        if (!a) continue;
        std::vector<double> samples;
        if (!a.GetTimeSamples(&samples)) continue;
        for (double t : samples) times.insert(t);
    }
    out.reserve(times.size());
    for (double t : times) out.push_back(t);
    return out;
}

} /* anonymous namespace */

extern "C" USDC_API void
usdc_skel_anim_times(UsdcStage *stage,
                     const char *anim_path,
                     UsdcFloatBufferCallback cb,
                     void *user) {
    UsdPrim prim = prim_at(stage, anim_path);
    if (!prim) { emit_empty_floats(cb, user); return; }
    try {
        UsdSkelAnimation anim(prim);
        if (!anim) { emit_empty_floats(cb, user); return; }
        std::vector<double> times = collect_anim_times(anim);
        if (times.empty()) { emit_empty_floats(cb, user); return; }
        std::vector<float> f32;
        f32.reserve(times.size());
        for (double t : times) f32.push_back(static_cast<float>(t));
        cb(f32.data(), f32.size(), user);
    } catch (...) {
        emit_empty_floats(cb, user);
    }
}

extern "C" USDC_API void
usdc_skel_anim_translations_at(UsdcStage *stage,
                               const char *anim_path,
                               double time_code,
                               UsdcFloatBufferCallback cb,
                               void *user) {
    UsdPrim prim = prim_at(stage, anim_path);
    if (!prim) { emit_empty_floats(cb, user); return; }
    try {
        UsdSkelAnimation anim(prim);
        if (!anim) { emit_empty_floats(cb, user); return; }
        VtArray<GfVec3f> arr;
        UsdAttribute a = anim.GetTranslationsAttr();
        if (!a || !a.Get(&arr, UsdTimeCode(time_code)) || arr.empty()) {
            emit_empty_floats(cb, user);
            return;
        }
        emit_float_array(arr, cb, user, 3);
    } catch (...) {
        emit_empty_floats(cb, user);
    }
}

extern "C" USDC_API void
usdc_skel_anim_rotations_at(UsdcStage *stage,
                            const char *anim_path,
                            double time_code,
                            UsdcFloatBufferCallback cb,
                            void *user) {
    UsdPrim prim = prim_at(stage, anim_path);
    if (!prim) { emit_empty_floats(cb, user); return; }
    try {
        UsdSkelAnimation anim(prim);
        if (!anim) { emit_empty_floats(cb, user); return; }
        /* UsdSkelAnimation authors rotations as `quatf` (vec4, real
         * first). glTF wants (x, y, z, w); reorder during the copy
         * so the Rust side doesn't have to know about USD's
         * convention. */
        VtArray<GfQuatf> arr;
        UsdAttribute a = anim.GetRotationsAttr();
        if (!a || !a.Get(&arr, UsdTimeCode(time_code)) || arr.empty()) {
            emit_empty_floats(cb, user);
            return;
        }
        std::vector<float> flat;
        flat.reserve(arr.size() * 4);
        for (const GfQuatf &q : arr) {
            const GfVec3f &img = q.GetImaginary();
            flat.push_back(img[0]);
            flat.push_back(img[1]);
            flat.push_back(img[2]);
            flat.push_back(q.GetReal());
        }
        cb(flat.data(), flat.size(), user);
    } catch (...) {
        emit_empty_floats(cb, user);
    }
}

extern "C" USDC_API void
usdc_skel_anim_scales_at(UsdcStage *stage,
                         const char *anim_path,
                         double time_code,
                         UsdcFloatBufferCallback cb,
                         void *user) {
    UsdPrim prim = prim_at(stage, anim_path);
    if (!prim) { emit_empty_floats(cb, user); return; }
    try {
        UsdSkelAnimation anim(prim);
        if (!anim) { emit_empty_floats(cb, user); return; }
        /* UsdSkelAnimation authors `scales` as `half3[]` (half-float
         * vec3) per the schema; handle GfVec3h first, then fall back
         * to GfVec3f which some assets author despite the schema. */
        UsdAttribute a = anim.GetScalesAttr();
        if (!a) { emit_empty_floats(cb, user); return; }
        VtValue v;
        if (!a.Get(&v, UsdTimeCode(time_code))) {
            emit_empty_floats(cb, user);
            return;
        }
        std::vector<float> flat;
        if (v.IsHolding<VtArray<GfVec3h>>()) {
            const auto &arr = v.UncheckedGet<VtArray<GfVec3h>>();
            if (arr.empty()) { emit_empty_floats(cb, user); return; }
            flat.reserve(arr.size() * 3);
            for (const GfVec3h &s : arr) {
                flat.push_back(static_cast<float>(s[0]));
                flat.push_back(static_cast<float>(s[1]));
                flat.push_back(static_cast<float>(s[2]));
            }
        } else if (v.IsHolding<VtArray<GfVec3f>>()) {
            const auto &arr = v.UncheckedGet<VtArray<GfVec3f>>();
            if (arr.empty()) { emit_empty_floats(cb, user); return; }
            flat.reserve(arr.size() * 3);
            for (const GfVec3f &s : arr) {
                flat.push_back(s[0]);
                flat.push_back(s[1]);
                flat.push_back(s[2]);
            }
        } else {
            emit_empty_floats(cb, user);
            return;
        }
        cb(flat.data(), flat.size(), user);
    } catch (...) {
        emit_empty_floats(cb, user);
    }
}

extern "C" USDC_API void
usdc_skel_anim_blend_shape_weights_at(UsdcStage *stage,
                                      const char *anim_path,
                                      double time_code,
                                      UsdcFloatBufferCallback cb,
                                      void *user) {
    UsdPrim prim = prim_at(stage, anim_path);
    if (!prim) { emit_empty_floats(cb, user); return; }
    try {
        UsdSkelAnimation anim(prim);
        if (!anim) { emit_empty_floats(cb, user); return; }
        VtArray<float> arr;
        UsdAttribute a = anim.GetBlendShapeWeightsAttr();
        if (!a || !a.Get(&arr, UsdTimeCode(time_code)) || arr.empty()) {
            emit_empty_floats(cb, user);
            return;
        }
        cb(arr.cdata(), arr.size(), user);
    } catch (...) {
        emit_empty_floats(cb, user);
    }
}

/* -------------------- per-prim attribute inspector (#28) -------------------- */

namespace {

/* Stringify a VtValue into a human-readable summary.
 * Arrays are reported as "[N elements]"; scalars use TfStringify.
 * Falls back to "<unprintable>" on exception. */
std::string vtvalue_summary(const VtValue &v) {
    if (v.IsEmpty()) return "";
    try {
        /* Check for array types by testing IsArrayValued() */
        if (v.IsArrayValued()) {
            size_t n = v.GetArraySize();
            return "[" + std::to_string(n) + " elements]";
        }
        /* Stringify scalar via the VtValue streaming operator. */
        std::ostringstream oss;
        oss << v;
        std::string s = oss.str();
        /* Clamp very long strings to avoid flooding the UI. */
        if (s.size() > 256) {
            s = s.substr(0, 256) + "...";
        }
        return s;
    } catch (...) {
        return "<unprintable>";
    }
}

} /* anonymous namespace */

extern "C" USDC_API void
usdc_prim_attribute_names(UsdcStage *stage,
                          const char *prim_path,
                          UsdcStringCallback cb,
                          void *user) {
    if (!cb) return;
    UsdPrim prim = prim_at(stage, prim_path);
    if (!prim) return;
    swallow([&] {
        for (const UsdAttribute &attr : prim.GetAttributes()) {
            cb(attr.GetName().GetText(), user);
        }
    });
}

extern "C" USDC_API const char *
usdc_prim_attribute_type_name(UsdcStage *stage,
                              const char *prim_path,
                              const char *attr_name) {
    if (!attr_name) return nullptr;
    UsdPrim prim = prim_at(stage, prim_path);
    if (!prim || !stage) return nullptr;
    try {
        UsdAttribute attr = prim.GetAttribute(TfToken(attr_name));
        if (!attr) return nullptr;
        stage->scratch = attr.GetTypeName().GetAsToken().GetString();
        return stage->scratch.c_str();
    } catch (...) {
        return nullptr;
    }
}

extern "C" USDC_API const char *
usdc_prim_attribute_value_summary(UsdcStage *stage,
                                  const char *prim_path,
                                  const char *attr_name) {
    if (!attr_name) return nullptr;
    UsdPrim prim = prim_at(stage, prim_path);
    if (!prim || !stage) return nullptr;
    try {
        UsdAttribute attr = prim.GetAttribute(TfToken(attr_name));
        if (!attr) return nullptr;
        VtValue v;
        if (!attr.Get(&v)) {
            stage->scratch = "";
            return stage->scratch.c_str();
        }
        stage->scratch = vtvalue_summary(v);
        return stage->scratch.c_str();
    } catch (...) {
        stage->scratch = "<unprintable>";
        return stage->scratch.c_str();
    }
}

extern "C" USDC_API int
usdc_prim_attribute_is_custom(UsdcStage *stage,
                              const char *prim_path,
                              const char *attr_name) {
    if (!attr_name) return 0;
    UsdPrim prim = prim_at(stage, prim_path);
    if (!prim) return 0;
    try {
        UsdAttribute attr = prim.GetAttribute(TfToken(attr_name));
        if (!attr) return 0;
        return attr.IsCustom() ? 1 : 0;
    } catch (...) {
        return 0;
    }
}

extern "C" USDC_API const char *
usdc_prim_attribute_variability(UsdcStage *stage,
                                const char *prim_path,
                                const char *attr_name) {
    if (!attr_name) return nullptr;
    UsdPrim prim = prim_at(stage, prim_path);
    if (!prim || !stage) return nullptr;
    try {
        UsdAttribute attr = prim.GetAttribute(TfToken(attr_name));
        if (!attr) return nullptr;
        SdfVariability var = attr.GetVariability();
        if (var == SdfVariabilityUniform) {
            stage->scratch = "uniform";
        } else {
            stage->scratch = "varying";
        }
        return stage->scratch.c_str();
    } catch (...) {
        return nullptr;
    }
}

extern "C" USDC_API int
usdc_prim_attribute_time_sample_count(UsdcStage *stage,
                                      const char *prim_path,
                                      const char *attr_name) {
    if (!attr_name) return -1;
    UsdPrim prim = prim_at(stage, prim_path);
    if (!prim) return -1;
    try {
        UsdAttribute attr = prim.GetAttribute(TfToken(attr_name));
        if (!attr) return -1;
        size_t count = attr.GetNumTimeSamples();
        return static_cast<int>(count);
    } catch (...) {
        return -1;
    }
}

extern "C" USDC_API void
usdc_prim_attribute_time_samples(UsdcStage *stage,
                                 const char *prim_path,
                                 const char *attr_name,
                                 size_t max_samples,
                                 UsdcTimeSampleCallback cb,
                                 void *user) {
    if (!cb || !attr_name) return;
    UsdPrim prim = prim_at(stage, prim_path);
    if (!prim || !stage) return;
    try {
        UsdAttribute attr = prim.GetAttribute(TfToken(attr_name));
        if (!attr) return;
        std::vector<double> times;
        if (!attr.GetTimeSamples(&times)) return;
        size_t limit = (max_samples == 0 || max_samples > times.size())
                       ? times.size()
                       : max_samples;
        for (size_t i = 0; i < limit; ++i) {
            VtValue v;
            std::string summary;
            if (attr.Get(&v, times[i])) {
                summary = vtvalue_summary(v);
            }
            cb(times[i], summary.c_str(), user);
        }
    } catch (...) {
        /* silently drop on exception — we may have already emitted
         * some samples before the error; partial results are
         * preferable to a hard failure for an inspector display. */
    }
}

extern "C" USDC_API void
usdc_prim_relationship_names(UsdcStage *stage,
                             const char *prim_path,
                             UsdcStringCallback cb,
                             void *user) {
    if (!cb) return;
    UsdPrim prim = prim_at(stage, prim_path);
    if (!prim) return;
    swallow([&] {
        for (const UsdRelationship &rel : prim.GetRelationships()) {
            cb(rel.GetName().GetText(), user);
        }
    });
}

extern "C" USDC_API void
usdc_prim_relationship_targets(UsdcStage *stage,
                               const char *prim_path,
                               const char *rel_name,
                               UsdcStringCallback cb,
                               void *user) {
    if (!cb || !rel_name) return;
    UsdPrim prim = prim_at(stage, prim_path);
    if (!prim) return;
    swallow([&] {
        UsdRelationship rel = prim.GetRelationship(TfToken(rel_name));
        if (!rel) return;
        SdfPathVector targets;
        rel.GetForwardedTargets(&targets);
        for (const SdfPath &p : targets) {
            cb(p.GetString().c_str(), user);
        }
    });
}

extern "C" USDC_API void
usdc_prim_metadata_keys(UsdcStage *stage,
                        const char *prim_path,
                        UsdcStringCallback cb,
                        void *user) {
    if (!cb) return;
    UsdPrim prim = prim_at(stage, prim_path);
    if (!prim) return;
    swallow([&] {
        /* GetAllAuthoredMetadata returns a map of TfToken → VtValue.
         * We emit only the keys here; values are fetched separately
         * via usdc_prim_metadata_value_summary to avoid overwriting
         * the scratch buffer mid-enumeration. */
        UsdMetadataValueMap meta = prim.GetAllAuthoredMetadata();
        for (const auto &kv : meta) {
            cb(kv.first.GetText(), user);
        }
    });
}

extern "C" USDC_API const char *
usdc_prim_metadata_value_summary(UsdcStage *stage,
                                 const char *prim_path,
                                 const char *key) {
    if (!key) return nullptr;
    UsdPrim prim = prim_at(stage, prim_path);
    if (!prim || !stage) return nullptr;
    try {
        VtValue v;
        if (!prim.GetMetadata(TfToken(key), &v)) return nullptr;
        stage->scratch = vtvalue_summary(v);
        return stage->scratch.c_str();
    } catch (...) {
        return nullptr;
    }
}

/* -------------------- USD light enumeration (#35) -------------------- */

extern "C" USDC_API void
usdc_stage_lights(UsdcStage *stage,
                  UsdcLightInfoCallback cb,
                  void *user) {
    if (!stage || !stage->stage || !cb) return;
    try {
        /* Traverse every prim; collect those that have UsdLuxLightAPI applied.
         * We use UsdLuxLightAPI::Get() rather than prim.IsA<UsdLuxLightAPI>()
         * because in USD 21+ UsdLux uses applied-API semantics and IsA<>
         * only matches concrete schema types.  UsdLuxLightAPI::Get() returns
         * an invalid schema object for prims that do not carry the API, so
         * we gate on `if (!lightApi)` rather than catching exceptions. */
        for (const UsdPrim &prim : stage->stage->Traverse()) {
            /* Apply UsdLuxLightAPI to test if the prim carries the light
             * API schema.  On OpenUSD 22+/23+ with applied-API the check
             * is authoritative; on older USD the IsA<> path covers
             * concrete typed lights. */
            UsdLuxLightAPI lightApi = UsdLuxLightAPI::Get(stage->stage, prim.GetPath());
            if (!lightApi) {
                /* Fallback: prim typed as a concrete light (older USD). */
                UsdLuxLightAPI typed(prim);
                if (!typed) continue;
                lightApi = typed;
            }

            /* Build the info struct using stack-local strings. */
            std::string primPathStr   = prim.GetPath().GetString();
            std::string typeNameStr   = prim.GetTypeName().GetString();
            std::string domeTextureStr; /* only set for DomeLight */

            UsdcLightInfo info{};
            info.prim_path  = primPathStr.c_str();
            info.light_kind = typeNameStr.c_str();

            /* ---- colour ---- */
            {
                GfVec3f col(1.0f, 1.0f, 1.0f);
                UsdAttribute colorAttr = lightApi.GetColorAttr();
                if (colorAttr) colorAttr.Get(&col);
                info.color[0] = col[0];
                info.color[1] = col[1];
                info.color[2] = col[2];
            }

            /* ---- intensity ---- */
            {
                float intensity = 1.0f;
                UsdAttribute intensityAttr = lightApi.GetIntensityAttr();
                if (intensityAttr) intensityAttr.Get(&intensity);
                info.intensity = intensity;
            }

            /* ---- exposure ---- */
            {
                float exposure = 0.0f;
                UsdAttribute exposureAttr = lightApi.GetExposureAttr();
                if (exposureAttr) exposureAttr.Get(&exposure);
                info.exposure = exposure;
            }

            /* ---- color temperature ---- */
            {
                bool enableTemp = false;
                UsdAttribute enableAttr = lightApi.GetEnableColorTemperatureAttr();
                if (enableAttr) enableAttr.Get(&enableTemp);
                if (enableTemp) {
                    float temp = 6500.0f;
                    UsdAttribute tempAttr = lightApi.GetColorTemperatureAttr();
                    if (tempAttr && tempAttr.Get(&temp)) {
                        info.has_color_temperature = 1;
                        info.color_temperature     = temp;
                    }
                }
            }

            /* ---- specular / diffuse ---- */
            {
                float specular = 1.0f;
                UsdAttribute specAttr = lightApi.GetSpecularAttr();
                if (specAttr) specAttr.Get(&specular);
                info.specular = specular;
            }
            {
                float diffuse = 1.0f;
                UsdAttribute diffAttr = lightApi.GetDiffuseAttr();
                if (diffAttr) diffAttr.Get(&diffuse);
                info.diffuse = diffuse;
            }

            /* ---- DomeLight texture ---- */
            {
                UsdLuxDomeLight dome(prim);
                if (dome) {
                    UsdAttribute texAttr = dome.GetTextureFileAttr();
                    if (texAttr) {
                        SdfAssetPath assetPath;
                        if (texAttr.Get(&assetPath)) {
                            domeTextureStr = assetPath.GetAssetPath();
                            if (!domeTextureStr.empty()) {
                                info.dome_texture_file = domeTextureStr.c_str();
                            }
                        }
                    }
                }
            }

            /* ---- shaping cone (SpotLight / SphereLight with shaping) ---- */
            {
                UsdLuxShapingAPI shaping = UsdLuxShapingAPI::Get(
                    stage->stage, prim.GetPath());
                if (shaping) {
                    float angle = 90.0f, softness = 0.0f;
                    UsdAttribute angleAttr    = shaping.GetShapingConeAngleAttr();
                    UsdAttribute softnessAttr = shaping.GetShapingConeSoftnessAttr();
                    bool hasAngle    = angleAttr    && angleAttr.Get(&angle);
                    bool hasSoftness = softnessAttr && softnessAttr.Get(&softness);
                    if (hasAngle || hasSoftness) {
                        info.has_shaping_cone      = 1;
                        info.shaping_cone_angle    = angle;
                        info.shaping_cone_softness = softness;
                    }
                }
            }

            cb(&info, user);
        }
    } catch (...) {
        /* best-effort; silently drop remaining lights on exception */
    }
}

/* ---- #44 per-prim payload load / unload ---------------------------------- */

int usdc_stage_load_prim(UsdcStage *stage,
                         const char *prim_path,
                         UsdcError **err_out) {
    if (!stage || !prim_path) {
        if (err_out) {
            *err_out = make_err("usdc_stage_load_prim: null argument");
        }
        return 0;
    }
    try {
        pxr::SdfPath sdf_path(prim_path);
        /* LoadWithDescendants mirrors UsdStage::Load default policy */
        stage->stage->Load(sdf_path, pxr::UsdLoadWithDescendants);
        return 1;
    } catch (const std::exception &ex) {
        if (err_out) {
            *err_out = make_err(std::string("usdc_stage_load_prim: ") + ex.what());
        }
        return 0;
    } catch (...) {
        if (err_out) {
            *err_out = make_err("usdc_stage_load_prim: unknown exception");
        }
        return 0;
    }
}

int usdc_stage_unload_prim(UsdcStage *stage,
                           const char *prim_path,
                           UsdcError **err_out) {
    if (!stage || !prim_path) {
        if (err_out) {
            *err_out = make_err("usdc_stage_unload_prim: null argument");
        }
        return 0;
    }
    try {
        pxr::SdfPath sdf_path(prim_path);
        stage->stage->Unload(sdf_path);
        return 1;
    } catch (const std::exception &ex) {
        if (err_out) {
            *err_out = make_err(std::string("usdc_stage_unload_prim: ") + ex.what());
        }
        return 0;
    } catch (...) {
        if (err_out) {
            *err_out = make_err("usdc_stage_unload_prim: unknown exception");
        }
        return 0;
    }
}

/* ---- #41 UsdGeomPointInstancer ------------------------------------------- */

extern "C" USDC_API int usdc_prim_is_point_instancer(UsdcStage *stage,
                                                      const char *prim_path) {
    UsdPrim prim = prim_at(stage, prim_path);
    if (!prim) return 0;
    try {
        return prim.IsA<UsdGeomPointInstancer>() ? 1 : 0;
    } catch (...) {
        return 0;
    }
}

extern "C" USDC_API void usdc_point_instancer_prototypes(UsdcStage *stage,
                                                          const char *prim_path,
                                                          UsdcStringCallback cb,
                                                          void *user) {
    if (!cb) return;
    UsdPrim prim = prim_at(stage, prim_path);
    if (!prim) return;
    swallow([&] {
        UsdGeomPointInstancer instancer(prim);
        if (!instancer) return;
        UsdRelationship prototypesRel = instancer.GetPrototypesRel();
        if (!prototypesRel) return;
        SdfPathVector targets;
        prototypesRel.GetForwardedTargets(&targets);
        for (const SdfPath &p : targets) {
            cb(p.GetString().c_str(), user);
        }
    });
}

extern "C" USDC_API void usdc_point_instancer_proto_indices(UsdcStage *stage,
                                                             const char *prim_path,
                                                             UsdcI32BufferCallback cb,
                                                             void *user) {
    if (!cb) return;
    UsdPrim prim = prim_at(stage, prim_path);
    if (!prim) { cb(nullptr, 0, user); return; }
    swallow([&] {
        UsdGeomPointInstancer instancer(prim);
        if (!instancer) { cb(nullptr, 0, user); return; }
        VtArray<int> indices;
        UsdAttribute attr = instancer.GetProtoIndicesAttr();
        if (!attr || !attr.Get(&indices, UsdTimeCode::Default())) {
            cb(nullptr, 0, user);
            return;
        }
        cb(indices.data(), indices.size(), user);
    });
}

extern "C" USDC_API void usdc_point_instancer_positions(UsdcStage *stage,
                                                         const char *prim_path,
                                                         UsdcFloatBufferCallback cb,
                                                         void *user) {
    if (!cb) return;
    UsdPrim prim = prim_at(stage, prim_path);
    if (!prim) { cb(nullptr, 0, user); return; }
    swallow([&] {
        UsdGeomPointInstancer instancer(prim);
        if (!instancer) { cb(nullptr, 0, user); return; }
        VtArray<GfVec3f> positions;
        UsdAttribute attr = instancer.GetPositionsAttr();
        if (!attr || !attr.Get(&positions, UsdTimeCode::Default())) {
            cb(nullptr, 0, user);
            return;
        }
        /* Flat [x0,y0,z0, x1,y1,z1, ...]; stride=3 for GfVec3f */
        emit_float_array(positions, cb, user, 3);
    });
}

extern "C" USDC_API void usdc_point_instancer_orientations(UsdcStage *stage,
                                                            const char *prim_path,
                                                            UsdcFloatBufferCallback cb,
                                                            void *user) {
    if (!cb) return;
    UsdPrim prim = prim_at(stage, prim_path);
    if (!prim) { cb(nullptr, 0, user); return; }
    swallow([&] {
        UsdGeomPointInstancer instancer(prim);
        if (!instancer) { cb(nullptr, 0, user); return; }
        /* USD stores quath (half-precision, w,x,y,z order).
         * We expand to f32 and reorder to glTF convention (x,y,z,w). */
        VtArray<GfQuath> orientations;
        UsdAttribute attr = instancer.GetOrientationsAttr();
        if (!attr || !attr.Get(&orientations, UsdTimeCode::Default())) {
            cb(nullptr, 0, user);
            return;
        }
        std::vector<float> flat;
        flat.reserve(orientations.size() * 4);
        for (const GfQuath &q : orientations) {
            /* GfQuath stores imaginary first (i,j,k), then real (w).
             * GetImaginary() -> GfVec3h(x,y,z), GetReal() -> w */
            GfVec3h imag = q.GetImaginary();
            GfHalf  real = q.GetReal();
            flat.push_back(static_cast<float>(imag[0])); /* x */
            flat.push_back(static_cast<float>(imag[1])); /* y */
            flat.push_back(static_cast<float>(imag[2])); /* z */
            flat.push_back(static_cast<float>(real));    /* w */
        }
        cb(flat.data(), flat.size(), user);
    });
}

extern "C" USDC_API void usdc_point_instancer_scales(UsdcStage *stage,
                                                      const char *prim_path,
                                                      UsdcFloatBufferCallback cb,
                                                      void *user) {
    if (!cb) return;
    UsdPrim prim = prim_at(stage, prim_path);
    if (!prim) { cb(nullptr, 0, user); return; }
    swallow([&] {
        UsdGeomPointInstancer instancer(prim);
        if (!instancer) { cb(nullptr, 0, user); return; }
        VtArray<GfVec3f> scales;
        UsdAttribute attr = instancer.GetScalesAttr();
        if (!attr || !attr.Get(&scales, UsdTimeCode::Default())) {
            cb(nullptr, 0, user);
            return;
        }
        emit_float_array(scales, cb, user, 3);
    });
}

extern "C" USDC_API void usdc_point_instancer_invisible_ids(UsdcStage *stage,
                                                             const char *prim_path,
                                                             UsdcI64BufferCallback cb,
                                                             void *user) {
    if (!cb) return;
    UsdPrim prim = prim_at(stage, prim_path);
    if (!prim) { cb(nullptr, 0, user); return; }
    swallow([&] {
        UsdGeomPointInstancer instancer(prim);
        if (!instancer) { cb(nullptr, 0, user); return; }
        VtArray<int64_t> ids;
        UsdAttribute attr = instancer.GetInvisibleIdsAttr();
        if (!attr || !attr.Get(&ids, UsdTimeCode::Default())) {
            cb(nullptr, 0, user);
            return;
        }
        cb(ids.data(), ids.size(), user);
    });
}
