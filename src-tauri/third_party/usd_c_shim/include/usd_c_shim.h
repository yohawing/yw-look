/* SPDX-License-Identifier: Apache-2.0 */
/*
 * usd_c_shim — a narrow C surface over Pixar OpenUSD for yw-look.
 *
 * Design rules:
 *   - Every function is `extern "C"`; no C++ symbols leak out.
 *   - Stage is exposed as an opaque handle; callers never see
 *     UsdStageRefPtr or any pxr type.
 *   - Variable-length results (prim lists, composition arcs) are
 *     delivered through per-item callbacks. This avoids allocating
 *     Vec-shaped return values across the FFI boundary.
 *   - Scalar string returns are backed by a per-Stage scratch buffer
 *     that is overwritten on each call. Callers must copy (or use
 *     immediately) before making the next call into this shim.
 *   - C++ exceptions are always caught at the boundary and mapped
 *     to an out-parameter `UsdcError*`. Letting an exception unwind
 *     across `extern "C"` is UB.
 *
 * Scope: Inspector-only. Geometry, material, skel APIs are out of
 * scope for the initial PoC and may be added later.
 */
#ifndef USD_C_SHIM_H
#define USD_C_SHIM_H

#include <stddef.h>

/* Visibility / export control.
 *
 * The CMake target sets CXX_VISIBILITY_PRESET=hidden and
 * VISIBILITY_INLINES_HIDDEN=ON so that, by default, no symbols are
 * exported from the shared library. Every public entry point below
 * must therefore be tagged with USDC_API so the linker keeps it in
 * the resulting DLL / dylib / so.
 *
 * - When the shim itself is being built, `USD_C_SHIM_BUILDING` is
 *   defined by CMake (`target_compile_definitions(... PRIVATE
 *   USD_C_SHIM_BUILDING)`), so USDC_API expands to the "export" form.
 * - When a consumer (bindgen, our Rust build.rs) parses the header,
 *   `USD_C_SHIM_BUILDING` is not defined, so USDC_API expands to the
 *   "import" form. On Windows this is required so the compiler emits
 *   `__declspec(dllimport)` references; on POSIX the visibility
 *   attribute is simply ignored on consumer side but harmless.
 */
#if defined(_WIN32) || defined(_WIN64)
#  if defined(USD_C_SHIM_BUILDING)
#    define USDC_API __declspec(dllexport)
#  else
#    define USDC_API __declspec(dllimport)
#  endif
#else
#  if defined(USD_C_SHIM_BUILDING)
#    define USDC_API __attribute__((visibility("default")))
#  else
#    define USDC_API
#  endif
#endif

