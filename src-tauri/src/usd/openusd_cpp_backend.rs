//! `UsdBackend` implementation backed by Pixar OpenUSD via the
//! handwritten `usd_c_shim` C ABI.
//!
//! Scope (PoC, Inspector-only):
//!   - `inspect_stage`, `summarize_stage`, `collect_asset_issues`,
//!     `root_layer_is_binary` are implemented against the shim.
//!   - `requires_glb_preview` returns `false` for every file. Until the
//!     C++ backend grows a GLB extraction pipeline, the frontend will
//!     use the Three.js `USDLoader.parse` path for every USD file when
//!     this backend is active. USDC binary files will surface as
//!     explicit errors via the existing loader error path, matching
//!     the pre-Phase-3 behavior.
//!   - `extract_geometry_glb` returns `UsdError::Parse(...)`. The
//!     geometry / material / skel pipeline is explicitly deferred to a
//!     later phase of the C++ backend.
//!
//! This backend is only compiled when the `backend-openusd-cpp` Cargo
//! feature is enabled. `lib.rs` picks between `OpenusdBackend` (pure
//! Rust fork, default) and `OpenusdCppBackend` (this file) via the
//! `DefaultBackend` type alias in `super::mod`.

use std::collections::HashSet;
use std::path::Path as StdPath;

use openusd::sdf::Path as SdfPath;
use openusd::stage::MeshData;

use super::backend::{UsdBackend, UsdError};
use super::cpp_sys::{CStage, Interpolation, LoadPolicy, Orientation};
use super::glb::{self, MaterialInput, MeshInput};
use super::openusd_backend::{
    mat4_f64_to_f32, mat4_mul, mesh_data_to_input, srgb_to_linear, z_up_to_y_up_mat4,
    MeshOrientation,
};
use super::types::{
    AssetIssue, AssetIssueCode, AssetIssueLevel, CompositionArc, CompositionArcState,
    StageInspection, StageLoadPolicy, StageSummary, VariantSetInfo,
};
use super::cpp_sys::UpAxis;

/// Real backend backed by Pixar OpenUSD via the C shim.
pub struct OpenusdCppBackend;

impl OpenusdCppBackend {
    pub fn new() -> Self {
        Self
    }

    fn open(path: &StdPath, policy: StageLoadPolicy) -> Result<CStage, UsdError> {
        CStage::open(path, to_cpp_policy(policy)).map_err(|e| UsdError::Parse(e.0))
    }
}

impl Default for OpenusdCppBackend {
    fn default() -> Self {
        Self::new()
    }
}

fn to_cpp_policy(policy: StageLoadPolicy) -> LoadPolicy {
    match policy {
        StageLoadPolicy::LoadAll => LoadPolicy::All,
        StageLoadPolicy::NoPayloads => LoadPolicy::NoPayloads,
    }
}

/// Matches the Rust-backend `reference_arc_state` rule: an authored
/// arc is `Missing` iff its asset_path literal appears in the set of
/// unresolved assets the shim reported for the stage.
fn classify_reference(
    unresolved: &HashSet<&str>,
    asset_path: &str,
) -> CompositionArcState {
    if unresolved.contains(asset_path) {
        CompositionArcState::Missing
    } else {
        CompositionArcState::Loaded
    }
}

/// Payload classification has three states. Missing trumps Unloaded
/// so a broken payload never reads as "deferred on purpose". Keyed on
/// the (asset_path, source_prim) pair so multiple payloads pointing at
/// the same asset from different prims are classified independently —
/// matching the Rust fork's `openusd_backend::payload_arc_state`
/// behavior.
fn classify_payload(
    unresolved: &HashSet<&str>,
    skipped_pairs: &HashSet<(&str, &str)>,
    asset_path: &str,
    source_prim: &str,
    policy: StageLoadPolicy,
) -> CompositionArcState {
    if unresolved.contains(asset_path) {
        return CompositionArcState::Missing;
    }
    if policy == StageLoadPolicy::NoPayloads
        && skipped_pairs.contains(&(asset_path, source_prim))
    {
        return CompositionArcState::Unloaded;
    }
    CompositionArcState::Loaded
}

