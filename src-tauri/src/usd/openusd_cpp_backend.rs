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

use std::collections::{HashMap, HashSet};
use std::path::Path as StdPath;
use std::time::Instant;

use openusd::sdf::Path as SdfPath;
use openusd::stage::MeshData;

use super::asset_resolution::filter_resolvable_relative_assets;
use super::backend::{
    UsdError, UsdGeometryBackend, UsdInspectBackend, UsdLightBackend, UsdSessionBackend,
    UsdSourceBackend,
};
use super::cpp_sys::{CError, CStage, Interpolation, LoadPolicy, Orientation, UpAxis};
use super::extract_shared::{
    apply_display_color_fallback, apply_vertex_alpha_blend, filter_display_opacity_for_subset,
    skin_index_from_payload, ScalarAttributeKind,
};
use super::geometry::{
    filter_mesh_by_face_indices, mesh_data_to_input, validate_mesh_topology, MeshOrientation,
};
use super::glb::{self, InstancingInput, MaterialInput, MeshInput};
use super::lights::{effective_light_intensity_from_authored, gltf_light_kind_from_usd_type_name};
use super::material::{
    apply_resolved_texture_transforms, build_material_slot_paths, is_preview_surface_shader_id,
    lookup_material_slot, material_input_from_preview_surface, register_material_slot,
    resolve_texture_sampler_node, select_wrap_sampler_source,
    texture_transform_from_usd_transform2d, PreviewSurfaceInput, ResolvedTextureSampler,
    TextureNodeGraph,
};
use super::math::{
    identity_mat4, invert_mat4_f32, invert_mat4_with_threshold, mat4_f64_to_f32, mat4_mul,
    mat4_mul_f32, trs_to_mat4_f32, z_up_to_y_up_mat4,
};
use super::node_tree::{
    collect_node_payload_maps, emit_node_inputs, order_node_paths_by_traversal,
};
use super::prim_path::parent_prim_path;
use super::skel::{remap_mesh_skin_indices, DenseBlendShape};
use super::texture_loader::{embed_material_textures, TextureEmbedLogStyle, TextureLoader};
use super::types::{
    AssetIssue, AssetIssueCode, AssetIssueLevel, AttributeInfo, AttributeTimeSamples,
    CompositionArc, CompositionArcKind, CompositionArcState, ExtractGeometryOptions, LayerInfo,
    MetadataEntry, PrimInspection, PrimTypeCount, RelationshipInfo, ShapingCone, StageInspection,
    StageLoadPolicy, StageSummary, TimeSampleEntry, UsdLightInfo, VariantSelection, VariantSetInfo,
};

fn usd_timing_enabled() -> bool {
    std::env::var_os("YW_LOOK_USD_TIMING").is_some()
}

fn log_usd_timing(label: &str, started: Instant) {
    if usd_timing_enabled() {
        log::debug!(
            "[usd-cpp timing] {label}: {}ms",
            started.elapsed().as_millis()
        );
    }
}

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

fn map_c_error(error: CError) -> UsdError {
    UsdError::Parse(error.to_string())
}

/// Matches the Rust-backend `reference_arc_state` rule: an authored
/// arc is `Missing` iff its asset_path literal appears in the set of
/// unresolved assets the shim reported for the stage.
fn classify_reference(unresolved: &HashSet<&str>, asset_path: &str) -> CompositionArcState {
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
    if policy == StageLoadPolicy::NoPayloads {
        return CompositionArcState::Unloaded;
    }
    if skipped_pairs.contains(&(asset_path, source_prim)) {
        return CompositionArcState::Unloaded;
    }
    CompositionArcState::Loaded
}

impl UsdInspectBackend for OpenusdCppBackend {
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
        let all_prims = stage.traverse().map_err(map_c_error)?;
        let root_prims: Vec<String> = all_prims
            .iter()
            .filter(|p| is_root_prim_path(p))
            .map(|p| p.trim_start_matches('/').to_string())
            .collect();

        // Layer identifiers: first entry is the root layer, everything
        // after are composed dependencies. The inspector UI only shows
        // the composed set (sublayers, refs, payloads), so skip [0].
        let all_layer_ids = stage.layer_identifiers().map_err(map_c_error)?;
        let missing_assets = filter_resolvable_relative_assets(
            path,
            all_layer_ids.iter().cloned(),
            stage.unresolved_assets().map_err(map_c_error)?,
        );
        let mut layer_ids = all_layer_ids;
        if !layer_ids.is_empty() {
            layer_ids.remove(0);
        }
        let composed_layers = layer_ids;

        let unresolved_set: HashSet<&str> = missing_assets.iter().map(String::as_str).collect();

        // Skipped-payloads key on (asset_path, source_prim) — see
        // `classify_payload`. Hold the owning Vec until classification
        // is done so the borrowed `&str` pairs stay valid.
        let skipped_owned = stage.skipped_payloads().map_err(map_c_error)?;
        let skipped_pairs: HashSet<(&str, &str)> = skipped_owned
            .iter()
            .map(|a| (a.asset_path.as_str(), a.source_prim.as_str()))
            .collect();

        let mut references = Vec::<CompositionArc>::new();
        let mut payloads = Vec::<CompositionArc>::new();
        let mut payload_seen = HashSet::<(String, String, String)>::new();
        let mut variant_sets = Vec::<VariantSetInfo>::new();
        // #30: additional arc kinds collected into the shared
        // `composition_arcs` field for new-style consumers. References
        // and payloads are also duplicated here so the frontend has one
        // flat list when it needs all arcs together.
        let mut inherits_arcs = Vec::<CompositionArc>::new();
        let mut specializes_arcs = Vec::<CompositionArc>::new();
        let mut variant_selection_arcs = Vec::<CompositionArc>::new();

        for prim_path in &all_prims {
            if stage.prim_has_variants(prim_path) {
                for set_name in stage.variant_set_names(prim_path) {
                    let selection = stage.variant_selection(prim_path, &set_name);
                    let variants = stage.variant_names(prim_path, &set_name);
                    // #30: emit a VariantSelection arc for each set that
                    // has an authored selection. `asset_path` is empty
                    // (variant selections are always stage-local); the
                    // selection is encoded in `target_prim` as
                    // `"{setName}={variantName}"`.
                    if let Some(ref sel) = selection {
                        variant_selection_arcs.push(CompositionArc {
                            source_prim: prim_path.clone(),
                            asset_path: String::new(),
                            target_prim: format!("{set_name}={sel}"),
                            state: CompositionArcState::Loaded,
                            kind: CompositionArcKind::VariantSelection,
                        });
                    }
                    variant_sets.push(VariantSetInfo {
                        prim_path: prim_path.clone(),
                        set_name,
                        selection,
                        variants,
                    });
                }
            }

            for r in stage.references_in(prim_path).map_err(map_c_error)? {
                let state = classify_reference(&unresolved_set, &r.asset_path);
                references.push(CompositionArc {
                    source_prim: r.source_prim,
                    asset_path: r.asset_path,
                    target_prim: r.target_prim.unwrap_or_default(),
                    state,
                    kind: CompositionArcKind::Reference,
                });
            }
            for p in stage.payloads_in(prim_path).map_err(map_c_error)? {
                let target_prim = p.target_prim.unwrap_or_default();
                let state = classify_payload(
                    &unresolved_set,
                    &skipped_pairs,
                    &p.asset_path,
                    &p.source_prim,
                    policy,
                );
                payload_seen.insert((
                    p.source_prim.clone(),
                    p.asset_path.clone(),
                    target_prim.clone(),
                ));
                payloads.push(CompositionArc {
                    source_prim: p.source_prim,
                    asset_path: p.asset_path,
                    target_prim,
                    state,
                    kind: CompositionArcKind::Payload,
                });
            }
            for inh in stage.inherits_in(prim_path).map_err(map_c_error)? {
                inherits_arcs.push(CompositionArc {
                    source_prim: inh.source_prim,
                    asset_path: inh.asset_path,
                    target_prim: inh.target_prim.unwrap_or_default(),
                    state: CompositionArcState::Loaded,
                    kind: CompositionArcKind::Inherits,
                });
            }
            for spec in stage.specializes_in(prim_path).map_err(map_c_error)? {
                specializes_arcs.push(CompositionArc {
                    source_prim: spec.source_prim,
                    asset_path: spec.asset_path,
                    target_prim: spec.target_prim.unwrap_or_default(),
                    state: CompositionArcState::Loaded,
                    kind: CompositionArcKind::Specializes,
                });
            }
        }

        for p in &skipped_owned {
            let target_prim = p.target_prim.clone().unwrap_or_default();
            if !payload_seen.insert((
                p.source_prim.clone(),
                p.asset_path.clone(),
                target_prim.clone(),
            )) {
                continue;
            }
            let state = classify_payload(
                &unresolved_set,
                &skipped_pairs,
                &p.asset_path,
                &p.source_prim,
                policy,
            );
            payloads.push(CompositionArc {
                source_prim: p.source_prim.clone(),
                asset_path: p.asset_path.clone(),
                target_prim,
                state,
                kind: CompositionArcKind::Payload,
            });
        }

        let time_codes_per_second = stage.authored_time_codes_per_second();
        let frames_per_second = stage.authored_frames_per_second();
        let start_time_code = stage.authored_start_time_code();
        let end_time_code = stage.authored_end_time_code();
        let comment = stage.comment();
        let root_layer_is_binary = stage.root_layer_is_binary().unwrap_or(false);

        // #29 — detailed layer stack (subLayers hierarchy only).
        let raw_stack = stage.layer_stack();
        let layers: Vec<LayerInfo> = raw_stack
            .into_iter()
            .map(|l| LayerInfo {
                identifier: l.identifier,
                depth: l.depth,
                muted: l.muted,
                time_offset: l.time_offset,
                time_scale: l.time_scale,
                comment: l.comment,
            })
            .collect();

