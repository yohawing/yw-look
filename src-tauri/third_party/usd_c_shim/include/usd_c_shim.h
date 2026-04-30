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

/* Stage-level time metadata authored on the root layer. Each function
 * returns 1 and writes the authored value to `*out` on success;
 * returns 0 when the metadatum is not authored on the root layer.
 * Callers fall back to the USD spec defaults
 * (`timeCodesPerSecond=24`, `framesPerSecond=24`, time codes = 0)
 * when 0 is returned, but the inspector surfaces the authored vs
 * default distinction so users can tell a stage apart from one that
 * relies on implicit defaults. */
USDC_API int usdc_stage_authored_time_codes_per_second(UsdcStage *stage,
                                                       double *out);
USDC_API int usdc_stage_authored_frames_per_second(UsdcStage *stage,
                                                   double *out);
USDC_API int usdc_stage_authored_start_time_code(UsdcStage *stage,
                                                 double *out);
USDC_API int usdc_stage_authored_end_time_code(UsdcStage *stage,
                                               double *out);

/* Returns the stage's authored `comment` metadatum on the root layer,
 * or NULL if not authored. Scratch-buffer lifetime; copy before the
 * next shim call on this stage. */
USDC_API const char *usdc_stage_comment(UsdcStage *stage);

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

/* Payloads that were skipped under USDC_LOAD_NO_PAYLOADS, reported as
 * full composition arcs so callers can classify by (asset_path,
 * source_prim) pair.
 *
 * Why UsdcArcCallback (not UsdcStringCallback):
 * A USD stage can author the same payload asset from multiple prims
 * with different local load rules, so asset_path alone is not a
 * sufficient key to decide whether a given (prim, payload) pair was
 * Unloaded vs Loaded. The Rust fork classifies on the same
 * (asset_path, source_prim) pair, and this callback surface lets the
 * C++ backend match that behavior.
 *
 * Field semantics per emission:
 *   - source_prim : SdfPath of the prim that authored the payload.
 *   - asset_path  : authored asset path literal.
 *   - target_prim : nullable; same convention as references_in/payloads_in.
 *   - is_loaded   : always 0 (emissions represent skipped payloads).
 *
 * Empty under USDC_LOAD_ALL. */
USDC_API void usdc_stage_skipped_payloads(UsdcStage *stage,
                                          UsdcArcCallback cb,
                                          void *user);

/* -------------------- layer stack (#29) -------------------- */

/* Detailed information about one layer in the stage's layer stack.
 * All string fields are valid only for the duration of the callback;
 * callers must copy before returning. `comment` may be NULL when the
 * layer has no authored comment. */
typedef struct {
    /* Layer identifier (file path or anonymous tag). */
    const char *identifier;
    /* Nesting depth: root layer = 0, its direct sublayers = 1, etc. */
    int         depth;
    /* 1 if the stage has muted this layer, 0 otherwise. */
    int         muted;
    /* SdfLayerOffset applied by the sublayer arc that introduced this
     * layer. Zero/identity when the layer is the root. */
    double      offset_time;
    double      offset_scale;
    /* Authored `comment` metadatum, or NULL when not authored. */
    const char *comment;
} UsdcLayerInfo;

typedef void (*UsdcLayerInfoCallback)(const UsdcLayerInfo *info, void *user);

/* Traverses the stage's layer stack in DFS order (root layer first,
 * then sublayers depth-first) and calls `cb` once per layer.
 * Each emission's `depth` field reflects how many sublayer hops
 * separate this layer from the root. `offset_time`/`offset_scale`
 * are the SdfLayerOffset authored on the sublayer arc that brought
 * this layer into the stack (identity/zero for the root and for any
 * layer introduced via reference/payload rather than explicit subLayers).
 * Composed layers introduced only via reference/payload arcs are
 * omitted — the traversal covers the subLayers graph only, matching
 * the USD Layer Stack definition used in the usdview Layer Stack panel.
 */