impl UsdBackend for OpenusdCppBackend {
    fn inspect_stage(
        &self,
        path: &StdPath,
        policy: StageLoadPolicy,
    ) -> Result<StageInspection, UsdError> {
        let stage = Self::open(path, policy)?;

        let default_prim = stage.default_prim();
        let up_axis = stage.up_axis().map(|axis| match axis {
            super::cpp_sys::UpAxis::Y => "Y".to_string(),
            super::cpp_sys::UpAxis::Z => "Z".to_string(),
        });
        let meters_per_unit = stage.meters_per_unit();

        // The shim has no first-class "root prims" enumerator — prims
        // under the pseudo-root are emitted by traverse() as paths of
        // depth 1 (e.g. `/Foo`). Filter the traverse result to match
        // the Rust fork's behavior.
        let all_prims = stage.traverse();
        let root_prims: Vec<String> = all_prims
            .iter()
            .filter(|p| is_root_prim_path(p))
            .map(|p| p.trim_start_matches('/').to_string())
            .collect();

        // Layer identifiers: first entry is the root layer, everything
        // after are composed dependencies. The inspector UI only shows
        // the composed set (sublayers, refs, payloads), so skip [0].
        let mut layer_ids = stage.layer_identifiers();
        if !layer_ids.is_empty() {
            layer_ids.remove(0);
        }
        let composed_layers = layer_ids;

        let missing_assets = stage.unresolved_assets();
        let unresolved_set: HashSet<&str> =
            missing_assets.iter().map(String::as_str).collect();

        // Skipped-payloads key on (asset_path, source_prim) — see
        // `classify_payload`. Hold the owning Vec until classification
        // is done so the borrowed `&str` pairs stay valid.
        let skipped_owned = stage.skipped_payloads();
        let skipped_pairs: HashSet<(&str, &str)> = skipped_owned
            .iter()
            .map(|a| (a.asset_path.as_str(), a.source_prim.as_str()))
            .collect();

        let mut references = Vec::<CompositionArc>::new();
        let mut payloads = Vec::<CompositionArc>::new();
        let mut variant_sets = Vec::<VariantSetInfo>::new();

        for prim_path in &all_prims {
            if stage.prim_has_variants(prim_path) {
                for set_name in stage.variant_set_names(prim_path) {
                    let selection = stage.variant_selection(prim_path, &set_name);
                    variant_sets.push(VariantSetInfo {
                        prim_path: prim_path.clone(),
                        set_name,
                        selection,
                    });
                }
            }

            for r in stage.references_in(prim_path) {
                let state = classify_reference(&unresolved_set, &r.asset_path);
                references.push(CompositionArc {
                    source_prim: r.source_prim,
                    asset_path: r.asset_path,
                    target_prim: r.target_prim.unwrap_or_default(),
                    state,
                });
            }
            for p in stage.payloads_in(prim_path) {
                let state = classify_payload(
                    &unresolved_set,
                    &skipped_pairs,
                    &p.asset_path,
                    &p.source_prim,
                    policy,
                );
                payloads.push(CompositionArc {
                    source_prim: p.source_prim,
                    asset_path: p.asset_path,
                    target_prim: p.target_prim.unwrap_or_default(),
                    state,
                });
            }
        }

        Ok(StageInspection {
            path: path.display().to_string(),
            default_prim,
            up_axis,
            meters_per_unit,
            root_prims,
            composed_layers,
            references,
            payloads,
            missing_assets,
            variant_sets,
            load_policy: policy,
        })
    }

    fn summarize_stage(
        &self,
        path: &StdPath,
        policy: StageLoadPolicy,
    ) -> Result<StageSummary, UsdError> {
        let stage = Self::open(path, policy)?;

        let layer_count = stage.layer_count();

        let all_prims = stage.traverse();
        let root_prim_count = all_prims.iter().filter(|p| is_root_prim_path(p)).count();

        let mut mesh_count = 0usize;
        let mut payload_count = 0usize;
        let mut has_variants = false;

        for prim_path in &all_prims {
            if stage.prim_type_is_mesh(prim_path) {
                mesh_count += 1;
            }
            let payloads = stage.payloads_in(prim_path);
            if !payloads.is_empty() {
                payload_count += payloads.len();
            }
            if stage.prim_has_variants(prim_path) {
                has_variants = true;
            }
        }

        let warnings: Vec<String> = stage
            .unresolved_assets()
            .into_iter()
            .map(|a| format!("unresolved asset: {a}"))
            .collect();

        Ok(StageSummary {
            path: path.display().to_string(),
            layer_count,
            root_prim_count,
            mesh_count,
            payload_count,
            unloaded_payload_count: stage.skipped_payloads().len(),
            has_variants,
            warnings,
            load_policy: policy,
        })
    }