        Ok(StageInspection {
            path: path.display().to_string(),
            default_prim,
            up_axis,
            meters_per_unit,
            time_codes_per_second,
            frames_per_second,
            start_time_code,
            end_time_code,
            comment,
            root_layer_is_binary,
            root_prims,
            composed_layers,
            layers,
            references,
            payloads,
            inherits: inherits_arcs,
            specializes: specializes_arcs,
            variant_selection_arcs,
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

        let all_prims = stage.traverse().map_err(map_c_error)?;
        let root_prim_count = all_prims.iter().filter(|p| is_root_prim_path(p)).count();

        let mut mesh_count = 0usize;
        let mut payload_count = 0usize;
        let mut has_variants = false;
        let mut variant_set_count = 0usize;
        let mut total_vertices = 0usize;
        let mut total_triangles = 0usize;
        // #38 reference / payload resolution counters.
        let mut resolved_reference_count = 0usize;
        let mut unresolved_reference_count = 0usize;
        let mut resolved_payload_count = 0usize;
        let mut unresolved_payload_count_stat = 0usize;
        let mut unloaded_payload_count = 0usize;
        let mut payload_seen = HashSet::<(String, String, String)>::new();

        // Histogram keyed by USD `typeName`. We use a Vec rather than a
        // HashMap to keep first-seen ordering — the inspector renders
        // entries directly and stable ordering across reloads is nicer
        // than alphabetical churn. Linear search is fine because the
        // unique-type fan-out is small (typical stages have under 30
        // distinct typeName tokens even at production scale).
        let mut prim_type_counts: Vec<PrimTypeCount> = Vec::new();

        // #38: unresolved assets set for arc classification.
        let unresolved_assets = filter_resolvable_relative_assets(
            path,
            stage.layer_identifiers().map_err(map_c_error)?,
            stage.unresolved_assets().map_err(map_c_error)?,
        );
        let unresolved_set: HashSet<&str> = unresolved_assets.iter().map(String::as_str).collect();

        // #38: skipped payloads for NoPayloads policy classification.
        let skipped_owned = stage.skipped_payloads().map_err(map_c_error)?;
        let skipped_pairs: HashSet<(&str, &str)> = skipped_owned
            .iter()
            .map(|a| (a.asset_path.as_str(), a.source_prim.as_str()))
            .collect();

        for prim_path in &all_prims {
            // Skip the pseudo-root: it has no authored typeName and
            // would just bloat the histogram with an empty key.
            if prim_path == "/" {
                continue;
            }

            if let Some(type_name) = stage.prim_type_name(prim_path) {
                if !type_name.is_empty() {
                    if let Some(slot) = prim_type_counts
                        .iter_mut()
                        .find(|c| c.type_name == type_name)
                    {
                        slot.count += 1;
                    } else {
                        prim_type_counts.push(PrimTypeCount {
                            type_name,
                            count: 1,
                        });
                    }
                }
            }

            if stage.prim_type_is_mesh(prim_path) {
                mesh_count += 1;
                // Vertex count = points / 3. Triangle count is the
                // post-fan-triangulation total for non-triangular faces
                // (face with N vertices triangulates into N-2 tris).
                // Both the Rust fork backend and the cpp backend expose
                // points / faceVertexCounts, so we read them here once
                // per mesh prim and accumulate.
                let points = stage.mesh_points(prim_path);
                if !points.is_empty() {
                    total_vertices += points.len() / 3;
                }
                let counts = stage.mesh_face_vertex_counts(prim_path);
                for n in counts {
                    if n >= 3 {
                        total_triangles += (n as usize) - 2;
                    }
                }
            }
            // #38: classify reference arcs.
            for r in stage.references_in(prim_path).map_err(map_c_error)? {
                if classify_reference(&unresolved_set, &r.asset_path)
                    == CompositionArcState::Missing
                {
                    unresolved_reference_count += 1;
                } else {
                    resolved_reference_count += 1;
                }
            }
            // #38: classify payload arcs.
            let payloads = stage.payloads_in(prim_path).map_err(map_c_error)?;
            for p in &payloads {
                let target_prim = p.target_prim.clone().unwrap_or_default();
                payload_seen.insert((p.source_prim.clone(), p.asset_path.clone(), target_prim));
                let state = classify_payload(
                    &unresolved_set,
                    &skipped_pairs,
                    &p.asset_path,
                    &p.source_prim,
                    policy,
                );
                match state {
                    CompositionArcState::Missing => unresolved_payload_count_stat += 1,
                    CompositionArcState::Loaded => resolved_payload_count += 1,
                    // Unloaded (NoPayloads policy) still counts toward
                    // payload_count but not resolved/unresolved stats.
                    CompositionArcState::Unloaded => unloaded_payload_count += 1,
                }
            }
            if !payloads.is_empty() {
                payload_count += payloads.len();
            }
            if stage.prim_has_variants(prim_path) {
                has_variants = true;
                variant_set_count += stage.variant_set_names(prim_path).len();
            }
        }

        for p in &skipped_owned {
            let target_prim = p.target_prim.clone().unwrap_or_default();
            if !payload_seen.insert((p.source_prim.clone(), p.asset_path.clone(), target_prim)) {
                continue;
            }
            payload_count += 1;
            match classify_payload(
                &unresolved_set,
                &skipped_pairs,
                &p.asset_path,
                &p.source_prim,
                policy,
            ) {
                CompositionArcState::Missing => unresolved_payload_count_stat += 1,
                CompositionArcState::Loaded => resolved_payload_count += 1,
                CompositionArcState::Unloaded => unloaded_payload_count += 1,
            }
        }

        // #38: duration_seconds = (end - start) / fps, only when all
        // three time metadata fields are authored on the root layer.
        let fps = stage.authored_frames_per_second();
        let start = stage.authored_start_time_code();
        let end = stage.authored_end_time_code();
        let duration_seconds = match (start, end, fps) {
            (Some(s), Some(e), Some(f)) if f > 0.0 => Some((e - s) / f),
            _ => None,
        };

        let warnings: Vec<String> = unresolved_assets
            .into_iter()
            .map(|a| format!("unresolved asset: {a}"))
            .collect();

        Ok(StageSummary {
            path: path.display().to_string(),
            layer_count,
            root_prim_count,
            mesh_count,
            payload_count,
            unloaded_payload_count,
            has_variants,
            prim_type_counts,
            total_vertices,
            total_triangles,
            variant_set_count,
            duration_seconds,
            resolved_reference_count,
            unresolved_reference_count,
            resolved_payload_count,
            unresolved_payload_count: unresolved_payload_count_stat,
            warnings,
            load_policy: policy,
        })
    }

    fn collect_asset_issues(&self, path: &StdPath) -> Result<Vec<AssetIssue>, UsdError> {
        // Asset issues inspect the fully-loaded stage so problems inside
        // payload layers are not hidden from the sidebar diagnostics.
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

        let unresolved_owned = filter_resolvable_relative_assets(
            path,
            stage.layer_identifiers().map_err(map_c_error)?,
            stage.unresolved_assets().map_err(map_c_error)?,
        );
        let unresolved_set: HashSet<&str> = unresolved_owned.iter().map(String::as_str).collect();

        // Walk arcs and emit one contextualized issue per missing
        // reference / payload, tracking which asset paths we've
        // already attributed so the generic fallback below doesn't
        // double-report them.
        let mut covered = HashSet::<String>::new();

        for prim_path in stage.traverse().map_err(map_c_error)? {
            for r in stage.references_in(&prim_path).map_err(map_c_error)? {
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
            for p in stage.payloads_in(&prim_path).map_err(map_c_error)? {
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
        // This is a routing check, not a render pass. Keep payloads
        // deferred so heavy stages can decide quickly whether the JS
        // USDLoader path is safe.
        let stage = Self::open(path, StageLoadPolicy::NoPayloads)?;
        if stage.root_layer_is_binary().unwrap_or(false) {
            return Ok(true);
        }
        // Same rule as the Rust fork: more than one composed layer
        // means the USDA root depends on an external file the
        // Three.js USDLoader can't pull in, so route to the GLB path.
        if stage.layer_count() > 1 {
            return Ok(true);
        }
        if !stage.skipped_payloads().map_err(map_c_error)?.is_empty() {
            return Ok(true);
        }
        Ok(false)
    }

    fn inspect_prim(&self, path: &StdPath, prim_path: &str) -> Result<PrimInspection, UsdError> {
        let stage = Self::open(path, StageLoadPolicy::LoadAll)?;

        // Attributes
        let attr_names = stage.prim_attribute_names(prim_path);
        let mut attributes = Vec::with_capacity(attr_names.len());
        for name in &attr_names {
            let type_name = stage
                .prim_attribute_type_name(prim_path, name)
                .unwrap_or_default();
            let value_summary = stage
                .prim_attribute_value_summary(prim_path, name)
                .unwrap_or_default();
            let variability = stage
                .prim_attribute_variability(prim_path, name)
                .unwrap_or_else(|| "varying".to_string());
            let custom = stage.prim_attribute_is_custom(prim_path, name);
            let time_sample_count = stage.prim_attribute_time_sample_count(prim_path, name);
            attributes.push(AttributeInfo {
                name: name.clone(),
                type_name,
                value_summary,
                variability,
                custom,
                time_sample_count,
            });
        }

        // Relationships
        let rel_names = stage.prim_relationship_names(prim_path);
        let mut relationships = Vec::with_capacity(rel_names.len());
        for name in &rel_names {
            let targets = stage.prim_relationship_targets(prim_path, name);
            relationships.push(RelationshipInfo {
                name: name.clone(),
                targets,
            });
        }

        // Metadata
        let meta_keys = stage.prim_metadata_keys(prim_path).map_err(map_c_error)?;
        let mut metadata = Vec::with_capacity(meta_keys.len());
        for key in &meta_keys {
            let value_summary = stage
                .prim_metadata_value_summary(prim_path, key)
                .unwrap_or_default();
            metadata.push(MetadataEntry {
                key: key.clone(),
                value_summary,
            });
        }

        Ok(PrimInspection {
            prim_path: prim_path.to_string(),
            attributes,
            relationships,
            metadata,
        })
    }

    fn inspect_attribute_time_samples(
        &self,
        path: &StdPath,
        prim_path: &str,
        attr_name: &str,
        max_samples: usize,
    ) -> Result<AttributeTimeSamples, UsdError> {
        let stage = Self::open(path, StageLoadPolicy::LoadAll)?;
        let total_count = stage.prim_attribute_time_sample_count(prim_path, attr_name);
        let cap = if max_samples == 0 {
            total_count
        } else {
            max_samples
        };
        let raw_pairs = stage
            .prim_attribute_time_samples(prim_path, attr_name, cap)
            .map_err(map_c_error)?;

        let samples: Vec<TimeSampleEntry> = raw_pairs
            .iter()
            .map(|(t, v)| TimeSampleEntry {
                time: *t,
                value_summary: v.clone(),
            })
            .collect();

        // Attempt to derive numeric statistics by parsing value_summary
        // as f64. Works for scalar float/double/int attributes; array
        // attributes produce "[N elements]" which won't parse, so we
        // get None for those types.
        let numeric_values: Vec<f64> = samples
            .iter()
            .filter_map(|s| s.value_summary.parse::<f64>().ok())
            .collect();

        let (numeric_min, numeric_max, numeric_mean) = if numeric_values.is_empty() {
            (None, None, None)
        } else {
            let min = numeric_values.iter().cloned().fold(f64::INFINITY, f64::min);
            let max = numeric_values
                .iter()
                .cloned()
                .fold(f64::NEG_INFINITY, f64::max);
            let mean = numeric_values.iter().sum::<f64>() / numeric_values.len() as f64;
            (Some(min), Some(max), Some(mean))
        };

        Ok(AttributeTimeSamples {
            prim_path: prim_path.to_string(),
            attribute_name: attr_name.to_string(),
            samples,
            total_count,
            numeric_min,
            numeric_max,
            numeric_mean,
        })
    }
}

impl UsdGeometryBackend for OpenusdCppBackend {
    fn extract_geometry_glb(
        &self,
        path: &StdPath,
        policy: StageLoadPolicy,
    ) -> Result<Vec<u8>, UsdError> {
        let total_started = Instant::now();
        let open_started = Instant::now();
        let stage = Self::open(path, policy)?;
        log_usd_timing("stage open", open_started);
        let extract_started = Instant::now();
        let options = ExtractGeometryOptions::from(policy);
        let result = extract_from_stage_with_options(&stage, path, &options);
        log_usd_timing("extract from open stage", extract_started);
        log_usd_timing("extract_geometry_glb total", total_started);
        result
    }

    /// #31: options-aware override. Opens the stage, applies variant
    /// selections via `set_variant_selection` on the stage's session
    /// layer, then runs the full geometry extraction pipeline. Stateless:
    /// the stage handle is opened fresh on every call.
    fn extract_geometry_glb_with_options(
        &self,
        path: &StdPath,
        options: &ExtractGeometryOptions,
    ) -> Result<Vec<u8>, UsdError> {
        let total_started = Instant::now();
        let open_started = Instant::now();
        let stage = Self::open(path, options.policy)?;
        log_usd_timing("stage open", open_started);
        let extract_started = Instant::now();
        let result = extract_from_stage_with_options(&stage, path, options);
        log_usd_timing("extract from open stage", extract_started);
        log_usd_timing("extract_geometry_glb_with_options total", total_started);
        result
    }
}

impl UsdSourceBackend for OpenusdCppBackend {
    fn flatten_stage(&self, path: &StdPath) -> Result<String, UsdError> {
        // Use LoadAll so every composition arc is included in the
        // flattened output, matching `usdcat --flatten` semantics.
        let stage = Self::open(path, StageLoadPolicy::LoadAll)?;
        stage
            .flatten()
            .map_err(|error| UsdError::Parse(error.to_string()))
    }
}

impl UsdLightBackend for OpenusdCppBackend {
    fn inspect_usd_lights(&self, path: &StdPath) -> Result<Vec<UsdLightInfo>, UsdError> {
        let stage = Self::open(path, StageLoadPolicy::LoadAll)?;
        let lights = stage.lights();
        let result = lights
            .into_iter()
            .map(|l| UsdLightInfo {
                prim_path: l.prim_path,
                light_kind: l.light_kind,
                color: l.color,
                intensity: l.intensity,
                exposure: l.exposure,
                color_temperature: l.color_temperature,
                specular: l.specular,
                diffuse: l.diffuse,
                dome_texture_file: l.dome_texture_file,
                shaping_cone: l.shaping_cone.map(|c| ShapingCone {
                    angle: c.angle,
                    softness: c.softness,
                }),
            })
            .collect();
        Ok(result)
    }
}

impl UsdSessionBackend for OpenusdCppBackend {
    // ---- #44 session methods -----------------------------------------------

    fn open_stage_session(
        &self,
        path: &StdPath,
        policy: StageLoadPolicy,
    ) -> Result<crate::usd::stage_state::OpenStage, UsdError> {
        let stage = Self::open(path, policy)?;
        Ok(crate::usd::stage_state::OpenStage::Cpp(
            std::sync::Mutex::new(stage),
        ))
    }

    fn load_payload(
        &self,
        stage: &crate::usd::stage_state::OpenStage,
        prim_path: &str,
    ) -> Result<(), UsdError> {
        match stage {
            crate::usd::stage_state::OpenStage::Cpp(mutex) => {
                let locked = mutex
                    .lock()
                    .map_err(|_| UsdError::Parse("stage Mutex was poisoned".to_string()))?;
                locked
                    .load_prim(prim_path)
                    .map_err(|e| UsdError::Parse(e.0))
            }
            #[cfg(feature = "backend-openusd-rs")]
            crate::usd::stage_state::OpenStage::Rust(_) => Err(UsdError::Parse(
                "load_payload: Rust stage handle passed to C++ backend".to_string(),
            )),
        }
    }

    fn unload_payload(
        &self,
        stage: &crate::usd::stage_state::OpenStage,
        prim_path: &str,
    ) -> Result<(), UsdError> {
        match stage {
            crate::usd::stage_state::OpenStage::Cpp(mutex) => {
                let locked = mutex
                    .lock()
                    .map_err(|_| UsdError::Parse("stage Mutex was poisoned".to_string()))?;
                locked
                    .unload_prim(prim_path)
                    .map_err(|e| UsdError::Parse(e.0))
            }
            #[cfg(feature = "backend-openusd-rs")]
            crate::usd::stage_state::OpenStage::Rust(_) => Err(UsdError::Parse(
                "unload_payload: Rust stage handle passed to C++ backend".to_string(),
            )),
        }
    }

    fn extract_geometry_from_session(
        &self,
        stage: &crate::usd::stage_state::OpenStage,
        stage_path: &StdPath,
        options: &ExtractGeometryOptions,
    ) -> Result<Vec<u8>, UsdError> {
        // Pass the original stage path through to the extractor so the
        // texture loader can open USDZ archives and resolve relative
        // asset paths. The session stores the original path; the Tauri
        // command layer hands it to us alongside the stage handle.
        match stage {
            crate::usd::stage_state::OpenStage::Cpp(mutex) => {
                let locked = mutex
                    .lock()
                    .map_err(|_| UsdError::Parse("stage Mutex was poisoned".to_string()))?;
                extract_from_stage_with_options(&locked, stage_path, options)
            }
            #[cfg(feature = "backend-openusd-rs")]
            crate::usd::stage_state::OpenStage::Rust(_) => Err(UsdError::Parse(
                "extract_geometry_from_session: Rust stage handle passed to C++ backend"
                    .to_string(),
            )),
        }
    }
}

fn extract_from_stage_with_options(
    stage: &CStage,
    path: &StdPath,
    options: &ExtractGeometryOptions,
) -> Result<Vec<u8>, UsdError> {
    let setup_started = Instant::now();
    // #44: when the caller provides variant selections (e.g. the session
    // path also routes through here after a payload toggle), push them to
    // the stage's session layer before traversal so the GLB reflects the
    // user's variant choices. The stateless path opens a fresh stage and
    // reaches this helper directly; the session path needs the same apply
    // step to avoid silently reverting to authored variants on every
    // payload load/unload.
    apply_and_validate_variant_selections(stage, &options.variant_selections)?;
    let all_stage_prims = stage.traverse().map_err(map_c_error)?;
    let skipped_payload_sources: Vec<String> = if options.policy == StageLoadPolicy::NoPayloads {
        let mut sources: Vec<String> = stage
            .skipped_payloads()
            .map_err(map_c_error)?
            .into_iter()
            .map(|payload| payload.source_prim)
            .collect();
        if sources.is_empty() {
            for prim_path in &all_stage_prims {
                for payload in stage.payloads_in(prim_path).map_err(map_c_error)? {
                    sources.push(payload.source_prim);
                }
            }
        }
        sources
    } else {
        Vec::new()
    };

    // Z-up → Y-up baked into every mesh's world matrix so the GLB
    // is self-describing on the viewer side. Matches the Rust
    // fork backend's convention.
    let up_axis_correction = match stage.up_axis() {
        Some(UpAxis::Z) => Some(z_up_to_y_up_mat4()),
        _ => None,
    };
    log_usd_timing("extract setup", setup_started);

    let collect_meshes_started = Instant::now();
    // Pass 1: collect every Mesh prim. We use two sub-passes:
    //   a) `prim_is_renderable_mesh` — already handles active /
    //      visibility / purpose={default,render} via UsdGeomImageable.
    //   b) A second pass picks up purpose={proxy,guide} meshes that
    //      `prim_is_renderable_mesh` would skip. We record these with
    //      their purpose token so the GLB node extras can tag them for
    //      frontend dynamic visibility (#32).
    // Active/visibility filtering for (b) is best-effort: a proxy mesh
    // inside an invisible or deactivated parent is still included; the
    // frontend's purposeModes default (render=true, proxy=false,
    // guide=false) hides them by default, so any over-inclusion is not
    // user-visible at startup.
    let all_instance_proxy_prims = stage.traverse_instance_proxies().map_err(map_c_error)?;
    let direct_children_by_parent = index_direct_children(&all_instance_proxy_prims);
    let mut mesh_paths = Vec::new();
    let mut mesh_path_set = HashSet::new();
    for prim_path in &all_instance_proxy_prims {
        if stage.prim_is_renderable_mesh(prim_path) {
            mesh_path_set.insert(prim_path.clone());
            mesh_paths.push(prim_path.clone());
        }
    }

    // Collect proxy/guide meshes not covered by prim_is_renderable_mesh.
    // NOTE (known limitation, #32): `prim_attr_token` reads the authored
    // attribute on the prim itself and does not resolve USD purpose
    // inheritance from ancestor Xforms. A mesh whose purpose is set via an
    // ancestor will therefore not appear in this pass. Additionally, the
    // active/invisible checks from `prim_is_renderable_mesh` are not
    // repeated here, so a proxy/guide mesh under an invisible imageable
    // will still be extracted. Both gaps require C-shim or USD API changes
    // to fix properly and are deferred.
    for prim_path in &all_instance_proxy_prims {
        if mesh_path_set.contains(prim_path.as_str()) || !stage.prim_type_is_mesh(prim_path) {
            continue;
        }
        let purpose = stage
            .prim_attr_token(prim_path, "purpose")
            .unwrap_or_default();
        if purpose == "proxy" || purpose == "guide" {
            mesh_path_set.insert(prim_path.clone());
            mesh_paths.push(prim_path.clone());
        }
    }

    // Drop "leaked" root prims from referenced / payloaded layers
    // when the stage authors a defaultPrim. Matches the Rust
    // backend's filter — without it you see duplicate meshes at
    // the origin from the raw root of each referenced layer.
    if let Some(dp) = stage.default_prim() {
        let prefix = format!("/{dp}/");
        let root_path = format!("/{dp}");
        mesh_paths.retain(|p| p.starts_with(&prefix) || *p == root_path);
    }

    // #41 P2-2 fix: exclude prototype subtree paths from the regular
    // mesh pass. PointInstancer prototypes live as concrete Mesh prims
    // under the instancer; without this filter the regular pass would
    // emit them as standalone geometry alongside the instanced copies,
    // producing visible duplicates at the prototype's authored location
    // plus N instances. The PointInstancer pass below re-builds and
    // pushes prototype meshes into `inputs` directly, so the regular
    // pass needs to skip them.
    let prototype_subtree_paths: std::collections::HashSet<String> = {
        let instancer_paths: Vec<String> = all_stage_prims
            .iter()
            .filter(|p| stage.is_point_instancer(p))
            .cloned()
            .collect();
        let mut set: std::collections::HashSet<String> = std::collections::HashSet::new();
        for inst_path in &instancer_paths {
            for proto_path in stage.point_instancer_prototypes(inst_path) {
                let prefix = format!("{proto_path}/");
                for p in &all_stage_prims {
                    if p == &proto_path || p.starts_with(&prefix) {
                        set.insert(p.clone());
                    }
                }
            }
        }
        set
    };
    if !prototype_subtree_paths.is_empty() {
        mesh_paths.retain(|p| !prototype_subtree_paths.contains(p));
    }

    // Check for PointInstancer prims as a fallback geometry source (#41).
    // If there are no regular meshes but there are PointInstancwers,
    // we still proceed — the PointInstancer pass below will add prototype
    // meshes to `inputs`. We only fail hard if there is truly nothing.
    let has_point_instancers = if mesh_paths.is_empty() {
        all_stage_prims.iter().any(|p| stage.is_point_instancer(p))
    } else {
        false
    };
    log_usd_timing("collect mesh candidates", collect_meshes_started);

    let mesh_candidates_are_deferred = !mesh_paths.is_empty()
        && mesh_paths.iter().all(|value| {
            skipped_payload_sources.iter().any(|source| {
                let descendant_prefix = format!("{source}/");
                value == source || value.starts_with(&descendant_prefix)
            })
        });
    let stage_has_deferred_payload_specs =
        options.policy == StageLoadPolicy::NoPayloads && stage.has_authored_payload_specs();
    let can_export_empty_scene = options.policy == StageLoadPolicy::NoPayloads
        && (!skipped_payload_sources.is_empty() || stage_has_deferred_payload_specs);
    let empty_scene_has_no_mesh_candidates = mesh_paths.is_empty() && can_export_empty_scene;

    if mesh_paths.is_empty() && !has_point_instancers {
        if can_export_empty_scene {
            log::warn!(
                "[usd-cpp] no renderable Mesh prims found in deferred-payload stage; exporting an empty GLB scene"
            );
        } else {
            return Err(UsdError::Parse(
                "no renderable Mesh prims found in stage".to_string(),
            ));
        }
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
    // Phase 2.L: same shape as `material_texture_paths` but for
    // normal maps. The loader pass below populates each slot's
    // `MaterialInput.normal_texture` after deduping across the
    // combined texture pool, so a single asset shared by two
    // channels embeds only once.
    let mut material_normal_paths: Vec<Option<String>> = vec![None];
    // Phase 2.N: metallic/roughness channel. Same layout as the
    // other two; if a slot has a shared ORM texture asset, this
    // is where it lands.
    let mut material_metal_rough_paths: Vec<Option<String>> = vec![None];

    // Phase 2.G: UsdSkel skin resolution. A first pass walks
    // meshes, resolves each bound Skeleton via the shim, and
    // builds a dedup'd `SkinInput`. `mesh_skin_slots` parallels
    // `mesh_paths`. The Z-up→Y-up correction is applied to bind /
    // rest transforms so the skeleton hierarchy ends up in the
    // same Y-up space the mesh node matrices target.
    let up_correction_f32: Option<[f32; 16]> = up_axis_correction.as_ref().map(mat4_f64_to_f32);
    let skin_started = Instant::now();
    let mut skins: Vec<glb::SkinInput> = Vec::new();
    let mut skin_slots: std::collections::HashMap<String, usize> = std::collections::HashMap::new();
    let mut animations: Vec<glb::AnimationInput> = Vec::new();
    let mut mesh_skin_slots: Vec<Option<usize>> = vec![None; mesh_paths.len()];
    for (i, prim_path) in mesh_paths.iter().enumerate() {
        let Some(skel_path) = stage.mesh_bound_skeleton(prim_path) else {
            continue;
        };
        let slot = if let Some(&existing) = skin_slots.get(&skel_path) {
            existing
        } else {
            let Some(skin_input) =
                build_skin_input_cpp(&stage, &skel_path, up_correction_f32.as_ref())
            else {
                continue;
            };
            let joint_names = skin_input.joint_names.clone();
            let s = skins.len();
            skins.push(skin_input);
            skin_slots.insert(skel_path.clone(), s);
            // Phase 2.G.3: resolve the bound SkelAnimation (if
            // any) and flatten its samples into a
            // `glb::AnimationInput`. Runs once per skin so a
            // stage that shares one rig across many meshes
            // produces exactly one animation channel bundle.
            if let Some(anim_input) = build_animation_input_cpp(&stage, &skel_path, s, &joint_names)
            {
                animations.push(anim_input);
            }
            s
        };
        mesh_skin_slots[i] = Some(slot);
    }
    log_usd_timing("resolve skins and animations", skin_started);

    let mesh_extract_started = Instant::now();
    let mut inputs: Vec<MeshInput> = Vec::with_capacity(mesh_paths.len());
    // Phase 2.O: parallel tracking for the blend-shape weight-
    // animation attach pass that runs after every MeshInput has
    // been produced. Each record ties an authored mesh to the
    // MeshInput indices it contributed (subsets fan out), plus
    // the blend-shape channel names in the order they were fed
    // into `mesh_data_to_input` — glTF `morph_targets` inherit
    // that ordering and the animation weights must be remapped
    // into it before emission.
    struct MorphRecord {
        mesh_path: String,
        channel_names: Vec<String>,
        mesh_input_indices: Vec<usize>,
    }
    let mut morph_records: Vec<MorphRecord> = Vec::new();

    for (mesh_idx, prim_path) in mesh_paths.iter().enumerate() {
        let Some(mut raw) = build_mesh_data_from_shim(&stage, prim_path) else {
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
        validate_mesh_topology(&sdf_path, &raw)?;

        // Phase 2.G: apply the per-mesh `skel:joints` override,
        // remapping the mesh's `primvars:skel:jointIndices` into
        // the bound Skeleton's full joint order (what glTF
        // `skin.joints` exposes). Apple ARKit exports (chameleon /
        // seahorse) use this heavily — skipping it leaves
        // eyeball / tongue meshes pointing at the wrong joint
        // and produces the "exploded" look.
        let mut skin_slot = mesh_skin_slots[mesh_idx];
        if let Some(slot) = skin_slot {
            let local_joints = stage.mesh_skel_joints(prim_path);
            if !local_joints.is_empty() {
                if let Some(skin) = skins.get(slot) {
                    remap_mesh_skin_indices(&mut raw, &local_joints, &skin.joint_names);
                }
            }
        }
        // Post-remap sanity: if none of the local `skel:joints`
        // matched the bound skeleton, `remap_mesh_skin_indices`
        // zeroes every weight → the skinned mesh collapses to
        // the origin. That's worse than falling back to the
        // static-xform path, so drop the skin payload entirely
        // in that case. Matches the graceful-degradation intent
        // of the Rust fork's remap comment.
        let all_weights_zero = raw
            .joint_weights
            .as_ref()
            .map(|w| !w.is_empty() && w.iter().all(|&x| x == 0.0))
            .unwrap_or(false);
        if all_weights_zero {
            raw.joint_indices = None;
            raw.joint_weights = None;
            raw.joints_per_vertex = 0;
            skin_slot = None;
        }

        // Clamp joint indices to the skeleton's joint count so
        // `mesh_data_to_input` doesn't reject the mesh. Matches
        // the max_joint parameter the Rust backend passes.
        let max_joint = skin_slot
            .and_then(|si| skins.get(si))
            .map(|s| s.joint_names.len())
            .unwrap_or(usize::MAX);

        // Phase 2.I.2: materialBind GeomSubsets split the mesh
        // into per-face partitions, each with its own material
        // binding. Seahorse / Kitchen_set use this pattern
        // heavily. When subsets are present, emit one MeshInput
        // per subset (filtered by faceIndices); when absent,
        // fall through to the whole-mesh path.
        // Phase 2.G.4: resolve any blend-shape targets on this
        // mesh once, so both the whole-mesh and per-subset
        // branches below can feed them into `mesh_data_to_input`.
        // Point count is derived from the raw (pre-triangulated)
        // MeshData since sparse `pointIndices` reference the
        // original vertex order.
        let point_count = raw.points.len() / 3;
        let blend_shapes = resolve_blend_shapes_cpp(&stage, prim_path, point_count);

        // Track MeshInput indices emitted by this mesh path so
        // the post-loop morph-weight attach can target all of
        // them (subsets fan out; a single blend-shape animation
        // drives every piece).
        let record_start = inputs.len();

        let direct_children = direct_children_by_parent
            .get(prim_path.as_str())
            .map_or(&[][..], Vec::as_slice);
        let subsets = collect_material_bind_subsets(stage, direct_children)?;
        let display_opacity_cpp = read_display_opacity_cpp(&stage, prim_path);
        let display_opacity_values: Option<&[f32]> = display_opacity_cpp
            .as_ref()
            .map(|(values, _)| values.as_slice());
        let display_opacity_kind = display_opacity_cpp
            .as_ref()
            .and_then(|(_, interp)| scalar_attribute_kind_cpp(*interp));
        if subsets.is_empty() {
            let raw_for_input = mesh_data_without_constant_display_color_for_opacity_cpp(
                &raw,
                display_opacity_values.is_some(),
            );
            let mesh_input_data = raw_for_input.as_ref().unwrap_or(&raw);
            let mut triangulated = mesh_data_to_input(
                &sdf_path,
                world_f32,
                mesh_input_data,
                orientation,
                max_joint,
                &blend_shapes,
                display_opacity_values,
                display_opacity_kind,
            )?;
            let bound_slot = resolve_material_slot_cpp(
                &stage,
                prim_path,
                &mut materials,
                &mut material_slots,
                &mut material_texture_paths,
                &mut material_normal_paths,
                &mut material_metal_rough_paths,
            );
            triangulated.material_index = apply_display_color_fallback(
                bound_slot,
                &raw,
                prim_path,
                &mut materials,
                &mut material_slots,
                &mut material_texture_paths,
                &mut material_normal_paths,
                Some(&mut material_metal_rough_paths),
            );
            apply_vertex_alpha_blend(&triangulated, &mut materials);
            triangulated.skin_index = skin_index_from_payload(&triangulated, skin_slot);
            // #32: attach the USD purpose token for dynamic
            // frontend visibility toggle.
            triangulated.purpose = Some(
                stage
                    .prim_attr_token(prim_path, "purpose")
                    .unwrap_or_else(|| "default".to_string()),
            );
            inputs.push(triangulated);
        } else {
            for subset in &subsets {
                let filtered = filter_mesh_by_face_indices(&raw, &subset.face_indices);
                let subset_opacity_vec = display_opacity_cpp.as_ref().map(|(op, interp)| {
                    filter_display_opacity_for_subset(
                        op,
                        &raw,
                        &subset.face_indices,
                        scalar_attribute_kind_cpp(*interp),
                    )
                });
                let subset_opacity_cpp: Option<&[f32]> = subset_opacity_vec.as_deref();
                let Ok(subset_sdf_path) = SdfPath::new(&subset.path) else {
                    continue;
                };
                // Subsets share the outer mesh's point buffer, so
                // the blend shapes computed above still index
                // correctly into `filtered.points`. No filter is
                // needed on the delta arrays — `mesh_data_to_input`
                // indexes blend shapes by point index during its
                // triangle-soup expansion, using whatever points
                // land in the emitted primitive.
                let filtered_for_input = mesh_data_without_constant_display_color_for_opacity_cpp(
                    &filtered,
                    subset_opacity_cpp.is_some(),
                );
                let subset_mesh_input_data = filtered_for_input.as_ref().unwrap_or(&filtered);
                let Ok(mut tri) = mesh_data_to_input(
                    &subset_sdf_path,
                    world_f32,
                    subset_mesh_input_data,
                    orientation,
                    max_joint,
                    &blend_shapes,
                    subset_opacity_cpp,
                    display_opacity_kind,
                ) else {
                    continue;
                };
                // Binding is authored on the GeomSubset prim, not
                // the parent mesh — look it up at the subset path
                // so each partition picks up its own material.
                let bound_slot = resolve_material_slot_cpp(
                    &stage,
                    &subset.path,
                    &mut materials,
                    &mut material_slots,
                    &mut material_texture_paths,
                    &mut material_normal_paths,
                    &mut material_metal_rough_paths,
                );
                tri.material_index = apply_display_color_fallback(
                    bound_slot,
                    &filtered,
                    &subset.path,
                    &mut materials,
                    &mut material_slots,
                    &mut material_texture_paths,
                    &mut material_normal_paths,
                    Some(&mut material_metal_rough_paths),
                );
                apply_vertex_alpha_blend(&tri, &mut materials);
                tri.skin_index = skin_index_from_payload(&tri, skin_slot);
                // #32: subsets inherit parent mesh's purpose.
                tri.purpose = Some(
                    stage
                        .prim_attr_token(prim_path, "purpose")
                        .unwrap_or_else(|| "default".to_string()),
                );
                inputs.push(tri);
            }
        }

        // Phase 2.O: record this mesh's blend-shape channel
        // order + the MeshInput indices it contributed, so the
        // attach pass below can emit `MorphWeightChannel`s.
        if !blend_shapes.is_empty() {
            let indices: Vec<usize> = (record_start..inputs.len()).collect();
            if !indices.is_empty() {
                morph_records.push(MorphRecord {
                    mesh_path: prim_path.clone(),
                    channel_names: blend_shapes.iter().map(|b| b.name.clone()).collect(),
                    mesh_input_indices: indices,
                });
            }
        }
    }
    log_usd_timing("extract regular meshes", mesh_extract_started);

    // `inputs` may be empty here for a PointInstancer-only stage;
    // prototype meshes are added in the #41 pass below. We defer the
    // empty check until after that pass.
    let regular_mesh_count = inputs.len();

    // Phase 2.O: attach `UsdSkelAnimation.blendShapeWeights`
    // time samples as glTF weight-animation channels. Runs after
    // the mesh loop because we need MeshInput indices (subsets
    // fan out) to target the right glTF node. Each morph record
    // maps back to its animated skeleton by path-matching; the
    // weights are remapped from the animation's `blendShapes`
    // order into the mesh's own morph-target order so a mesh
    // that authors blend shapes out-of-order or a subset of
    // what the animation drives still animates correctly.
    for animation in &mut animations {
        let skin_idx = animation.skin_index;
        let Some((skel_path, _)) = skin_slots
            .iter()
            .find(|(_, &idx)| idx == skin_idx)
            .map(|(p, i)| (p.clone(), *i))
        else {
            continue;
        };
        let Some(anim_path) = stage.skel_animation_source(&skel_path) else {
            continue;
        };
        let anim_blend_shapes = stage.prim_attr_token_array(&anim_path, "blendShapes");
        if anim_blend_shapes.is_empty() {
            continue;
        }
        let times_usd = stage.skel_anim_times(&anim_path);
        if times_usd.is_empty() {
            continue;
        }
        // Pre-sample once per frame so we don't cross the FFI
        // boundary `frames × records × targets` times.
        let per_frame: Vec<Vec<f32>> = times_usd
            .iter()
            .map(|&t| stage.skel_anim_blend_shape_weights_at(&anim_path, t as f64))
            .collect();

        for record in &morph_records {
            // Limit each record to the animation that actually
            // drives its bound skeleton — one stage can host
            // multiple (skeleton, animation) pairs and the
            // weights must not cross-contaminate.
            let Some(rec_skel) = stage.mesh_bound_skeleton(&record.mesh_path) else {
                continue;
            };
            if rec_skel != skel_path {
                continue;
            }
            let target_count = record.channel_names.len();
            if target_count == 0 {
                continue;
            }
            let anim_idx_for: Vec<Option<usize>> = record
                .channel_names
                .iter()
                .map(|n| anim_blend_shapes.iter().position(|a| a == n))
                .collect();
            // No mesh→anim channel overlap → skip (would emit
            // all-zero weights, which drops the mesh to rest).
            if anim_idx_for.iter().all(|x| x.is_none()) {
                continue;
            }
            let mut flat: Vec<f32> = Vec::with_capacity(times_usd.len() * target_count);
            for frame in &per_frame {
                for &maybe_anim_i in &anim_idx_for {
                    match maybe_anim_i {
                        Some(ai) => flat.push(frame.get(ai).copied().unwrap_or(0.0)),
                        None => flat.push(0.0),
                    }
                }
            }
            for &mi_idx in &record.mesh_input_indices {
                animation.weight_channels.push(glb::MorphWeightChannel {
                    mesh_index: mi_idx,
                    weights: flat.clone(),
                });
            }
        }
    }

    // ---- #41 PointInstancer pass -----------------------------------
    //
    // Traverses all prims to find UsdGeomPointInstancer prims. For
    // each instancer:
    //   1. Skip if `visibility = "invisible"` is authored on the
    //      instancer prim itself (ancestor inheritance is deferred).
    //   2. Compose `composite_inst_world = upAxis * world_xform_of(instancer)`
    //      so the per-instance TRS reflects the instancer's parent chain.
    //   3. For each instance: bake `composite_inst_world * (T·R·S of i)`,
    //      decompose back to TRS for `EXT_mesh_gpu_instancing`. Skip
    //      individual instances whose scale is non-finite.
    //   4. Filter `invisibleIds` against authored `ids` when present,
    //      falling back to zero-based array indices per USD semantics.
    //   5. Resolve `prototypes` rel; for each prototype index, partition
    //      the instance arrays by `protoIndices[i] == proto_idx`. For
    //      each Mesh prim under the prototype subtree, compose the
    //      prototype-internal local xform onto the instance TRS so the
    //      mesh's position within the prototype subtree is preserved.
    //
    // Instance-level picking is out of MVP scope (issue #41 follow-up).
    // The instancer prim itself gets no NodeInput here (flat C++ layout);
    // the EXT_mesh_gpu_instancing node carries the prototype mesh index.
    let mut instancing_inputs: Vec<InstancingInput> = Vec::new();
    {
        let instancing_started = Instant::now();
        // #41: mirror the defaultPrim filter the regular mesh pass
        // applies above so PointInstancer prims that leak from
        // referenced / payloaded layer roots don't end up emitting
        // duplicate geometry outside the authored defaultPrim subtree.
        let default_prim_filter: Option<(String, String)> = stage
            .default_prim()
            .map(|dp| (format!("/{dp}"), format!("/{dp}/")));
        let all_prims = stage.traverse().map_err(map_c_error)?;
        let instancer_paths: Vec<String> = all_prims
            .into_iter()
            .filter(|p| {
                if let Some((root, prefix)) = &default_prim_filter {
                    if !(p == root || p.starts_with(prefix)) {
                        return false;
                    }
                }
                stage.is_point_instancer(p)
            })
            .collect();

        for inst_path in &instancer_paths {
            // #41: skip instancers authored as invisible. We only
            // probe the instancer prim itself, not its ancestors —
            // ancestor visibility inheritance through UsdGeomImageable
            // would need either a C-shim helper or an ancestor walk
            // and is deferred to a follow-up. This still catches the
            // common case where a level-design tool stamps
            // `visibility = "invisible"` on the instancer prim
            // directly to gate it.
            let viz = stage
                .prim_attr_token(inst_path, "visibility")
                .unwrap_or_default();
            if viz == "invisible" {
                log::warn!("[usd-cpp] PointInstancer {inst_path} authored as invisible; skipping");
                continue;
            }

            // Collect per-instance TRS from the shim.
            let positions_flat = stage.point_instancer_positions(inst_path);
            let orientations_flat = stage.point_instancer_orientations(inst_path);
            let scales_flat = stage.point_instancer_scales(inst_path);
            let proto_indices = stage.point_instancer_proto_indices(inst_path);
            let authored_ids = stage.point_instancer_ids(inst_path);
            let invisible_ids: std::collections::HashSet<i64> = stage
                .point_instancer_invisible_ids(inst_path)
                .into_iter()
                .collect();

            let instance_count = proto_indices.len();
            if instance_count == 0 || positions_flat.len() < instance_count * 3 {
                log::warn!(
                    "[usd-cpp] PointInstancer {inst_path}: no instances or no positions, skipping"
                );
                continue;
            }

            // #41 P1-1 fix: compose the instancer's world transform (its
            // own xform plus every ancestor's) with the up-axis
            // correction and bake it into each instance's TRS. Without
            // this an instancer parented under a non-identity Xform
            // would render its instances at the wrong place / orientation
            // because positions / orientations are authored in the
            // instancer's local space.
            let inst_world_f64 = stage
                .prim_world_matrix(inst_path)
                .unwrap_or_else(identity_mat4);
            let composite_world_f64 = match up_axis_correction.as_ref() {
                Some(corr) => mat4_mul(corr, &inst_world_f64),
                None => inst_world_f64,
            };
            let composite_world_f32 = mat4_f64_to_f32(&composite_world_f64);

            // Convert flat buffers to per-instance arrays, composing each
            // local TRS with the instancer world matrix and decomposing
            // back to TRS for EXT_mesh_gpu_instancing.
            let mut translations: Vec<[f32; 3]> = Vec::new();
            let mut rotations: Vec<[f32; 4]> = Vec::new();
            let mut scales_out: Vec<[f32; 3]> = Vec::new();
            // Parallel array: which prototype this instance references.
            let mut instance_proto_idx: Vec<i32> = Vec::new();

            for i in 0..instance_count {
                let instance_id = authored_ids.get(i).copied().unwrap_or(i as i64);
                if invisible_ids.contains(&instance_id) {
                    continue;
                }

                let px = positions_flat[i * 3];
                let py = positions_flat[i * 3 + 1];
                let pz = positions_flat[i * 3 + 2];

                let (qx, qy, qz, qw) = if orientations_flat.len() >= instance_count * 4 {
                    let b = i * 4;
                    (
                        orientations_flat[b],
                        orientations_flat[b + 1],
                        orientations_flat[b + 2],
                        orientations_flat[b + 3],
                    )
                } else {
                    (0.0_f32, 0.0, 0.0, 1.0)
                };

                let (sx, sy, sz) = if scales_flat.len() >= instance_count * 3 {
                    let b = i * 3;
                    (scales_flat[b], scales_flat[b + 1], scales_flat[b + 2])
                } else {
                    (1.0_f32, 1.0, 1.0)
                };

                if !sx.is_finite()
                    || !sy.is_finite()
                    || !sz.is_finite()
                    || sx <= 0.0
                    || sy <= 0.0
                    || sz <= 0.0
                {
                    log::warn!(
                            "[usd-cpp] PointInstancer {inst_path} instance {i} has invalid scale ({sx},{sy},{sz}); skipping instance"
                        );
                    continue;
                }

                // Build local TRS matrix (column-major) and compose with
                // the instancer's world matrix.
                let local_mat = trs_to_mat4_f32([px, py, pz], [qx, qy, qz, qw], [sx, sy, sz]);
                let world_mat = mat4_mul_f32(&composite_world_f32, &local_mat);
                let (t, r, s) = glb::decompose_trs_column_major(&world_mat);

                // Decomposition can yield a negative scale component when
                // the composite world matrix has a flip (negative
                // determinant). EXT_mesh_gpu_instancing TRS cannot
                // represent mirroring cleanly — Three.js InstancedMesh
                // would render those instances inside-out — so we drop
                // them. The TRS gate doc claim now holds end-to-end.
                if !s[0].is_finite()
                    || !s[1].is_finite()
                    || !s[2].is_finite()
                    || s[0] <= 0.0
                    || s[1] <= 0.0
                    || s[2] <= 0.0
                {
                    continue;
                }

                translations.push(t);
                rotations.push(r);
                scales_out.push(s);
                instance_proto_idx.push(proto_indices.get(i).copied().unwrap_or(0));
            }

            if translations.is_empty() {
                log::warn!(
                    "[usd-cpp] PointInstancer {inst_path}: empty after filter; skipping instancing"
                );
                continue;
            }

            // Resolve prototype mesh prims and build MeshInputs for them.
            // #41 P1-2 fix: filter per-prototype using `protoIndices`.
            // Each prototype only receives the subset of instances whose
            // protoIndices[i] equals the prototype's index in the
            // `prototypes` rel — without this every prototype would
            // appear at every instance location.
            let proto_paths = stage.point_instancer_prototypes(inst_path);
            for (proto_idx, proto_path) in proto_paths.iter().enumerate() {
                let mut my_t: Vec<[f32; 3]> = Vec::new();
                let mut my_r: Vec<[f32; 4]> = Vec::new();
                let mut my_s: Vec<[f32; 3]> = Vec::new();
                for (out_idx, &pi) in instance_proto_idx.iter().enumerate() {
                    if pi >= 0 && (pi as usize) == proto_idx {
                        my_t.push(translations[out_idx]);
                        my_r.push(rotations[out_idx]);
                        my_s.push(scales_out[out_idx]);
                    }
                }
                if my_t.is_empty() {
                    continue;
                }

                let all_stage_prims = stage.traverse().map_err(map_c_error)?;
                let proto_prefix = format!("{proto_path}/");
                let proto_mesh_prims: Vec<String> = all_stage_prims
                    .into_iter()
                    .filter(|p| {
                        (p == proto_path || p.starts_with(&proto_prefix))
                            && stage.prim_type_is_mesh(p)
                    })
                    .collect();

                // #41 prototype-local-xform: per USD semantics each
                // instance is `M_inst_world * inst_TRS * proto_local`
                // where `proto_local = inv(inst_world) * proto_mesh_world`
                // — the mesh's xform expressed in the *instancer's*
                // coordinate frame, NOT the prototype root's. Using
                // `inv(proto_root_world)` would strip any xform authored
                // on the prototype root prim itself (a common pattern
                // when the prototype root has its own translate/rotate
                // ops or is an Xform wrapping a transformed mesh).
                let inv_inst_world_f32 = invert_mat4_f32(&mat4_f64_to_f32(&inst_world_f64))
                    .unwrap_or_else(|| mat4_f64_to_f32(&identity_mat4()));

                for proto_mesh_path in &proto_mesh_prims {
                    // TODO (#41 follow-up): split prototype meshes by
                    // GeomSubset material bindings. Direct bindings are
                    // resolved below so prototypes with authored mesh-level
                    // materials no longer fall back to the gray preview slot.
                    let Some(raw_proto) = build_mesh_data_from_shim(&stage, proto_mesh_path) else {
                        continue;
                    };

                    let proto_mesh_world = stage
                        .prim_world_matrix(proto_mesh_path)
                        .unwrap_or_else(identity_mat4);
                    let proto_mesh_world_f32 = mat4_f64_to_f32(&proto_mesh_world);
                    // proto_local = inv(inst_world) * proto_mesh_world
                    let proto_local = mat4_mul_f32(&inv_inst_world_f32, &proto_mesh_world_f32);

                    // Re-bake the per-instance TRS by composing
                    //   composite_inst_world * instance_local * proto_local
                    // and decomposing back. We rebuild on every
                    // prototype mesh because proto_local differs per
                    // mesh prim.
                    let mut prim_t: Vec<[f32; 3]> = Vec::with_capacity(my_t.len());
                    let mut prim_r: Vec<[f32; 4]> = Vec::with_capacity(my_t.len());
                    let mut prim_s: Vec<[f32; 3]> = Vec::with_capacity(my_t.len());
                    for ((t, r), s) in my_t.iter().zip(my_r.iter()).zip(my_s.iter()) {
                        let inst_local = trs_to_mat4_f32(*t, *r, *s);
                        // The per-instance values already include the
                        // composite_inst_world bake from earlier; we
                        // multiply by proto_local on the right to put
                        // the prototype-internal xform on the mesh side.
                        let composed = mat4_mul_f32(&inst_local, &proto_local);
                        let (ct, cr, cs) = glb::decompose_trs_column_major(&composed);
                        if !cs[0].is_finite()
                            || !cs[1].is_finite()
                            || !cs[2].is_finite()
                            || cs[0] <= 0.0
                            || cs[1] <= 0.0
                            || cs[2] <= 0.0
                        {
                            continue;
                        }
                        prim_t.push(ct);
                        prim_r.push(cr);
                        prim_s.push(cs);
                    }
                    if prim_t.is_empty() {
                        continue;
                    }

                    let world_f32 = mat4_f64_to_f32(&identity_mat4());

                    let orientation = match stage.mesh_orientation(proto_mesh_path) {
                        Orientation::LeftHanded => MeshOrientation::LeftHanded,
                        Orientation::RightHanded => MeshOrientation::RightHanded,
                    };

                    let Ok(sdf_path) = SdfPath::new(proto_mesh_path) else {
                        continue;
                    };
                    validate_mesh_topology(&sdf_path, &raw_proto)?;
                    let Ok(mut proto_input) = mesh_data_to_input(
                        &sdf_path,
                        world_f32,
                        &raw_proto,
                        orientation,
                        usize::MAX,
                        &[],
                        None,
                        None,
                    ) else {
                        continue;
                    };
                    let bound_slot = resolve_material_slot_cpp(
                        &stage,
                        proto_mesh_path,
                        &mut materials,
                        &mut material_slots,
                        &mut material_texture_paths,
                        &mut material_normal_paths,
                        &mut material_metal_rough_paths,
                    );
                    proto_input.material_index = apply_display_color_fallback(
                        bound_slot,
                        &raw_proto,
                        proto_mesh_path,
                        &mut materials,
                        &mut material_slots,
                        &mut material_texture_paths,
                        &mut material_normal_paths,
                        Some(&mut material_metal_rough_paths),
                    );
                    apply_vertex_alpha_blend(&proto_input, &mut materials);

                    let prototype_mesh_idx = inputs.len();
                    inputs.push(proto_input);

                    instancing_inputs.push(InstancingInput {
                        prototype_mesh_idx,
                        parent_node_idx: None,
                        instancer_prim_path: inst_path.clone(),
                        translations: prim_t,
                        rotations: prim_r,
                        scales: prim_s,
                    });
                }
            }
        }
        log_usd_timing("extract point instancers", instancing_started);
    }

    // After the PointInstancer pass, allow a valid empty GLB scene. This
    // happens when the user defers payloads and all renderable geometry lives
    // behind those payloads.
    if inputs.is_empty() {
        if empty_scene_has_no_mesh_candidates
            || (can_export_empty_scene && mesh_candidates_are_deferred)
        {
            log::warn!(
                "[usd-cpp] deferred-payload stage has no usable mesh points; exporting an empty GLB scene"
            );
        } else {
            return Err(UsdError::Parse(
                "all renderable meshes failed to build".to_string(),
            ));
        }
    }
    let _ = regular_mesh_count; // used above for documentation, suppress unused warning

    // Phase 2.F: resolve every material's `inputs:diffuseColor`
    // texture path into actual image bytes and embed them in the
    // GLB. Failures log and fall back to the scalar base color —
    // real assets commonly ship with broken texture references that
    // the user still wants to preview. Search dirs include the
    // stage file's parent plus every composed layer's parent so
    // materials authored in a referenced layer resolve relative to
    // that layer.
    let mut search_dirs: Vec<std::path::PathBuf> = Vec::new();
    let texture_started = Instant::now();
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() {
            search_dirs.push(parent.to_path_buf());
        }
    }
    for layer_id in stage.layer_identifiers().map_err(map_c_error)? {
        let layer_path = StdPath::new(&layer_id);
        if let Some(parent) = layer_path.parent() {
            // Bare-filename layer identifiers (e.g. anonymous
            // layers or a single relative `.usd` path) yield
            // `Some("")`, which would otherwise be pushed as a
            // distinct CWD-relative search dir and shadow real
            // parents. Drop them.
            if !parent.as_os_str().is_empty() && !search_dirs.iter().any(|d| d == parent) {
                search_dirs.push(parent.to_path_buf());
            }
        }
    }

    let mut texture_loader = TextureLoader::new(path, search_dirs);
    let mut textures: Vec<glb::TextureInput> = Vec::new();
    embed_material_textures(
        &mut texture_loader,
        &mut materials,
        &mut textures,
        &material_texture_paths,
        &material_normal_paths,
        Some(&material_metal_rough_paths),
        TextureEmbedLogStyle::OpenUsdCpp,
    );
    log_usd_timing("resolve textures", texture_started);

    // Phase 2.H: resolve UsdLux lights and UsdGeomCamera cameras
    // alongside meshes. Same up-axis baking applies so glTF node
    // matrices stay self-describing.
    let scene_metadata_started = Instant::now();
    let lights = resolve_lights_cpp(&stage, up_axis_correction.as_ref())?;
    let cameras = resolve_cameras_cpp(&stage, up_axis_correction.as_ref())?;

    // #46 (C++ backend): build the prim hierarchy NodeInput tree so the
    // GLB carries Kitchen_set / Sponza-style nested xform graphs rather
    // than a flat scene-root list. The synthetic `__upAxis` root added
    // by `build_glb` carries the Z→Y correction; node local matrices
    // here are pure USD space.
    let node_tree = build_node_tree_cpp(
        &stage,
        &inputs,
        &lights,
        &cameras,
        &skin_slots,
        &instancing_inputs,
    )?;
    log_usd_timing("resolve lights cameras node tree", scene_metadata_started);
    let up_correction_f32 = up_axis_correction.as_ref().map(mat4_f64_to_f32);
    let glb_started = Instant::now();
    let glb = glb::build_glb(
        &node_tree,
        &inputs,
        &materials,
        &textures,
        &skins,
        &animations,
        &lights,
        &cameras,
        up_correction_f32,
        &instancing_inputs,
    )
    .map_err(|e| UsdError::Parse(e.to_string()))?;
    log_usd_timing("serialize glb", glb_started);
    Ok(glb)
}

fn invalid_variant_selection(selection: &VariantSelection) -> UsdError {
    UsdError::InvalidVariantSelection {
        prim_path: selection.prim_path.clone(),
        set_name: selection.set_name.clone(),
        variant_name: selection.variant_name.clone(),
    }
}

fn apply_and_validate_variant_selections(
    stage: &CStage,
    selections: &[VariantSelection],
) -> Result<(), UsdError> {
    let mut first_failed: Option<VariantSelection> = None;
    let mut expected = Vec::<VariantSelection>::new();

    for selection in selections {
        let ok = stage.set_variant_selection(
            &selection.prim_path,
            &selection.set_name,
            &selection.variant_name,
        );
        if !ok && first_failed.is_none() {
            first_failed = Some(selection.clone());
        }

        if let Some(index) = expected.iter().position(|previous| {
            previous.prim_path == selection.prim_path && previous.set_name == selection.set_name
        }) {
            expected.remove(index);
        }
        expected.push(selection.clone());
    }

    if let Some(selection) = first_failed {
        return Err(invalid_variant_selection(&selection));
    }

    for selection in &expected {
        if stage
            .variant_selection(&selection.prim_path, &selection.set_name)
            .as_deref()
            != Some(selection.variant_name.as_str())
        {
            return Err(invalid_variant_selection(selection));
        }
    }

    Ok(())
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
    let uvs = if !uvs_raw.is_empty()
        && !uv_indices.is_empty()
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

    // Phase 2.G: capture any authored skin primvar on the mesh. The
    // outer loop decides whether to use it based on whether a bound
    // skeleton resolves (a mesh with `primvars:skel:jointIndices` but
    // no reachable Skeleton is effectively unrigged for preview
    // purposes).
    let jpv = stage.mesh_joints_per_vertex(prim_path);
    let point_count = points.len() / 3;
    let (joint_indices, joint_weights, joints_per_vertex) = if jpv > 0 {
        let indices_i32 = stage.mesh_joint_indices(prim_path);
        let weights = stage.mesh_joint_weights(prim_path);
        if indices_i32.is_empty() || weights.is_empty() || indices_i32.len() != weights.len() {
            (None, None, 0)
        } else {
            // USD authors int[]; glTF wants u16 (triangulator later
            // truncates to 4 influences / u16). Negative authoring
            // is a schema violation, so clamp to 0 defensively.
            let indices: Vec<u32> = indices_i32
                .into_iter()
                .map(|i| if i < 0 { 0 } else { i as u32 })
                .collect();
            (Some(indices), Some(weights), jpv)
        }
    } else {
        // Phase 2.G rigid-follow: a mesh inside a SkelRoot can
        // author `skel:joints = [<joint>]` (usually a single joint)
        // without any `primvars:skel:jointIndices` primvar. The
        // UsdSkel convention says every vertex is rigidly bound to
        // `skel:joints[0]` with weight 1.0 in that case. Apple ARKit
        // exports (chameleon eyes / tongue, seahorse eye meshes) use
        // this pattern heavily; without synthesis those meshes stay
        // at their bind-pose world matrix while the animated body
        // walks away. Synthesize the full-weight binding here so the
        // rest of the skin pipeline (remap → mesh_data_to_input →
        // skin_index) treats them uniformly.
        // Guard against orphan `skel:joints` authoring (no bound
        // Skeleton on the prim hierarchy). Without this check, a
        // mesh that happens to author `skel:joints` but lives
        // outside a SkelRoot would produce MeshData with a joint
        // payload while the outer loop's `skin_slot` stays `None`,
        // and `glb::build_glb`'s consistency check at glb.rs:346
        // rejects the whole export. Keeping the static-xform
        // fallback path healthy for those assets matters more than
        // recovering from broken rigs.
        let skel_joints = stage.mesh_skel_joints(prim_path);
        let has_bound_skel = stage.mesh_bound_skeleton(prim_path).is_some();
        if has_bound_skel && !skel_joints.is_empty() && point_count > 0 {
            let indices: Vec<u32> = vec![0; point_count];
            let weights: Vec<f32> = vec![1.0; point_count];
            (Some(indices), Some(weights), 1)
        } else {
            (None, None, 0)
        }
    };

    Some(MeshData {
        points,
        face_vertex_counts,
        face_vertex_indices,
        normals,
        uvs,
        joint_indices,
        joint_weights,
        joints_per_vertex,
        display_color,
    })
}

/// Phase 2.G.4: resolve every `UsdSkelBlendShape` target bound to a
/// mesh into a dense per-vertex offset array. Returns `Vec::new()`
/// when the mesh has no blend-shape rig or the authored data is
/// malformed. Mirrors the Rust fork's `resolve_blend_shapes` scope:
/// positions only, no `normalOffsets`, no `inbetweens`.
///
/// Sparse authoring via `pointIndices` is expanded to dense
/// offsets (length = point_count * 3); authored indices past the
/// point count are dropped silently to keep broken assets
/// renderable.
fn resolve_blend_shapes_cpp(
    stage: &CStage,
    mesh_path: &str,
    point_count: usize,
) -> Vec<DenseBlendShape> {
    let targets = stage.prim_rel_targets(mesh_path, "skel:blendShapeTargets");
    if targets.is_empty() {
        return Vec::new();
    }
    // Parallel naming: `skel:blendShapes` gives each channel a
    // stable token so UsdSkelAnimation.blendShapes can find it.
    // Unauthored → fall back to the target prim's leaf name.
    let channel_names = stage.prim_attr_token_array(mesh_path, "skel:blendShapes");

    let mut out = Vec::with_capacity(targets.len());
    for (i, target) in targets.iter().enumerate() {
        // Guard: the rel target must actually be a BlendShape prim.
        // Authored typos pointing at random Xforms are common in
        // production exports — skip rather than propagate garbage.
        if stage.prim_type_name(target).as_deref() != Some("BlendShape") {
            continue;
        }
        let offsets_flat = stage.prim_attr_vec3f_array(target, "offsets");
        if offsets_flat.is_empty() || offsets_flat.len() % 3 != 0 {
            continue;
        }
        let offset_count = offsets_flat.len() / 3;
        let point_indices_i32 = stage.prim_attr_i32_array(target, "pointIndices");

        let mut dense = vec![0.0_f32; point_count * 3];
        if !point_indices_i32.is_empty() {
            // Sparse: offsets[i] applies to pointIndices[i].
            if point_indices_i32.len() != offset_count {
                continue;
            }
            for (pi_raw, k) in point_indices_i32.iter().zip(0..offset_count) {
                let pi = *pi_raw;
                if pi < 0 {
                    continue;
                }
                let pi = pi as usize;
                if pi >= point_count {
                    continue;
                }
                dense[pi * 3] = offsets_flat[k * 3];
                dense[pi * 3 + 1] = offsets_flat[k * 3 + 1];
                dense[pi * 3 + 2] = offsets_flat[k * 3 + 2];
            }
        } else {
            // Dense: offsets.len() must equal point_count.
            if offset_count != point_count {
                continue;
            }
            dense.copy_from_slice(&offsets_flat);
        }

        let name = channel_names
            .get(i)
            .cloned()
            .or_else(|| target.rsplit('/').next().map(|s| s.to_string()))
            .unwrap_or_else(|| format!("blend_shape_{i}"));

        out.push(DenseBlendShape {
            name,
            offsets: dense,
        });
    }
    out
}

/// Phase 2.I.2: one materialBind GeomSubset resolved to its prim
/// path + face indices. `face_indices` drives
/// `filter_mesh_by_face_indices` so the outer mesh's shared point
/// buffer is triangulated once but emitted per subset.
struct GeomSubsetBinding {
    path: String,
    face_indices: Vec<u32>,
}

/// Build a stable, borrowed index of direct prim children from one stage
/// traversal. Root prims are intentionally omitted because the pseudo-root is
/// not a real prim path; their descendants are still indexed under the root
/// prim path as usual.
fn index_direct_children(prim_paths: &[String]) -> HashMap<&str, Vec<&str>> {
    let mut children_by_parent: HashMap<&str, Vec<&str>> = HashMap::new();
    for path in prim_paths {
        if let Some(parent) = parent_prim_path(path) {
            children_by_parent
                .entry(parent)
                .or_default()
                .push(path.as_str());
        }
    }
    children_by_parent
}

/// Enumerate GeomSubset children of a mesh whose `familyName` is
/// `materialBind` (the UsdShadeMaterialBindingAPI convention).
/// Subsets without the right family, with `elementType != "face"`, or
/// with an empty `faceIndices` array are dropped — those cases
/// belong to other subset consumers (proxy geometry, crease masks,
/// etc.) and are out of scope for materialBind splitting.
fn collect_material_bind_subsets(
    stage: &CStage,
    direct_children: &[&str],
) -> Result<Vec<GeomSubsetBinding>, UsdError> {
    let mut out = Vec::new();
    for &p in direct_children {
        if stage.prim_type_name(p).as_deref() != Some("GeomSubset") {
            continue;
        }
        // materialBind family. When unauthored, UsdGeomSubset defaults
        // to an empty family token which we treat as non-materialBind.
        let family = stage.prim_attr_token(p, "familyName").unwrap_or_default();
        if family != "materialBind" {
            continue;
        }
        // Element type defaults to "face"; respect explicit values
        // but accept the unauthored case since the default is what
        // we want anyway.
        let element = stage
            .prim_attr_token(p, "elementType")
            .unwrap_or_else(|| "face".to_string());
        if element != "face" {
            continue;
        }
        let face_indices_i32 = stage.prim_attr_i32_array(p, "indices");
        if face_indices_i32.is_empty() {
            continue;
        }
        let face_indices: Vec<u32> = face_indices_i32
            .into_iter()
            .filter_map(|i| if i >= 0 { Some(i as u32) } else { None })
            .collect();
        if face_indices.is_empty() {
            continue;
        }
        out.push(GeomSubsetBinding {
            path: p.to_string(),
            face_indices,
        });
    }
    Ok(out)
}

fn read_display_opacity_cpp(stage: &CStage, prim_path: &str) -> Option<(Vec<f32>, Interpolation)> {
    let (values, interp) = stage.mesh_display_opacity(prim_path);
    (!values.is_empty()).then_some((values, interp))
}

fn scalar_attribute_kind_cpp(interp: Interpolation) -> Option<ScalarAttributeKind> {
    match interp {
        Interpolation::Constant => Some(ScalarAttributeKind::Constant),
        Interpolation::Uniform => Some(ScalarAttributeKind::Uniform),
        Interpolation::Varying | Interpolation::Vertex => Some(ScalarAttributeKind::Vertex),
        Interpolation::FaceVarying => Some(ScalarAttributeKind::FaceVarying),
        Interpolation::Unknown => None,
    }
}

fn mesh_data_without_constant_display_color_for_opacity_cpp(
    mesh: &MeshData,
    has_display_opacity: bool,
) -> Option<MeshData> {
    if !has_display_opacity || mesh.display_color.as_ref().map(|v| v.len()) != Some(3) {
        return None;
    }
    let mut cloned = mesh.clone();
    cloned.display_color = None;
    Some(cloned)
}

/// Phase 2.G.3: resolve the SkelAnimation bound to a skeleton and
/// flatten its samples into a `glb::AnimationInput`. Returns `None`
/// when the skeleton has no animation source or the source has no
/// time samples.
///
/// USD's `UsdSkelAnimation` may target a *subset* of the full
/// skeleton joints in any order, so each skin joint is looked up by
/// name in the animation's joint list and gets an `Option<Vec<f32>>`
/// channel. Joints not mentioned stay at their rest pose at runtime.
///
/// **Sparse per-frame authoring**: if a given time code yields
/// shorter translations / rotations / scales than the animation's
/// joint list (malformed but seen in the wild), we drop the
/// entire channel for that joint rather than writing in zeros —
/// glTF interpolation on partial [0,0,0,0] quaternions or zero
/// scales looks catastrophic, so preferring rest-pose fallback is
/// safer. Mirrors the Rust fork's `animation_input_from_skel`
/// behavior.
fn build_animation_input_cpp(
    stage: &CStage,
    skel_path: &str,
    skin_index: usize,
    skin_joint_names: &[String],
) -> Option<glb::AnimationInput> {
    let anim_path = stage.skel_animation_source(skel_path)?;
    let times_usd = stage.skel_anim_times(&anim_path);
    if times_usd.is_empty() {
        return None;
    }
    let anim_joints = stage.skel_anim_joints(&anim_path);
    if anim_joints.is_empty() {
        return None;
    }
    let tcps = stage.time_codes_per_second();
    let inv_tcps = if tcps > 0.0 { 1.0 / tcps as f32 } else { 1.0 };
    let times: Vec<f32> = times_usd.iter().map(|&t| t * inv_tcps).collect();
    let frame_count = times.len();

    // Pre-sample every frame's three channels once so the per-joint
    // extraction below only iterates Vec<f32> slices instead of
    // crossing the shim boundary frame×joint times.
    let mut trans_frames: Vec<Vec<f32>> = Vec::with_capacity(frame_count);
    let mut rot_frames: Vec<Vec<f32>> = Vec::with_capacity(frame_count);
    let mut scale_frames: Vec<Vec<f32>> = Vec::with_capacity(frame_count);
    for &t in &times_usd {
        let time_code = t as f64;
        trans_frames.push(stage.skel_anim_translations_at(&anim_path, time_code));
        rot_frames.push(stage.skel_anim_rotations_at(&anim_path, time_code));
        scale_frames.push(stage.skel_anim_scales_at(&anim_path, time_code));
    }

    let anim_index_for: Vec<Option<usize>> = skin_joint_names
        .iter()
        .map(|name| anim_joints.iter().position(|j| j == name))
        .collect();

    let extract_channel = |samples: &[Vec<f32>], stride: usize| -> Vec<Option<Vec<f32>>> {
        anim_index_for
            .iter()
            .map(|maybe_idx| {
                let Some(anim_idx) = *maybe_idx else {
                    return None;
                };
                let mut out = Vec::with_capacity(frame_count * stride);
                for frame in samples.iter().take(frame_count) {
                    let off = anim_idx * stride;
                    if frame.is_empty() || off + stride > frame.len() {
                        return None;
                    }
                    out.extend_from_slice(&frame[off..off + stride]);
                }
                Some(out)
            })
            .collect()
    };

    let translations = extract_channel(&trans_frames, 3);
    let rotations = extract_channel(&rot_frames, 4);
    let scales = extract_channel(&scale_frames, 3);

    Some(glb::AnimationInput {
        name: format!("usd:{anim_path}"),
        times,
        skin_index,
        translations,
        rotations,
        scales,
        // Filled in by `attach_weight_channels_cpp` once the mesh
        // loop has built every `MeshInput` (we need the mesh index
        // to know which glTF node a weight channel targets, and
        // the mesh-to-morph-target mapping is only finalized there).
        weight_channels: Vec::new(),
    })
}

/// Phase 2.G: build a `glb::SkinInput` from the shim's skeleton
/// queries. Returns `None` when the skeleton authors no joints
/// (malformed or empty rig) so the caller can silently drop the
/// mesh's skin hookup and fall back to static rendering.
///
/// Parents are derived from joint token paths using the UsdSkel
/// convention: `/root/hip/leg`'s parent is the joint whose path
/// equals `root/hip` within the same array. Roots (no `/` in the
/// path, or unmatched parent) get `None`.
///
/// Bind / rest transforms are kept in their authored space (the
/// up-axis correction is intentionally not applied here — matches
/// `skin_input_from_skel` on the Rust backend, which relies on the
/// mesh's world matrix carrying the Z-up→Y-up rotation so
/// `meshMatrix * skin(vertex, joints)` stays single-rotate).
fn build_skin_input_cpp(
    stage: &CStage,
    skel_path: &str,
    _up_correction_f32: Option<&[f32; 16]>,
) -> Option<glb::SkinInput> {
    let joints = stage.skel_joints(skel_path);
    if joints.is_empty() {
        return None;
    }
    let joint_count = joints.len();

    let parents = derive_joint_parents(&joints);

    let rest_flat = stage.skel_rest_transforms(skel_path);
    let bind_flat = stage.skel_bind_transforms(skel_path);

    // Unflatten to one 16-element matrix per joint; pad with
    // identity when the source array is short (malformed rigs from
    // hand-authored USD are surprisingly common).
    let rest_local_matrices = unflatten_mat4_or_identity(&rest_flat, joint_count);
    let bind_world_matrices = unflatten_mat4_or_identity(&bind_flat, joint_count);
    let inverse_bind_matrices: Vec<[f32; 16]> = bind_world_matrices
        .iter()
        .map(|m| {
            invert_mat4_f32(m).unwrap_or([
                1.0, 0.0, 0.0, 0.0, //
                0.0, 1.0, 0.0, 0.0, //
                0.0, 0.0, 1.0, 0.0, //
                0.0, 0.0, 0.0, 1.0,
            ])
        })
        .collect();

    // **Phase 2.P**: capture the Skeleton prim's composed world
    // transform so the glTF side can parent every root joint
    // under a wrapper node carrying that transform. glTF's skin
    // formula drops the mesh node's `matrixWorld` on skinned
    // vertices (the shader's implicit `inverse(meshNode.matrixWorld)`
    // prefactor cancels it), so whatever `prim_world_matrix` bakes
    // into the mesh node — ancestor xforms, `metersPerUnit` — is
    // invisible to the rig. Unskinned meshes (e.g. the stick in
    // Apple ARKit's chameleon USDZ) still get the full transform,
    // so without a wrapper the skinned body and the stick end up
    // in wildly different world scales.
    //
    // Baking into the rest matrices alone doesn't work: the
    // animation's TRS tracks overwrite root joint translations per
    // frame, which would strip the bake back out on every
    // playback step. A parent wrapper node leaves the authored
    // rest / animation tracks untouched and lets the scene graph
    // carry the scale down to every joint.
    let skel_root_matrix = stage
        .prim_world_matrix(skel_path)
        .map(|m| mat4_f64_to_f32(&m));

    Some(glb::SkinInput {
        name: format!("usd:{skel_path}"),
        joint_names: joints,
        parents,
        rest_local_matrices,
        inverse_bind_matrices,
        skel_root_matrix,
    })
}

/// Split a flat `[f32]` of `joint_count * 16` values into one 16-
/// element matrix per joint. Short / empty inputs pad with identity.
fn unflatten_mat4_or_identity(flat: &[f32], joint_count: usize) -> Vec<[f32; 16]> {
    const IDENTITY: [f32; 16] = [
        1.0, 0.0, 0.0, 0.0, //
        0.0, 1.0, 0.0, 0.0, //
        0.0, 0.0, 1.0, 0.0, //
        0.0, 0.0, 0.0, 1.0,
    ];
    let mut out = Vec::with_capacity(joint_count);
    for j in 0..joint_count {
        let start = j * 16;
        if start + 16 <= flat.len() {
            let mut m = [0.0_f32; 16];
            m.copy_from_slice(&flat[start..start + 16]);
            out.push(m);
        } else {
            out.push(IDENTITY);
        }
    }
    out
}

/// UsdSkel parent-derivation: joint path tokens use `/` as segment
/// separator, and the parent of `a/b/c` is whichever entry spells
/// exactly `a/b`. Root joints (paths with no `/`) and orphans (parent
/// path not present in the joints array) get `None`. O(n²) but
/// skeletons in practice stay well under 1000 joints.
fn derive_joint_parents(joints: &[String]) -> Vec<Option<usize>> {
    joints
        .iter()
        .map(|j| {
            let Some(sep) = j.rfind('/') else {
                return None;
            };
            let parent_path = &j[..sep];
            joints.iter().position(|p| p == parent_path)
        })
        .collect()
}

/// Phase 2.H: enumerate UsdLux light prims and resolve each to a
/// `glb::LightInput`. Only `DistantLight` (→ directional) and
/// `SphereLight` (→ point) are mapped, matching the Rust backend's
/// scope. Area lights and DomeLights are intentionally skipped —
/// glTF's `KHR_lights_punctual` does not cover them.
fn resolve_lights_cpp(
    stage: &CStage,
    up_correction: Option<&[f64; 16]>,
) -> Result<Vec<glb::LightInput>, UsdError> {
    let mut out = Vec::new();
    for prim_path in stage.traverse().map_err(map_c_error)? {
        let Some(kind) =
            gltf_light_kind_from_usd_type_name(stage.prim_type_name(&prim_path).as_deref())
        else {
            continue;
        };
        let intensity = effective_light_intensity_from_authored(
            stage.prim_attr_float(&prim_path, "inputs:intensity"),
            stage.prim_attr_float(&prim_path, "inputs:exposure"),
        );
        let color = stage
            .prim_attr_color3f(&prim_path, "inputs:color")
            .unwrap_or([1.0, 1.0, 1.0]);
        // Skip (rather than fall back to identity) when the light
        // prim isn't xformable — matches the Rust backend, which
        // `continue`s in the same situation. An identity-matrix
        // fallback would emit a ghost light at the origin for
        // malformed assets and break parity deterministic ordering.
        let Some(mut world) = stage.prim_world_matrix(&prim_path) else {
            continue;
        };
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
    Ok(out)
}

/// Phase 2.H: enumerate `UsdGeomCamera` prims and resolve each to a
/// `glb::CameraInput`. Perspective only; non-perspective projections
/// are skipped like the Rust backend does. Spec defaults kick in
/// when `focalLength` / `horizontalAperture` / `verticalAperture`
/// are unauthored so every camera produces a valid glTF entry.
fn resolve_cameras_cpp(
    stage: &CStage,
    up_correction: Option<&[f64; 16]>,
) -> Result<Vec<glb::CameraInput>, UsdError> {
    let mut out = Vec::new();
    for prim_path in stage.traverse().map_err(map_c_error)? {
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

        // Same skip-on-failure stance as `resolve_lights_cpp`: a
        // non-xformable camera prim is malformed USD, and the Rust
        // backend drops it silently rather than emitting with an
        // identity transform.
        let Some(mut world) = stage.prim_world_matrix(&prim_path) else {
            continue;
        };
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
    Ok(out)
}

/// #46 (C++ backend port): build a topologically-sorted `NodeInput` tree
/// from the prim paths collected by Pass 1. Mirrors `build_node_tree`
/// in `openusd_backend.rs` (Rust fork backend) but uses
/// `CStage::prim_world_matrix` (which delegates to
/// `UsdGeomXformable::ComputeLocalToWorldTransform`) for the world
/// transform queries.
///
/// Z-up→Y-up correction is **not** applied here. `build_glb` inserts a
/// synthetic `__upAxis` node carrying the correction matrix when the
/// returned slice is non-empty; the local matrices below are pure USD
/// space (parent_world⁻¹ × own_world).
fn build_node_tree_cpp(
    stage: &CStage,
    inputs: &[MeshInput],
    lights: &[glb::LightInput],
    cameras: &[glb::CameraInput],
    skin_slots: &std::collections::HashMap<String, usize>,
    instancing: &[glb::InstancingInput],
) -> Result<Vec<glb::NodeInput>, UsdError> {
    use std::collections::{HashMap, HashSet};

    // PointInstancer prototype MeshInputs must not appear in the prim
    // hierarchy: `build_glb` emits them via `EXT_mesh_gpu_instancing`,
    // and the flat-path code already skips standalone scene nodes for
    // these. If we leak them into NodeInput, the prototype shape gets
    // drawn twice — once at its authored location and once per instance.
    let prototype_mesh_set: HashSet<usize> = instancing
        .iter()
        .map(|inst| inst.prototype_mesh_idx)
        .collect();

    let maps = collect_node_payload_maps(
        inputs,
        lights,
        cameras,
        skin_slots,
        |mesh_idx, _| !prototype_mesh_set.contains(&mesh_idx),
        true,
    );

    // Order the NodeInput slice by USD *authored* order rather than
    // lexicographic SdfPath sort. `CStage::traverse` walks the stage
    // depth-first in scene-graph order (matching what usdview shows in
    // its "Prim Hierarchy" panel), so a Kitchen_set whose Props_grp
    // authors `Ceiling_grp / DiningTable_grp / North_grp / West_grp` in
    // that order surfaces here in that order — not the alphabetical
    // C/D/N/W a BTreeMap would produce. Paths in our `path_to_kind` set
    // that are missing from the traverse output (rare; would imply a
    // composition bug) are appended afterwards in lexicographic order
    // so we still emit them deterministically.
    let traversal_paths = stage.traverse().map_err(map_c_error)?;
    let sorted_paths = order_node_paths_by_traversal(&maps, &traversal_paths);

    // Cache world matrices to avoid re-querying the shim for each
    // parent during the local-matrix computation. The shim's
    // `prim_world_matrix` returns `None` for non-Xformable prims
    // (Scope, GeomSubset, materialBind subsets, …). For those we walk
    // up the path until we hit an Xformable ancestor so the prim
    // inherits the nearest authored transform — matching the way
    // pxr's `UsdGeomImageable` traversal would resolve world space.
    // Without this, materialBind GeomSubsets (Seahorse / Kitchen_set)
    // resolve to identity here and `inv(parent) * identity` then
    // negates the parent mesh's transform on the GLB side.
    let mut world_cache: HashMap<String, [f64; 16]> = HashMap::new();
    let mut get_world = |path: &str| -> [f64; 16] {
        if let Some(m) = world_cache.get(path) {
            return *m;
        }
        let mut cur = path.to_string();
        let resolved = loop {
            if let Some(m) = stage.prim_world_matrix(&cur) {
                break m;
            }
            let Some(parent) = parent_prim_path(&cur) else {
                break identity_mat4();
            };
            cur = parent.to_string();
        };
        world_cache.insert(path.to_string(), resolved);
        resolved
    };

    Ok(emit_node_inputs(
        &maps,
        &sorted_paths,
        |path_str, parent_path| {
            let own_world = get_world(path_str);
            let local_mat_f64 = if let Some(parent_path) = parent_path {
                let parent_world = get_world(parent_path);
                if let Some(inv_parent) = invert_mat4_with_threshold(&parent_world, 1e-12) {
                    mat4_mul(&inv_parent, &own_world)
                } else {
                    own_world
                }
            } else {
                own_world
            };
            mat4_f64_to_f32(&local_mat_f64)
        },
    ))
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
    material_normal_paths: &mut Vec<Option<String>>,
    material_metal_rough_paths: &mut Vec<Option<String>>,
) -> usize {
    let Some(mat_path) = stage.prim_bound_material(prim_path) else {
        return 0;
    };
    if let Some(slot) = lookup_material_slot(&mat_path, material_slots) {
        return slot;
    }

    let shader_path = match stage.material_surface_shader(&mat_path) {
        Some(p) => p,
        None => return 0,
    };
    // Accept both the USD-native `UsdPreviewSurface` id and the
    // MaterialX-flavored `ND_UsdPreviewSurface_surfaceshader` the
    // MaterialX standard library emits. Pixar / Apple tools mix
    // and match these; rejecting the MaterialX form silently
    // drops textures on assets like `glove_baseball_mtl_variant.usdz`.
    if !is_preview_surface_shader_id(stage.shader_id(&shader_path).as_deref()) {
        return 0;
    }

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
    let diffuse = stage.shader_input_color3f(&shader_path, "inputs:diffuseColor");
    let opacity = stage.shader_input_float(&shader_path, "inputs:opacity");
    // Phase 2.M: UsdPreviewSurface.opacityThreshold — scalar cutoff
    // in [0, 1]. A non-zero authored value means MASK mode (alpha
    // test). Zero is the UsdPreviewSurface schema default for
    // "no alpha test, BLEND if opacity < 1", which is exactly the
    // behavior downstream `glb::build_glb` falls back to when we
    // leave `alpha_mode = None`.
    let opacity_threshold = stage.shader_input_float(&shader_path, "inputs:opacityThreshold");
    let metallic = stage.shader_input_float(&shader_path, "inputs:metallic");
    let roughness = stage.shader_input_float(&shader_path, "inputs:roughness");
    let emissive = stage.shader_input_color3f(&shader_path, "inputs:emissiveColor");

    // Walk the UsdShade graph for the diffuseColor connection's
    // target shader; if it's a UsdUVTexture, pull its authored
    // `inputs:file` asset path so the outer loop can hand it to the
    // shared TextureLoader. Keeps the scalar fallback path intact
    // when no texture is wired up.
    let diffuse_tex = if has_diffuse_texture {
        resolve_shader_texture_asset(stage, &shader_path, "inputs:diffuseColor")
    } else {
        None
    };

    // Phase 2.L: read wrapS / wrapT from the authored texture sampler.
    // Diffuse remains the source of truth when present to preserve the
    // current one-wrap-per-material policy; normal-only materials fall
    // back to the normal map sampler so their authored wrap is not lost.
    let normal_tex = resolve_shader_texture_asset(stage, &shader_path, "inputs:normal");
    let wrap_source = select_wrap_sampler_source(diffuse_tex.as_ref(), normal_tex.as_ref(), true);
    let wrap_s =
        wrap_source.and_then(|tex| stage.prim_attr_token(&tex.sampler_node, "inputs:wrapS"));
    let wrap_t =
        wrap_source.and_then(|tex| stage.prim_attr_token(&tex.sampler_node, "inputs:wrapT"));

    let mut mi = material_input_from_preview_surface(PreviewSurfaceInput {
        name: &mat_path,
        diffuse_color: diffuse,
        opacity,
        metallic,
        roughness,
        emissive_color: emissive,
        wrap_s: wrap_s.as_deref(),
        wrap_t: wrap_t.as_deref(),
        opacity_threshold: Some(opacity_threshold.unwrap_or(0.0)),
    });

    // Phase 2.L: UsdTransform2d (`inputs:st` hop between the texture
    // node and the PrimvarReader). When present, emit the authored
    // translation / rotation / scale as glTF's KHR_texture_transform.
    // Identity transforms drop back to `None` so the serializer
    // omits the extension.
    apply_resolved_texture_transforms(&mut mi, diffuse_tex.as_ref(), normal_tex.as_ref(), |node| {
        resolve_uv_transform_cpp(stage, node)
    });

    // Phase 2.N: metallic / roughness texture connections. glTF packs
    // both channels into a single `metallicRoughnessTexture`
    // (G = roughness, B = metallic). The common ORM workflow
    // authors both UsdPreviewSurface inputs connected to the *same*
    // texture asset; when that's the case we hand a single shared
    // texture path down and the factor defaults to 1.0 so the
    // shader reads the full texture contribution. Splitting onto
    // two different assets would need runtime pixel combining we
    // don't do in preview; in that case we fall back to scalar
    // factors on whichever channel isn't shared.
    let metallic_tex = resolve_shader_texture_asset(stage, &shader_path, "inputs:metallic");
    let roughness_tex = resolve_shader_texture_asset(stage, &shader_path, "inputs:roughness");
    // glTF packs both channels into one `metallicRoughnessTexture`
    // (G = roughness, B = metallic). We have three meaningful
    // cases to handle without the B / G channels leaking into a
    // channel the user didn't author:
    //
    //   1. Both connected to the SAME asset → canonical ORM.
    //      Emit the texture, neutralize both factors to 1.0 so the
    //      shader reads the full contribution of both channels.
    //   2. Only `inputs:roughness` connected → emit the texture,
    //      but pin `metallic_factor = 0` so glTF's
    //      `metalness = sampled(B) * metallicFactor` collapses to
    //      zero and the B-channel junk in the roughness image
    //      can't leak in as fake metalness. `roughness_factor = 1`
    //      lets the G channel drive roughness normally. This is
    //      the Apple ARKit `_r.jpg` pattern (seahorse uses it).
    //   3. Only `inputs:metallic` connected → there's no
    //      equivalent trick: `roughness = sampled(G) * roughnessFactor`
    //      can't ignore the G channel without emitting a dedicated
    //      extension, and `roughness_factor = 0` would render as a
    //      mirror surface. Fall back to scalar factors and drop
    //      the texture; authored metallic-only textures are rare
    //      enough that this trade-off is acceptable until we grow
    //      runtime pixel combining.
    //   4. Different assets per channel → same fallback as (3).
    let metal_rough_asset = match (metallic_tex.as_ref(), roughness_tex.as_ref()) {
        (Some(m), Some(r)) if m.asset_path == r.asset_path => {
            mi.metallic_factor = 1.0;
            mi.roughness_factor = 1.0;
            Some(m.asset_path.clone())
        }
        (None, Some(r)) => {
            mi.metallic_factor = 0.0;
            mi.roughness_factor = 1.0;
            Some(r.asset_path.clone())
        }
        _ => None,
    };

    register_material_slot(
        &mat_path,
        mi,
        build_material_slot_paths(
            diffuse_tex.map(|t| t.asset_path),
            normal_tex.as_ref(),
            metal_rough_asset,
        ),
        materials,
        material_slots,
        material_texture_paths,
        material_normal_paths,
        Some(material_metal_rough_paths),
    )
}

/// Chase a `UsdPreviewSurface` input connection to the connected
/// texture node and return its `inputs:file` asset path, or `None`
/// if the input isn't connected to a texture we recognize.
///
/// Accepts the USD-native `UsdUVTexture` as well as the MaterialX
/// `ND_image_*` family; both store the asset on `inputs:file` so
/// the caller can feed the result straight into `TextureLoader`
/// without branching per source type.
/// Phase 2.L: resolve a `UsdTransform2d` node attached to a
/// texture node's `inputs:st`, returning a `glb::TextureTransform`
/// ready to emit as `KHR_texture_transform`. Returns `None` when:
///   - `inputs:st` has no connection, or the connected source is
///     not a `UsdTransform2d` (common case: direct PrimvarReader
///     wiring), or
///   - every authored channel matches the schema default (identity
///     transform; emitting the extension would be a no-op).
///
/// USD's UsdTransform2d applies `scale → rotate → translate` in that
/// order, matching glTF's `KHR_texture_transform` convention so the
/// three inputs map 1:1. Rotation is authored in **degrees** per the
/// UsdPreviewSurface spec; convert once to radians here.
fn resolve_uv_transform_cpp(
    stage: &CStage,
    texture_node_path: &str,
) -> Option<glb::TextureTransform> {
    let xform_prim = stage.shader_input_connected_source_prim(texture_node_path, "inputs:st")?;
    texture_transform_from_usd_transform2d(
        stage.shader_id(&xform_prim).as_deref(),
        stage.prim_attr_float2(&xform_prim, "inputs:translation"),
        stage.prim_attr_float(&xform_prim, "inputs:rotation"),
        stage.prim_attr_float2(&xform_prim, "inputs:scale"),
    )
}

type ResolvedTexture = ResolvedTextureSampler<String>;

fn resolve_shader_texture_asset(
    stage: &CStage,
    shader_path: &str,
    input_name: &str,
) -> Option<ResolvedTexture> {
    if !stage.shader_input_has_connection(shader_path, input_name) {
        return None;
    }
    let src = stage.shader_input_connected_source_prim(shader_path, input_name)?;
    resolve_texture_node(stage, &src, 0)
}

/// Walk from a shader prim through MaterialX normal-map wrappers
/// (`ND_normalmap`) into the image-sampler node and pull its
/// `inputs:file` asset path. `UsdUVTexture` and the `ND_image_*`
/// family terminate the walk directly.
///
/// `depth` guards against cyclic graphs — MaterialX's connectable
/// API doesn't forbid them explicitly and authoring mistakes do
/// happen. The shared walker keeps the same bounded behavior this
/// backend used before the R12 extraction.
fn resolve_texture_node(stage: &CStage, prim: &str, depth: u32) -> Option<ResolvedTexture> {
    let graph = CppTextureNodeGraph { stage };
    resolve_texture_sampler_node(&graph, &prim.to_string(), depth)
}

struct CppTextureNodeGraph<'a> {
    stage: &'a CStage,
}

impl TextureNodeGraph for CppTextureNodeGraph<'_> {
    type Node = String;

    fn shader_id(&self, node: &Self::Node) -> Option<String> {
        self.stage.shader_id(node)
    }

    fn shader_input_asset(&self, node: &Self::Node, input_name: &str) -> Option<String> {
        self.stage.shader_input_asset(node, input_name)
    }

    fn shader_input_connected_source(
        &self,
        node: &Self::Node,
        input_name: &str,
    ) -> Option<Self::Node> {
        self.stage
            .shader_input_connected_source_prim(node, input_name)
    }
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

    #[test]
    fn direct_child_index_skips_pseudo_root_and_excludes_nested_descendants() {
        let paths = vec![
            "/World".to_string(),
            "/World/Mesh".to_string(),
            "/World/Mesh/Subset".to_string(),
            "/World/Mesh/Subset/Shader".to_string(),
        ];

        let index = index_direct_children(&paths);

        assert!(!index.contains_key("/"));
        assert_eq!(index.get("/World"), Some(&vec!["/World/Mesh"]));
        assert_eq!(index.get("/World/Mesh"), Some(&vec!["/World/Mesh/Subset"]));
        assert_eq!(
            index.get("/World/Mesh/Subset"),
            Some(&vec!["/World/Mesh/Subset/Shader"])
        );
    }

    #[test]
    fn direct_child_index_preserves_instance_proxy_traversal_order() {
        let paths = vec![
            "/Root".to_string(),
            "/Root/Mesh".to_string(),
            "/Root/Mesh/SubsetB".to_string(),
            "/Root/Mesh/SubsetA".to_string(),
            "/Root/Mesh/SubsetC".to_string(),
        ];

        let index = index_direct_children(&paths);

        assert_eq!(
            index.get("/Root/Mesh"),
            Some(&vec![
                "/Root/Mesh/SubsetB",
                "/Root/Mesh/SubsetA",
                "/Root/Mesh/SubsetC"
            ])
        );
    }
}
