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
#include <string>

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
#include <pxr/usd/usdGeom/mesh.h>
#include <pxr/usd/usdGeom/metrics.h>
#include <pxr/usd/usdGeom/tokens.h>

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
         * USDA reports "usda". USDZ presents its inner root layer
         * here (either form). */
        const TfToken &fmt = root->GetFileFormat()->GetFormatId();
        static const TfToken kUsdc("usdc");
        return (fmt == kUsdc) ? 1 : 0;
    } catch (...) {
        return -1;
    }
}

extern "C" USDC_API size_t usdc_stage_layer_count(UsdcStage *stage) {
    if (!stage) return 0;
    try {
        return stage->stage->GetUsedLayers().size();
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
        for (const SdfLayerHandle &layer : stage->stage->GetUsedLayers()) {
            if (!layer) continue;
            const std::string s = layer->GetIdentifier();
            cb(s.c_str(), user);
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