    fn collect_asset_issues(&self, path: &StdPath) -> Result<Vec<AssetIssue>, UsdError> {
        // Asset issues always inspect the fully-loaded stage.
        let stage = Self::open(path, StageLoadPolicy::LoadAll)?;
        let mut issues = Vec::new();

        if let Some(mpu) = stage.meters_per_unit() {
            if mpu <= 0.0 || mpu > 100.0 {
                issues.push(AssetIssue {
                    code: AssetIssueCode::SuspiciousMetersPerUnit,
                    level: AssetIssueLevel::Warning,
                    message: format!("metersPerUnit = {mpu} is outside the typical range."),
                    detail: None,
                    context_path: None,
                });
            }
        }

        let unresolved_owned = stage.unresolved_assets();
        let unresolved_set: HashSet<&str> =
            unresolved_owned.iter().map(String::as_str).collect();

        // Walk arcs and emit one contextualized issue per missing
        // reference / payload, tracking which asset paths we've
        // already attributed so the generic fallback below doesn't
        // double-report them.
        let mut covered = HashSet::<String>::new();

        for prim_path in stage.traverse() {
            for r in stage.references_in(&prim_path) {
                if unresolved_set.contains(r.asset_path.as_str()) {
                    covered.insert(r.asset_path.clone());
                    issues.push(AssetIssue {
                        code: AssetIssueCode::BrokenReference,
                        level: AssetIssueLevel::Error,
                        message: format!("Broken reference: {}", r.asset_path),
                        detail: None,
                        context_path: Some(r.source_prim),
                    });
                }
            }
            for p in stage.payloads_in(&prim_path) {
                if unresolved_set.contains(p.asset_path.as_str()) {
                    covered.insert(p.asset_path.clone());
                    issues.push(AssetIssue {
                        code: AssetIssueCode::MissingPayload,
                        level: AssetIssueLevel::Error,
                        message: format!("Missing payload: {}", p.asset_path),
                        detail: None,
                        context_path: Some(p.source_prim),
                    });
                }
            }
        }

        // Fallback for unresolved assets we couldn't attribute to any
        // specific arc (e.g. sublayers, which the shim doesn't expose
        // as arc-shaped data yet).
        for missing in &unresolved_owned {
            if !covered.contains(missing.as_str()) {
                issues.push(AssetIssue {
                    code: AssetIssueCode::MissingSubLayer,
                    level: AssetIssueLevel::Error,
                    message: format!("Unresolved asset: {missing}"),
                    detail: None,
                    context_path: None,
                });
            }
        }

        Ok(issues)
    }

    fn root_layer_is_binary(&self, path: &StdPath) -> Result<bool, UsdError> {
        let stage = Self::open(path, StageLoadPolicy::LoadAll)?;
        Ok(stage.root_layer_is_binary().unwrap_or(false))
    }

    fn requires_glb_preview(&self, path: &StdPath) -> Result<bool, UsdError> {
        let stage = Self::open(path, StageLoadPolicy::LoadAll)?;
        if stage.root_layer_is_binary().unwrap_or(false) {
            return Ok(true);
        }
        // Same rule as the Rust fork: more than one composed layer
        // means the USDA root depends on an external file the
        // Three.js USDLoader can't pull in, so route to the GLB path.
        if stage.layer_count() > 1 {
            return Ok(true);
        }
        Ok(false)
    }

