// SPDX-License-Identifier: Apache-2.0
//
// usd_c_shim implementation. See include/usd_c_shim.h for API contract.
//
// All functions catch C++ exceptions at the FFI boundary. Best-effort
// enumeration paths swallow exceptions silently after emitting whatever
// was gathered before the failure; APIs that return a single value
// surface the exception through UsdcError**.

#include "usd_c_shim.h"

#include <cmath>
#include <exception>
#include <string>

#include <pxr/base/tf/token.h>
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

extern "C" const char *usdc_error_message(const UsdcError *err) {
    return (err != nullptr) ? err->msg.c_str() : "";
}

extern "C" void usdc_error_free(UsdcError *err) {
    delete err;
}

/* -------------------- stage lifecycle -------------------- */

extern "C" UsdcStage *usdc_stage_open(const char *path,
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
        return h;
    } catch (const std::exception &e) {
        if (out_err) *out_err = make_err(e.what());
        return nullptr;
    } catch (...) {
        if (out_err) *out_err = make_err("unknown exception in usdc_stage_open");
        return nullptr;
    }
}

extern "C" void usdc_stage_close(UsdcStage *stage) {
    delete stage;
}

/* -------------------- scalar queries -------------------- */

extern "C" const char *usdc_stage_default_prim(UsdcStage *stage) {
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

extern "C" int usdc_stage_up_axis(UsdcStage *stage) {
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

extern "C" double usdc_stage_meters_per_unit(UsdcStage *stage) {
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

extern "C" int usdc_stage_root_layer_is_binary(UsdcStage *stage) {
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

extern "C" size_t usdc_stage_layer_count(UsdcStage *stage) {
    if (!stage) return 0;
    try {
        return stage->stage->GetUsedLayers().size();
    } catch (...) {
        return 0;
    }
}

/* -------------------- enumeration -------------------- */

extern "C" void usdc_stage_traverse(UsdcStage *stage,
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

extern "C" void usdc_stage_layer_identifiers(UsdcStage *stage,
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

extern "C" void usdc_stage_references_in(UsdcStage *stage,
                                         const char *prim_path,
                                         UsdcArcCallback cb,
                                         void *user) {
    if (!cb) return;
    UsdPrim prim = prim_at(stage, prim_path);
    if (!prim) return;

    swallow([&] {
        SdfReferencesProxy refs = prim.GetReferences();
        /* GetReferences() on a UsdPrim returns an editable proxy; the
         * authored list lives on the prim's spec across the layer
         * stack. We walk the prim's metadata to collect authored
         * references without mutating anything. */
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

extern "C" void usdc_stage_payloads_in(UsdcStage *stage,
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

extern "C" void usdc_stage_unresolved_assets(UsdcStage *stage,
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

extern "C" void usdc_stage_skipped_payloads(UsdcStage *stage,
                                            UsdcStringCallback cb,
                                            void *user) {
    if (!stage || !cb) return;
    /* A stage opened with LoadNone leaves every payload unloaded.
     * Emit each authored payload's asset path. Stages opened with
     * LoadAll return nothing here. */
    swallow([&] {
        if (stage->stage->GetLoadRules().GetEffectiveRulesForPath(SdfPath::AbsoluteRootPath())
                != UsdStageLoadRules::Rule::NoneRule) {
            return;
        }
        for (const UsdPrim &prim : stage->stage->TraverseAll()) {
            SdfPayloadListOp op;
            if (prim.GetMetadata(SdfFieldKeys->Payload, &op)) {
                std::vector<SdfPayload> items;
                op.ApplyOperations(&items);
                for (const SdfPayload &p : items) {
                    const std::string asset = p.GetAssetPath();
                    if (!asset.empty()) cb(asset.c_str(), user);
                }
            }
        }
    });
}

/* -------------------- per-prim queries -------------------- */

extern "C" int usdc_prim_type_is_mesh(UsdcStage *stage, const char *prim_path) {
    UsdPrim prim = prim_at(stage, prim_path);
    if (!prim) return 0;
    try {
        return prim.IsA<UsdGeomMesh>() ? 1 : 0;
    } catch (...) {
        return 0;
    }
}

extern "C" int usdc_prim_has_variants(UsdcStage *stage, const char *prim_path) {
    UsdPrim prim = prim_at(stage, prim_path);
    if (!prim) return 0;
    try {
        return prim.HasVariantSets() ? 1 : 0;
    } catch (...) {
        return 0;
    }
}

extern "C" void usdc_prim_variant_set_names(UsdcStage *stage,
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

extern "C" const char *usdc_prim_variant_selection(UsdcStage *stage,
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