#ifdef __cplusplus
extern "C" {
#endif

/* -------------------- handles -------------------- */

typedef struct UsdcStage_s UsdcStage;
typedef struct UsdcError_s UsdcError;

/* -------------------- error -------------------- */

/* Borrowed; remains valid until usdc_error_free() is called. */
USDC_API const char *usdc_error_message(const UsdcError *err);

/* Frees an error previously returned through an out-parameter. Safe
 * to pass NULL. */
USDC_API void usdc_error_free(UsdcError *err);

/* -------------------- stage lifecycle -------------------- */

/* Matches yw-look's StageLoadPolicy wire type. */
typedef enum {
    USDC_LOAD_ALL         = 0,
    USDC_LOAD_NO_PAYLOADS = 1
} UsdcLoadPolicy;

/* Opens `path` and returns a non-null handle on success. On failure
 * returns NULL and writes a non-null UsdcError* to *out_err. Caller
 * must free the error with usdc_error_free(). */
USDC_API UsdcStage *usdc_stage_open(const char *path,
                                    UsdcLoadPolicy policy,
                                    UsdcError **out_err);

/* Closes a stage and releases the scratch buffer. Safe with NULL. */
USDC_API void usdc_stage_close(UsdcStage *stage);

/* -------------------- scalar queries -------------------- */

/* Returns NULL if the stage has no authored defaultPrim. The returned
 * pointer is owned by the stage's scratch buffer; the caller must
 * copy before the next shim call on this stage. */
USDC_API const char *usdc_stage_default_prim(UsdcStage *stage);

/* Returns 0 = Y, 1 = Z, -1 = unset. */
USDC_API int usdc_stage_up_axis(UsdcStage *stage);

/* Returns the authored metersPerUnit, or NaN if unset. Callers should
 * check with `isnan` before using. */
USDC_API double usdc_stage_meters_per_unit(UsdcStage *stage);

/* Returns 1 if the stage's root layer is USDC (binary), 0 if USDA
 * (text). Returns -1 if the stage has no root layer. */
USDC_API int usdc_stage_root_layer_is_binary(UsdcStage *stage);

/* Total number of layers composed into the stage (including the root
 * layer and every sublayer / reference / payload). */
USDC_API size_t usdc_stage_layer_count(UsdcStage *stage);

/* -------------------- enumeration callbacks -------------------- */

/* Receives one C string per call. The `s` pointer is valid only
 * for the duration of the callback. `user` is the opaque pointer the
 * caller passed into the enumeration function. */
typedef void (*UsdcStringCallback)(const char *s, void *user);

/* One composition arc. All string fields are valid only for the
 * duration of the callback. `target_prim` may be NULL if the arc
 * does not specify a target prim within the referenced layer. */
typedef struct {
    const char *source_prim;
    const char *asset_path;
    const char *target_prim; /* nullable */
    /* 1 if the arc resolved and was composed into the stage, 0 if
     * it is missing or was skipped by USDC_LOAD_NO_PAYLOADS. The
     * caller can reclassify Missing vs Unloaded by cross-referencing
     * usdc_stage_unresolved_assets / skipped_payloads lists. */
    int is_loaded;
} UsdcArc;

typedef void (*UsdcArcCallback)(const UsdcArc *arc, void *user);

/* Walks every prim in the composed stage. Calls `cb(path, user)` once
 * per prim with the prim's SdfPath as a C string (`"/World/Foo"`). */
USDC_API void usdc_stage_traverse(UsdcStage *stage,
                                  UsdcStringCallback cb,
                                  void *user);

/* Calls `cb` once per composed layer identifier. */
USDC_API void usdc_stage_layer_identifiers(UsdcStage *stage,
                                           UsdcStringCallback cb,
                                           void *user);

/* Enumerates references authored on a prim (not resolved references
 * across the composed stage — the locally authored list, matching the
 * behavior of the Rust fork's `references_in`). */
USDC_API void usdc_stage_references_in(UsdcStage *stage,
                                       const char *prim_path,
                                       UsdcArcCallback cb,
                                       void *user);

/* Same as references_in, but for payloads. */
USDC_API void usdc_stage_payloads_in(UsdcStage *stage,
                                     const char *prim_path,
                                     UsdcArcCallback cb,
                                     void *user);

/* Asset paths that the stage's resolver could not locate. Useful for
 * populating BrokenReference / MissingSubLayer / MissingPayload
 * asset issues. */
USDC_API void usdc_stage_unresolved_assets(UsdcStage *stage,
                                           UsdcStringCallback cb,
                                           void *user);

/* Asset paths for payloads that were skipped under
 * USDC_LOAD_NO_PAYLOADS. Empty under USDC_LOAD_ALL. */
USDC_API void usdc_stage_skipped_payloads(UsdcStage *stage,
                                          UsdcStringCallback cb,
                                          void *user);

/* -------------------- per-prim queries -------------------- */

/* Returns 1 if the prim at `prim_path` is typed as UsdGeomMesh.
 * Returns 0 for any other type or if the prim does not exist. */
USDC_API int usdc_prim_type_is_mesh(UsdcStage *stage, const char *prim_path);

/* Returns 1 if the prim authors at least one variant set. */
USDC_API int usdc_prim_has_variants(UsdcStage *stage, const char *prim_path);

/* Enumerates variant set names authored on the prim. */
USDC_API void usdc_prim_variant_set_names(UsdcStage *stage,
                                          const char *prim_path,
                                          UsdcStringCallback cb,
                                          void *user);

/* Returns the selected variant for (prim, set), NULL if none is
 * authored. Pointer is valid only until the next shim call on this
 * stage. */
USDC_API const char *usdc_prim_variant_selection(UsdcStage *stage,
                                                 const char *prim_path,
                                                 const char *set_name);

#ifdef __cplusplus
} /* extern "C" */
#endif

#endif /* USD_C_SHIM_H */