    fn extract_geometry_glb(
        &self,
        path: &StdPath,
        policy: StageLoadPolicy,
    ) -> Result<Vec<u8>, UsdError> {
        let stage = Self::open(path, policy)?;

        // Z-up → Y-up baked into every mesh's world matrix so the GLB
        // is self-describing on the viewer side. Matches the Rust
        // fork backend's convention.
        let up_axis_correction = match stage.up_axis() {
            Some(UpAxis::Z) => Some(z_up_to_y_up_mat4()),
            _ => None,
        };

        // Pass 1: collect every renderable Mesh prim path. The shim's
        // `prim_is_renderable_mesh` delegates to UsdGeomImageable
        // inheritance so this already respects active / visibility /
        // purpose the way usdview's default purpose does.
        let all_prims = stage.traverse();
        let mut mesh_paths: Vec<String> = all_prims
            .into_iter()
            .filter(|p| stage.prim_is_renderable_mesh(p))
            .collect();

        // Drop "leaked" root prims from referenced / payloaded layers
        // when the stage authors a defaultPrim. Matches the Rust
        // backend's filter — without it you see duplicate meshes at
        // the origin from the raw root of each referenced layer.
        if let Some(dp) = stage.default_prim() {
            let prefix = format!("/{dp}/");
            let root_path = format!("/{dp}");
            mesh_paths.retain(|p| p.starts_with(&prefix) || *p == root_path);
        }

        if mesh_paths.is_empty() {
            return Err(UsdError::Parse(
                "no renderable Mesh prims found in stage".to_string(),
            ));
        }

        // Slot 0 is the yw-look default preview material, matching the
        // Rust backend's convention. Phase 2.E.1 added UsdPreviewSurface
        // scalar resolution; Phase 2.F bolts on texture resolution for
        // `inputs:diffuseColor` (USDZ archive + filesystem) via the
        // shared `TextureLoader`, so bound-texture previews land with
        // their actual image bytes.
        let mut materials: Vec<MaterialInput> = vec![MaterialInput::default_preview()];
        let mut material_slots: std::collections::HashMap<String, usize> =
            std::collections::HashMap::new();
        // Parallel to `materials`: each entry is the authored
        // `inputs:file` asset path (or `None` when the material has no
        // diffuse texture). The texture-loading pass below walks this
        // once `mesh_paths` have been processed.
        let mut material_texture_paths: Vec<Option<String>> = vec![None];
        let mut inputs: Vec<MeshInput> = Vec::with_capacity(mesh_paths.len());

        for prim_path in &mesh_paths {
            let Some(raw) = build_mesh_data_from_shim(&stage, prim_path) else {
                continue;
            };

            // World transform: shim delegates to
            // UsdGeomXformable::ComputeLocalToWorldTransform, so the
            // resetXformStack handling and multi-op composition come
            // for free from pxr. Apply the Z-up correction on top.
            let mut world = stage
                .prim_world_matrix(prim_path)
                .unwrap_or_else(identity_mat4);
            if let Some(correction) = &up_axis_correction {
                world = mat4_mul(correction, &world);
            }
            let world_f32 = mat4_f64_to_f32(&world);

            let orientation = match stage.mesh_orientation(prim_path) {
                Orientation::LeftHanded => MeshOrientation::LeftHanded,
                Orientation::RightHanded => MeshOrientation::RightHanded,
            };

            // Pass a parsed SdfPath into the shared mesh builder; its
            // validation layer uses the path only for error strings.
            let Ok(sdf_path) = SdfPath::new(prim_path) else {
                continue;
            };

            let mut triangulated = mesh_data_to_input(
                &sdf_path,
                world_f32,
                &raw,
                orientation,
                usize::MAX,
                &[],
            )?;

            // Phase 2.E.1: resolve the bound material's
            // UsdPreviewSurface scalars into a `MaterialInput` slot,
            // deduping identical bindings across meshes. Falls back
            // to slot 0 (yw-look default) when the mesh has no
            // material binding or the surface shader is not a
            // UsdPreviewSurface.
            let bound_slot = resolve_material_slot_cpp(
                &stage,
                prim_path,
                &mut materials,
                &mut material_slots,
                &mut material_texture_paths,
            );
            // Phase 2.I.1: when the mesh has no bound material and
            // carries a constant `primvars:displayColor`, promote the
            // color into a dedicated material slot so unshaded meshes
            // still pick up the authored tint. Per-vertex / varying
            // interpolations already flow through to COLOR_0 via the
            // shared triangulator in `mesh_data_to_input`.
            triangulated.material_index = apply_display_color_fallback_cpp(
                bound_slot,
                &raw,
                prim_path,
                &mut materials,
                &mut material_slots,
                &mut material_texture_paths,
            );
            triangulated.skin_index = None;
            inputs.push(triangulated);
        }

        if inputs.is_empty() {
            return Err(UsdError::Parse(
                "all renderable meshes failed to build".to_string(),
            ));
        }

        // Phase 2.F: resolve every material's `inputs:diffuseColor`
        // texture path into actual image bytes and embed them in the
        // GLB. Failures log and fall back to the scalar base color —
        // real assets commonly ship with broken texture references that
        // the user still wants to preview. Search dirs include the
        // stage file's parent plus every composed layer's parent so
        // materials authored in a referenced layer resolve relative to
        // that layer.
        let mut search_dirs: Vec<std::path::PathBuf> = Vec::new();
        if let Some(parent) = path.parent() {
            if !parent.as_os_str().is_empty() {
                search_dirs.push(parent.to_path_buf());
            }
        }
        for layer_id in stage.layer_identifiers() {
            let layer_path = StdPath::new(&layer_id);
            if let Some(parent) = layer_path.parent() {
                // Bare-filename layer identifiers (e.g. anonymous
                // layers or a single relative `.usd` path) yield
                // `Some("")`, which would otherwise be pushed as a
                // distinct CWD-relative search dir and shadow real
                // parents. Drop them.
                if !parent.as_os_str().is_empty()
                    && !search_dirs.iter().any(|d| d == parent)
                {
                    search_dirs.push(parent.to_path_buf());
                }
            }
        }

        let mut texture_loader =
            super::openusd_backend::TextureLoader::new(path, search_dirs);
        let mut textures: Vec<glb::TextureInput> = Vec::new();
        let mut texture_dedup: std::collections::HashMap<String, usize> =
            std::collections::HashMap::new();
        for (mat_idx, tex_path) in material_texture_paths.iter().enumerate() {
            let Some(tex_path) = tex_path else { continue };
            match texture_loader.load(tex_path) {
                Ok(loaded) => {
                    let new_idx =
                        if let Some(&existing) = texture_dedup.get(&loaded.identity) {
                            existing
                        } else {
                            let idx = textures.len();
                            textures.push(loaded.input);
                            texture_dedup.insert(loaded.identity, idx);
                            idx
                        };
                    materials[mat_idx].base_color_texture = Some(new_idx);
                    // Neutralize the factor to white exactly like the
                    // Rust backend does — UsdPreviewSurface treats
                    // diffuseColor as *either* scalar or texture, no
                    // multiplicative tint, so leaving the 0.18 schema
                    // default would render textured surfaces too dark.
                    let alpha = materials[mat_idx].base_color_factor[3];
                    materials[mat_idx].base_color_factor = [1.0, 1.0, 1.0, alpha];
                }
                Err(err) => {
                    eprintln!(
                        "[usd-cpp] texture '{}' for material[{mat_idx}] failed: {err}",
                        tex_path
                    );
                }
            }
        }

        // Phase 2.H: resolve UsdLux lights and UsdGeomCamera cameras
        // alongside meshes. Same up-axis baking applies so glTF node
        // matrices stay self-describing.
        let lights = resolve_lights_cpp(&stage, up_axis_correction.as_ref());
        let cameras = resolve_cameras_cpp(&stage, up_axis_correction.as_ref());

        glb::build_glb(&inputs, &materials, &textures, &[], &[], &lights, &cameras)
            .map_err(|e| UsdError::Parse(e.to_string()))
    }
}