USDC_API void usdc_stage_layer_stack(UsdcStage *stage,
                                     UsdcLayerInfoCallback cb,
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

/* Enumerates all variant names in the named variant set on `prim_path`.
 * Calls `cb(name, user)` once per variant in authoring order. Emits
 * nothing when the prim or set does not exist. */
USDC_API void usdc_prim_variant_names(UsdcStage *stage,
                                      const char *prim_path,
                                      const char *set_name,
                                      UsdcStringCallback cb,
                                      void *user);

/* Sets the variant selection for (prim, set) on the stage's session
 * layer. Returns 1 on success, 0 on failure (prim not found, set not
 * found, or an internal OpenUSD error). */
USDC_API int usdc_prim_set_variant_selection(UsdcStage *stage,
                                             const char *prim_path,
                                             const char *set_name,
                                             const char *variant_name);

/* -------------------- geometry -------------------- */

/* Primvar interpolation tokens, matching the pxr::UsdGeomTokens
 * interpolation vocabulary. Returned alongside normal / UV / displayColor
 * reads so the caller can expand faceVarying data into per-vertex layout
 * or emit a COLOR_0 attribute as appropriate. */
typedef enum {
    USDC_INTERP_UNKNOWN      = -1,
    USDC_INTERP_CONSTANT     = 0,
    USDC_INTERP_UNIFORM      = 1,
    USDC_INTERP_VARYING      = 2,
    USDC_INTERP_VERTEX       = 3,
    USDC_INTERP_FACE_VARYING = 4
} UsdcInterpolation;

/* UsdGeomMesh `orientation` token. Default (and authoring when the
 * attribute is absent) is right-handed; left-handed meshes need their
 * triangle indices reversed when targeting Y-up right-handed glTF. */
typedef enum {
    USDC_ORIENT_RIGHT_HANDED = 0,
    USDC_ORIENT_LEFT_HANDED  = 1
} UsdcOrientation;

/* Bulk attribute readers. Called exactly once with the authored data:
 *   - `data != NULL` and `count > 0` when the attribute is authored,
 *   - `data == NULL` and `count == 0` when it is not.
 *
 * The `data` pointer is valid only for the duration of the callback,
 * backed either by a VtArray still owned by OpenUSD or by a transient
 * copy inside the shim. Callers must consume or memcpy the buffer
 * before returning from the callback.
 *
 * `cb` may be invoked with `count == 0` even when the callback pointer
 * itself is non-null; the trampoline on the caller side should no-op
 * on an empty buffer. */
typedef void (*UsdcFloatBufferCallback)(const float *data, size_t count, void *user);
typedef void (*UsdcI32BufferCallback)(const int *data, size_t count, void *user);

/* Returns 1 iff the prim at `prim_path` is a UsdGeomMesh AND its
 * effective visibility / purpose / active state is renderable under
 * the default render purpose.
 *
 * Inheritance follows UsdGeomImageable semantics:
 *   - `active == false` anywhere on the ancestor chain → skipped.
 *   - `visibility == invisible` inherited → skipped.
 *   - `purpose` resolves to `proxy` or `guide` → skipped.
 *
 * All other failures (unknown prim, exception, non-mesh) return 0. */
USDC_API int usdc_prim_is_renderable_mesh(UsdcStage *stage,
                                          const char *prim_path);

/* Computes UsdGeomXformable::ComputeLocalToWorldTransform at the
 * default time code. Writes 16 column-major doubles to `out_matrix`
 * and returns 1 on success. Returns 0 if the prim is not xformable
 * or the computation throws; `out_matrix` is left untouched in that
 * case. */
USDC_API int usdc_prim_world_matrix(UsdcStage *stage,
                                    const char *prim_path,
                                    double out_matrix[16]);

/* Reads `orientation` on a UsdGeomMesh prim. Returns
 * USDC_ORIENT_RIGHT_HANDED if the attribute is unauthored, the prim
 * is not a mesh, or the read fails. */
USDC_API UsdcOrientation usdc_mesh_orientation(UsdcStage *stage,
                                               const char *prim_path);

/* Emits `points` as a flat `[x, y, z, x, y, z, ...]` float buffer. */
USDC_API void usdc_mesh_points(UsdcStage *stage,
                               const char *prim_path,
                               UsdcFloatBufferCallback cb,
                               void *user);

/* Emits `faceVertexCounts`. One entry per face. */
USDC_API void usdc_mesh_face_vertex_counts(UsdcStage *stage,
                                           const char *prim_path,
                                           UsdcI32BufferCallback cb,
                                           void *user);

/* Emits `faceVertexIndices`. Total length equals the sum of
 * `faceVertexCounts`. */
USDC_API void usdc_mesh_face_vertex_indices(UsdcStage *stage,
                                            const char *prim_path,
                                            UsdcI32BufferCallback cb,
                                            void *user);

/* Emits `normals` and writes the attribute's interpolation token to
 * `*out_interp` (may be NULL to skip interpolation reporting). The
 * flat layout is `[x, y, z, ...]`. Length semantics depend on
 * interpolation (vertex / faceVarying / uniform / constant). */
USDC_API void usdc_mesh_normals(UsdcStage *stage,
                                const char *prim_path,
                                UsdcFloatBufferCallback cb,
                                void *user,
                                UsdcInterpolation *out_interp);

/* Emits `primvars:st` UV coordinates, flat `[u, v, ...]`. */
USDC_API void usdc_mesh_uvs(UsdcStage *stage,
                            const char *prim_path,
                            UsdcFloatBufferCallback cb,
                            void *user,
                            UsdcInterpolation *out_interp);

/* Emits `primvars:st:indices` for faceVarying UV indirection. Emits
 * `(NULL, 0)` when the primvar does not author an indices array. */
USDC_API void usdc_mesh_uv_indices(UsdcStage *stage,
                                   const char *prim_path,
                                   UsdcI32BufferCallback cb,
                                   void *user);

/* Emits `primvars:displayColor`, flat `[r, g, b, ...]`. */
USDC_API void usdc_mesh_display_color(UsdcStage *stage,
                                      const char *prim_path,
                                      UsdcFloatBufferCallback cb,
                                      void *user,
                                      UsdcInterpolation *out_interp);

/* -------------------- generic prim attribute reads (Phase 2.H) -------------------- */

/* Returns the prim's USD `typeName` (e.g. "Mesh", "Camera",
 * "DistantLight", "SphereLight"). Scratch-buffer lifetime. Returns
 * NULL for the pseudo-root or a prim without a type. Not the same as
 * `usdc_shader_id` — this is the IsA schema type, not the Shader's
 * `info:id` token. */
USDC_API const char *usdc_prim_type_name(UsdcStage *stage,
                                         const char *prim_path);

/* Reads a float or double attribute authored on `prim_path` at the
 * default time code. Writes the value to `*out` and returns 1 on
 * success. Returns 0 when unauthored or the wrong type. Does not
 * traverse connections or follow shader input namespaces (pass the
 * bare attribute name, e.g. "focalLength"). */
USDC_API int usdc_prim_attr_float(UsdcStage *stage,
                                  const char *prim_path,
                                  const char *attr_name,
                                  float *out);

/* Reads a float2 / double2 attribute (e.g. `UsdGeomCamera.clippingRange`)
 * at the default time code. Writes two floats to `out` and returns 1
 * on success. Returns 0 when unauthored or the wrong type. */
USDC_API int usdc_prim_attr_float2(UsdcStage *stage,
                                   const char *prim_path,
                                   const char *attr_name,
                                   float out[2]);

/* Reads a color3f / color3d attribute (e.g. a UsdLux
 * `inputs:color` stored on the light prim itself). Returns 0 on
 * missing / wrong type. */
USDC_API int usdc_prim_attr_color3f(UsdcStage *stage,
                                    const char *prim_path,
                                    const char *attr_name,
                                    float out[3]);

/* Reads a token attribute on a prim (e.g. `GeomSubset.familyName`,
 * `GeomSubset.elementType`). Scratch-buffer lifetime. Returns NULL
 * when unauthored or the wrong type. */
USDC_API const char *usdc_prim_attr_token(UsdcStage *stage,
                                          const char *prim_path,
                                          const char *attr_name);

/* Emits an `int[]` attribute (e.g. `GeomSubset.faceIndices`) as a
 * flat callback buffer. Emits `(NULL, 0)` when unauthored / missing
 * / wrong type. */
USDC_API void usdc_prim_attr_i32_array(UsdcStage *stage,
                                       const char *prim_path,
                                       const char *attr_name,
                                       UsdcI32BufferCallback cb,
                                       void *user);

/* Emits a `vector3f[]` / `point3f[]` / `color3f[]` array attribute
 * (e.g. `UsdSkelBlendShape.offsets`) as a flat stride-3 float
 * buffer. Emits `(NULL, 0)` when unauthored / missing / wrong type. */
USDC_API void usdc_prim_attr_vec3f_array(UsdcStage *stage,
                                         const char *prim_path,
                                         const char *attr_name,
                                         UsdcFloatBufferCallback cb,
                                         void *user);

/* Enumerates a `token[]` / `string[]` array attribute (e.g.
 * `skel:blendShapes`) one entry per callback. */
USDC_API void usdc_prim_attr_token_array(UsdcStage *stage,
                                         const char *prim_path,
                                         const char *attr_name,
                                         UsdcStringCallback cb,
                                         void *user);

/* Enumerates the forwarded target paths of a relationship (e.g.
 * `skel:blendShapeTargets`, `material:binding`) one path per
 * callback. Uses `UsdRelationship::GetForwardedTargets` so
 * pass-through relationships are resolved. */
USDC_API void usdc_prim_rel_targets(UsdcStage *stage,
                                    const char *prim_path,
                                    const char *rel_name,
                                    UsdcStringCallback cb,
                                    void *user);

/* -------------------- material / shading (Phase 2.E.1) -------------------- */

/* Returns the SdfPath of the Material prim bound (direct binding,
 * allPurpose) to `prim_path`. The returned pointer is backed by the
 * stage's scratch buffer and must be consumed before the next shim
 * call on this stage. Returns NULL if no binding is authored, or if
 * the prim does not exist. */
USDC_API const char *usdc_prim_bound_material(UsdcStage *stage,
                                              const char *prim_path);

/* Returns the SdfPath of the Shader prim connected to
 * `outputs:surface` on the Material at `mat_path`. Resolves the
 * universal (no render-context) output, falling back to "mtlx" if
 * universal is unauthored. Scratch-buffer lifetime; see
 * `usdc_prim_bound_material`. Returns NULL if no surface shader is
 * connected or the prim is not a Material. */
USDC_API const char *usdc_material_surface_shader(UsdcStage *stage,
                                                  const char *mat_path);

/* Returns the `info:id` token authored on `shader_path`
 * (e.g. "UsdPreviewSurface", "UsdUVTexture", "UsdTransform2d").
 * Scratch-buffer lifetime. Returns NULL if unauthored or the prim is
 * not a Shader. */
USDC_API const char *usdc_shader_id(UsdcStage *stage,
                                    const char *shader_path);

/* Reads a float or double input authored on `shader_path` by name
 * (e.g. "inputs:roughness"). Writes the resolved value to `*out` and
 * returns 1 on success. Returns 0 when the input is unauthored, has
 * the wrong type, or is driven only by a connection (no fallback
 * value). Does not traverse connections. */
USDC_API int usdc_shader_input_float(UsdcStage *stage,
                                     const char *shader_path,
                                     const char *input_name,
                                     float *out);

/* Reads a color3f or color3d input authored on `shader_path` by name
 * (e.g. "inputs:diffuseColor"). Writes [r, g, b] to `out`. Returns 0
 * when unauthored or the wrong type. Does not traverse connections. */
USDC_API int usdc_shader_input_color3f(UsdcStage *stage,
                                       const char *shader_path,
                                       const char *input_name,
                                       float out[3]);

/* Returns 1 when `input_name` on `shader_path` has at least one
 * authored connection source (e.g. `inputs:diffuseColor.connect`
 * pointing at a `UsdUVTexture.outputs:rgb`). This is how
 * `UsdPreviewSurface` expresses "driven by a texture" — callers use
 * it to neutralize `baseColorFactor` to white when a texture lookup
 * is downstream. Returns 0 for unauthored, unconnected, or missing
 * shader prims. */
USDC_API int usdc_shader_input_has_connection(UsdcStage *stage,
                                              const char *shader_path,
                                              const char *input_name);

/* Returns the SdfPath of the first connected source prim for
 * `input_name` on `shader_path`. For a `UsdPreviewSurface` with
 * `inputs:diffuseColor.connect = </M/Tex.outputs:rgb>`, this returns
 * `"/M/Tex"`. Scratch-buffer lifetime. Returns NULL when the input
 * has no connection or the prim does not exist. */
USDC_API const char *usdc_shader_input_connected_source_prim(
    UsdcStage *stage,
    const char *shader_path,
    const char *input_name);

/* Reads an `asset`-typed input authored on `shader_path` (e.g.
 * `UsdUVTexture.inputs:file`) and returns the **authored** asset
 * path string — no resolver / ArResolver hop. Scratch-buffer
 * lifetime. Returns NULL when unauthored or the wrong type. Callers
 * handle the filesystem / USDZ-archive resolve themselves so the
 * shim does not have to know about the yw-look search-dir rules. */
USDC_API const char *usdc_shader_input_asset(UsdcStage *stage,
                                             const char *shader_path,
                                             const char *input_name);

/* -------------------- per-prim attribute inspector (#28) -------------------- */

/* Enumerates all authored attributes on the prim at `prim_path`.
 * Calls `cb(name, user)` once per attribute name in no guaranteed order.
 * Emits nothing when the prim does not exist. */
USDC_API void usdc_prim_attribute_names(UsdcStage *stage,
                                        const char *prim_path,
                                        UsdcStringCallback cb,
                                        void *user);

/* Returns the USD type name of an attribute (e.g. "float3", "token",
 * "asset"). Scratch-buffer lifetime. Returns NULL when the attribute
 * does not exist. */
USDC_API const char *usdc_prim_attribute_type_name(UsdcStage *stage,
                                                   const char *prim_path,
                                                   const char *attr_name);

/* Returns a human-readable summary of the attribute's default value.
 * Arrays are reported as "[N elements]"; scalar types are stringified
 * via TfStringify. Scratch-buffer lifetime. Returns empty string ""
 * when unauthored, NULL when the attribute does not exist. */
USDC_API const char *usdc_prim_attribute_value_summary(UsdcStage *stage,
                                                       const char *prim_path,
                                                       const char *attr_name);

/* Returns 1 if the attribute is custom (not schema-defined), 0 otherwise. */
USDC_API int usdc_prim_attribute_is_custom(UsdcStage *stage,
                                           const char *prim_path,
                                           const char *attr_name);

/* Returns "varying" or "uniform" for the attribute's variability.
 * Scratch-buffer lifetime. Returns NULL when the attribute does not exist. */
USDC_API const char *usdc_prim_attribute_variability(UsdcStage *stage,
                                                     const char *prim_path,
                                                     const char *attr_name);

/* Returns the number of time samples authored on the attribute.
 * Returns -1 when the attribute does not exist. */
USDC_API int usdc_prim_attribute_time_sample_count(UsdcStage *stage,
                                                   const char *prim_path,
                                                   const char *attr_name);

/* Callback invoked once per time sample by
 * `usdc_prim_attribute_time_samples`. Both `time` and `value_summary`
 * are valid only for the duration of the callback; `user` is the opaque
 * pointer the caller passed in. */
typedef void (*UsdcTimeSampleCallback)(double time,
                                      const char *value_summary,
                                      void *user);

/* Enumerates up to `max_samples` time samples on the attribute at
 * `attr_name` on the prim at `prim_path`, calling `cb` once per sample
 * in the order pxr returns them (ascending time code). If the attribute
 * has fewer samples than `max_samples` all are emitted; if it has more,
 * only the first `max_samples` are emitted and the remaining are
 * silently dropped. Emits nothing when the attribute does not exist or
 * has no samples. */
USDC_API void usdc_prim_attribute_time_samples(UsdcStage *stage,
                                               const char *prim_path,
                                               const char *attr_name,
                                               size_t max_samples,
                                               UsdcTimeSampleCallback cb,
                                               void *user);

/* Enumerates all authored relationships on the prim at `prim_path`.
 * Calls `cb(name, user)` once per relationship name.
 * Emits nothing when the prim does not exist. */
USDC_API void usdc_prim_relationship_names(UsdcStage *stage,
                                           const char *prim_path,
                                           UsdcStringCallback cb,
                                           void *user);

/* Enumerates the forwarded target paths of the named relationship.
 * Calls `cb(path, user)` once per target SdfPath string.
 * Emits nothing when the prim or relationship does not exist. */
USDC_API void usdc_prim_relationship_targets(UsdcStage *stage,
                                             const char *prim_path,
                                             const char *rel_name,
                                             UsdcStringCallback cb,
                                             void *user);

/* Enumerates the authored metadata keys on the prim.
 * Calls `cb(key, user)` once per key.
 * Emits nothing when the prim does not exist. */
USDC_API void usdc_prim_metadata_keys(UsdcStage *stage,
                                      const char *prim_path,
                                      UsdcStringCallback cb,
                                      void *user);

/* Returns a human-readable summary of a prim's metadata value for `key`.
 * Scratch-buffer lifetime. Returns NULL when the key is not authored or
 * the prim does not exist. */
USDC_API const char *usdc_prim_metadata_value_summary(UsdcStage *stage,
                                                      const char *prim_path,
                                                      const char *key);

/* -------------------- UsdSkel (Phase 2.G) -------------------- */

/* Returns the SdfPath of the `UsdSkelSkeleton` inherited-bound to a
 * mesh via `UsdSkelBindingAPI`. Walks the prim hierarchy so a skel
 * rel authored on an ancestor (the common SkelRoot pattern) still
 * resolves. Scratch-buffer lifetime. Returns NULL when no skeleton
 * is bound or when the prim does not exist. */
USDC_API const char *usdc_mesh_bound_skeleton(UsdcStage *stage,
                                              const char *mesh_path);

/* Enumerates the authored joint token paths on a
 * `UsdSkelSkeleton.joints` array, in authoring order. Callers use
 * the order to derive parent indices by longest-common-prefix
 * match. Emits nothing on unauthored / missing prims. */
USDC_API void usdc_skel_joints(UsdcStage *stage,
                               const char *skel_path,
                               UsdcStringCallback cb,
                               void *user);

/* Emits `UsdSkelSkeleton.bindTransforms` as a flat 16-float-per-joint
 * buffer in **column-major** layout (glTF convention). The shim
 * transposes OpenUSD's row-major `GfMatrix4d` on the way out. */
USDC_API void usdc_skel_bind_transforms(UsdcStage *stage,
                                        const char *skel_path,
                                        UsdcFloatBufferCallback cb,
                                        void *user);

/* Same as `usdc_skel_bind_transforms`, for
 * `UsdSkelSkeleton.restTransforms`. Column-major, 16 floats per
 * joint. */
USDC_API void usdc_skel_rest_transforms(UsdcStage *stage,
                                        const char *skel_path,
                                        UsdcFloatBufferCallback cb,
                                        void *user);

/* Enumerates the per-mesh `skel:joints` token override. Apple ARKit
 * exports use this to restrict which joints a given mesh binds to
 * (the mesh's `primvars:skel:jointIndices` index into this subset,
 * not the full Skeleton.joints array). Emits nothing when
 * unauthored. */
USDC_API void usdc_mesh_skel_joints(UsdcStage *stage,
                                    const char *mesh_path,
                                    UsdcStringCallback cb,
                                    void *user);

/* Emits `primvars:skel:jointIndices` as a flat int array. Length is
 * `point_count * joints_per_vertex`. Use
 * `usdc_mesh_joints_per_vertex` to learn the stride. */
USDC_API void usdc_mesh_joint_indices(UsdcStage *stage,
                                      const char *mesh_path,
                                      UsdcI32BufferCallback cb,
                                      void *user);

/* Emits `primvars:skel:jointWeights` as a flat float array. Parallel
 * to `usdc_mesh_joint_indices`; sums to 1.0 per-vertex in spec-
 * compliant authoring, but yw-look does not normalize before
 * handing the glTF writer. */
USDC_API void usdc_mesh_joint_weights(UsdcStage *stage,
                                      const char *mesh_path,
                                      UsdcFloatBufferCallback cb,
                                      void *user);

/* Returns the `elementSize` metadata on `primvars:skel:jointIndices`
 * — i.e. the number of bone influences stored per vertex (spec
 * default 1, Apple ARKit exports usually author 4). Returns 0 when
 * the primvar is unauthored. */
USDC_API int usdc_mesh_joints_per_vertex(UsdcStage *stage,
                                         const char *mesh_path);

/* Stage `timeCodesPerSecond` metadata (USD spec default 24.0). Used
 * to convert USD time codes to glTF seconds. Returns 24.0 when the
 * stage has no root layer or metadata access fails. */
USDC_API double usdc_stage_time_codes_per_second(UsdcStage *stage);

/* Returns the SdfPath of the `UsdSkelAnimation` bound to a
 * `UsdSkelSkeleton` via `skel:animationSource`. Walks
 * `UsdSkelBindingAPI::GetInheritedAnimationSource` so animation
 * sources authored on an ancestor (the common SkelRoot pattern)
 * resolve correctly. Scratch-buffer lifetime. Returns NULL when no
 * animation is bound. */
USDC_API const char *usdc_skel_animation_source(UsdcStage *stage,
                                                const char *skel_path);

/* Enumerates the `UsdSkelAnimation.joints` token array. Animations
 * often target a subset of the full skeleton joint list, so callers
 * must map each animated joint by name back to the owning
 * skeleton's joint order. */
USDC_API void usdc_skel_anim_joints(UsdcStage *stage,
                                    const char *anim_path,
                                    UsdcStringCallback cb,
                                    void *user);

/* Emits the union of USD time codes authored across `translations`,
 * `rotations`, and `scales` attributes — i.e. every frame the
 * animation mentions, in ascending order. f32 precision is enough
 * for the preview (sub-frame drift is imperceptible under 24fps);
 * callers convert to glTF seconds by dividing by
 * `usdc_stage_time_codes_per_second`. Emits `(NULL, 0)` when the
 * animation has no authored samples. */
USDC_API void usdc_skel_anim_times(UsdcStage *stage,
                                   const char *anim_path,
                                   UsdcFloatBufferCallback cb,
                                   void *user);

/* Samples `UsdSkelAnimation.translations` at `time_code` as a flat
 * vec3f array (stride 3 per joint). Emits `(NULL, 0)` when the
 * attribute is unauthored or empty at this time. */
USDC_API void usdc_skel_anim_translations_at(UsdcStage *stage,
                                             const char *anim_path,
                                             double time_code,
                                             UsdcFloatBufferCallback cb,
                                             void *user);

/* Samples `UsdSkelAnimation.rotations` at `time_code` as a flat
 * quaternion array in **glTF order (x, y, z, w)** — the shim
 * reorders from USD's `(w, x, y, z)` layout so the Rust side and
 * the eventual GLB writer don't have to juggle conventions. Stride
 * 4 per joint. */
USDC_API void usdc_skel_anim_rotations_at(UsdcStage *stage,
                                          const char *anim_path,
                                          double time_code,
                                          UsdcFloatBufferCallback cb,
                                          void *user);

/* Samples `UsdSkelAnimation.scales` at `time_code` as flat vec3h /
 * vec3f (converted to f32) with stride 3. */
USDC_API void usdc_skel_anim_scales_at(UsdcStage *stage,
                                       const char *anim_path,
                                       double time_code,
                                       UsdcFloatBufferCallback cb,
                                       void *user);

/* Samples `UsdSkelAnimation.blendShapeWeights` at `time_code` as a
 * flat `float[]` — one weight per entry in the animation's
 * `blendShapes` token array (use `usdc_prim_attr_token_array` with
 * `"blendShapes"` on `anim_path` to recover the parallel names).
 * Emits `(NULL, 0)` when unauthored or empty at this time. */
USDC_API void usdc_skel_anim_blend_shape_weights_at(UsdcStage *stage,
                                                    const char *anim_path,
                                                    double time_code,
                                                    UsdcFloatBufferCallback cb,
                                                    void *user);

#ifdef __cplusplus
} /* extern "C" */
#endif

#endif /* USD_C_SHIM_H */