fn identity_mat4() -> [f64; 16] {
    [
        1.0, 0.0, 0.0, 0.0, //
        0.0, 1.0, 0.0, 0.0, //
        0.0, 0.0, 1.0, 0.0, //
        0.0, 0.0, 0.0, 1.0,
    ]
}

/// Collect the raw per-mesh attributes via the shim and shape them
/// into an `openusd::MeshData` value so the shared `mesh_data_to_input`
/// pure function can consume them unchanged.
///
/// Returns `None` when the mesh has no authored `points` or
/// `faceVertexCounts`, which are the only two attributes the GLB
/// pipeline cannot work without.
fn build_mesh_data_from_shim(stage: &CStage, prim_path: &str) -> Option<MeshData> {
    let points = stage.mesh_points(prim_path);
    let face_vertex_counts = stage.mesh_face_vertex_counts(prim_path);
    let face_vertex_indices = stage.mesh_face_vertex_indices(prim_path);

    if points.is_empty() || face_vertex_counts.is_empty() {
        return None;
    }

    let (normals_raw, _normals_interp) = stage.mesh_normals(prim_path);
    let (uvs_raw, uvs_interp) = stage.mesh_uvs(prim_path);
    let uv_indices = stage.mesh_uv_indices(prim_path);
    let (display_color_raw, _dc_interp) = stage.mesh_display_color(prim_path);

    let normals = (!normals_raw.is_empty()).then_some(normals_raw);
    // UsdGeomPrimvarsAPI surfaces indexed UV primvars as a compact
    // values array + an indices array. Expand to faceVarying layout
    // so `classify_attribute` (in the shared builder) recognizes the
    // length and emits correct per-vertex expansions. Matches
    // `expand_indexed_uvs` on the Rust backend.
    let uvs = if !uvs_raw.is_empty() && !uv_indices.is_empty()
        && uvs_interp == Interpolation::FaceVarying
    {
        let mut expanded = Vec::with_capacity(uv_indices.len() * 2);
        for idx in &uv_indices {
            let i = *idx as usize;
            let base = i * 2;
            if base + 1 < uvs_raw.len() {
                expanded.push(uvs_raw[base]);
                expanded.push(uvs_raw[base + 1]);
            } else {
                // Out-of-range index — fall back to (0, 0) rather
                // than dropping the whole attribute so downstream
                // validation still sees the expected element count.
                expanded.push(0.0);
                expanded.push(0.0);
            }
        }
        Some(expanded)
    } else if !uvs_raw.is_empty() {
        Some(uvs_raw)
    } else {
        None
    };
    let display_color = (!display_color_raw.is_empty()).then_some(display_color_raw);

    Some(MeshData {
        points,
        face_vertex_counts,
        face_vertex_indices,
        normals,
        uvs,
        joint_indices: None,
        joint_weights: None,
        joints_per_vertex: 0,
        display_color,
    })
}

/// Phase 2.I.1: displayColor fallback for cpp backend. When a mesh
/// has no bound material (slot 0) but authors a constant
/// `primvars:displayColor`, create a dedicated material slot so the
/// viewer picks up the authored color instead of the yw-look default
/// grey. Mirrors `apply_display_color_fallback` on the Rust backend;
/// keeps a separate copy so the cpp backend doesn't need to grow the
/// `material_normal_paths` argument the Rust fallback threads through.
fn apply_display_color_fallback_cpp(
    slot: usize,
    mesh: &MeshData,
    prim_path: &str,
    materials: &mut Vec<MaterialInput>,
    material_slots: &mut std::collections::HashMap<String, usize>,
    material_texture_paths: &mut Vec<Option<String>>,
) -> usize {
    if slot != 0 {
        return slot;
    }
    let Some(dc) = &mesh.display_color else { return 0 };
    // Only the constant-interpolation case makes sense as a material
    // fallback; per-vertex / faceVarying display colors flow into
    // COLOR_0 via `mesh_data_to_input` and don't need a material
    // slot.
    if dc.len() != 3 {
        return 0;
    }
    let key = format!("displayColor:{:.4},{:.4},{:.4}", dc[0], dc[1], dc[2]);
    if let Some(&existing) = material_slots.get(&key) {
        return existing;
    }
    let mut mi = MaterialInput::default_preview();
    mi.name = format!("dc:{prim_path}");
    mi.base_color_factor = [
        srgb_to_linear(dc[0]),
        srgb_to_linear(dc[1]),
        srgb_to_linear(dc[2]),
        1.0,
    ];
    // displayColor is a preview-only signal; leave metallic at 0 and
    // roughness at a slightly smoother default than the yw-look
    // fallback (0.9) so the result looks plausible for untextured
    // assets that mostly use displayColor for colored solids.
    mi.metallic_factor = 0.0;
    mi.roughness_factor = 0.5;

    let s = materials.len();
    materials.push(mi);
    material_texture_paths.push(None);
    material_slots.insert(key, s);
    s
}

/// Phase 2.H: enumerate UsdLux light prims and resolve each to a
/// `glb::LightInput`. Only `DistantLight` (→ directional) and
/// `SphereLight` (→ point) are mapped, matching the Rust backend's
/// scope. Area lights and DomeLights are intentionally skipped —
/// glTF's `KHR_lights_punctual` does not cover them.
fn resolve_lights_cpp(
    stage: &CStage,
    up_correction: Option<&[f64; 16]>,
) -> Vec<glb::LightInput> {
    let mut out = Vec::new();
    for prim_path in stage.traverse() {
        let kind = match stage.prim_type_name(&prim_path).as_deref() {
            Some("DistantLight") => glb::LightKind::Directional,
            Some("SphereLight") => glb::LightKind::Point,
            _ => continue,
        };
        let intensity = stage
            .prim_attr_float(&prim_path, "inputs:intensity")
            .unwrap_or(1.0);
        let exposure = stage
            .prim_attr_float(&prim_path, "inputs:exposure")
            .unwrap_or(0.0);
        let intensity = intensity * 2.0f32.powf(exposure);
        let color = stage
            .prim_attr_color3f(&prim_path, "inputs:color")
            .unwrap_or([1.0, 1.0, 1.0]);
        let mut world = stage.prim_world_matrix(&prim_path).unwrap_or_else(identity_mat4);
        if let Some(correction) = up_correction {
            world = mat4_mul(correction, &world);
        }
        out.push(glb::LightInput {
            name: prim_path.clone(),
            kind,
            color,
            intensity,
            world_matrix: mat4_f64_to_f32(&world),
        });
    }
    out
}

/// Phase 2.H: enumerate `UsdGeomCamera` prims and resolve each to a
/// `glb::CameraInput`. Perspective only; non-perspective projections
/// are skipped like the Rust backend does. Spec defaults kick in
/// when `focalLength` / `horizontalAperture` / `verticalAperture`
/// are unauthored so every camera produces a valid glTF entry.
fn resolve_cameras_cpp(
    stage: &CStage,
    up_correction: Option<&[f64; 16]>,
) -> Vec<glb::CameraInput> {
    let mut out = Vec::new();
    for prim_path in stage.traverse() {
        if stage.prim_type_name(&prim_path).as_deref() != Some("Camera") {
            continue;
        }
        let focal_length = stage
            .prim_attr_float(&prim_path, "focalLength")
            .unwrap_or(50.0);
        let horizontal_aperture = stage
            .prim_attr_float(&prim_path, "horizontalAperture")
            .unwrap_or(20.955);
        let vertical_aperture = stage
            .prim_attr_float(&prim_path, "verticalAperture")
            .unwrap_or(15.2908);

        let yfov = glb::camera_yfov_radians(vertical_aperture, focal_length);
        let aspect_ratio = if vertical_aperture > 0.0 {
            horizontal_aperture / vertical_aperture
        } else {
            1.0
        };

        let (znear, zfar) = match stage.prim_attr_float2(&prim_path, "clippingRange") {
            Some(v) if v[0] > 0.0 => (v[0], Some(v[1])),
            Some(v) => (0.1, Some(v[1])),
            None => (0.1, None),
        };

        let mut world = stage.prim_world_matrix(&prim_path).unwrap_or_else(identity_mat4);
        if let Some(correction) = up_correction {
            world = mat4_mul(correction, &world);
        }

        out.push(glb::CameraInput {
            name: prim_path.clone(),
            yfov,
            aspect_ratio,
            znear,
            zfar,
            world_matrix: mat4_f64_to_f32(&world),
        });
    }
    out
}

/// Phase 2.E.1: resolve a mesh's bound material into a
/// `MaterialInput` slot, deduping by material SdfPath so multiple
/// meshes sharing one binding point at the same slot. Falls back to
/// slot 0 (yw-look default preview) when the mesh has no binding or
/// the surface shader is not a `UsdPreviewSurface`.
///
/// Texture connections and `UsdTransform2d` resolution are left to
/// Phase 2.F — scalar inputs alone already unblock the "color shows
/// up in preview" goal without needing the USDZ archive reader.
fn resolve_material_slot_cpp(
    stage: &CStage,
    prim_path: &str,
    materials: &mut Vec<MaterialInput>,
    material_slots: &mut std::collections::HashMap<String, usize>,
    material_texture_paths: &mut Vec<Option<String>>,
) -> usize {
    let Some(mat_path) = stage.prim_bound_material(prim_path) else {
        return 0;
    };
    if let Some(&slot) = material_slots.get(&mat_path) {
        return slot;
    }

    let shader_path = match stage.material_surface_shader(&mat_path) {
        Some(p) => p,
        None => return 0,
    };
    // Only UsdPreviewSurface is wired up here. MaterialX / custom
    // shaders fall through to the default slot until we grow an
    // explicit mapping for each `info:id`.
    match stage.shader_id(&shader_path).as_deref() {
        Some("UsdPreviewSurface") => {}
        _ => return 0,
    }

    // UsdPreviewSurface schema defaults — see
    // https://openusd.org/release/spec_usdpreviewsurface.html. Match
    // the Rust backend's defaults so parity tests hold.
    const DIFFUSE_DEFAULT: [f32; 3] = [0.18, 0.18, 0.18];
    const METALLIC_DEFAULT: f32 = 0.0;
    const ROUGHNESS_DEFAULT: f32 = 0.5;
    const OPACITY_DEFAULT: f32 = 1.0;
    const EMISSIVE_DEFAULT: [f32; 3] = [0.0, 0.0, 0.0];

    // The factor stays at the authored scalar (or schema default)
    // here. When `inputs:diffuseColor` is driven by a UsdUVTexture
    // and the texture loads successfully, the later texture pass
    // neutralizes this to white (UsdPreviewSurface is either-or,
    // never multiplicative). Keeping the scalar here means a
    // texture load failure leaves the material with the authored
    // (or 0.18 default) color rather than collapsing to white —
    // matches the Rust backend's Codex P1 fallback.
    let has_diffuse_texture =
        stage.shader_input_has_connection(&shader_path, "inputs:diffuseColor");
    let diffuse = stage
        .shader_input_color3f(&shader_path, "inputs:diffuseColor")
        .unwrap_or(DIFFUSE_DEFAULT);
    let opacity = stage
        .shader_input_float(&shader_path, "inputs:opacity")
        .unwrap_or(OPACITY_DEFAULT)
        .clamp(0.0, 1.0);
    let metallic = stage
        .shader_input_float(&shader_path, "inputs:metallic")
        .unwrap_or(METALLIC_DEFAULT);
    let roughness = stage
        .shader_input_float(&shader_path, "inputs:roughness")
        .unwrap_or(ROUGHNESS_DEFAULT);
    let emissive = stage
        .shader_input_color3f(&shader_path, "inputs:emissiveColor")
        .unwrap_or(EMISSIVE_DEFAULT);

    let mut mi = MaterialInput::default_preview();
    mi.name = format!("usd:{mat_path}");
    mi.base_color_factor = [
        srgb_to_linear(diffuse[0]),
        srgb_to_linear(diffuse[1]),
        srgb_to_linear(diffuse[2]),
        opacity,
    ];
    mi.metallic_factor = metallic;
    mi.roughness_factor = roughness;
    mi.emissive_factor = emissive;

    // Walk the UsdShade graph for the diffuseColor connection's
    // target shader; if it's a UsdUVTexture, pull its authored
    // `inputs:file` asset path so the outer loop can hand it to the
    // shared TextureLoader. Keeps the scalar fallback path intact
    // when no texture is wired up.
    let texture_asset_path = if has_diffuse_texture {
        stage
            .shader_input_connected_source_prim(&shader_path, "inputs:diffuseColor")
            .and_then(|src_shader_path| {
                match stage.shader_id(&src_shader_path).as_deref() {
                    Some("UsdUVTexture") => {
                        stage.shader_input_asset(&src_shader_path, "inputs:file")
                    }
                    _ => None,
                }
            })
    } else {
        None
    };

    let slot = materials.len();
    materials.push(mi);
    material_texture_paths.push(texture_asset_path);
    material_slots.insert(mat_path, slot);
    slot
}

/// A root-level prim has exactly one `/` and no further separator. We
/// use an explicit character count instead of `split('/').count()` to
/// avoid allocating iterators on the hot traverse loop.
fn is_root_prim_path(p: &str) -> bool {
    let mut saw_leading_slash = false;
    for ch in p.chars() {
        if ch == '/' {
            if saw_leading_slash {
                return false;
            }
            saw_leading_slash = true;
        }
    }
    // Must have a leading '/' and at least one character after it.
    saw_leading_slash && p.len() > 1
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn is_root_prim_path_rules() {
        assert!(is_root_prim_path("/Root"));
        assert!(is_root_prim_path("/Foo"));
        assert!(!is_root_prim_path("/Foo/Bar"));
        assert!(!is_root_prim_path("/"));
        assert!(!is_root_prim_path(""));
        assert!(!is_root_prim_path("NoLeadingSlash"));
    }
}
