//! Concrete `UsdBackend` implementation backed by the `openusd` crate
//! (yohawing fork of `mxpv/openusd`, branch `yw-look-phase4`).
//!
//! This adapter is intentionally thin: it converts paths, calls the
//! parser, and maps the result into `yw-look`'s wire types in
//! [`super::types`]. Anything richer (heuristics, scoring, UI sorting)
//! belongs in the frontend or a higher layer.

use std::cell::RefCell;
use std::collections::HashSet;
use std::path::Path as StdPath;

use openusd::sdf::schema::FieldKey;
use openusd::sdf::Path as SdfPath;
use openusd::sdf::Value as SdfValue;
use openusd::usd::PrimPredicate;
use openusd::usd::Stage;

mod attribute_samples;
mod blend_shapes;
mod cameras;
mod composition_arcs;
mod extract;
mod lights;
mod material_adapter;
mod mesh_attributes;
mod mesh_visibility;
mod node_tree;
mod point_instancer;
mod session;
mod shader_fields;
mod skel_adapter;
mod stage_fields;
mod stage_query;
mod xform;

use super::asset_resolution::filter_resolvable_relative_assets;
use super::backend::{UsdError, UsdGeometryBackend, UsdInspectBackend};
#[cfg(test)]
use super::extract_shared::srgb_to_linear;
use super::types::{
    AssetIssue, AssetIssueCode, AssetIssueLevel, AttributeTimeSamples, CompositionArc,
    CompositionArcKind, CompositionArcState, ExtractGeometryOptions, LayerInfo, PrimInspection,
    PrimTypeCount, StageCapabilityInfo, StageCapabilityKind, StageCapabilitySupport,
    StageInspection, StageLoadPolicy, StageSummary,
};
use composition_arcs::{payload_arc_state, reference_arc_state};
use extract::extract_geometry_from_open_stage_rs;
#[cfg(test)]
use mesh_visibility::is_renderable_mesh;
use stage_fields::{
    read_root_double_field, read_string_or_token_attribute, read_token_or_string_field,
    token_vec_to_strings, ValidatedStagePathExt,
};
use stage_query::UpAxis;
#[cfg(test)]
use xform::{build_xform_op_matrix, compose_prim_local_xform, read_quat};

pub(super) const LEGACY_TRAVERSE_PREDICATE: PrimPredicate = PrimPredicate::ALL;

#[derive(Default)]
struct StageCapabilityDetection {
    point_instancer: bool,
    material_x: bool,
    skel: bool,
    payload: bool,
    variant_override: bool,
    usd_authored_splat: bool,
}

impl StageCapabilityDetection {
    fn observe_prim(&mut self, stage: &Stage, prim_path: &SdfPath) {
        let Some(type_name) = read_token_or_string_field(stage, prim_path.clone()) else {
            return;
        };

        match type_name.as_str() {
            "PointInstancer" => self.point_instancer = true,
            "Points" => self.usd_authored_splat = true,
            "Skeleton" | "SkelRoot" | "SkelAnimation" | "BlendShape" => self.skel = true,
            _ if type_name.starts_with("Skel") => self.skel = true,
            _ => {}
        }

        if type_name == "Shader" {
            let info_id = prim_path
                .append_property("info:id")
                .ok()
                .and_then(|path| read_string_or_token_attribute(stage, path));
            if info_id.as_deref().is_some_and(is_material_x_shader_id) {
                self.material_x = true;
            }
        }
    }
}

fn is_material_x_shader_id(id: &str) -> bool {
    // MaterialX node identifiers emitted by the USD interchange commonly
    // use the `ND_` namespace. Keep the check intentionally name-based: the
    // Rust backend does not expose a richer MaterialX schema query yet.
    id.starts_with("ND_") || id.starts_with("MaterialX")
}

fn stage_capability_infos(
    detection: StageCapabilityDetection,
    start_time_code: Option<f64>,
    end_time_code: Option<f64>,
) -> Vec<StageCapabilityInfo> {
    const MATERIAL_X_REASON: &str =
        "MaterialX preview is limited to known shader aliases and direct graphs.";
    const SKEL_REASON: &str =
        "UsdSkel preview supports the current GLB skinning path only; arbitrary rig data is not covered.";
    const ANIMATION_RANGE_REASON: &str =
        "Only authored stage start/end metadata is reported; time-varying attributes are not scanned.";
    const VARIANT_OVERRIDE_REASON: &str =
        "Variant session overrides are not supported by the current backend.";
    const USD_AUTHORED_SPLAT_REASON: &str =
        "USD-authored Points/splat geometry is not supported by the preview backend.";

    vec![
        StageCapabilityInfo {
            kind: StageCapabilityKind::PointInstancer,
            detected: detection.point_instancer,
            support: StageCapabilitySupport::Supported,
            reason: String::new(),
        },
        StageCapabilityInfo {
            kind: StageCapabilityKind::MaterialX,
            detected: detection.material_x,
            support: StageCapabilitySupport::Degraded,
            reason: MATERIAL_X_REASON.to_owned(),
        },
        StageCapabilityInfo {
            kind: StageCapabilityKind::Skel,
            detected: detection.skel,
            support: StageCapabilitySupport::Degraded,
            reason: SKEL_REASON.to_owned(),
        },
        StageCapabilityInfo {
            kind: StageCapabilityKind::AnimationRange,
            detected: start_time_code.is_some() && end_time_code.is_some(),
            support: StageCapabilitySupport::Degraded,
            reason: ANIMATION_RANGE_REASON.to_owned(),
        },
        StageCapabilityInfo {
            kind: StageCapabilityKind::Payload,
            detected: detection.payload,
            support: StageCapabilitySupport::Supported,
            reason: String::new(),
        },
        StageCapabilityInfo {
            kind: StageCapabilityKind::VariantOverride,
            detected: detection.variant_override,
            support: StageCapabilitySupport::Unsupported,
            reason: VARIANT_OVERRIDE_REASON.to_owned(),
        },
        StageCapabilityInfo {
            kind: StageCapabilityKind::UsdAuthoredSplat,
            detected: detection.usd_authored_splat,
            support: StageCapabilitySupport::Unsupported,
            reason: USD_AUTHORED_SPLAT_REASON.to_owned(),
        },
    ]
}

/// Real backend backed by `openusd`.
pub struct OpenusdBackend;

impl OpenusdBackend {
    pub fn new() -> Self {
        Self
    }

    /// Opens a stage with a fully tolerant error handler. Phase 1 of this
    /// backend never failed `Stage::open` for partial-resolution scenes
    /// (Kitchen Set in particular references files that the default
    /// resolver can't find from the cwd, but we still want to display
    /// what *did* load). The new fork defaults to a strict handler, so we
    /// install one that swallows both layer-collection failures (missing
    /// asset files) and composition (pcp) failures (references to layers
    /// that the layer collector skipped). Both feed
    /// `Stage::unresolved_assets()` for downstream issue reporting.
    ///
    /// Tolerating composition errors means a structurally broken stage
    /// (cycles, missing default prim) opens silently rather than
    /// producing a hard error — but the same behavior was in place for
    /// the entirety of Phase 1 / Phase 2 and matches the "show as much
    /// as possible" philosophy of the inspector.
    ///
    /// Phase 4: `policy` controls whether payload arcs are composed. The
    /// default (`LoadAll`) reproduces Phase 3 behavior; `NoPayloads`
    /// skips every payload and makes `Stage::skipped_payloads` return
    /// the targeted arcs for UI display.
    fn open(path: &StdPath, policy: StageLoadPolicy) -> Result<Stage, UsdError> {
        let path_str = path
            .to_str()
            .ok_or_else(|| UsdError::Io(format!("non-UTF8 path: {}", path.display())))?;
        stage_query::apply_load_policy(Stage::builder(), policy)
            .open(path_str)
            .map_err(|e| UsdError::Parse(e.to_string()))
    }
}

impl Default for OpenusdBackend {
    fn default() -> Self {
        Self::new()
    }
}

impl UsdInspectBackend for OpenusdBackend {
    fn inspect_stage(
        &self,
        path: &StdPath,
        policy: StageLoadPolicy,
    ) -> Result<StageInspection, UsdError> {
        let stage = Self::open(path, policy)?;

        let default_prim = stage.default_prim().map(|token| token.as_str().to_owned());
        let up_axis = stage_query::up_axis(&stage).map(|axis| match axis {
            UpAxis::Y => "Y".to_string(),
            UpAxis::Z => "Z".to_string(),
        });
        let meters_per_unit = stage_query::meters_per_unit(&stage);

        let root_prims = stage
            .root_prims()
            .map(|prims| token_vec_to_strings(prims))
            .map_err(|e| UsdError::Parse(e.to_string()))?;

        // We expose every collected layer identifier (root layer excluded) as
        // `composedLayers`. This includes all layers that participate in
        // composition (references, payloads, sublayers) — not just authored
        // `subLayers` arcs — which is what the frontend actually needs.
        let layer_ids = stage.layer_identifiers();
        let missing_assets = filter_resolvable_relative_assets(
            path,
            layer_ids.iter().cloned(),
            stage_query::unresolved_assets(&stage),
        );
        let composed_layers: Vec<String> = layer_ids.into_iter().skip(1).collect();

        // Capture unresolved assets upfront so each composition arc can be
        // tagged with its current resolution state. This uses the same
        // exact-string matching as `collect_asset_issues` — any arc whose
        // authored `assetPath` appears in `unresolved_assets()` is reported
        // as `Missing`, everything else is `Loaded`.
        let unresolved_set: HashSet<&str> = missing_assets.iter().map(String::as_str).collect();

        // Phase 4: collect the payload arcs the layer collector skipped
        // under NoPayloads. The key here is `(asset_path, source_prim)`
        // where `source_prim` is the prim that _declares_ the payload
        // arc (`payload = @asset@</target>` is authored on that prim).
        // This matches what `Stage::skipped_payloads` records — the
        // declaring prim, not the target. Matching on the target path
        // (which is what `payloads_in(...).prim_path` returns) would be
        // wrong: a payload like `payload = @foo.usda@</Target>` on
        // `/Root` is stored as `(foo.usda, /Root)`, not `(foo.usda,
        // /Target)`, and a target-based lookup would miss it whenever
        // source and target differ.
        let skipped_payloads = stage_query::skipped_payloads(&stage, policy);
        let skipped_set: HashSet<(String, String)> = skipped_payloads
            .iter()
            .map(|sp| (sp.asset_path.clone(), sp.prim_path.to_string()))
            .collect();

        let references = RefCell::new(Vec::new());
        let payloads = RefCell::new(Vec::new());
        let variant_sets_out = RefCell::new(Vec::<super::types::VariantSetInfo>::new());
        let mut capability_detection = StageCapabilityDetection::default();

        stage
            .traverse(LEGACY_TRAVERSE_PREDICATE, |prim_path| {
                let source = prim_path.as_str().to_string();
                capability_detection.observe_prim(&stage, &prim_path);

                // Collect variant sets for the inspector UI via the public
                // `Prim::variant_sets().get_all_variant_selections()`.
                //
                // USD-NATIVE-01: this used to read the raw authored
                // `variantSetNames` list plus the raw `variantSelection`
                // dictionary, so a variant set with no selection at all
                // (no authored opinion, no fallback, no default) still
                // showed up with `selection: None`. The public accessor
                // only reports variant sets that actually resolved to a
                // composed node, so that authored-but-unselected case no
                // longer appears in the inspector. Every set that *does*
                // show up now always carries a `Some` selection (composed
                // — authored, fallback, or first-variant default).
                if let Ok(selections) = stage
                    .prim_at(prim_path.clone())
                    .variant_sets()
                    .get_all_variant_selections()
                {
                    for (set_name, selection) in selections {
                        capability_detection.variant_override = true;
                        let mut variants =
                            stage_query::variant_names(&stage, prim_path.clone(), &set_name);
                        // Keep the controlled value valid even when the
                        // effective selection came from a composed opinion
                        // that is not present in the authored child list.
                        if !variants.iter().any(|variant| variant == &selection) {
                            variants.insert(0, selection.clone());
                        }
                        variant_sets_out
                            .borrow_mut()
                            .push(super::types::VariantSetInfo {
                                prim_path: source.clone(),
                                set_name,
                                selection: Some(selection),
                                variants,
                            });
                    }
                }

                for r in stage_query::references_in(&stage, prim_path.clone()) {
                    let state = reference_arc_state(&unresolved_set, &r.asset_path);
                    references.borrow_mut().push(CompositionArc {
                        source_prim: source.clone(),
                        asset_path: r.asset_path,
                        target_prim: r.prim_path.to_string(),
                        state,
                        kind: CompositionArcKind::Reference,
                    });
                }
                let prim_payloads = stage_query::payloads_in(&stage, prim_path.clone());
                let has_payloads = !prim_payloads.is_empty();
                for p in prim_payloads {
                    // `source` is the prim that authored the payload
                    // (what `Stage::skipped_payloads` keys on); `p.prim_path`
                    // is the target prim inside the external layer (what the
                    // UI displays as the arc destination). They are usually
                    // but not always the same path.
                    let target_prim = p.prim_path.to_string();
                    let state =
                        payload_arc_state(&unresolved_set, &skipped_set, &p.asset_path, &source);
                    payloads.borrow_mut().push(CompositionArc {
                        source_prim: source.clone(),
                        asset_path: p.asset_path,
                        target_prim,
                        state,
                        kind: CompositionArcKind::Payload,
                    });
                }
                if has_payloads {
                    capability_detection.payload = true;
                }
            })
            .map_err(|e| UsdError::Parse(e.to_string()))?;

        // Stage timing metadata, composed via `Stage::stage_metadata`
        // (session layer honored, same as `up_axis` / `meters_per_unit` in
        // `stage_query.rs`). Each returns `None` when the metadatum is
        // unauthored.
        let time_codes_per_second = read_root_double_field(&stage, FieldKey::TimeCodesPerSecond);
        let frames_per_second = read_root_double_field(&stage, FieldKey::FramesPerSecond);
        let start_time_code = read_root_double_field(&stage, FieldKey::StartTimeCode);
        let end_time_code = read_root_double_field(&stage, FieldKey::EndTimeCode);
        let comment = stage
            .stage_metadata(FieldKey::Comment)
            .ok()
            .flatten()
            .and_then(|v| String::try_from(v).ok())
            .filter(|s| !s.is_empty());
        let root_layer_is_binary = stage_query::root_layer_is_binary(&stage);
        let capabilities =
            stage_capability_infos(capability_detection, start_time_code, end_time_code);

        // #29 — degraded layer info: the Rust fork doesn't expose
        // per-layer muted / offset APIs, so we synthesise LayerInfo
        // entries from composed_layers with identity offset and
        // muted=false. Depth is always 1 for non-root layers since we
        // can't reconstruct the subLayers nesting without the C++ shim.
        let layers: Vec<LayerInfo> = {
            let mut v = Vec::with_capacity(composed_layers.len() + 1);
            // Root layer (depth 0) — use the stage path as identifier.
            v.push(LayerInfo {
                identifier: path.display().to_string(),
                depth: 0,
                muted: false,
                time_offset: 0.0,
                time_scale: 1.0,
                comment: None,
            });
            for id in &composed_layers {
                v.push(LayerInfo {
                    identifier: id.clone(),
                    depth: 1,
                    muted: false,
                    time_offset: 0.0,
                    time_scale: 1.0,
                    comment: None,
                });
            }
            v
        };

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
            references: references.into_inner(),
            payloads: payloads.into_inner(),
            // #30: Rust-fork backend does not expose GetInherits() /
            // GetSpecializes() yet. Return empty Vecs so the wire type
            // is valid; the Rust crate does not expose them yet.
            inherits: Vec::new(),
            specializes: Vec::new(),
            variant_selection_arcs: Vec::new(),
            missing_assets,
            variant_sets: variant_sets_out.into_inner(),
            capabilities,
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
        let root_prim_count = stage
            .root_prims()
            .map_err(|e| UsdError::Parse(e.to_string()))?
            .len();

        let mesh_count = RefCell::new(0usize);
        let payload_count = RefCell::new(0usize);
        let has_variants = RefCell::new(false);
        let variant_set_count = RefCell::new(0usize);
        let total_vertices = RefCell::new(0usize);
        let total_triangles = RefCell::new(0usize);
        let prim_type_counts = RefCell::new(Vec::<PrimTypeCount>::new());
        // #38 reference / payload resolution counters.
        let resolved_reference_count = RefCell::new(0usize);
        let unresolved_reference_count = RefCell::new(0usize);
        let resolved_payload_count = RefCell::new(0usize);
        let unresolved_payload_count_stat = RefCell::new(0usize);
        let mut capability_detection = StageCapabilityDetection::default();

        // #38: build unresolved-asset set upfront so arc classification
        // in the traverse closure can borrow it without moving `stage`.
        let unresolved_assets = filter_resolvable_relative_assets(
            path,
            stage.layer_identifiers(),
            stage_query::unresolved_assets(&stage),
        );
        let unresolved_set: HashSet<&str> = unresolved_assets.iter().map(String::as_str).collect();

        // #38: skipped payloads for NoPayloads policy classification.
        let skipped_payloads = stage_query::skipped_payloads(&stage, policy);
        let skipped_set: HashSet<(String, String)> = skipped_payloads
            .iter()
            .map(|sp| (sp.asset_path.clone(), sp.prim_path.to_string()))
            .collect();

        stage
            .traverse(LEGACY_TRAVERSE_PREDICATE, |prim_path| {
                capability_detection.observe_prim(&stage, &prim_path);
                if let Some(type_name) = read_token_or_string_field(&stage, prim_path.clone()) {
                    if !type_name.is_empty() {
                        let mut buckets = prim_type_counts.borrow_mut();
                        if let Some(slot) = buckets.iter_mut().find(|c| c.type_name == type_name) {
                            slot.count += 1;
                        } else {
                            buckets.push(PrimTypeCount {
                                type_name: type_name.clone(),
                                count: 1,
                            });
                        }
                    }
                    if type_name == "Mesh" {
                        *mesh_count.borrow_mut() += 1;
                        // Read points + faceVertexCounts on this Mesh
                        // prim to accumulate authored vertex / triangle
                        // totals. The values are read directly from the
                        // composed layer stack — we don't need full
                        // `mesh_of` (no skinning / xform / triangulation)
                        // because we're only counting authored data.
                        if let Ok(points_path) = prim_path.append_property("points") {
                            if let Ok(Some(value)) =
                                stage.attribute_at(points_path).get::<SdfValue>()
                            {
                                let count = match value {
                                    SdfValue::Vec3fVec(v) => v.len(),
                                    SdfValue::Vec3dVec(v) => v.len(),
                                    SdfValue::Vec3hVec(v) => v.len(),
                                    _ => 0,
                                };
                                *total_vertices.borrow_mut() += count;
                            }
                        }
                        if let Ok(counts_path) = prim_path.append_property("faceVertexCounts") {
                            if let Ok(Some(SdfValue::IntVec(counts))) =
                                stage.attribute_at(counts_path).get::<SdfValue>()
                            {
                                for n in counts {
                                    if n >= 3 {
                                        *total_triangles.borrow_mut() += (n as usize) - 2;
                                    }
                                }
                            }
                        }
                    }
                }
                // #38: classify reference arcs.
                for r in stage_query::references_in(&stage, prim_path.clone()) {
                    if reference_arc_state(&unresolved_set, &r.asset_path)
                        == CompositionArcState::Missing
                    {
                        *unresolved_reference_count.borrow_mut() += 1;
                    } else {
                        *resolved_reference_count.borrow_mut() += 1;
                    }
                }
                // #38: classify payload arcs.
                let payloads = stage_query::payloads_in(&stage, prim_path.clone());
                for p in &payloads {
                    let source = prim_path.as_str().to_string();
                    let state =
                        payload_arc_state(&unresolved_set, &skipped_set, &p.asset_path, &source);
                    match state {
                        CompositionArcState::Missing => {
                            *unresolved_payload_count_stat.borrow_mut() += 1;
                        }
                        CompositionArcState::Loaded => {
                            *resolved_payload_count.borrow_mut() += 1;
                        }
                        // Unloaded (NoPayloads policy): still contributes
                        // to payload_count but not to resolved/unresolved.
                        CompositionArcState::Unloaded => {}
                    }
                }
                if !payloads.is_empty() {
                    capability_detection.payload = true;
                    *payload_count.borrow_mut() += payloads.len();
                }
                // USD-NATIVE-01: counts composed variant selections via
                // the public API (see the matching comment in
                // `inspect_stage`) rather than the raw authored
                // `variantSetNames` field, so a variant set with no
                // resolved selection no longer contributes to either
                // counter.
                if let Ok(selections) = stage
                    .prim_at(prim_path.clone())
                    .variant_sets()
                    .get_all_variant_selections()
                {
                    if !selections.is_empty() {
                        capability_detection.variant_override = true;
                        *has_variants.borrow_mut() = true;
                        *variant_set_count.borrow_mut() += selections.len();
                    }
                }
            })
            .map_err(|e| UsdError::Parse(e.to_string()))?;

        // #38: duration_seconds = (end - start) / fps, only when all
        // three time metadata fields are authored on the root layer.
        let fps = read_root_double_field(&stage, FieldKey::FramesPerSecond);
        let start = read_root_double_field(&stage, FieldKey::StartTimeCode);
        let end = read_root_double_field(&stage, FieldKey::EndTimeCode);
        let duration_seconds = match (start, end, fps) {
            (Some(s), Some(e), Some(f)) if f > 0.0 => Some((e - s) / f),
            _ => None,
        };

        let warnings: Vec<String> = unresolved_assets
            .into_iter()
            .map(|a| format!("unresolved asset: {a}"))
            .collect();
        let capabilities = stage_capability_infos(capability_detection, start, end);

        Ok(StageSummary {
            path: path.display().to_string(),
            layer_count,
            root_prim_count,
            mesh_count: mesh_count.into_inner(),
            payload_count: payload_count.into_inner(),
            unloaded_payload_count: stage_query::skipped_payloads(&stage, policy).len(),
            has_variants: has_variants.into_inner(),
            prim_type_counts: prim_type_counts.into_inner(),
            total_vertices: total_vertices.into_inner(),
            total_triangles: total_triangles.into_inner(),
            variant_set_count: variant_set_count.into_inner(),
            duration_seconds,
            resolved_reference_count: resolved_reference_count.into_inner(),
            unresolved_reference_count: unresolved_reference_count.into_inner(),
            resolved_payload_count: resolved_payload_count.into_inner(),
            unresolved_payload_count: unresolved_payload_count_stat.into_inner(),
            warnings,
            capabilities,
            load_policy: policy,
        })
    }

    fn root_layer_is_binary(&self, path: &StdPath) -> Result<bool, UsdError> {
        Ok(stage_query::root_layer_is_binary(&Self::open(
            path,
            StageLoadPolicy::LoadAll,
        )?))
    }

    fn requires_glb_preview(&self, path: &StdPath) -> Result<bool, UsdError> {
        let stage = Self::open(path, StageLoadPolicy::LoadAll)?;
        // Binary root → Three.js USDLoader can't parse it at all.
        if stage_query::root_layer_is_binary(&stage) {
            return Ok(true);
        }
        // More than one composed layer → the stage depends on at least
        // one external file (sublayer, reference, or payload). yw-look
        // only hands USDLoader.parse a single text buffer, so every such
        // dependency is invisible on the JS side. Route to GLB.
        if stage.layer_count() > 1 {
            return Ok(true);
        }
        let has_point_instancer = RefCell::new(false);
        stage
            .traverse(LEGACY_TRAVERSE_PREDICATE, |prim_path| {
                if stage
                    .prim_at(prim_path.clone())
                    .type_name()
                    .ok()
                    .flatten()
                    .is_some_and(|type_name| type_name.as_str() == "PointInstancer")
                {
                    *has_point_instancer.borrow_mut() = true;
                }
            })
            .map_err(|error| UsdError::Parse(error.to_string()))?;
        if *has_point_instancer.borrow() {
            return Ok(true);
        }
        // Single self-contained USDA layer — USDLoader handles hierarchy
        // and xform composition better than the GLB flattener, so prefer
        // the JS path.
        Ok(false)
    }

    fn inspect_prim(&self, _path: &StdPath, _prim_path: &str) -> Result<PrimInspection, UsdError> {
        Err(UsdError::Parse(
            "inspect_prim is not supported on the openusd Rust backend".into(),
        ))
    }

    fn inspect_attribute_time_samples(
        &self,
        path: &StdPath,
        prim_path: &str,
        attr_name: &str,
        max_samples: usize,
    ) -> Result<AttributeTimeSamples, UsdError> {
        let stage = Self::open(path, StageLoadPolicy::LoadAll)?;
        attribute_samples::inspect_attribute_time_samples(&stage, prim_path, attr_name, max_samples)
    }

    fn collect_asset_issues(&self, path: &StdPath) -> Result<Vec<AssetIssue>, UsdError> {
        let stage = Self::open(path, StageLoadPolicy::LoadAll)?;
        let mut issues = Vec::new();

        if let Some(mpu) = stage_query::meters_per_unit(&stage) {
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
            stage.layer_identifiers(),
            stage_query::unresolved_assets(&stage),
        );
        let unresolved: HashSet<&str> = unresolved_owned.iter().map(|s| s.as_str()).collect();

        let collected: RefCell<Vec<AssetIssue>> = RefCell::new(Vec::new());
        let covered: RefCell<HashSet<String>> = RefCell::new(HashSet::new());

        stage
            .traverse(LEGACY_TRAVERSE_PREDICATE, |prim_path| {
                let source = prim_path.as_str().to_string();
                for r in stage_query::references_in(&stage, prim_path.clone()) {
                    if reference_arc_state(&unresolved, &r.asset_path)
                        == CompositionArcState::Missing
                    {
                        covered.borrow_mut().insert(r.asset_path.clone());
                        collected.borrow_mut().push(AssetIssue {
                            code: AssetIssueCode::BrokenReference,
                            level: AssetIssueLevel::Error,
                            message: format!("Broken reference: {}", r.asset_path),
                            detail: None,
                            context_path: Some(source.clone()),
                        });
                    }
                }
                for p in stage_query::payloads_in(&stage, prim_path.clone()) {
                    if reference_arc_state(&unresolved, &p.asset_path)
                        == CompositionArcState::Missing
                    {
                        covered.borrow_mut().insert(p.asset_path.clone());
                        collected.borrow_mut().push(AssetIssue {
                            code: AssetIssueCode::MissingPayload,
                            level: AssetIssueLevel::Error,
                            message: format!("Missing payload: {}", p.asset_path),
                            detail: None,
                            context_path: Some(source.clone()),
                        });
                    }
                }
            })
            .map_err(|e| UsdError::Parse(e.to_string()))?;

        issues.extend(collected.into_inner());

        let covered = covered.into_inner();
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
}

impl UsdGeometryBackend for OpenusdBackend {
    fn extract_geometry_glb(
        &self,
        path: &StdPath,
        policy: StageLoadPolicy,
    ) -> Result<Vec<u8>, UsdError> {
        let stage = Self::open(path, policy)?;
        extract_geometry_from_open_stage_rs(&stage, path, &ExtractGeometryOptions::from(policy))
    }

    fn extract_geometry_glb_with_options(
        &self,
        path: &StdPath,
        options: &ExtractGeometryOptions,
    ) -> Result<Vec<u8>, UsdError> {
        if !options.variant_selections.is_empty() {
            eprintln!(
                "[usd-rust] extract_geometry_glb_with_options: variant_selections are \
                 not supported by the Rust openusd backend (degraded mode). The \
                 authored variant selections will be used instead."
            );
        }
        let stage = Self::open(path, options.policy)?;
        extract_geometry_from_open_stage_rs(&stage, path, options)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn tiny_usda() -> PathBuf {
        // tests run with CWD = src-tauri
        PathBuf::from("../samples/assets/usd/tiny.usda")
    }

    /// Returns true when `path` contains only an LFS pointer (i.e. the
    /// environment checked out without `lfs: true`). Tests call this and
    /// return early so CI doesn't fail trying to parse a pointer file.
    fn is_lfs_pointer(path: &PathBuf) -> bool {
        std::fs::read_to_string(path)
            .map(|s| s.starts_with("version https://git-lfs.github.com/spec/v1"))
            .unwrap_or(false)
    }

    fn glb_json(glb: &[u8]) -> serde_json::Value {
        let json_length = u32::from_le_bytes(glb[12..16].try_into().unwrap()) as usize;
        let json = std::str::from_utf8(&glb[20..20 + json_length])
            .expect("GLB JSON UTF-8")
            .trim_end_matches(' ');
        serde_json::from_str(json).expect("GLB JSON")
    }

    fn glb_accessor_f32(
        glb: &[u8],
        document: &serde_json::Value,
        accessor_index: usize,
    ) -> Vec<f32> {
        let accessor = &document["accessors"][accessor_index];
        let view = &document["bufferViews"][accessor["bufferView"].as_u64().unwrap() as usize];
        let component_count = match accessor["type"].as_str().unwrap() {
            "VEC3" => 3,
            "VEC4" => 4,
            other => panic!("unsupported accessor type {other}"),
        };
        let count = accessor["count"].as_u64().unwrap() as usize * component_count;
        let json_length = u32::from_le_bytes(glb[12..16].try_into().unwrap()) as usize;
        let bin_start = 20 + json_length + 8;
        let offset = bin_start
            + view["byteOffset"].as_u64().unwrap_or(0) as usize
            + accessor["byteOffset"].as_u64().unwrap_or(0) as usize;
        (0..count)
            .map(|index| {
                let start = offset + index * 4;
                f32::from_le_bytes(glb[start..start + 4].try_into().unwrap())
            })
            .collect()
    }

    fn instancing_accessor(node: &serde_json::Value, name: &str) -> usize {
        node["extensions"]["EXT_mesh_gpu_instancing"]["attributes"][name]
            .as_u64()
            .expect("instancing accessor") as usize
    }

    #[test]
    fn summarize_tiny_usda() {
        let path = tiny_usda();
        if is_lfs_pointer(&path) {
            eprintln!("SKIP summarize_tiny_usda: tiny.usda is an LFS pointer (checkout without lfs: true)");
            return;
        }
        let backend = OpenusdBackend::new();
        let summary = backend
            .summarize_stage(&path, super::StageLoadPolicy::LoadAll)
            .expect("summarize tiny.usda");
        assert_eq!(summary.layer_count, 1);
        assert_eq!(summary.root_prim_count, 1);
        assert_eq!(summary.mesh_count, 1, "tiny.usda has one Mesh");
        assert_eq!(summary.payload_count, 0);
        assert!(summary.warnings.is_empty());
    }

    #[test]
    fn inspect_tiny_usda() {
        let path = tiny_usda();
        if is_lfs_pointer(&path) {
            eprintln!(
                "SKIP inspect_tiny_usda: tiny.usda is an LFS pointer (checkout without lfs: true)"
            );
            return;
        }
        let backend = OpenusdBackend::new();
        let inspection = backend
            .inspect_stage(&path, super::StageLoadPolicy::LoadAll)
            .expect("inspect tiny.usda");
        assert_eq!(inspection.default_prim.as_deref(), Some("Root"));
        assert_eq!(inspection.up_axis.as_deref(), Some("Y"));
        assert_eq!(inspection.meters_per_unit, Some(0.01));
        assert_eq!(inspection.root_prims, vec!["Root".to_string()]);
        assert!(inspection.references.is_empty());
        assert!(inspection.payloads.is_empty());
        assert!(inspection.missing_assets.is_empty());
    }

    #[test]
    fn stage_capabilities_point_instancer_are_supported_and_shared() {
        let path = PathBuf::from("../samples/assets/usd/tiny_point_instancer.usda");
        let backend = OpenusdBackend::new();
        let summary = backend
            .summarize_stage(&path, super::StageLoadPolicy::LoadAll)
            .expect("summarize PointInstancer fixture");
        let inspection = backend
            .inspect_stage(&path, super::StageLoadPolicy::LoadAll)
            .expect("inspect PointInstancer fixture");

        assert_eq!(summary.capabilities, inspection.capabilities);
        assert_eq!(summary.capabilities.len(), 7);
        let point_instancer = &summary.capabilities[0];
        assert_eq!(point_instancer.kind, StageCapabilityKind::PointInstancer);
        assert!(point_instancer.detected);
        assert_eq!(point_instancer.support, StageCapabilitySupport::Supported);
        assert!(point_instancer.reason.is_empty());
    }

    #[test]
    fn stage_capabilities_cover_points_variants_materialx_skel_and_range() {
        let root =
            std::env::temp_dir().join(format!("yw-look-stage-capabilities-{}", std::process::id()));
        std::fs::create_dir_all(&root).expect("create temp dir");
        let path = root.join("capabilities.usda");
        std::fs::write(
            &path,
            r#"#usda 1.0
(
    defaultPrim = "Root"
    startTimeCode = 1
    endTimeCode = 24
    framesPerSecond = 24
)

def Xform "Root" (
    variants = {
        string look = "blue"
    }
    prepend variantSets = ["look"]
)
{
    variantSet "look" = {
        "red" {
        }
        "blue" {
        }
    }
}

def Points "Cloud"
{
    point3f[] points = [(0, 0, 0)]
}

def Shader "MaterialXShader"
{
    uniform token info:id = "ND_standard_surface_surfaceshader"
}

def Skeleton "Rig"
{
}
"#,
        )
        .expect("write capability fixture");

        let backend = OpenusdBackend::new();
        let summary = backend
            .summarize_stage(&path, super::StageLoadPolicy::LoadAll)
            .expect("summarize capability fixture");
        let inspection = backend
            .inspect_stage(&path, super::StageLoadPolicy::LoadAll)
            .expect("inspect capability fixture");

        let expected_kinds = [
            StageCapabilityKind::PointInstancer,
            StageCapabilityKind::MaterialX,
            StageCapabilityKind::Skel,
            StageCapabilityKind::AnimationRange,
            StageCapabilityKind::Payload,
            StageCapabilityKind::VariantOverride,
            StageCapabilityKind::UsdAuthoredSplat,
        ];
        assert_eq!(summary.capabilities, inspection.capabilities);
        assert_eq!(summary.capabilities.len(), expected_kinds.len());
        assert_eq!(
            summary
                .capabilities
                .iter()
                .map(|entry| entry.kind)
                .collect::<Vec<_>>(),
            expected_kinds
        );
        assert!(summary.capabilities[1].detected);
        assert_eq!(
            summary.capabilities[1].support,
            StageCapabilitySupport::Degraded
        );
        assert!(summary.capabilities[2].detected);
        assert!(summary.capabilities[3].detected);
        assert!(summary.capabilities[5].detected);
        assert!(summary.capabilities[6].detected);
        for entry in &summary.capabilities {
            if matches!(
                entry.support,
                StageCapabilitySupport::Degraded | StageCapabilitySupport::Unsupported
            ) {
                assert!(
                    !entry.reason.is_empty(),
                    "missing reason for {:?}",
                    entry.kind
                );
            }
        }
        assert_eq!(
            summary.capabilities[6].support,
            StageCapabilitySupport::Unsupported
        );

        std::fs::remove_dir_all(root).ok();
    }

    #[test]
    fn extract_point_instancer_emits_prototype_groups_and_visible_trs() {
        let path = PathBuf::from("../samples/assets/usd/tiny_point_instancer.usda");
        let glb = OpenusdBackend::new()
            .extract_geometry_glb(&path, super::StageLoadPolicy::LoadAll)
            .expect("extract PointInstancer fixture");
        let document = glb_json(&glb);
        let nodes = document["nodes"].as_array().expect("GLB nodes");
        let instanced_nodes = nodes
            .iter()
            .filter(|node| node.get("extensions").is_some())
            .collect::<Vec<_>>();

        assert_eq!(
            document["extensionsUsed"],
            serde_json::json!(["EXT_mesh_gpu_instancing"])
        );
        assert_eq!(instanced_nodes.len(), 2);
        assert!(nodes.iter().all(|node| {
            !matches!(
                node["name"].as_str(),
                Some("PrototypeCube" | "PrototypePyramid")
            )
        }));

        let cube = instanced_nodes
            .iter()
            .find(|node| node["name"].as_str().unwrap().contains("PrototypeCube"))
            .expect("cube instances");
        let pyramid = instanced_nodes
            .iter()
            .find(|node| node["name"].as_str().unwrap().contains("PrototypePyramid"))
            .expect("pyramid instances");
        assert_eq!(
            document["accessors"][instancing_accessor(cube, "TRANSLATION")]["count"],
            3
        );
        assert_eq!(
            document["accessors"][instancing_accessor(pyramid, "TRANSLATION")]["count"],
            2
        );
        assert_eq!(
            glb_accessor_f32(&glb, &document, instancing_accessor(cube, "TRANSLATION"),),
            vec![-3.0, 0.0, 0.0, -0.6, 0.0, 0.0, 1.8, 0.0, 0.0]
        );
        assert_eq!(
            glb_accessor_f32(&glb, &document, instancing_accessor(cube, "SCALE")),
            vec![1.0, 1.0, 1.0, 0.75, 0.75, 0.75, 1.25, 1.25, 1.25]
        );
        let pyramid_rotations =
            glb_accessor_f32(&glb, &document, instancing_accessor(pyramid, "ROTATION"));
        assert!((pyramid_rotations[1] - 0.382_683).abs() < 1e-3);
        assert!((pyramid_rotations[3] - 0.923_88).abs() < 1e-3);
        assert!((pyramid_rotations[5] + 0.382_683).abs() < 1e-3);
        assert_eq!(
            glb_accessor_f32(&glb, &document, instancing_accessor(pyramid, "TRANSLATION")),
            vec![-1.8, 0.3, 0.0, 3.0, 0.225, 0.0]
        );
        assert_eq!(cube["extras"]["primPath"], "/Root/Instancer");
        assert_eq!(pyramid["extras"]["primPath"], "/Root/Instancer");
    }

    #[test]
    fn extracts_mesh_from_native_instance_proxy() {
        let temp = tempfile::tempdir().expect("create native instance fixture directory");
        let path = temp.path().join("native_instance.usda");
        std::fs::write(
            &path,
            r#"#usda 1.0
(
    defaultPrim = "Root"
)

def Xform "Root"
{
    def Scope "Prototypes"
    {
        token visibility = "invisible"

        def Xform "Triangle"
        {
            def Mesh "Geometry"
            {
                int[] faceVertexCounts = [3]
                int[] faceVertexIndices = [0, 1, 2]
                point3f[] points = [(0, 0, 0), (1, 0, 0), (0, 1, 0)]
            }
        }
    }

    def Xform "VisibleInstance" (
        instanceable = true
        prepend references = </Root/Prototypes/Triangle>
    )
    {
        double3 xformOp:translate = (2, 3, 4)
        uniform token[] xformOpOrder = ["xformOp:translate"]
    }
}
"#,
        )
        .expect("write native instance fixture");

        let glb = OpenusdBackend::new()
            .extract_geometry_glb(&path, super::StageLoadPolicy::LoadAll)
            .expect("extract native instance fixture");
        let document = glb_json(&glb);
        let nodes = document["nodes"].as_array().expect("GLB nodes");
        let mesh_nodes = nodes
            .iter()
            .filter(|node| node.get("mesh").is_some())
            .collect::<Vec<_>>();

        assert_eq!(document["meshes"].as_array().map(Vec::len), Some(1));
        assert_eq!(mesh_nodes.len(), 1);
        assert_eq!(
            mesh_nodes[0]["extras"]["primPath"],
            "/Root/VisibleInstance/Geometry"
        );
    }

    #[test]
    fn extracts_nested_instance_from_deep_payload_and_reference_targets() {
        let temp = tempfile::tempdir().expect("create nested payload fixture directory");
        std::fs::write(
            temp.path().join("payload.usda"),
            r#"#usda 1.0

def Xform "Root"
{
    def Scope "Prototypes"
    {
        def Xform "Asset"
        {
            def Xform "Nested" (
                instanceable = true
                prepend references = @nested.usda@</Root/Prototypes/NestedRoot>
            )
            {
            }
        }
    }
}
"#,
        )
        .expect("write payload layer");
        std::fs::write(
            temp.path().join("nested.usda"),
            r#"#usda 1.0

def Xform "Root"
{
    def Scope "Prototypes"
    {
        def Xform "NestedRoot"
        {
            def Mesh "Geometry"
            {
                int[] faceVertexCounts = [3]
                int[] faceVertexIndices = [0, 1, 2]
                point3f[] points = [(0, 0, 0), (1, 0, 0), (0, 1, 0)]
            }
        }
    }
}
"#,
        )
        .expect("write nested instance layer");
        std::fs::write(
            temp.path().join("prototypes.usda"),
            r#"#usda 1.0
(
    defaultPrim = "Root"
)

def Xform "Root"
{
    def Scope "Prototypes"
    {
        token visibility = "invisible"

        def Xform "Asset" (
            payload = @payload.usda@</Root/Prototypes/Asset>
        )
        {
        }
    }
}
"#,
        )
        .expect("write prototype layer");
        std::fs::write(
            temp.path().join("scene.usda"),
            r#"#usda 1.0

def Xform "Root"
{
    def Xform "Tags"
    {
        def Xform "Placed" (
        instanceable = true
            prepend references = </Root/Prototypes/Asset>
        )
        {
        }
    }
}
"#,
        )
        .expect("write scene layer");
        let root_path = temp.path().join("root.usda");
        std::fs::write(
            &root_path,
            r#"#usda 1.0
(
    defaultPrim = "Root"
    subLayers = [
        @scene.usda@,
        @prototypes.usda@
    ]
)
"#,
        )
        .expect("write root layer");
        let path = temp.path().join("top.usda");
        std::fs::write(
            &path,
            r#"#usda 1.0
(
    defaultPrim = "World"
)

def Xform "World"
{
    def Xform "PROJECTORS" (
        variants = {
            string activeScene = "Merge"
        }
        prepend variantSets = "activeScene"
    )
    {
        variantSet "activeScene" = {
            "Merge" {
                def Xform "projector_1F" (
                    prepend references = @root.usda@
                )
                {
                }
            }
        }
    }
}
"#,
        )
        .expect("write outer variant layer");

        let glb = OpenusdBackend::new()
            .extract_geometry_glb(&path, super::StageLoadPolicy::LoadAll)
            .expect("extract sublayer payload under native instance");
        let document = glb_json(&glb);
        let nodes = document["nodes"].as_array().expect("GLB nodes");
        let mesh_nodes = nodes
            .iter()
            .filter(|node| node.get("mesh").is_some())
            .collect::<Vec<_>>();

        assert_eq!(document["meshes"].as_array().map(Vec::len), Some(1));
        assert_eq!(mesh_nodes.len(), 1);
        assert_eq!(
            mesh_nodes[0]["extras"]["primPath"],
            "/World/PROJECTORS/projector_1F/Tags/Placed/Nested/Geometry"
        );
    }

    #[test]
    fn inspect_stage_reports_rust_backend_variant_selection() {
        let root =
            std::env::temp_dir().join(format!("yw-look-variant-selection-{}", std::process::id()));
        std::fs::create_dir_all(&root).expect("create temp dir");
        let path = root.join("variant_selection.usda");
        std::fs::write(
            &path,
            r#"#usda 1.0
(
    defaultPrim = "Root"
)

def Xform "Root" (
    variants = {
        string look = "blue"
    }
    prepend variantSets = ["look"]
)
{
    variantSet "look" = {
        "red" {
        }
        "blue" {
        }
    }
}
"#,
        )
        .expect("write variant selection fixture");

        let inspection = OpenusdBackend::new()
            .inspect_stage(&path, super::StageLoadPolicy::LoadAll)
            .expect("inspect variant selection fixture");

        let variant = inspection
            .variant_sets
            .iter()
            .find(|entry| entry.prim_path == "/Root" && entry.set_name == "look")
            .expect("look variant set");
        assert_eq!(variant.selection.as_deref(), Some("blue"));
        assert_eq!(variant.variants, vec!["red", "blue"]);

        std::fs::remove_dir_all(root).ok();
    }

    #[test]
    fn variant_candidates_merge_strongest_first_across_sublayer_and_reference_sites() {
        let unique = format!(
            "yw-look-variant-candidates-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("system clock")
                .as_nanos()
        );
        let root = std::env::temp_dir().join(unique);
        std::fs::create_dir_all(&root).expect("create variant candidate temp dir");
        let asset = root.join("asset.usda");
        let sub = root.join("sub.usda");
        let root_usda = root.join("root.usda");

        std::fs::write(
            &asset,
            r#"#usda 1.0
(
    defaultPrim = "Asset"
)

def Xform "Asset" (
    prepend variantSets = ["look"]
)
{
    variantSet "look" = {
        "shared" { }
        "referenced" { }
    }
}
"#,
        )
        .expect("write asset variant fixture");
        std::fs::write(
            &sub,
            r#"#usda 1.0

over "World" {
    over "Hero" (
        prepend variantSets = ["look"]
    )
    {
        variantSet "look" = {
            "shared" { }
            "sublayer" { }
        }
    }
}
"#,
        )
        .expect("write sublayer variant fixture");
        std::fs::write(
            &root_usda,
            r#"#usda 1.0
(
    defaultPrim = "World"
    subLayers = [@sub.usda@]
)

def Xform "World"
{
    def Xform "Hero" (
        references = @asset.usda@</Asset>
        prepend variantSets = ["look"]
        variants = {
            string look = "local"
        }
    )
    {
        variantSet "look" = {
            "local" { }
            "shared" { }
        }
    }
}
"#,
        )
        .expect("write root variant fixture");

        let stage = OpenusdBackend::open(&root_usda, super::StageLoadPolicy::LoadAll)
            .expect("open layered variant fixture");
        let variants = stage_query::variant_names(&stage, "/World/Hero", "look");
        assert_eq!(variants, vec!["local", "shared", "sublayer", "referenced"]);

        let inspection = OpenusdBackend::new()
            .inspect_stage(&root_usda, super::StageLoadPolicy::LoadAll)
            .expect("inspect layered variant fixture");
        let variant = inspection
            .variant_sets
            .iter()
            .find(|entry| entry.prim_path == "/World/Hero" && entry.set_name == "look")
            .expect("layered look variant set");
        assert_eq!(variant.selection.as_deref(), Some("local"));
        assert_eq!(variant.variants, variants);

        std::fs::remove_dir_all(root).ok();
    }

    #[test]
    fn collect_issues_tiny_usda_is_clean() {
        let path = tiny_usda();
        if is_lfs_pointer(&path) {
            eprintln!("SKIP collect_issues_tiny_usda_is_clean: tiny.usda is an LFS pointer (checkout without lfs: true)");
            return;
        }
        let backend = OpenusdBackend::new();
        let issues = backend.collect_asset_issues(&path).expect("collect issues");
        // tiny.usda is Y-up, metersPerUnit=0.01, no missing assets → no issues
        assert!(issues.is_empty(), "expected no issues, got {issues:?}");
    }

    #[test]
    fn inspect_tiny_broken_ref_reports_missing_state() {
        // Phase 4 Lite regression: verify that `CompositionArc::state`
        // reflects the stage resolver's opinion. The fixture has two
        // references authored at sibling prims — one points at
        // tiny.usda (resolvable) and one at a non-existent path. We
        // expect the first arc to report `Loaded` and the second to
        // report `Missing`.
        let path = PathBuf::from("../samples/assets/usd/tiny_broken_ref.usda");
        if !path.exists() || is_lfs_pointer(&path) {
            eprintln!("SKIP inspect_tiny_broken_ref_reports_missing_state: fixture missing");
            return;
        }
        let backend = OpenusdBackend::new();
        let inspection = backend
            .inspect_stage(&path, super::StageLoadPolicy::LoadAll)
            .expect("inspect tiny_broken_ref.usda");

        let good = inspection
            .references
            .iter()
            .find(|a| a.asset_path.contains("tiny.usda"))
            .expect("resolvable reference recorded");
        assert_eq!(
            good.state,
            CompositionArcState::Loaded,
            "resolvable arc must be Loaded"
        );

        let broken = inspection
            .references
            .iter()
            .find(|a| a.asset_path.contains("does_not_exist"))
            .expect("broken reference recorded");
        assert_eq!(
            broken.state,
            CompositionArcState::Missing,
            "unresolved arc must be Missing"
        );

        assert!(
            !inspection.missing_assets.is_empty(),
            "missing_assets should list the unresolved path"
        );
    }

    #[test]
    fn root_layer_is_binary_for_tiny_usda() {
        let path = tiny_usda();
        if is_lfs_pointer(&path) {
            eprintln!("SKIP: tiny.usda is an LFS pointer");
            return;
        }
        let backend = OpenusdBackend::new();
        let is_binary = backend
            .root_layer_is_binary(&path)
            .expect("root_layer_is_binary tiny.usda");
        assert!(!is_binary, "tiny.usda is text USDA");
    }

    #[test]
    fn negative_face_counts_return_parse_error_before_rust_subset_filter() -> std::io::Result<()> {
        let tmp_dir = std::env::temp_dir().join("yw_look_rs_negative_face_counts");
        std::fs::create_dir_all(&tmp_dir)?;
        let usda_path = tmp_dir.join("negative_face_counts.usda");
        std::fs::write(
            &usda_path,
            r#"#usda 1.0
(
    defaultPrim = "Root"
    upAxis = "Y"
)

def Xform "Root"
{
    def Mesh "Bad"
    {
        point3f[] points = [(0, 0, 0), (1, 0, 0), (0, 1, 0)]
        int[] faceVertexCounts = [-1]
        int[] faceVertexIndices = [0, 1, 2]
        uniform token subdivisionScheme = "none"

        def GeomSubset "BadSubset"
        {
            uniform token elementType = "face"
            uniform token familyName = "materialBind"
            int[] indices = [0]
        }
    }
}
"#,
        )?;

        let backend = OpenusdBackend::new();
        let err = backend
            .extract_geometry_glb(&usda_path, super::StageLoadPolicy::LoadAll)
            .expect_err("negative faceVertexCounts must be reported as a parse error");
        let msg = format!("{err:?}");
        assert!(
            msg.contains("negative faceVertexCounts"),
            "unexpected error: {msg}"
        );

        Ok(())
    }

    /// Regression test for the P1 Codex finding: a `xformOp:translate:pivot`
    /// paired with its `!invert!` counterpart MUST compose to identity
    /// (the whole point of the pivot pair is to define a temporary pivot
    /// for rotation/scale that doesn't leak into the final transform).
    /// Before the fix, the fork's `local_xform_of` silently dropped the
    /// inverse entry and the forward translate stuck around, leaving
    /// meshes offset by the pivot amount.
    #[test]
    fn pivot_pair_composes_to_identity() -> std::io::Result<()> {
        let tmp_dir = std::env::temp_dir().join("yw_look_pivot_pair_test");
        std::fs::create_dir_all(&tmp_dir)?;
        let usda = tmp_dir.join("pivot_pair.usda");
        std::fs::write(
            &usda,
            r#"#usda 1.0
(
    defaultPrim = "Root"
    upAxis = "Y"
)

def Xform "Root" (
    kind = "component"
)
{
    # Maya-style pivot pair around (10, 20, 30) with nothing in between:
    # the forward translate moves to the pivot, the inverse moves back,
    # and the composed local transform should be the identity.
    double3 xformOp:translate:pivot = (10, 20, 30)
    uniform token[] xformOpOrder = [
        "xformOp:translate:pivot",
        "!invert!xformOp:translate:pivot"
    ]

    def Mesh "Quad"
    {
        int[] faceVertexCounts = [3]
        int[] faceVertexIndices = [0, 1, 2]
        point3f[] points = [(0, 0, 0), (1, 0, 0), (0, 1, 0)]
    }
}
"#,
        )?;

        let backend = OpenusdBackend::new();
        let glb = backend
            .extract_geometry_glb(&usda, super::StageLoadPolicy::LoadAll)
            .expect("extract_geometry pivot_pair.usda");

        // GLB sanity check, then pull out the first node's matrix and
        // verify it's the identity (modulo floating point rounding). If
        // the pivot inverse were still being dropped, the node matrix
        // would carry a (10, 20, 30) translation.
        assert_eq!(&glb[0..4], b"glTF");

        let json_chunk_len = u32::from_le_bytes(glb[12..16].try_into().unwrap()) as usize;
        let json_start = 20;
        let json_end = json_start + json_chunk_len;
        let json_text = std::str::from_utf8(&glb[json_start..json_end])
            .unwrap()
            .trim_end_matches(' ');
        let doc: serde_json::Value = serde_json::from_str(json_text).unwrap();
        // #46: nodes[0] is now the __upAxis synthetic node; find the
        // Quad mesh node by searching for the one that carries a `mesh`
        // field. We assert its local matrix is (approximately) identity,
        // proving the pivot pair composed correctly.
        let nodes_arr = doc["nodes"].as_array().expect("nodes array");
        let mesh_node = nodes_arr
            .iter()
            .find(|n| n.get("mesh").is_some())
            .expect("at least one mesh node");
        let matrix = mesh_node["matrix"].as_array().expect("node matrix");
        let values: Vec<f64> = matrix.iter().map(|v| v.as_f64().unwrap()).collect();
        // Column-major identity: diagonal 1s, everything else 0 — in
        // particular the translation column (m[12..15]) must be zero,
        // not (10, 20, 30).
        let expected = [
            1.0_f64, 0.0, 0.0, 0.0, //
            0.0, 1.0, 0.0, 0.0, //
            0.0, 0.0, 1.0, 0.0, //
            0.0, 0.0, 0.0, 1.0,
        ];
        for (i, (&actual, &exp)) in values.iter().zip(expected.iter()).enumerate() {
            assert!(
                (actual - exp).abs() < 1e-6,
                "matrix element {i} mismatch: expected {exp}, got {actual} — pivot inverse likely dropped"
            );
        }

        std::fs::remove_file(&usda).ok();
        Ok(())
    }

    /// Regression guard for Phase 4: `compose_prim_local_xform` used to
    /// iterate the xformOp list in reverse, which turned the canonical
    /// Pixar op order `[translate, rotateXYZ]` into `R * T` instead of
    /// `T * R`. Any prop with both a translate and a rotate — every
    /// single Kitchen Set MeasuringSpoon / Cup / Bowl / chain of shakers —
    /// ended up rotated around the world origin, flinging it across (and
    /// often through) the kitchen floor.
    ///
    /// This test uses a self-contained USDA with
    /// `xformOpOrder = [translate(10,0,0), rotateZ(90)]`. USD semantics
    /// say ops in this list apply in list order, which translates (in
    /// column-vector convention) to `M = T * R` — i.e., rotate locally
    /// first, then translate to position. We verify the composed world
    /// matrix has translation column `(10, 0, 0)` and a Z-rotation by
    /// checking a known axis basis vector.
    #[test]
    fn trs_order_matches_usd_semantics() {
        let path = PathBuf::from("../samples/assets/usd/tiny_trs.usda");
        if !path.exists() || is_lfs_pointer(&path) {
            eprintln!("SKIP trs_order_matches_usd_semantics: fixture missing");
            return;
        }
        let backend = OpenusdBackend::new();
        let glb = backend
            .extract_geometry_glb(&path, super::StageLoadPolicy::LoadAll)
            .expect("extract_geometry tiny_trs.usda");
        assert_eq!(&glb[0..4], b"glTF");

        let json_chunk_len = u32::from_le_bytes(glb[12..16].try_into().unwrap()) as usize;
        let json_start = 20;
        let json_end = json_start + json_chunk_len;
        let json_text = std::str::from_utf8(&glb[json_start..json_end])
            .unwrap()
            .trim_end_matches(' ');
        let doc: serde_json::Value = serde_json::from_str(json_text).unwrap();
        // #46: the GLB now carries the full prim hierarchy. The `Rotated` Xform
        // prim is emitted as a Group node whose LOCAL matrix encodes the
        // authored translate(10,0,0) + rotateZ(90) ops. We verify that local
        // matrix rather than the old world-baked mesh node matrix.
        let nodes_arr = doc["nodes"].as_array().expect("nodes array");
        let rotated_node = nodes_arr
            .iter()
            .find(|n| n["name"].as_str() == Some("Rotated"))
            .expect("Rotated Xform node must be present in hierarchy GLB");
        let matrix = rotated_node["matrix"].as_array().expect("node matrix");
        let m: Vec<f64> = matrix.iter().map(|v| v.as_f64().unwrap()).collect();

        // Column-major layout: m[12..15] is the translation column.
        // Under the correct `T * R` composition (USD op order: first op outermost),
        // the translation column must be (10, 0, 0) — the authored translate value.
        // The old `R * T` code rotated (10, 0, 0) by 90° around Z,
        // which would put translation at roughly (0, 10, 0) instead.
        assert!(
            (m[12] - 10.0).abs() < 1e-5,
            "expected translation.x == 10 (T*R), got m[12]={} — op order reversed?",
            m[12]
        );
        assert!(
            m[13].abs() < 1e-5,
            "expected translation.y == 0 (T*R), got m[13]={} — op order reversed?",
            m[13]
        );
        assert!(
            m[14].abs() < 1e-5,
            "expected translation.z == 0, got m[14]={}",
            m[14]
        );

        // Verify the rotation column too: the local X axis (1, 0, 0)
        // transforms to the first column of M. Rz(90°) maps +X → +Y, so
        // m[0..3] should be approximately (0, 1, 0).
        assert!(
            m[0].abs() < 1e-5 && (m[1] - 1.0).abs() < 1e-5 && m[2].abs() < 1e-5,
            "expected local +X → world +Y after Rz(90), got ({}, {}, {})",
            m[0],
            m[1],
            m[2]
        );
    }

    #[test]
    fn orient_quatf_uses_scalar_first_order() {
        let half = std::f32::consts::FRAC_1_SQRT_2;
        let value = SdfValue::Quatf(openusd::gf::quatf(half, 0.0, 0.0, half));
        let matrix =
            super::build_xform_op_matrix("xformOp:orient", &value).expect("xformOp:orient matrix");

        // USD/openusd v0.5 exposes quat arrays as [w, x, y, z]. A +90deg
        // rotation around Z maps local +X to +Y in this column-major matrix.
        assert!(matrix[0].abs() < 1e-5, "m[0] = {}", matrix[0]);
        assert!(
            (matrix[1] - 1.0).abs() < 1e-5,
            "m[1] = {}, expected +Y",
            matrix[1]
        );
        assert!(matrix[2].abs() < 1e-5, "m[2] = {}", matrix[2]);

        let (w, x, y, z) = super::read_quat(&value).expect("read quat");
        assert!((w - half as f64).abs() < 1e-6);
        assert!(x.abs() < 1e-6);
        assert!(y.abs() < 1e-6);
        assert!((z - half as f64).abs() < 1e-6);
    }

    #[test]
    fn tiny_usda_does_not_require_glb_preview() {
        // Pure single-layer USDA file — the Three.js USDLoader path is
        // the preferred route because it preserves hierarchy and xforms.
        let path = tiny_usda();
        if is_lfs_pointer(&path) {
            eprintln!("SKIP: tiny.usda is an LFS pointer");
            return;
        }
        let backend = OpenusdBackend::new();
        let needs_glb = backend
            .requires_glb_preview(&path)
            .expect("requires_glb_preview tiny.usda");
        assert!(
            !needs_glb,
            "tiny.usda is single-layer USDA — USDLoader handles it"
        );
    }

    #[test]
    fn extract_geometry_tiny_usda_round_trips() {
        // Even though the existing pipeline never calls extract_geometry on a
        // USDA stage (the frontend takes the USDLoader path for those), the
        // function must still work end-to-end against the simplest available
        // mesh so we can detect regressions in the GLB builder + transform
        // composer + triangulator without needing the Pixar samples on hand.
        let path = tiny_usda();
        if is_lfs_pointer(&path) {
            eprintln!("SKIP: tiny.usda is an LFS pointer");
            return;
        }
        let backend = OpenusdBackend::new();
        let glb = backend
            .extract_geometry_glb(&path, super::StageLoadPolicy::LoadAll)
            .expect("extract_geometry tiny.usda");

        // GLB header check.
        assert_eq!(&glb[0..4], b"glTF");
        let total_length = u32::from_le_bytes(glb[8..12].try_into().unwrap()) as usize;
        assert_eq!(total_length, glb.len());
    }

    // ----- Phase 0 production-asset parity tests --------------------------
    //
    // These tests reproduce production-asset observations through
    // `OpenusdBackend` instead of the raw `openusd` API. They confirm the
    // adapter does not lose information for real-world USD scenes.
    //
    // The assets live under `samples/private/` (license-restricted), so the
    // tests are `#[ignore]`d by default and skipped automatically when the
    // file is missing. Run them locally with:
    //
    //     cargo test --lib usd:: -- --ignored
    //
    // ---------------------------------------------------------------------

    fn skip_if_missing(path: &PathBuf, name: &str) -> bool {
        if !path.exists() {
            eprintln!("SKIP {name}: not present at {}", path.display());
            return true;
        }
        false
    }

    #[test]
    #[ignore = "needs samples/private (Pixar license)"]
    fn extract_geometry_kitchen_set_full() {
        // Phase 3 multi-mesh stress test: walk the entire Kitchen Set scene
        // (USDA root + 228 USDC references) and bake every Mesh prim into a
        // single GLB. The root layer is USDA so the frontend wouldn't take
        // this path during normal operation, but `extract_geometry_glb` is
        // root-format-agnostic and this is the largest available scene.
        let path = PathBuf::from("../samples/private/usd/Kitchen_set/Kitchen_set/Kitchen_set.usd");
        if skip_if_missing(&path, "kitchen_set_full") {
            return;
        }
        let backend = OpenusdBackend::new();
        let started = std::time::Instant::now();
        let glb = backend
            .extract_geometry_glb(&path, super::StageLoadPolicy::LoadAll)
            .expect("extract_geometry_glb kitchen_set");
        eprintln!(
            "kitchen_set extract_geometry: {} bytes in {:?}",
            glb.len(),
            started.elapsed()
        );
        assert_eq!(&glb[0..4], b"glTF");
        assert!(glb.len() > 1024);
    }

    #[test]
    #[ignore = "needs samples/private (Pixar license)"]
    fn extract_geometry_ball_via_payload_and_reference() {
        // End-to-end composition check: Ball.usd is a USDA root that wraps
        // its geometry via a payload → reference chain:
        //
        //     Ball.usd      (USDA) --payload--> Ball_payload.usd (USDA)
        //                                         --reference--> Ball.geom.usd (USDC)
        //
        // If either arc is being silently skipped, `extract_geometry_glb`
        // on Ball.usd will find zero Mesh prims and bail with "no Mesh
        // prims found in stage". A successful extraction proves that:
        //   1. Payloads are loaded during composition (the fork's default
        //      mode is `loaded`, which is what Phase 3 expects).
        //   2. References inside those payloads are followed recursively.
        //   3. The underlying USDC layer is parsed through `mesh_of`.
        //
        // This is the fundamental check the user asked about — without it
        // the 228-ref Kitchen_set result could be misleading if it happened
        // to work through references alone.
        let path =
            PathBuf::from("../samples/private/usd/Kitchen_set/Kitchen_set/assets/Ball/Ball.usd");
        if skip_if_missing(&path, "ball_usd_via_payload") {
            return;
        }
        let backend = OpenusdBackend::new();

        // Root layer is USDA, so the frontend would take the USDLoader
        // path in practice. We still want the Rust pipeline to produce
        // valid geometry from this file so that if we ever broaden the
        // GLB path, it doesn't silently lose coverage.
        let is_binary = backend
            .root_layer_is_binary(&path)
            .expect("root_layer_is_binary ball.usd");
        assert!(!is_binary, "Ball.usd has a USDA root");

        // Critical: the routing decision must send Ball.usd to the GLB
        // pipeline because USDLoader can't follow its payload/reference
        // chain. This is the assertion that would have caught the bug
        // where Ball.usd opened to an empty viewport in the Tauri UI.
        let needs_glb = backend
            .requires_glb_preview(&path)
            .expect("requires_glb_preview ball.usd");
        assert!(
            needs_glb,
            "Ball.usd has a payload chain — MUST route through the GLB pipeline, otherwise the Three.js USDLoader renders nothing"
        );

        let glb = backend
            .extract_geometry_glb(&path, super::StageLoadPolicy::LoadAll)
            .expect("extract_geometry ball.usd (payload + reference chain)");

        assert_eq!(&glb[0..4], b"glTF");
        // Ball.geom.usd (Ball.geom proxy) has thousands of vertices, so the
        // final GLB should be meaningfully larger than an empty doc. If
        // this ever regresses to "just the JSON chunk" (~500 bytes), a
        // composition arc is being dropped.
        assert!(
            glb.len() > 4_000,
            "Ball.usd GLB is suspiciously small ({} bytes) — payload or reference may not be composed",
            glb.len()
        );
    }

    #[test]
    #[ignore = "needs samples/private (Pixar license)"]
    fn extract_geometry_kitchen_set_ball() {
        // Phase 3 manual smoke test on the canonical USDC asset: a single
        // ball geom file. Verifies the GLB extraction pipeline against
        // real binary USD data (the only thing the synthetic tiny.usda
        // round-trip can't validate is `mesh_of` reading from a `.usdc`
        // crate file rather than a USDA text source).
        let path = PathBuf::from(
            "../samples/private/usd/Kitchen_set/Kitchen_set/assets/Ball/Ball.geom.usd",
        );
        if skip_if_missing(&path, "kitchen_set_ball") {
            return;
        }
        let backend = OpenusdBackend::new();

        let is_binary = backend
            .root_layer_is_binary(&path)
            .expect("root_layer_is_binary");
        assert!(is_binary, "Ball.geom.usd should be USDC");

        let glb = backend
            .extract_geometry_glb(&path, super::StageLoadPolicy::LoadAll)
            .expect("extract_geometry_glb");
        assert_eq!(&glb[0..4], b"glTF", "GLB magic header");
        let total_length = u32::from_le_bytes(glb[8..12].try_into().unwrap()) as usize;
        assert_eq!(total_length, glb.len(), "GLB length matches buffer size");
        // Sanity-check that we got something substantial — Ball.geom.usd
        // has thousands of vertices, so the GLB should be at least a few
        // kilobytes.
        assert!(glb.len() > 1024, "GLB too small ({} bytes)", glb.len());
    }

    #[test]
    #[ignore = "needs samples/private (Pixar license)"]
    fn summarize_kitchen_set() {
        let path = PathBuf::from("../samples/private/usd/Kitchen_set/Kitchen_set/Kitchen_set.usd");
        if skip_if_missing(&path, "kitchen_set") {
            return;
        }
        let backend = OpenusdBackend::new();
        let summary = backend
            .summarize_stage(&path, super::StageLoadPolicy::LoadAll)
            .expect("summarize kitchen_set");
        // Phase 0 observation: 229 layers, 77 root prims, 2048 traversed prims.
        assert_eq!(summary.layer_count, 229, "kitchen_set layer count");
        assert_eq!(summary.root_prim_count, 77, "kitchen_set root prim count");
    }

    #[test]
    #[ignore = "needs samples/private (Pixar license)"]
    fn inspect_kitchen_set() {
        let path = PathBuf::from("../samples/private/usd/Kitchen_set/Kitchen_set/Kitchen_set.usd");
        if skip_if_missing(&path, "kitchen_set") {
            return;
        }
        let backend = OpenusdBackend::new();
        let inspection = backend
            .inspect_stage(&path, super::StageLoadPolicy::LoadAll)
            .expect("inspect kitchen_set");
        assert_eq!(inspection.default_prim.as_deref(), Some("Kitchen_set"));
        assert_eq!(inspection.up_axis.as_deref(), Some("Z"));
        // Phase 0 says references and payloads are heavily used.
        assert!(
            !inspection.references.is_empty(),
            "kitchen_set should expose references"
        );
        assert!(
            !inspection.payloads.is_empty(),
            "kitchen_set should expose payloads"
        );
        // Phase 4 Lite: every arc in a well-resolved asset should report
        // `Loaded`. Kitchen Set on a clean checkout resolves fully.
        assert!(
            inspection
                .references
                .iter()
                .all(|a| a.state == CompositionArcState::Loaded),
            "kitchen_set references should all be Loaded"
        );
        assert!(
            inspection
                .payloads
                .iter()
                .all(|a| a.state == CompositionArcState::Loaded),
            "kitchen_set payloads should all be Loaded"
        );
    }

    #[test]
    #[ignore = "needs samples/private (Pixar license) — depends on PR #41 fix"]
    fn inspect_kitchen_set_instanced() {
        // Phase 0 PoC: this file failed with `Unsupported prim metadata: instanceable`.
        // The fork's `feature/instanceable-metadata` branch (upstream PR #41) is
        // supposed to fix it. This test verifies the fix is wired into the
        // git dependency.
        let path = PathBuf::from(
            "../samples/private/usd/Kitchen_set/Kitchen_set/Kitchen_set_instanced.usd",
        );
        if skip_if_missing(&path, "kitchen_set_instanced") {
            return;
        }
        let backend = OpenusdBackend::new();
        let inspection = backend
            .inspect_stage(&path, super::StageLoadPolicy::LoadAll)
            .expect("instanceable metadata regression: should now parse");
        assert_eq!(inspection.default_prim.as_deref(), Some("Kitchen_set"));
    }

    #[test]
    #[ignore = "needs samples/private (Apple AR Quick Look)"]
    fn inspect_chameleon_usdz() {
        let path = PathBuf::from("../samples/private/usd/chameleon_anim_mtl_variant.usdz");
        if skip_if_missing(&path, "chameleon_usdz") {
            return;
        }
        let backend = OpenusdBackend::new();
        let summary = backend
            .summarize_stage(&path, super::StageLoadPolicy::LoadAll)
            .expect("summarize chameleon");
        assert_eq!(summary.layer_count, 1, "usdz reports as a single layer");
        assert_eq!(summary.root_prim_count, 1);

        let inspection = backend
            .inspect_stage(&path, super::StageLoadPolicy::LoadAll)
            .expect("inspect chameleon");
        assert_eq!(inspection.default_prim.as_deref(), Some("Root"));
    }

    #[test]
    #[ignore = "needs samples/private (Apple AR Quick Look)"]
    fn extract_geometry_chameleon_usdz() {
        // Phase 3 coverage for USDZ archives whose first entry is a USDC
        // layer (Apple AR Quick Look assets). This is the exact case
        // Codex called out for P2 — if routing picks the USDLoader path
        // for a USDC-root usdz it silently renders nothing. A successful
        // GLB here proves both root_layer_is_binary and extract_geometry
        // work for the ZIP-wrapped USDC case.
        let path = PathBuf::from("../samples/private/usd/chameleon_anim_mtl_variant.usdz");
        if skip_if_missing(&path, "chameleon_usdz") {
            return;
        }
        let backend = OpenusdBackend::new();

        let is_binary = backend
            .root_layer_is_binary(&path)
            .expect("root_layer_is_binary chameleon");
        assert!(is_binary, "chameleon usdz has a USDC root layer");

        let glb = backend
            .extract_geometry_glb(&path, super::StageLoadPolicy::LoadAll)
            .expect("extract_geometry chameleon");
        assert_eq!(&glb[0..4], b"glTF");
        let total_length = u32::from_le_bytes(glb[8..12].try_into().unwrap()) as usize;
        assert_eq!(total_length, glb.len());
        assert!(glb.len() > 1024, "GLB too small ({} bytes)", glb.len());
    }

    #[test]
    #[ignore = "needs samples/private (Apple AR Quick Look)"]
    fn extract_geometry_glove_usdz() {
        let path = PathBuf::from("../samples/private/usd/glove_baseball_mtl_variant.usdz");
        if skip_if_missing(&path, "glove_usdz") {
            return;
        }
        let backend = OpenusdBackend::new();
        assert!(backend.root_layer_is_binary(&path).expect("root binary"));
        let glb = backend
            .extract_geometry_glb(&path, super::StageLoadPolicy::LoadAll)
            .expect("extract_geometry glove");
        assert_eq!(&glb[0..4], b"glTF");
        assert!(glb.len() > 1024);
    }

    #[test]
    #[ignore = "needs samples/private (Apple AR Quick Look)"]
    fn extract_geometry_seahorse_usdz() {
        let path = PathBuf::from("../samples/private/usd/seahorse_anim_mtl_variant.usdz");
        if skip_if_missing(&path, "seahorse_usdz") {
            return;
        }
        let backend = OpenusdBackend::new();
        assert!(backend.root_layer_is_binary(&path).expect("root binary"));
        let glb = backend
            .extract_geometry_glb(&path, super::StageLoadPolicy::LoadAll)
            .expect("extract_geometry seahorse");
        assert_eq!(&glb[0..4], b"glTF");
        assert!(glb.len() > 1024);
    }

    #[test]
    #[ignore = "needs samples/private (Pixar license)"]
    fn extract_geometry_kitchen_set_varied_assets() {
        // Spot-check a handful of Kitchen Set asset .geom.usd files with
        // different mesh topologies (curved surfaces, boxes, cylinders)
        // to make sure the face-varying classifier and triangulation work
        // across real production data, not just the Ball smoke test.
        let candidates = [
            "../samples/private/usd/Kitchen_set/Kitchen_set/assets/Book/Book.geom.usd",
            "../samples/private/usd/Kitchen_set/Kitchen_set/assets/Bottle/Bottle.geom.usd",
            "../samples/private/usd/Kitchen_set/Kitchen_set/assets/Bowl/Bowl.geom.usd",
            "../samples/private/usd/Kitchen_set/Kitchen_set/assets/Chair/Chair.geom.usd",
            "../samples/private/usd/Kitchen_set/Kitchen_set/assets/CastIron/CastIron.geom.usd",
        ];
        let backend = OpenusdBackend::new();
        let mut tested = 0;
        for candidate in candidates {
            let path = PathBuf::from(candidate);
            if !path.exists() {
                continue;
            }
            let is_binary = backend
                .root_layer_is_binary(&path)
                .unwrap_or_else(|e| panic!("{candidate}: root_layer_is_binary failed: {e}"));
            assert!(is_binary, "{candidate} should be USDC");
            let glb = backend
                .extract_geometry_glb(&path, super::StageLoadPolicy::LoadAll)
                .unwrap_or_else(|e| panic!("{candidate}: extract_geometry failed: {e}"));
            assert_eq!(&glb[0..4], b"glTF", "{candidate}: missing GLB magic");
            assert!(
                glb.len() > 512,
                "{candidate}: GLB too small ({} bytes)",
                glb.len()
            );
            tested += 1;
            eprintln!("  {}: {} bytes", candidate, glb.len());
        }
        assert!(tested > 0, "no Kitchen Set assets were found to test");
        eprintln!("extracted {tested} Kitchen Set geom assets");
    }

    #[test]
    #[ignore = "needs samples/private (Apple AR Quick Look)"]
    fn inspect_glove_usdz() {
        let path = PathBuf::from("../samples/private/usd/glove_baseball_mtl_variant.usdz");
        if skip_if_missing(&path, "glove_usdz") {
            return;
        }
        let backend = OpenusdBackend::new();
        let summary = backend
            .summarize_stage(&path, super::StageLoadPolicy::LoadAll)
            .expect("summarize glove");
        assert_eq!(summary.layer_count, 1);
        assert_eq!(summary.root_prim_count, 1);

        let inspection = backend
            .inspect_stage(&path, super::StageLoadPolicy::LoadAll)
            .expect("inspect glove");
        assert_eq!(inspection.default_prim.as_deref(), Some("glove_baseball"));
    }

    /// Phase 5c E E2E helper: write the `samples/assets/usd/tiny_rigged.usda`
    /// fixture to `artifacts/tmp/tiny_rigged.glb` so the
    /// preview-model skill can verify the UsdSkel → glTF skin /
    /// animation pipeline in a real WebGL context. Always runs (no
    /// `#[ignore]`) because the fixture is checked in.
    #[test]
    fn dump_tiny_rigged_glb_for_preview_model() -> std::io::Result<()> {
        let path = PathBuf::from("../samples/assets/usd/tiny_rigged.usda");
        if !path.exists() {
            eprintln!(
                "SKIP dump_tiny_rigged_glb: fixture missing at {}",
                path.display()
            );
            return Ok(());
        }
        let backend = OpenusdBackend::new();
        let glb = backend
            .extract_geometry_glb(&path, super::StageLoadPolicy::LoadAll)
            .expect("extract tiny_rigged.usda");
        assert_eq!(&glb[0..4], b"glTF");

        // Sanity-check the JSON chunk before persisting so a broken
        // GLB does not silently land in artifacts/tmp.
        let json_chunk_len = u32::from_le_bytes(glb[12..16].try_into().unwrap()) as usize;
        let json_start = 20;
        let json_end = json_start + json_chunk_len;
        let json_text = std::str::from_utf8(&glb[json_start..json_end])
            .unwrap()
            .trim_end_matches(' ');
        let doc: serde_json::Value = serde_json::from_str(json_text).unwrap();
        assert!(doc["skins"].as_array().is_some_and(|a| !a.is_empty()));
        assert!(doc["animations"].as_array().is_some_and(|a| !a.is_empty()));

        let out_dir = PathBuf::from("../artifacts/tmp");
        std::fs::create_dir_all(&out_dir)?;
        std::fs::write(out_dir.join("tiny_rigged.glb"), &glb)?;
        Ok(())
    }

    /// Phase 5c E E2E helper: write a UsdSkelExamples HumanFemale GLB
    /// to `artifacts/tmp/` so the Node-side `preview-model` skill can
    /// load the rigged + animated mesh in a real WebGL context. Lets
    /// the reviewer visually confirm `JOINTS_0` / `WEIGHTS_0` and the
    /// glTF skin/animation channels round-trip through Three.js.
    /// Ignored by default so automated runs don't produce unsolicited
    /// artifacts.
    #[test]
    #[ignore = "manual E2E helper — needs samples/private (UsdSkelExamples)"]
    fn dump_human_female_skinned_glb_for_preview_model() {
        let candidates = [
            "../samples/private/usd/UsdSkelExamples/UsdSkelExamples/HumanFemale/HumanFemale.walk.usd",
            "../samples/private/usd/UsdSkelExamples/UsdSkelExamples/HumanFemale/HumanFemale.usd",
        ];
        let mut chosen: Option<PathBuf> = None;
        for c in &candidates {
            let p = PathBuf::from(c);
            if p.exists() {
                chosen = Some(p);
                break;
            }
        }
        let Some(path) = chosen else {
            eprintln!("SKIP dump_human_female_skinned_glb: no fixture found");
            return;
        };
        let backend = OpenusdBackend::new();
        // HumanFemale.{walk,}.usd uses variants / `over` constructs
        // the fork's stage walker does not traverse yet, so the
        // extraction may legitimately return "no renderable Mesh
        // prims". Treat that as a documented Phase 5d candidate
        // rather than a hard test failure.
        let glb = match backend.extract_geometry_glb(&path, super::StageLoadPolicy::LoadAll) {
            Ok(bytes) => bytes,
            Err(err) => {
                eprintln!(
                    "SKIP dump_human_female_skinned_glb: fork could not extract HumanFemale ({err})"
                );
                return;
            }
        };

        // Persist into the project tree so preview-model.mjs can
        // serve it from Vite without needing fs.allow updates for
        // %TEMP%.
        let out_dir = PathBuf::from("../artifacts/tmp");
        std::fs::create_dir_all(&out_dir).expect("create artifacts/tmp");
        let out = out_dir.join("human_female.glb");
        std::fs::write(&out, &glb).expect("write glb");
        eprintln!("wrote {} ({} bytes)", out.display(), glb.len());
    }

    /// Phase 5a E2E helper: write a Kitchen Set GLB to disk so the
    /// Node-side `preview-model` skill can open it in a real WebGL
    /// context and the reviewer can visually verify material binding
    /// survives the full pipeline. Ignored by default so automated
    /// runs don't produce unsolicited artifacts.
    #[test]
    #[ignore = "manual E2E — needs samples/private"]
    fn dump_seahorse_glb_for_preview_model() {
        let path = PathBuf::from("../samples/private/usd/seahorse_anim_mtl_variant.usdz");
        if skip_if_missing(&path, "seahorse_dump") {
            return;
        }
        let backend = OpenusdBackend::new();
        match backend.extract_geometry_glb(&path, super::StageLoadPolicy::LoadAll) {
            Ok(glb) => {
                let out_dir = PathBuf::from("../artifacts/tmp");
                std::fs::create_dir_all(&out_dir).expect("mkdir");
                let out = out_dir.join("seahorse.glb");
                std::fs::write(&out, &glb).expect("write");
                eprintln!("wrote {} ({} bytes)", out.display(), glb.len());
            }
            Err(err) => eprintln!("SKIP seahorse dump: {err}"),
        }
    }

    #[test]
    #[ignore = "manual debug — needs samples/private"]
    fn debug_seahorse_material() {
        use openusd::sdf::Value as SdfValue;
        let path = PathBuf::from("../samples/private/usd/seahorse_anim_mtl_variant.usdz");
        if skip_if_missing(&path, "seahorse_debug") {
            return;
        }
        let stage = OpenusdBackend::open(&path, super::StageLoadPolicy::LoadAll).unwrap();
        let mesh_path = SdfPath::new("/seahorse_bind/seahorse/seahorse_combined_mesh").unwrap();

        // Mesh stats
        let mesh_data = stage_query::mesh_of(&stage, mesh_path.clone())
            .ok()
            .flatten();
        if let Some(ref md) = mesh_data {
            let total_fv: usize = md.face_vertex_counts.iter().map(|c| *c as usize).sum();
            let point_count = md.points.len() / 3;
            let uv_len = md.uvs.as_ref().map(|u| u.len()).unwrap_or(0);
            eprintln!(
                "  meshdata: points={} faces={} total_fv={} uvs.len={} (fv*2={} pt*2={})",
                point_count,
                md.face_vertex_counts.len(),
                total_fv,
                uv_len,
                total_fv * 2,
                point_count * 2
            );
        }

        // Check UV primvar names
        for uv_name in &[
            "primvars:st",
            "primvars:st1",
            "primvars:UVMap",
            "primvars:map1",
            "primvars:uv",
        ] {
            if let Ok(prop) = mesh_path.append_property(*uv_name) {
                let val: Option<SdfValue> =
                    stage.attribute_at(prop).get::<SdfValue>().ok().flatten();
                if val.is_some() {
                    let len = match &val {
                        Some(SdfValue::Vec2fVec(v)) => v.len(),
                        Some(SdfValue::FloatVec(v)) => v.len() / 2,
                        _ => 0,
                    };
                    eprintln!("  UV found: {} len={}", uv_name, len);
                }
            }
        }

        // Check GeomSubsets
        let subsets = stage_query::geom_subsets_of(&stage, mesh_path.clone());
        eprintln!("GeomSubsets: {} found", subsets.len());
        for s in &subsets {
            eprintln!(
                "  {} indices={} mat={:?}",
                s.name,
                s.indices.len(),
                s.material_binding.as_ref().map(|p| p.to_string())
            );
            // Check alternative binding names
            let subset_path = SdfPath::new(&format!("{}/{}", mesh_path.as_str(), s.name)).unwrap();
            // Brute-force: try bound_material directly on the subset
            let bm_sub = stage_query::bound_material(&stage, subset_path.clone());
            eprintln!(
                "    bound_material(subset) = {:?}",
                bm_sub.as_ref().map(|p| p.to_string())
            );

            for rel_name in &[
                "material:binding",
                "material:binding:preview",
                "material:binding:full",
            ] {
                if let Ok(prop) = subset_path.append_property(*rel_name) {
                    let targets = stage.relationship_at(prop).targets().unwrap_or_default();
                    if !targets.is_empty() {
                        eprintln!("    {} = {:?}", rel_name, targets);
                    }
                }
            }
        }

        // Check parent chain for material:binding
        let parents = ["/seahorse_bind/seahorse", "/seahorse_bind"];
        for p in &parents {
            if let Ok(pp) = SdfPath::new(p) {
                let bm = stage_query::bound_material(&stage, pp).map(|p| p.to_string());
                eprintln!("parent {} -> bound_material={:?}", p, bm);
            }
        }

        // Check direct mesh bound_material
        let bm = stage_query::bound_material(&stage, mesh_path.clone()).map(|p| p.to_string());
        eprintln!("mesh -> bound_material={:?}", bm);

        // List all Material prims
        eprintln!("\n--- All prims under /seahorse_bind with material in path ---");
        stage
            .traverse(LEGACY_TRAVERSE_PREDICATE, |prim_path| {
                let path_str = prim_path.as_str();
                if path_str.contains("mtl")
                    || path_str.contains("Looks")
                    || path_str.contains("Material")
                    || path_str.contains("mat")
                {
                    let type_name = read_token_or_string_field(&stage, prim_path.clone());
                    eprintln!("  {} type={:?}", path_str, type_name);
                }
            })
            .unwrap();
    }

    #[test]
    #[ignore = "manual debug — needs samples/private"]
    fn debug_glove_xform_ops() {
        use openusd::sdf::Value as SdfValue;
        let path = PathBuf::from("../samples/private/usd/glove_baseball_mtl_variant.usdz");
        if skip_if_missing(&path, "glove_xform") {
            return;
        }
        let stage = OpenusdBackend::open(&path, super::StageLoadPolicy::LoadAll).unwrap();
        let root = SdfPath::new("/glove_baseball").unwrap();

        // Read xformOpOrder via property path (same method as compose_prim_local_xform)
        let order_path = root.append_property("xformOpOrder").unwrap();
        let order: Option<SdfValue> = stage
            .attribute_at(order_path)
            .get::<SdfValue>()
            .ok()
            .flatten();
        eprintln!("xformOpOrder = {:?}", order);

        // Try reading individual xformOps
        for op_name in &[
            "xformOp:transform",
            "xformOp:rotateXYZ",
            "xformOp:rotateZ",
            "xformOp:scale",
            "xformOp:translate",
            "xformOp:orient",
        ] {
            if let Ok(prop) = root.append_property(*op_name) {
                let val: Option<SdfValue> =
                    stage.attribute_at(prop).get::<SdfValue>().ok().flatten();
                if val.is_some() {
                    eprintln!("  {} = {:?}", op_name, val);
                }
            }
        }

        // Our compose_prim_local_xform
        let our_local = super::compose_prim_local_xform(&stage, &root);
        eprintln!("our compose_prim_local_xform = {:?}", our_local);
    }

    #[test]
    #[ignore = "manual E2E — needs samples/private"]
    fn dump_glove_glb_for_preview_model() {
        let path = PathBuf::from("../samples/private/usd/glove_baseball_mtl_variant.usdz");
        if skip_if_missing(&path, "glove_dump") {
            return;
        }
        let backend = OpenusdBackend::new();
        match backend.extract_geometry_glb(&path, super::StageLoadPolicy::LoadAll) {
            Ok(glb) => {
                let out_dir = PathBuf::from("../artifacts/tmp");
                std::fs::create_dir_all(&out_dir).expect("mkdir");
                let out = out_dir.join("glove.glb");
                std::fs::write(&out, &glb).expect("write");
                eprintln!("wrote {} ({} bytes)", out.display(), glb.len());
            }
            Err(err) => eprintln!("SKIP glove dump: {err}"),
        }
    }

    #[test]
    #[ignore = "manual debug — needs samples/private"]
    fn debug_glove_material_binding() {
        use openusd::sdf::Value as SdfValue;
        let path = PathBuf::from("../samples/private/usd/glove_baseball_mtl_variant.usdz");
        if skip_if_missing(&path, "glove_debug") {
            return;
        }
        let stage = OpenusdBackend::open(&path, super::StageLoadPolicy::LoadAll).unwrap();
        let mut checked = 0;
        stage
            .traverse(LEGACY_TRAVERSE_PREDICATE, |prim_path| {
                if !super::is_renderable_mesh(&stage, prim_path) {
                    return;
                }
                checked += 1;
                let bm =
                    stage_query::bound_material(&stage, prim_path.clone()).map(|p| p.to_string());
                let mo = stage_query::material_of(&stage, prim_path.clone());
                let dc_path = prim_path.append_property("primvars:displayColor").ok();
                let dc =
                    dc_path.and_then(|p| stage.attribute_at(p).get::<SdfValue>().ok().flatten());
                eprintln!(
                    "  {} -> bound={:?} material_of={:?} displayColor={}",
                    prim_path.as_str(),
                    bm,
                    mo.as_ref().map(|m| format!(
                        "diffuse={:?} tex={:?}",
                        m.diffuse_color, m.diffuse_texture
                    )),
                    if dc.is_some() { "yes" } else { "no" }
                );
            })
            .unwrap();
        eprintln!("glove: {checked} meshes");

        // Check the Material prim's children to understand why material_of fails
        eprintln!("\n--- Material children dump ---");
        stage
            .traverse(LEGACY_TRAVERSE_PREDICATE, |prim_path| {
                // Only look under the material path
                if !prim_path
                    .as_str()
                    .starts_with("/glove_baseball/mtl/glove_new_mat_1")
                {
                    return;
                }
                let type_name = read_token_or_string_field(&stage, prim_path.clone());
                let info_id_path = prim_path.append_property("info:id").ok();
                let info_id: Option<String> =
                    info_id_path.and_then(|p| read_string_or_token_attribute(&stage, p));
                // Check for inputs:diffuseColor
                let dc_path = prim_path.append_property("inputs:diffuseColor").ok();
                let dc: Option<SdfValue> =
                    dc_path.and_then(|p| stage.attribute_at(p).get::<SdfValue>().ok().flatten());
                let dc_conn_path = prim_path.append_property("inputs:diffuseColor").ok();
                let dc_conn: Option<Vec<SdfPath>> =
                    dc_conn_path.and_then(|p| stage.attribute_at(p).connections().ok());
                eprintln!(
                    "  {} type={:?} info:id={:?} diffuseColor={:?} diffuseColor.connect={:?}",
                    prim_path.as_str(),
                    type_name,
                    info_id,
                    dc.as_ref()
                        .map(|v| format!("{:?}", v).chars().take(50).collect::<String>()),
                    dc_conn
                        .as_ref()
                        .map(|v| format!("{:?}", v).chars().take(80).collect::<String>()),
                );
            })
            .unwrap();
    }

    #[test]
    #[ignore = "manual debug — needs samples/private"]
    fn debug_kitchen_set_material_binding() {
        use openusd::sdf::Value as SdfValue;
        let path = PathBuf::from("../samples/private/usd/Kitchen_set/Kitchen_set/Kitchen_set.usd");
        if !path.exists() {
            return;
        }
        let stage = OpenusdBackend::open(&path, super::StageLoadPolicy::LoadAll).unwrap();
        let mut checked = 0;
        let mut bound = 0;
        let mut has_display_color = 0;
        stage
            .traverse(LEGACY_TRAVERSE_PREDICATE, |prim_path| {
                if !super::is_renderable_mesh(&stage, prim_path) {
                    return;
                }
                checked += 1;
                if checked <= 10 {
                    let bm = stage_query::bound_material(&stage, prim_path.clone())
                        .map(|p| p.to_string());
                    // Check for primvars:displayColor
                    let dc_path = prim_path.append_property("primvars:displayColor").ok();
                    let dc = dc_path
                        .and_then(|p| stage.attribute_at(p).get::<SdfValue>().ok().flatten());
                    let dc_label = match &dc {
                        Some(SdfValue::Vec3fVec(v)) => format!("Vec3f[{}]", v.len()),
                        Some(SdfValue::Vec3f(v)) => {
                            format!("Vec3f({:.2},{:.2},{:.2})", v[0], v[1], v[2])
                        }
                        Some(other) => format!("{:?}", other).chars().take(40).collect(),
                        None => "None".to_string(),
                    };
                    eprintln!(
                        "  {} -> bound={:?} displayColor={}",
                        prim_path.as_str(),
                        bm,
                        dc_label
                    );
                    if bm.is_some() {
                        bound += 1;
                    }
                    if dc.is_some() {
                        has_display_color += 1;
                    }
                }
            })
            .unwrap();
        eprintln!("Kitchen Set: {checked} meshes, first 10: {bound} bound, {has_display_color} displayColor");
    }

    #[test]
    #[ignore = "manual E2E helper — needs samples/private"]
    fn dump_kitchen_set_full_glb_for_preview_model() {
        let path = PathBuf::from("../samples/private/usd/Kitchen_set/Kitchen_set/Kitchen_set.usd");
        if !path.exists() {
            eprintln!("SKIP dump_kitchen_set_full_glb: fixture missing");
            return;
        }
        let backend = OpenusdBackend::new();
        match backend.extract_geometry_glb(&path, super::StageLoadPolicy::LoadAll) {
            Ok(glb) => {
                let out_dir = PathBuf::from("../artifacts/tmp");
                std::fs::create_dir_all(&out_dir).expect("create artifacts/tmp");
                let out = out_dir.join("kitchen_set.glb");
                std::fs::write(&out, &glb).expect("write glb");
                eprintln!("wrote {} ({} bytes)", out.display(), glb.len());
            }
            Err(err) => {
                eprintln!("SKIP dump_kitchen_set_full_glb: {err}");
            }
        }
    }

    #[test]
    #[ignore = "manual E2E helper — needs samples/private"]
    fn dump_kitchen_set_glb_for_preview_model() {
        let candidates = [
            "../samples/private/usd/Kitchen_set/Kitchen_set/assets/Ball/Ball.geom.usd",
            "../samples/private/usd/Kitchen_set/Kitchen_set/assets/Ball/Ball.usd",
        ];
        let mut chosen: Option<PathBuf> = None;
        for c in &candidates {
            let p = PathBuf::from(c);
            if p.exists() {
                chosen = Some(p);
                break;
            }
        }
        let Some(path) = chosen else {
            eprintln!("SKIP dump_kitchen_set_glb: no fixture found");
            return;
        };

        let backend = OpenusdBackend::new();
        let glb = backend
            .extract_geometry_glb(&path, super::StageLoadPolicy::LoadAll)
            .expect("extract kitchen set ball");

        let out_dir = PathBuf::from(std::env::temp_dir()).join("yw_look_phase5a_dump");
        std::fs::create_dir_all(&out_dir).expect("create tmp dir");
        let out = out_dir.join("ball.glb");
        std::fs::write(&out, &glb).expect("write glb");
        eprintln!("wrote {} ({} bytes)", out.display(), glb.len());
    }

    /// Phase 5c E: a skinned mesh authored with `SkelBindingAPI` and
    /// a sibling `Skeleton` + `SkelAnimation` must end up in the GLB
    /// with a `skins[]` entry, joint nodes, JOINTS_0/WEIGHTS_0
    /// vertex attributes on the mesh primitive, an `animations[]`
    /// entry, and a `node.skin` reference back to the rig. Uses a
    /// temp-dir USDA fixture so the test runs without samples/private.
    #[test]
    fn extract_geometry_emits_skin_and_animation() -> std::io::Result<()> {
        let tmp_dir = std::env::temp_dir().join("yw_look_phase5c_e_skin");
        std::fs::create_dir_all(&tmp_dir)?;
        let usda = tmp_dir.join("rigged.usda");
        std::fs::write(
            &usda,
            r#"#usda 1.0
(
    defaultPrim = "Root"
    upAxis = "Y"
)

def Xform "Root"
{
    def SkelRoot "RigRoot"
    {
        def Mesh "Body" (
            prepend apiSchemas = ["SkelBindingAPI"]
        )
        {
            int[] faceVertexCounts = [3]
            int[] faceVertexIndices = [0, 1, 2]
            point3f[] points = [(0, 0, 0), (1, 0, 0), (0, 1, 0)]

            int[] primvars:skel:jointIndices = [0, 1, 0, 1, 0, 1] (
                interpolation = "vertex"
                elementSize = 2
            )
            float[] primvars:skel:jointWeights = [1.0, 0.0, 0.5, 0.5, 0.0, 1.0] (
                interpolation = "vertex"
                elementSize = 2
            )

            rel skel:skeleton = </Root/RigRoot/Skel>
        }

        def Skeleton "Skel"
        {
            uniform token[] joints = ["Hip", "Hip/Spine"]
            uniform matrix4d[] bindTransforms = [
                ((1, 0, 0, 0), (0, 1, 0, 0), (0, 0, 1, 0), (0, 0, 0, 1)),
                ((1, 0, 0, 0), (0, 1, 0, 0), (0, 0, 1, 0), (0, 1, 0, 1))
            ]
            uniform matrix4d[] restTransforms = [
                ((1, 0, 0, 0), (0, 1, 0, 0), (0, 0, 1, 0), (0, 0, 0, 1)),
                ((1, 0, 0, 0), (0, 1, 0, 0), (0, 0, 1, 0), (0, 1, 0, 1))
            ]
            rel skel:animationSource = </Root/RigRoot/Anim>
        }

        def SkelAnimation "Anim"
        {
            uniform token[] joints = ["Hip", "Hip/Spine"]
            float3[] translations.timeSamples = {
                0: [(0, 0, 0), (0, 1, 0)],
                24: [(0, 0.5, 0), (0, 1, 0.25)],
            }
            quatf[] rotations.timeSamples = {
                0: [(1, 0, 0, 0), (1, 0, 0, 0)],
                24: [(0.7071, 0, 0.7071, 0), (1, 0, 0, 0)],
            }
            float3[] scales.timeSamples = {
                0: [(1, 1, 1), (1, 1, 1)],
                24: [(1, 1, 1), (1, 1, 1)],
            }
        }
    }
}
"#,
        )?;

        let backend = OpenusdBackend::new();
        let glb = backend
            .extract_geometry_glb(&usda, super::StageLoadPolicy::LoadAll)
            .expect("extract rigged.usda");
        assert_eq!(&glb[0..4], b"glTF");

        let json_chunk_len = u32::from_le_bytes(glb[12..16].try_into().unwrap()) as usize;
        let json_start = 20;
        let json_end = json_start + json_chunk_len;
        let json_text = std::str::from_utf8(&glb[json_start..json_end])
            .unwrap()
            .trim_end_matches(' ');
        let doc: serde_json::Value = serde_json::from_str(json_text).unwrap();

        // Skins must be present and contain the joint hierarchy.
        let skins = doc["skins"].as_array().expect("skins array");
        assert_eq!(skins.len(), 1);
        let skin = &skins[0];
        let joints = skin["joints"].as_array().expect("joint node indices");
        assert_eq!(joints.len(), 2);
        assert!(skin["inverseBindMatrices"].is_number());

        // The mesh primitive must carry JOINTS_0 + WEIGHTS_0 and the
        // mesh node must reference the skin.
        let meshes = doc["meshes"].as_array().expect("meshes");
        let body = meshes
            .iter()
            .find(|m| {
                m["name"]
                    .as_str()
                    .map(|n| n.ends_with("Body"))
                    .unwrap_or(false)
            })
            .expect("Body mesh");
        let attrs = &body["primitives"][0]["attributes"];
        assert!(
            attrs.get("JOINTS_0").is_some(),
            "missing JOINTS_0 attribute"
        );
        assert!(
            attrs.get("WEIGHTS_0").is_some(),
            "missing WEIGHTS_0 attribute"
        );

        let nodes = doc["nodes"].as_array().expect("nodes");
        let mesh_node = nodes
            .iter()
            .find(|n| n.get("mesh").is_some())
            .expect("at least one node references a mesh");
        assert_eq!(mesh_node["skin"], 0);

        // Animations must be present, target the skin, and contain
        // 2 time samples (0 and 24).
        let animations = doc["animations"].as_array().expect("animations");
        assert_eq!(animations.len(), 1);
        let anim = &animations[0];
        let samplers = anim["samplers"].as_array().expect("anim samplers");
        let channels = anim["channels"].as_array().expect("anim channels");
        assert!(!samplers.is_empty(), "expected at least one sampler");
        assert!(!channels.is_empty(), "expected at least one channel");
        // Verify the channel targets a joint node and uses one of
        // the TRS paths glTF supports.
        let first_path = channels[0]["target"]["path"]
            .as_str()
            .expect("channel target path");
        assert!(
            ["translation", "rotation", "scale"].contains(&first_path),
            "unexpected channel path: {first_path}"
        );

        Ok(())
    }

    /// Phase 5c A: a USDA file that authors `inputs:diffuseColor` as a
    /// `UsdUVTexture` connection with a relative `inputs:file` asset
    /// path must end up in the GLB with the texture embedded as an
    /// `image` referencing a `bufferView`, the matching `texture`
    /// pointing at the image, and the material's `pbrMetallicRoughness`
    /// carrying a `baseColorTexture` index. Uses a tiny PNG written to
    /// disk so the test runs without needing samples/private.
    #[test]
    fn extract_geometry_embeds_filesystem_diffuse_texture() -> std::io::Result<()> {
        let tmp_dir = std::env::temp_dir().join("yw_look_phase5c_fs_texture");
        std::fs::create_dir_all(&tmp_dir)?;
        let png_path = tmp_dir.join("checker.png");
        // Minimal valid 1x1 sRGB PNG (red pixel). Hand-crafted bytes
        // so the test does not depend on the `image` crate.
        let png_bytes: &[u8] = &[
            0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, // PNG magic
            0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52, // IHDR length + type
            0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, // 1x1
            0x08, 0x02, 0x00, 0x00, 0x00, // bit depth 8, color type 2 (RGB)
            0x90, 0x77, 0x53, 0xDE, // IHDR CRC
            0x00, 0x00, 0x00, 0x0C, 0x49, 0x44, 0x41, 0x54, // IDAT length + type
            0x08, 0x99, 0x63, 0xF8, 0xCF, 0xC0, 0x00, 0x00, 0x00, 0x03, 0x00, 0x01, 0x5C, 0xCD,
            0xFF, 0x69, // IDAT CRC
            0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0x44, // IEND length + type
            0xAE, 0x42, 0x60, 0x82, // IEND CRC
        ];
        std::fs::write(&png_path, png_bytes)?;

        let usda_path = tmp_dir.join("textured.usda");
        std::fs::write(
            &usda_path,
            r#"#usda 1.0
(
    defaultPrim = "Root"
    upAxis = "Y"
)

def Xform "Root"
{
    def Mesh "Tri" (
        prepend apiSchemas = ["MaterialBindingAPI"]
    )
    {
        int[] faceVertexCounts = [3]
        int[] faceVertexIndices = [0, 1, 2]
        point3f[] points = [(0, 0, 0), (1, 0, 0), (0, 1, 0)]
        texCoord2f[] primvars:st = [(0, 0), (1, 0), (0, 1)] (
            interpolation = "vertex"
        )
        rel material:binding = </Root/Looks/RedMat>
    }

    def "Looks"
    {
        def Material "RedMat"
        {
            token outputs:surface.connect = </Root/Looks/RedMat/Preview.outputs:surface>

            def Shader "Preview"
            {
                uniform token info:id = "UsdPreviewSurface"
                color3f inputs:diffuseColor.connect = </Root/Looks/RedMat/Tex.outputs:rgb>
                token outputs:surface
            }

            def Shader "Tex"
            {
                uniform token info:id = "UsdUVTexture"
                asset inputs:file = @./checker.png@
                token outputs:rgb
            }
        }
    }
}
"#,
        )?;

        let backend = OpenusdBackend::new();
        let glb = backend
            .extract_geometry_glb(&usda_path, super::StageLoadPolicy::LoadAll)
            .expect("extract textured.usda");
        assert_eq!(&glb[0..4], b"glTF");

        // Decode the JSON chunk and verify the texture pipeline.
        let json_chunk_len = u32::from_le_bytes(glb[12..16].try_into().unwrap()) as usize;
        let json_start = 20;
        let json_end = json_start + json_chunk_len;
        let json_text = std::str::from_utf8(&glb[json_start..json_end])
            .unwrap()
            .trim_end_matches(' ');
        let doc: serde_json::Value = serde_json::from_str(json_text).unwrap();

        let images = doc["images"].as_array().expect("images array");
        assert_eq!(
            images.len(),
            1,
            "expected one embedded image, got {images:?}"
        );
        assert_eq!(images[0]["mimeType"], "image/png");
        assert!(
            images[0]["bufferView"].is_number(),
            "image must reference a bufferView, got {:?}",
            images[0]
        );

        let textures = doc["textures"].as_array().expect("textures array");
        assert_eq!(textures.len(), 1);
        assert_eq!(textures[0]["source"], 0);
        assert_eq!(textures[0]["sampler"], 0);

        let samplers = doc["samplers"].as_array().expect("samplers array");
        assert_eq!(samplers.len(), 1);
        // glTF defaults: linear mip-mapping + repeat wrap.
        assert_eq!(samplers[0]["magFilter"], 9729);
        assert_eq!(samplers[0]["wrapS"], 10497);
        assert_eq!(samplers[0]["wrapT"], 10497);

        // The bound material must reference texture index 0 via
        // baseColorTexture; slot 0 (default) must NOT have a texture.
        let materials = doc["materials"].as_array().expect("materials array");
        assert_eq!(materials[0]["name"], "yw_look_default");
        assert!(
            materials[0]["pbrMetallicRoughness"]
                .get("baseColorTexture")
                .is_none(),
            "default material should not have a base color texture"
        );
        let red_slot = materials
            .iter()
            .position(|m| {
                m["name"]
                    .as_str()
                    .map(|n| n.contains("RedMat"))
                    .unwrap_or(false)
            })
            .expect("RedMat slot");
        let red = &materials[red_slot];
        assert_eq!(red["pbrMetallicRoughness"]["baseColorTexture"]["index"], 0);
        assert_eq!(
            red["pbrMetallicRoughness"]["baseColorTexture"]["texCoord"],
            0
        );

        // Codex P1: when baseColorTexture is attached, baseColorFactor
        // RGB must be neutral white so the texture is not multiplied
        // by the schema-default 0.18 fallback. Alpha is preserved so
        // an authored opacity still drives alphaMode.
        let factor = red["pbrMetallicRoughness"]["baseColorFactor"]
            .as_array()
            .expect("baseColorFactor");
        for i in 0..3 {
            let v = factor[i].as_f64().unwrap();
            assert!(
                (v - 1.0).abs() < 1e-6,
                "baseColorFactor[{i}] = {v}, expected 1.0 when texture is bound"
            );
        }
        let alpha = factor[3].as_f64().unwrap();
        assert!((alpha - 1.0).abs() < 1e-6, "alpha should be 1 by default");

        Ok(())
    }

    /// Phase 6a: a UsdPreviewSurface with both `inputs:diffuseColor`
    /// and `inputs:normal` connections must produce a GLB material
    /// with both `pbrMetallicRoughness.baseColorTexture` and
    /// `normalTexture` set, and the shared `textures` array must
    /// contain exactly the two distinct images (deduplication works
    /// across the base color and normal channels via the shared
    /// `texture_dedup` map).
    #[test]
    fn extract_geometry_embeds_normal_map_texture() -> std::io::Result<()> {
        let tmp_dir = std::env::temp_dir().join("yw_look_phase6a_fs_normal");
        std::fs::create_dir_all(&tmp_dir)?;
        let albedo_path = tmp_dir.join("albedo.png");
        let normal_path = tmp_dir.join("normal.png");
        // Same 1x1 PNG bytes used by the base color fixture above;
        // content doesn't matter because we only check the glTF
        // plumbing, not any per-pixel rendering outcome.
        let png_bytes: &[u8] = &[
            0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x48,
            0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x02, 0x00, 0x00,
            0x00, 0x90, 0x77, 0x53, 0xDE, 0x00, 0x00, 0x00, 0x0C, 0x49, 0x44, 0x41, 0x54, 0x08,
            0x99, 0x63, 0xF8, 0xCF, 0xC0, 0x00, 0x00, 0x00, 0x03, 0x00, 0x01, 0x5C, 0xCD, 0xFF,
            0x69, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82,
        ];
        std::fs::write(&albedo_path, png_bytes)?;
        std::fs::write(&normal_path, png_bytes)?;

        let usda_path = tmp_dir.join("textured.usda");
        std::fs::write(
            &usda_path,
            r#"#usda 1.0
(
    defaultPrim = "Root"
    upAxis = "Y"
)

def Xform "Root"
{
    def Mesh "Tri" (
        prepend apiSchemas = ["MaterialBindingAPI"]
    )
    {
        int[] faceVertexCounts = [3]
        int[] faceVertexIndices = [0, 1, 2]
        point3f[] points = [(0, 0, 0), (1, 0, 0), (0, 1, 0)]
        texCoord2f[] primvars:st = [(0, 0), (1, 0), (0, 1)] (
            interpolation = "vertex"
        )
        rel material:binding = </Root/Looks/PBRMat>
    }

    def "Looks"
    {
        def Material "PBRMat"
        {
            token outputs:surface.connect = </Root/Looks/PBRMat/Preview.outputs:surface>

            def Shader "Preview"
            {
                uniform token info:id = "UsdPreviewSurface"
                color3f inputs:diffuseColor.connect = </Root/Looks/PBRMat/Albedo.outputs:rgb>
                normal3f inputs:normal.connect = </Root/Looks/PBRMat/Normal.outputs:rgb>
                token outputs:surface
            }

            def Shader "Albedo"
            {
                uniform token info:id = "UsdUVTexture"
                asset inputs:file = @./albedo.png@
                token outputs:rgb
            }

            def Shader "Normal"
            {
                uniform token info:id = "UsdUVTexture"
                asset inputs:file = @./normal.png@
                token outputs:rgb
            }
        }
    }
}
"#,
        )?;

        let backend = OpenusdBackend::new();
        let glb = backend
            .extract_geometry_glb(&usda_path, super::StageLoadPolicy::LoadAll)
            .expect("extract textured.usda with normal map");
        assert_eq!(&glb[0..4], b"glTF");

        let json_chunk_len = u32::from_le_bytes(glb[12..16].try_into().unwrap()) as usize;
        let json_start = 20;
        let json_end = json_start + json_chunk_len;
        let json_text = std::str::from_utf8(&glb[json_start..json_end])
            .unwrap()
            .trim_end_matches(' ');
        let doc: serde_json::Value = serde_json::from_str(json_text).unwrap();

        // Two distinct textures should land in the GLB: one for base
        // color, one for normal. A correct implementation dedupes on
        // resolved identity, so the two files at different paths but
        // with identical bytes still produce two entries (the dedup
        // key is the filesystem path, not the byte hash).
        let textures = doc["textures"].as_array().expect("textures array");
        assert_eq!(
            textures.len(),
            2,
            "expected albedo + normal to land as two textures, got {textures:?}"
        );

        let materials = doc["materials"].as_array().expect("materials array");
        let pbr_slot = materials
            .iter()
            .position(|m| {
                m["name"]
                    .as_str()
                    .map(|n| n.contains("PBRMat"))
                    .unwrap_or(false)
            })
            .expect("PBRMat slot present");
        let pbr = &materials[pbr_slot];

        // Base color channel
        let base_idx = pbr["pbrMetallicRoughness"]["baseColorTexture"]["index"]
            .as_u64()
            .expect("baseColorTexture.index");

        // Normal channel: glTF places `normalTexture` at the material
        // level, not nested under `pbrMetallicRoughness`.
        let normal_idx = pbr["normalTexture"]["index"]
            .as_u64()
            .expect("normalTexture.index");
        assert_eq!(pbr["normalTexture"]["texCoord"], 0);

        assert_ne!(
            base_idx, normal_idx,
            "base color and normal must reference different texture indices"
        );

        Ok(())
    }

    #[test]
    fn extract_geometry_accepts_materialx_tiledimage_normal_texture() -> std::io::Result<()> {
        let tmp_dir = std::env::temp_dir().join("yw_look_materialx_tiledimage_normal");
        std::fs::create_dir_all(&tmp_dir)?;
        let normal_path = tmp_dir.join("normal.png");
        let png_bytes: &[u8] = &[
            0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x48,
            0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x02, 0x00, 0x00,
            0x00, 0x90, 0x77, 0x53, 0xDE, 0x00, 0x00, 0x00, 0x0C, 0x49, 0x44, 0x41, 0x54, 0x08,
            0x99, 0x63, 0xF8, 0xCF, 0xC0, 0x00, 0x00, 0x00, 0x03, 0x00, 0x01, 0x5C, 0xCD, 0xFF,
            0x69, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82,
        ];
        std::fs::write(&normal_path, png_bytes)?;

        let usda_path = tmp_dir.join("normal.usda");
        std::fs::write(
            &usda_path,
            r#"#usda 1.0
(
    defaultPrim = "Root"
    upAxis = "Y"
)

def Xform "Root"
{
    def Mesh "Tri" (
        prepend apiSchemas = ["MaterialBindingAPI"]
    )
    {
        int[] faceVertexCounts = [3]
        int[] faceVertexIndices = [0, 1, 2]
        point3f[] points = [(0, 0, 0), (1, 0, 0), (0, 1, 0)]
        texCoord2f[] primvars:st = [(0, 0), (1, 0), (0, 1)] (
            interpolation = "vertex"
        )
        rel material:binding = </Root/Looks/PBRMat>
    }

    def "Looks"
    {
        def Material "PBRMat"
        {
            token outputs:surface.connect = </Root/Looks/PBRMat/Preview.outputs:surface>

            def Shader "Preview"
            {
                uniform token info:id = "UsdPreviewSurface"
                color3f inputs:diffuseColor = (0.8, 0.8, 0.8)
                normal3f inputs:normal.connect = </Root/Looks/PBRMat/Normal.outputs:rgb>
                token outputs:surface
            }

            def Shader "Normal"
            {
                uniform token info:id = "ND_tiledimage_color3"
                asset inputs:file = @./normal.png@
                token outputs:rgb
            }
        }
    }
}
"#,
        )?;

        let backend = OpenusdBackend::new();
        let glb = backend
            .extract_geometry_glb(&usda_path, super::StageLoadPolicy::LoadAll)
            .expect("extract MaterialX tiledimage normal map");
        let json_chunk_len = u32::from_le_bytes(glb[12..16].try_into().unwrap()) as usize;
        let json_text = std::str::from_utf8(&glb[20..20 + json_chunk_len])
            .unwrap()
            .trim_end_matches(' ');
        let doc: serde_json::Value = serde_json::from_str(json_text).unwrap();

        let textures = doc["textures"].as_array().expect("textures array");
        assert_eq!(textures.len(), 1);
        let materials = doc["materials"].as_array().expect("materials array");
        let pbr = materials
            .iter()
            .find(|m| {
                m["name"]
                    .as_str()
                    .map(|n| n.contains("PBRMat"))
                    .unwrap_or(false)
            })
            .expect("PBRMat material");
        assert_eq!(pbr["normalTexture"]["index"], 0);

        Ok(())
    }

    #[test]
    fn extract_geometry_walks_materialx_normalmap_wrapper() -> std::io::Result<()> {
        let tmp_dir = std::env::temp_dir().join("yw_look_materialx_normalmap_wrapper");
        std::fs::create_dir_all(&tmp_dir)?;
        let normal_path = tmp_dir.join("normal.png");
        let png_bytes: &[u8] = &[
            0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x48,
            0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x02, 0x00, 0x00,
            0x00, 0x90, 0x77, 0x53, 0xDE, 0x00, 0x00, 0x00, 0x0C, 0x49, 0x44, 0x41, 0x54, 0x08,
            0x99, 0x63, 0xF8, 0xCF, 0xC0, 0x00, 0x00, 0x00, 0x03, 0x00, 0x01, 0x5C, 0xCD, 0xFF,
            0x69, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82,
        ];
        std::fs::write(&normal_path, png_bytes)?;

        let usda_path = tmp_dir.join("normalmap.usda");
        std::fs::write(
            &usda_path,
            r#"#usda 1.0
(
    defaultPrim = "Root"
    upAxis = "Y"
)

def Xform "Root"
{
    def Mesh "Tri" (
        prepend apiSchemas = ["MaterialBindingAPI"]
    )
    {
        int[] faceVertexCounts = [3]
        int[] faceVertexIndices = [0, 1, 2]
        point3f[] points = [(0, 0, 0), (1, 0, 0), (0, 1, 0)]
        texCoord2f[] primvars:st = [(0, 0), (1, 0), (0, 1)] (
            interpolation = "vertex"
        )
        rel material:binding = </Root/Looks/PBRMat>
    }

    def "Looks"
    {
        def Material "PBRMat"
        {
            token outputs:surface.connect = </Root/Looks/PBRMat/Preview.outputs:surface>

            def Shader "Preview"
            {
                uniform token info:id = "UsdPreviewSurface"
                color3f inputs:diffuseColor = (0.8, 0.8, 0.8)
                normal3f inputs:normal.connect = </Root/Looks/PBRMat/NormalMap.outputs:out>
                token outputs:surface
            }

            def Shader "NormalMap"
            {
                uniform token info:id = "ND_normalmap"
                vector3f inputs:in.connect = </Root/Looks/PBRMat/NormalImage.outputs:rgb>
                normal3f outputs:out
            }

            def Shader "NormalImage"
            {
                uniform token info:id = "ND_image_vector3"
                asset inputs:file = @./normal.png@
                float2 inputs:st.connect = </Root/Looks/PBRMat/UVXform.outputs:result>
                token inputs:wrapS = "clamp"
                token inputs:wrapT = "mirror"
                token outputs:rgb
            }

            def Shader "UVXform"
            {
                uniform token info:id = "UsdTransform2d"
                float2 inputs:scale = (1.5, 2.5)
                float inputs:rotation = 45.0
                float2 inputs:translation = (0.125, 0.375)
                float2 inputs:in.connect = </Root/Looks/PBRMat/PrimvarST.outputs:result>
                float2 outputs:result
            }

            def Shader "PrimvarST"
            {
                uniform token info:id = "UsdPrimvarReader_float2"
                token inputs:varname = "st"
                float2 outputs:result
            }
        }
    }
}
"#,
        )?;

        let backend = OpenusdBackend::new();
        let glb = backend
            .extract_geometry_glb(&usda_path, super::StageLoadPolicy::LoadAll)
            .expect("extract MaterialX normalmap wrapper");
        let json_chunk_len = u32::from_le_bytes(glb[12..16].try_into().unwrap()) as usize;
        let json_text = std::str::from_utf8(&glb[20..20 + json_chunk_len])
            .unwrap()
            .trim_end_matches(' ');
        let doc: serde_json::Value = serde_json::from_str(json_text).unwrap();

        let textures = doc["textures"].as_array().expect("textures array");
        assert_eq!(textures.len(), 1);
        let samplers = doc["samplers"].as_array().expect("samplers array");
        assert_eq!(samplers[0]["wrapS"], 33071);
        assert_eq!(samplers[0]["wrapT"], 33648);
        let materials = doc["materials"].as_array().expect("materials array");
        let pbr = materials
            .iter()
            .find(|m| {
                m["name"]
                    .as_str()
                    .map(|n| n.contains("PBRMat"))
                    .unwrap_or(false)
            })
            .expect("PBRMat material");
        assert_eq!(pbr["normalTexture"]["index"], 0);

        let transform = &pbr["normalTexture"]["extensions"]["KHR_texture_transform"];
        assert!(transform.is_object(), "normal texture transform missing");
        let offset = transform["offset"].as_array().expect("offset array");
        assert!((offset[0].as_f64().unwrap() - 0.125).abs() < 1e-5);
        assert!((offset[1].as_f64().unwrap() - 0.375).abs() < 1e-5);
        let rotation = transform["rotation"].as_f64().expect("rotation f64");
        assert!(
            (rotation - std::f64::consts::FRAC_PI_4).abs() < 1e-5,
            "rotation = {rotation}, expected π/4"
        );
        let scale = transform["scale"].as_array().expect("scale array");
        assert!((scale[0].as_f64().unwrap() - 1.5).abs() < 1e-5);
        assert!((scale[1].as_f64().unwrap() - 2.5).abs() < 1e-5);

        Ok(())
    }

    #[test]
    fn extract_geometry_resolves_materialx_diffuse_texture_from_graph() -> std::io::Result<()> {
        let tmp_dir = std::env::temp_dir().join("yw_look_materialx_diffuse_graph");
        std::fs::create_dir_all(&tmp_dir)?;
        let albedo_path = tmp_dir.join("albedo.png");
        let png_bytes: &[u8] = &[
            0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x48,
            0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x02, 0x00, 0x00,
            0x00, 0x90, 0x77, 0x53, 0xDE, 0x00, 0x00, 0x00, 0x0C, 0x49, 0x44, 0x41, 0x54, 0x08,
            0x99, 0x63, 0xF8, 0xCF, 0xC0, 0x00, 0x00, 0x00, 0x03, 0x00, 0x01, 0x5C, 0xCD, 0xFF,
            0x69, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82,
        ];
        std::fs::write(&albedo_path, png_bytes)?;

        let usda_path = tmp_dir.join("diffuse.usda");
        std::fs::write(
            &usda_path,
            r#"#usda 1.0
(
    defaultPrim = "Root"
    upAxis = "Y"
)

def Xform "Root"
{
    def Mesh "Tri" (
        prepend apiSchemas = ["MaterialBindingAPI"]
    )
    {
        int[] faceVertexCounts = [3]
        int[] faceVertexIndices = [0, 1, 2]
        point3f[] points = [(0, 0, 0), (1, 0, 0), (0, 1, 0)]
        texCoord2f[] primvars:st = [(0, 0), (1, 0), (0, 1)] (
            interpolation = "vertex"
        )
        rel material:binding = </Root/Looks/PBRMat>
    }

    def "Looks"
    {
        def Material "PBRMat"
        {
            token outputs:surface.connect = </Root/Looks/PBRMat/Preview.outputs:surface>

            def Shader "Preview"
            {
                uniform token info:id = "UsdPreviewSurface"
                color3f inputs:diffuseColor.connect = </Root/Looks/PBRMat/Albedo.outputs:rgb>
                token outputs:surface
            }

            def Shader "Albedo"
            {
                uniform token info:id = "ND_tiledimage_color3"
                asset inputs:file = @./albedo.png@
                float2 inputs:st.connect = </Root/Looks/PBRMat/UVXform.outputs:result>
                token inputs:wrapS = "clamp"
                token inputs:wrapT = "mirror"
                token outputs:rgb
            }

            def Shader "UVXform"
            {
                uniform token info:id = "UsdTransform2d"
                float2 inputs:scale = (1.25, 1.75)
                float inputs:rotation = 30.0
                float2 inputs:translation = (0.2, 0.4)
                float2 inputs:in.connect = </Root/Looks/PBRMat/PrimvarST.outputs:result>
                float2 outputs:result
            }

            def Shader "PrimvarST"
            {
                uniform token info:id = "UsdPrimvarReader_float2"
                token inputs:varname = "st"
                float2 outputs:result
            }
        }
    }
}
"#,
        )?;

        let backend = OpenusdBackend::new();
        let glb = backend
            .extract_geometry_glb(&usda_path, super::StageLoadPolicy::LoadAll)
            .expect("extract MaterialX diffuse texture");
        let json_chunk_len = u32::from_le_bytes(glb[12..16].try_into().unwrap()) as usize;
        let json_text = std::str::from_utf8(&glb[20..20 + json_chunk_len])
            .unwrap()
            .trim_end_matches(' ');
        let doc: serde_json::Value = serde_json::from_str(json_text).unwrap();

        let textures = doc["textures"].as_array().expect("textures array");
        assert_eq!(textures.len(), 1);
        let samplers = doc["samplers"].as_array().expect("samplers array");
        assert_eq!(samplers[0]["wrapS"], 33071);
        assert_eq!(samplers[0]["wrapT"], 33648);
        let materials = doc["materials"].as_array().expect("materials array");
        let pbr = materials
            .iter()
            .find(|m| {
                m["name"]
                    .as_str()
                    .map(|n| n.contains("PBRMat"))
                    .unwrap_or(false)
            })
            .expect("PBRMat material");
        let base = &pbr["pbrMetallicRoughness"]["baseColorTexture"];
        assert_eq!(base["index"], 0);
        let metallic = pbr["pbrMetallicRoughness"]["metallicFactor"]
            .as_f64()
            .expect("metallicFactor");
        let roughness = pbr["pbrMetallicRoughness"]["roughnessFactor"]
            .as_f64()
            .expect("roughnessFactor");
        assert!((metallic - 0.0).abs() < 1e-5);
        assert!((roughness - 0.5).abs() < 1e-5);

        let transform = &base["extensions"]["KHR_texture_transform"];
        assert!(transform.is_object(), "base color transform missing");
        let offset = transform["offset"].as_array().expect("offset array");
        assert!((offset[0].as_f64().unwrap() - 0.2).abs() < 1e-5);
        assert!((offset[1].as_f64().unwrap() - 0.4).abs() < 1e-5);
        let rotation = transform["rotation"].as_f64().expect("rotation f64");
        assert!(
            (rotation - (30.0_f64).to_radians()).abs() < 1e-5,
            "rotation = {rotation}, expected 30 degrees in radians"
        );
        let scale = transform["scale"].as_array().expect("scale array");
        assert!((scale[0].as_f64().unwrap() - 1.25).abs() < 1e-5);
        assert!((scale[1].as_f64().unwrap() - 1.75).abs() < 1e-5);

        Ok(())
    }

    /// Phase 6b: a `UsdTransform2d` authored between the PrimvarReader
    /// and the UsdUVTexture on the diffuse channel must produce a
    /// `KHR_texture_transform` extension on the GLB material's
    /// `baseColorTexture` with the authored scale / rotation /
    /// translation values. The top-level `extensionsUsed` must also
    /// list the extension (required by the glTF spec).
    #[test]
    fn extract_geometry_applies_usd_transform_2d() -> std::io::Result<()> {
        let tmp_dir = std::env::temp_dir().join("yw_look_phase6b_transform2d");
        std::fs::create_dir_all(&tmp_dir)?;
        let png_path = tmp_dir.join("albedo.png");
        // Reuse the 1x1 PNG bytes; pixel content is irrelevant to
        // the plumbing being exercised here.
        let png_bytes: &[u8] = &[
            0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x48,
            0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x02, 0x00, 0x00,
            0x00, 0x90, 0x77, 0x53, 0xDE, 0x00, 0x00, 0x00, 0x0C, 0x49, 0x44, 0x41, 0x54, 0x08,
            0x99, 0x63, 0xF8, 0xCF, 0xC0, 0x00, 0x00, 0x00, 0x03, 0x00, 0x01, 0x5C, 0xCD, 0xFF,
            0x69, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82,
        ];
        std::fs::write(&png_path, png_bytes)?;

        let usda_path = tmp_dir.join("tiled.usda");
        // Authoring below uses scale = (2.0, 3.0), rotation = 90°,
        // translation = (0.25, 0.75). The asserts below convert the
        // rotation to radians before comparing — `resolve_texture_
        // transform` bakes the conversion so the GLB carries the
        // glTF-native radian form.
        std::fs::write(
            &usda_path,
            r#"#usda 1.0
(
    defaultPrim = "Root"
    upAxis = "Y"
)

def Xform "Root"
{
    def Mesh "Tri" (
        prepend apiSchemas = ["MaterialBindingAPI"]
    )
    {
        int[] faceVertexCounts = [3]
        int[] faceVertexIndices = [0, 1, 2]
        point3f[] points = [(0, 0, 0), (1, 0, 0), (0, 1, 0)]
        texCoord2f[] primvars:st = [(0, 0), (1, 0), (0, 1)] (
            interpolation = "vertex"
        )
        rel material:binding = </Root/Looks/TiledMat>
    }

    def "Looks"
    {
        def Material "TiledMat"
        {
            token outputs:surface.connect = </Root/Looks/TiledMat/Preview.outputs:surface>

            def Shader "Preview"
            {
                uniform token info:id = "UsdPreviewSurface"
                color3f inputs:diffuseColor.connect = </Root/Looks/TiledMat/Tex.outputs:rgb>
                token outputs:surface
            }

            def Shader "Tex"
            {
                uniform token info:id = "UsdUVTexture"
                asset inputs:file = @./albedo.png@
                float2 inputs:st.connect = </Root/Looks/TiledMat/UVXform.outputs:result>
                token outputs:rgb
            }

            def Shader "UVXform"
            {
                uniform token info:id = "UsdTransform2d"
                float2 inputs:scale = (2.0, 3.0)
                float inputs:rotation = 90.0
                float2 inputs:translation = (0.25, 0.75)
                float2 inputs:in.connect = </Root/Looks/TiledMat/PrimvarST.outputs:result>
                float2 outputs:result
            }

            def Shader "PrimvarST"
            {
                uniform token info:id = "UsdPrimvarReader_float2"
                token inputs:varname = "st"
                float2 outputs:result
            }
        }
    }
}
"#,
        )?;

        let backend = OpenusdBackend::new();
        let glb = backend
            .extract_geometry_glb(&usda_path, super::StageLoadPolicy::LoadAll)
            .expect("extract tiled.usda");
        assert_eq!(&glb[0..4], b"glTF");

        let json_chunk_len = u32::from_le_bytes(glb[12..16].try_into().unwrap()) as usize;
        let json_start = 20;
        let json_end = json_start + json_chunk_len;
        let json_text = std::str::from_utf8(&glb[json_start..json_end])
            .unwrap()
            .trim_end_matches(' ');
        let doc: serde_json::Value = serde_json::from_str(json_text).unwrap();

        // extensionsUsed must declare KHR_texture_transform.
        let ext_used = doc["extensionsUsed"].as_array().expect("extensionsUsed");
        assert!(
            ext_used
                .iter()
                .any(|e| e.as_str() == Some("KHR_texture_transform")),
            "extensionsUsed missing KHR_texture_transform, got {ext_used:?}"
        );

        let materials = doc["materials"].as_array().expect("materials array");
        let pbr_slot = materials
            .iter()
            .position(|m| {
                m["name"]
                    .as_str()
                    .map(|n| n.contains("TiledMat"))
                    .unwrap_or(false)
            })
            .expect("TiledMat slot present");
        let pbr = &materials[pbr_slot];

        let transform =
            &pbr["pbrMetallicRoughness"]["baseColorTexture"]["extensions"]["KHR_texture_transform"];
        assert!(transform.is_object(), "KHR_texture_transform missing");

        // offset = translation authored in USD → direct mapping
        let offset = transform["offset"].as_array().expect("offset array");
        assert!((offset[0].as_f64().unwrap() - 0.25).abs() < 1e-5);
        assert!((offset[1].as_f64().unwrap() - 0.75).abs() < 1e-5);

        // rotation USD deg → glTF rad (90° = π/2)
        let rotation = transform["rotation"].as_f64().expect("rotation f64");
        assert!(
            (rotation - std::f64::consts::FRAC_PI_2).abs() < 1e-5,
            "rotation = {rotation}, expected π/2 (≈1.5708)"
        );

        // scale = authored (2.0, 3.0)
        let scale = transform["scale"].as_array().expect("scale array");
        assert!((scale[0].as_f64().unwrap() - 2.0).abs() < 1e-5);
        assert!((scale[1].as_f64().unwrap() - 3.0).abs() < 1e-5);

        Ok(())
    }

    /// Phase 6b: authored materials without a `UsdTransform2d` (the
    /// common case, where `inputs:st` is wired straight to a
    /// PrimvarReader) must NOT emit a `KHR_texture_transform`
    /// extension or list it in `extensionsUsed`. Regression guard so
    /// the identity-transform drop in `resolve_texture_transform`
    /// stays honest.
    #[test]
    fn extract_geometry_without_transform2d_omits_extension() -> std::io::Result<()> {
        // Re-exercise the base-color-only filesystem fixture from
        // Phase 5c; it has no UsdTransform2d authored.
        let tmp_dir = std::env::temp_dir().join("yw_look_phase6b_no_transform");
        std::fs::create_dir_all(&tmp_dir)?;
        let png_path = tmp_dir.join("checker.png");
        let png_bytes: &[u8] = &[
            0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x48,
            0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x02, 0x00, 0x00,
            0x00, 0x90, 0x77, 0x53, 0xDE, 0x00, 0x00, 0x00, 0x0C, 0x49, 0x44, 0x41, 0x54, 0x08,
            0x99, 0x63, 0xF8, 0xCF, 0xC0, 0x00, 0x00, 0x00, 0x03, 0x00, 0x01, 0x5C, 0xCD, 0xFF,
            0x69, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82,
        ];
        std::fs::write(&png_path, png_bytes)?;

        let usda_path = tmp_dir.join("plain.usda");
        std::fs::write(
            &usda_path,
            r#"#usda 1.0
(
    defaultPrim = "Root"
    upAxis = "Y"
)

def Xform "Root"
{
    def Mesh "Tri" (
        prepend apiSchemas = ["MaterialBindingAPI"]
    )
    {
        int[] faceVertexCounts = [3]
        int[] faceVertexIndices = [0, 1, 2]
        point3f[] points = [(0, 0, 0), (1, 0, 0), (0, 1, 0)]
        texCoord2f[] primvars:st = [(0, 0), (1, 0), (0, 1)] (
            interpolation = "vertex"
        )
        rel material:binding = </Root/Looks/PlainMat>
    }

    def "Looks"
    {
        def Material "PlainMat"
        {
            token outputs:surface.connect = </Root/Looks/PlainMat/Preview.outputs:surface>

            def Shader "Preview"
            {
                uniform token info:id = "UsdPreviewSurface"
                color3f inputs:diffuseColor.connect = </Root/Looks/PlainMat/Tex.outputs:rgb>
                token outputs:surface
            }

            def Shader "Tex"
            {
                uniform token info:id = "UsdUVTexture"
                asset inputs:file = @./checker.png@
                token outputs:rgb
            }
        }
    }
}
"#,
        )?;

        let backend = OpenusdBackend::new();
        let glb = backend
            .extract_geometry_glb(&usda_path, super::StageLoadPolicy::LoadAll)
            .expect("extract plain.usda");

        let json_chunk_len = u32::from_le_bytes(glb[12..16].try_into().unwrap()) as usize;
        let json_start = 20;
        let json_end = json_start + json_chunk_len;
        let json_text = std::str::from_utf8(&glb[json_start..json_end])
            .unwrap()
            .trim_end_matches(' ');
        let doc: serde_json::Value = serde_json::from_str(json_text).unwrap();

        assert!(
            doc.get("extensionsUsed").is_none(),
            "extensionsUsed should be absent when no transforms authored, got {:?}",
            doc.get("extensionsUsed")
        );

        let materials = doc["materials"].as_array().expect("materials array");
        for m in materials {
            let base = &m["pbrMetallicRoughness"]["baseColorTexture"];
            if base.is_object() {
                assert!(
                    base.get("extensions").is_none(),
                    "baseColorTexture carries no-op extensions: {base:?}"
                );
            }
        }

        Ok(())
    }

    /// Phase 6c: a mesh authoring per-vertex `primvars:displayColor`
    /// must flow through to the GLB as a `COLOR_0` vertex attribute.
    /// Regression guard: the constant-color path (handled separately
    /// via `apply_display_color_fallback` as `baseColorFactor`) must
    /// not also emit `COLOR_0`, otherwise the color would be applied
    /// twice (once at vertex, once as the factor multiplier).
    #[test]
    fn extract_geometry_emits_color_0_for_per_vertex_display_color() -> std::io::Result<()> {
        let tmp_dir = std::env::temp_dir().join("yw_look_phase6c_vertex_color");
        std::fs::create_dir_all(&tmp_dir)?;
        let usda_path = tmp_dir.join("vcolor.usda");
        // 3 vertices, 3 distinct displayColors with interpolation =
        // "vertex". We deliberately do NOT bind a material: the mesh
        // should render with per-vertex colors via COLOR_0 alone.
        std::fs::write(
            &usda_path,
            r#"#usda 1.0
(
    defaultPrim = "Root"
    upAxis = "Y"
)

def Xform "Root"
{
    def Mesh "Tri"
    {
        int[] faceVertexCounts = [3]
        int[] faceVertexIndices = [0, 1, 2]
        point3f[] points = [(0, 0, 0), (1, 0, 0), (0, 1, 0)]
        color3f[] primvars:displayColor = [(1.0, 0.0, 0.0), (0.0, 1.0, 0.0), (0.0, 0.0, 1.0)] (
            interpolation = "vertex"
        )
    }
}
"#,
        )?;

        let backend = OpenusdBackend::new();
        let glb = backend
            .extract_geometry_glb(&usda_path, super::StageLoadPolicy::LoadAll)
            .expect("extract vcolor.usda");
        assert_eq!(&glb[0..4], b"glTF");

        let json_chunk_len = u32::from_le_bytes(glb[12..16].try_into().unwrap()) as usize;
        let json_start = 20;
        let json_end = json_start + json_chunk_len;
        let json_text = std::str::from_utf8(&glb[json_start..json_end])
            .unwrap()
            .trim_end_matches(' ');
        let doc: serde_json::Value = serde_json::from_str(json_text).unwrap();

        // Primitive must carry a COLOR_0 attribute pointing at an
        // accessor. We walk meshes[0].primitives[0] because the
        // fixture has exactly one mesh with one primitive.
        let meshes = doc["meshes"].as_array().expect("meshes array");
        assert!(!meshes.is_empty(), "expected at least one glTF mesh");
        let primitive = &meshes[0]["primitives"][0];
        let color_accessor_idx = primitive["attributes"]["COLOR_0"]
            .as_u64()
            .expect("COLOR_0 accessor index");

        let accessors = doc["accessors"].as_array().expect("accessors array");
        let color_acc = &accessors[color_accessor_idx as usize];
        // Issue #43: COLOR_0 is now VEC4 (RGBA) — alpha from
        // displayOpacity (default 1.0 when not authored).
        assert_eq!(color_acc["type"], "VEC4", "COLOR_0 must be VEC4 (RGBA)");
        // componentType 5126 = FLOAT (glTF uses integer enum values).
        assert_eq!(color_acc["componentType"], 5126);
        // 3 triangle corners → 3 vertices in the expanded per-corner
        // layout; glTF does not require per-primitive vertex dedup.
        let count = color_acc["count"].as_u64().expect("count");
        assert_eq!(count, 3, "expected 3 vertices, got {count}");

        Ok(())
    }

    /// Phase 6c regression: a mesh whose `primvars:displayColor` is
    /// authored as a single constant triple must continue to use the
    /// `baseColorFactor` fallback and must NOT emit a `COLOR_0`
    /// attribute — otherwise the material color would be applied
    /// twice (once as the factor, once per vertex).
    #[test]
    fn extract_geometry_omits_color_0_for_constant_display_color() -> std::io::Result<()> {
        let tmp_dir = std::env::temp_dir().join("yw_look_phase6c_constant_color");
        std::fs::create_dir_all(&tmp_dir)?;
        let usda_path = tmp_dir.join("const_color.usda");
        // Single color, interpolation = "constant" — Kitchen Set's
        // typical pattern for a mesh with no authored material.
        std::fs::write(
            &usda_path,
            r#"#usda 1.0
(
    defaultPrim = "Root"
    upAxis = "Y"
)

def Xform "Root"
{
    def Mesh "Tri"
    {
        int[] faceVertexCounts = [3]
        int[] faceVertexIndices = [0, 1, 2]
        point3f[] points = [(0, 0, 0), (1, 0, 0), (0, 1, 0)]
        color3f[] primvars:displayColor = [(0.8, 0.2, 0.1)] (
            interpolation = "constant"
        )
    }
}
"#,
        )?;

        let backend = OpenusdBackend::new();
        let glb = backend
            .extract_geometry_glb(&usda_path, super::StageLoadPolicy::LoadAll)
            .expect("extract const_color.usda");

        let json_chunk_len = u32::from_le_bytes(glb[12..16].try_into().unwrap()) as usize;
        let json_start = 20;
        let json_end = json_start + json_chunk_len;
        let json_text = std::str::from_utf8(&glb[json_start..json_end])
            .unwrap()
            .trim_end_matches(' ');
        let doc: serde_json::Value = serde_json::from_str(json_text).unwrap();

        // No COLOR_0 on the primitive.
        let primitive = &doc["meshes"][0]["primitives"][0];
        assert!(
            primitive["attributes"].get("COLOR_0").is_none(),
            "constant displayColor must not emit COLOR_0, got {primitive:?}"
        );

        // The color must have been materialized as a dedicated
        // material slot whose `baseColorFactor` matches the authored
        // color (after sRGB → linear conversion). The fallback
        // material name is prefixed `dc:`.
        let materials = doc["materials"].as_array().expect("materials array");
        let dc_slot = materials
            .iter()
            .find(|m| {
                m["name"]
                    .as_str()
                    .map(|n| n.starts_with("dc:"))
                    .unwrap_or(false)
            })
            .expect("displayColor fallback material slot");
        let factor = dc_slot["pbrMetallicRoughness"]["baseColorFactor"]
            .as_array()
            .expect("baseColorFactor array");
        // sRGB 0.8 → linear ≈ 0.6038, 0.2 → ≈ 0.0331, 0.1 → ≈ 0.0100.
        // We leave a generous epsilon so the test remains stable if
        // the sRGB curve implementation is ever re-derived.
        let r = factor[0].as_f64().unwrap();
        let g = factor[1].as_f64().unwrap();
        let b = factor[2].as_f64().unwrap();
        assert!((r - 0.6038).abs() < 1e-3, "R = {r}, expected ≈0.6038");
        assert!((g - 0.0331).abs() < 1e-3, "G = {g}, expected ≈0.0331");
        assert!((b - 0.0100).abs() < 1e-3, "B = {b}, expected ≈0.0100");

        Ok(())
    }

    /// Phase 6d: a mesh bound to a `UsdSkelBlendShape` target must
    /// produce a GLB primitive with `targets[0].POSITION` pointing at
    /// a VEC3 FLOAT accessor sized to match the mesh's vertex count,
    /// and the parent mesh object must expose a parallel
    /// `weights: [0.0]` array plus an `extras.targetNames` entry
    /// carrying the authored shape name. Sparse authoring via
    /// `pointIndices` must expand to dense deltas (zeros at
    /// untouched vertices) before the per-corner expansion runs.
    #[test]
    fn extract_geometry_emits_morph_target_for_blend_shape() -> std::io::Result<()> {
        let tmp_dir = std::env::temp_dir().join("yw_look_phase6d_blend_shape");
        std::fs::create_dir_all(&tmp_dir)?;
        let usda_path = tmp_dir.join("blendshape.usda");
        // 3-point triangle, one BlendShape "Smile" authored SPARSELY
        // (only point 1 is offset). After dense expansion we expect
        // `[0,0,0, 0.5,0,0, 0,0,0]` in point layout; after triangle-
        // soup expansion the per-corner array is the same because
        // each point maps to exactly one corner.
        std::fs::write(
            &usda_path,
            r#"#usda 1.0
(
    defaultPrim = "Root"
    upAxis = "Y"
)

def Xform "Root"
{
    def Mesh "Tri" (
        prepend apiSchemas = ["SkelBindingAPI"]
    )
    {
        int[] faceVertexCounts = [3]
        int[] faceVertexIndices = [0, 1, 2]
        point3f[] points = [(0, 0, 0), (1, 0, 0), (0, 1, 0)]
        uniform token[] skel:blendShapes = ["Smile"]
        rel skel:blendShapeTargets = [</Root/Tri/Smile>]

        def BlendShape "Smile"
        {
            uniform vector3f[] offsets = [(0.5, 0.0, 0.0)]
            uniform int[] pointIndices = [1]
        }
    }
}
"#,
        )?;

        let backend = OpenusdBackend::new();
        let glb = backend
            .extract_geometry_glb(&usda_path, super::StageLoadPolicy::LoadAll)
            .expect("extract blendshape.usda");
        assert_eq!(&glb[0..4], b"glTF");

        let json_chunk_len = u32::from_le_bytes(glb[12..16].try_into().unwrap()) as usize;
        let json_start = 20;
        let json_end = json_start + json_chunk_len;
        let json_text = std::str::from_utf8(&glb[json_start..json_end])
            .unwrap()
            .trim_end_matches(' ');
        let doc: serde_json::Value = serde_json::from_str(json_text).unwrap();

        let meshes = doc["meshes"].as_array().expect("meshes array");
        let mesh = &meshes[0];

        // weights parallel to targets, initialized to 0 (rest pose).
        let weights = mesh["weights"].as_array().expect("mesh.weights");
        assert_eq!(
            weights.len(),
            1,
            "expected one weight entry, got {weights:?}"
        );
        assert!((weights[0].as_f64().unwrap() - 0.0).abs() < 1e-6);

        // targetNames extras for the shape-key UI.
        let names = mesh["extras"]["targetNames"]
            .as_array()
            .expect("extras.targetNames");
        assert_eq!(names.len(), 1);
        assert_eq!(names[0].as_str(), Some("Smile"));

        let primitive = &mesh["primitives"][0];
        let targets = primitive["targets"].as_array().expect("primitive.targets");
        assert_eq!(targets.len(), 1);
        let pos_acc_idx = targets[0]["POSITION"]
            .as_u64()
            .expect("targets[0].POSITION");
        let accessors = doc["accessors"].as_array().unwrap();
        let pos_acc = &accessors[pos_acc_idx as usize];
        assert_eq!(pos_acc["type"], "VEC3");
        assert_eq!(pos_acc["componentType"], 5126); // FLOAT
                                                    // 3 triangle corners after expansion.
        assert_eq!(pos_acc["count"].as_u64().unwrap(), 3);

        // The axis-wise min/max cover the sparse delta: max_x = 0.5,
        // every other channel is 0. These are required by the glTF
        // spec for morph target accessors.
        let max = pos_acc["max"].as_array().expect("max array");
        assert!((max[0].as_f64().unwrap() - 0.5).abs() < 1e-6);
        assert!((max[1].as_f64().unwrap() - 0.0).abs() < 1e-6);
        assert!((max[2].as_f64().unwrap() - 0.0).abs() < 1e-6);
        let min = pos_acc["min"].as_array().expect("min array");
        assert!(min[0].as_f64().unwrap().abs() < 1e-6);

        Ok(())
    }

    #[test]
    fn extract_geometry_handles_blend_shape_fixture_without_skin_weights() {
        let path = PathBuf::from("../samples/assets/usd/tiny_rigged_blend.usda");
        let backend = OpenusdBackend::new();
        let glb = backend
            .extract_geometry_glb(&path, super::StageLoadPolicy::LoadAll)
            .expect("extract tiny_rigged_blend.usda");
        assert_eq!(&glb[0..4], b"glTF");
    }

    /// Phase 6d regression: a mesh without `skel:blendShapeTargets`
    /// must not emit any morph-target JSON — no `targets` on the
    /// primitive, no `weights` on the mesh, no `extras.targetNames`.
    /// Keeps non-rigged preview output byte-identical to Phase 6c.
    #[test]
    fn extract_geometry_omits_morph_when_no_blend_shapes() -> std::io::Result<()> {
        let tmp_dir = std::env::temp_dir().join("yw_look_phase6d_no_blend");
        std::fs::create_dir_all(&tmp_dir)?;
        let usda_path = tmp_dir.join("plain.usda");
        std::fs::write(
            &usda_path,
            r#"#usda 1.0
(
    defaultPrim = "Root"
    upAxis = "Y"
)

def Xform "Root"
{
    def Mesh "Tri"
    {
        int[] faceVertexCounts = [3]
        int[] faceVertexIndices = [0, 1, 2]
        point3f[] points = [(0, 0, 0), (1, 0, 0), (0, 1, 0)]
    }
}
"#,
        )?;

        let backend = OpenusdBackend::new();
        let glb = backend
            .extract_geometry_glb(&usda_path, super::StageLoadPolicy::LoadAll)
            .expect("extract plain.usda");

        let json_chunk_len = u32::from_le_bytes(glb[12..16].try_into().unwrap()) as usize;
        let json_start = 20;
        let json_end = json_start + json_chunk_len;
        let json_text = std::str::from_utf8(&glb[json_start..json_end])
            .unwrap()
            .trim_end_matches(' ');
        let doc: serde_json::Value = serde_json::from_str(json_text).unwrap();

        let mesh = &doc["meshes"][0];
        assert!(
            mesh.get("weights").is_none(),
            "mesh.weights must be omitted when no morph targets"
        );
        assert!(
            mesh.get("extras").is_none(),
            "mesh.extras must be omitted when no morph targets"
        );
        let primitive = &mesh["primitives"][0];
        assert!(
            primitive.get("targets").is_none(),
            "primitive.targets must be omitted when no morph targets"
        );

        Ok(())
    }

    /// Phase 7a: a stage authoring one `DistantLight` + one
    /// `SphereLight` must produce a GLB whose top-level
    /// `extensions.KHR_lights_punctual.lights` array carries both
    /// entries with the authored color / intensity baked in, and
    /// whose scene graph has one glTF node per light pointing at the
    /// matching light definition. `extensionsUsed` must list
    /// `"KHR_lights_punctual"` per the glTF spec.
    #[test]
    fn extract_geometry_emits_khr_lights_punctual() -> std::io::Result<()> {
        let tmp_dir = std::env::temp_dir().join("yw_look_phase7a_lights");
        std::fs::create_dir_all(&tmp_dir)?;
        let usda_path = tmp_dir.join("lights.usda");
        std::fs::write(
            &usda_path,
            r#"#usda 1.0
(
    defaultPrim = "Root"
    upAxis = "Y"
)

def Xform "Root"
{
    def Mesh "Tri"
    {
        int[] faceVertexCounts = [3]
        int[] faceVertexIndices = [0, 1, 2]
        point3f[] points = [(0, 0, 0), (1, 0, 0), (0, 1, 0)]
    }

    def DistantLight "Sun"
    {
        color3f inputs:color = (1.0, 0.95, 0.8)
        float inputs:intensity = 3.0
        float inputs:exposure = 1.0
    }

    def SphereLight "Fill"
    {
        color3f inputs:color = (0.4, 0.5, 1.0)
        float inputs:intensity = 10.0
    }
}
"#,
        )?;

        let backend = OpenusdBackend::new();
        let glb = backend
            .extract_geometry_glb(&usda_path, super::StageLoadPolicy::LoadAll)
            .expect("extract lights.usda");
        assert_eq!(&glb[0..4], b"glTF");

        let json_chunk_len = u32::from_le_bytes(glb[12..16].try_into().unwrap()) as usize;
        let json_start = 20;
        let json_end = json_start + json_chunk_len;
        let json_text = std::str::from_utf8(&glb[json_start..json_end])
            .unwrap()
            .trim_end_matches(' ');
        let doc: serde_json::Value = serde_json::from_str(json_text).unwrap();

        // extensionsUsed must declare KHR_lights_punctual.
        let ext_used = doc["extensionsUsed"].as_array().expect("extensionsUsed");
        assert!(
            ext_used
                .iter()
                .any(|e| e.as_str() == Some("KHR_lights_punctual")),
            "extensionsUsed missing KHR_lights_punctual, got {ext_used:?}"
        );

        // Top-level lights array with 2 entries.
        let lights = doc["extensions"]["KHR_lights_punctual"]["lights"]
            .as_array()
            .expect("KHR_lights_punctual.lights");
        assert_eq!(lights.len(), 2, "expected 2 lights, got {lights:?}");

        let sun = lights
            .iter()
            .find(|l| l["type"] == "directional")
            .expect("directional");
        // intensity = 3.0 * 2^1.0 = 6.0
        assert!(
            (sun["intensity"].as_f64().unwrap() - 6.0).abs() < 1e-5,
            "sun intensity: {}",
            sun["intensity"]
        );
        let color = sun["color"].as_array().unwrap();
        assert!((color[0].as_f64().unwrap() - 1.0).abs() < 1e-5);
        assert!((color[1].as_f64().unwrap() - 0.95).abs() < 1e-5);
        assert!((color[2].as_f64().unwrap() - 0.8).abs() < 1e-5);

        let fill = lights.iter().find(|l| l["type"] == "point").expect("point");
        // exposure unauthored → default 0.0; intensity stays at 10.0
        assert!(
            (fill["intensity"].as_f64().unwrap() - 10.0).abs() < 1e-5,
            "fill intensity: {}",
            fill["intensity"]
        );

        // Each light has a matching scene node with the extension
        // pointer. We can't assume ordering in the scenes.nodes list
        // (meshes land there too), so search for any node that
        // references our lights.
        let nodes = doc["nodes"].as_array().expect("nodes");
        let light_node_count = nodes
            .iter()
            .filter(|n| {
                n.get("extensions")
                    .and_then(|e| e.get("KHR_lights_punctual"))
                    .is_some()
            })
            .count();
        assert_eq!(
            light_node_count, 2,
            "expected 2 nodes with KHR_lights_punctual, got {light_node_count}"
        );

        Ok(())
    }

    /// Phase 7b: a stage with one `UsdGeomCamera` must produce a
    /// glTF `cameras` array with the resolved yfov + aspect ratio +
    /// clipping range, and a scene node carrying `camera: i`
    /// pointing at it. Verifies the mm → radians yfov math against
    /// known USD defaults: a 35mm full-frame sensor (vertAp 24mm)
    /// with a 50mm "normal" lens resolves to the canonical ~27°
    /// vertical FOV (`2·atan(24 / (2·50)) ≈ 0.4711` rad).
    #[test]
    fn extract_geometry_emits_authored_cameras() -> std::io::Result<()> {
        let tmp_dir = std::env::temp_dir().join("yw_look_phase7b_camera");
        std::fs::create_dir_all(&tmp_dir)?;
        let usda_path = tmp_dir.join("camera.usda");
        std::fs::write(
            &usda_path,
            r#"#usda 1.0
(
    defaultPrim = "Root"
    upAxis = "Y"
)

def Xform "Root"
{
    def Mesh "Tri"
    {
        int[] faceVertexCounts = [3]
        int[] faceVertexIndices = [0, 1, 2]
        point3f[] points = [(0, 0, 0), (1, 0, 0), (0, 1, 0)]
    }

    def Camera "MainCam"
    {
        float focalLength = 50.0
        float horizontalAperture = 36.0
        float verticalAperture = 24.0
        float2 clippingRange = (0.5, 1000.0)
    }
}
"#,
        )?;

        let backend = OpenusdBackend::new();
        let glb = backend
            .extract_geometry_glb(&usda_path, super::StageLoadPolicy::LoadAll)
            .expect("extract camera.usda");

        let json_chunk_len = u32::from_le_bytes(glb[12..16].try_into().unwrap()) as usize;
        let json_start = 20;
        let json_end = json_start + json_chunk_len;
        let json_text = std::str::from_utf8(&glb[json_start..json_end])
            .unwrap()
            .trim_end_matches(' ');
        let doc: serde_json::Value = serde_json::from_str(json_text).unwrap();

        let cameras = doc["cameras"].as_array().expect("cameras array");
        assert_eq!(cameras.len(), 1, "expected 1 camera, got {cameras:?}");
        let cam = &cameras[0];
        assert_eq!(cam["type"], "perspective");

        // yfov = 2 * atan(24 / (2 * 50)) ≈ 0.4711 rad (27° vertical
        // FOV — the canonical "50mm normal lens on full frame" pair).
        let yfov = cam["perspective"]["yfov"].as_f64().unwrap();
        assert!(
            (yfov - 0.4711).abs() < 1e-4,
            "yfov = {yfov}, expected ≈ 0.4711 rad"
        );
        // aspect = 36 / 24 = 1.5
        let aspect = cam["perspective"]["aspectRatio"].as_f64().unwrap();
        assert!((aspect - 1.5).abs() < 1e-4);
        // clippingRange
        let znear = cam["perspective"]["znear"].as_f64().unwrap();
        let zfar = cam["perspective"]["zfar"].as_f64().unwrap();
        assert!((znear - 0.5).abs() < 1e-4);
        assert!((zfar - 1000.0).abs() < 1e-1);

        // Matching scene node with `camera` pointer.
        let nodes = doc["nodes"].as_array().unwrap();
        let camera_nodes: Vec<_> = nodes.iter().filter(|n| n.get("camera").is_some()).collect();
        assert_eq!(
            camera_nodes.len(),
            1,
            "expected 1 camera-bearing node, got {camera_nodes:?}"
        );
        assert_eq!(camera_nodes[0]["camera"].as_u64().unwrap(), 0);

        Ok(())
    }

    /// Phase 7b regression: a stage with no authored cameras must
    /// emit no `cameras` array at all so the pre-7b output stays
    /// byte-identical.
    #[test]
    fn extract_geometry_omits_cameras_when_none_authored() -> std::io::Result<()> {
        let tmp_dir = std::env::temp_dir().join("yw_look_phase7b_no_camera");
        std::fs::create_dir_all(&tmp_dir)?;
        let usda_path = tmp_dir.join("plain.usda");
        std::fs::write(
            &usda_path,
            r#"#usda 1.0
(
    defaultPrim = "Root"
    upAxis = "Y"
)

def Xform "Root"
{
    def Mesh "Tri"
    {
        int[] faceVertexCounts = [3]
        int[] faceVertexIndices = [0, 1, 2]
        point3f[] points = [(0, 0, 0), (1, 0, 0), (0, 1, 0)]
    }
}
"#,
        )?;

        let backend = OpenusdBackend::new();
        let glb = backend
            .extract_geometry_glb(&usda_path, super::StageLoadPolicy::LoadAll)
            .expect("extract plain.usda");

        let json_chunk_len = u32::from_le_bytes(glb[12..16].try_into().unwrap()) as usize;
        let json_start = 20;
        let json_end = json_start + json_chunk_len;
        let json_text = std::str::from_utf8(&glb[json_start..json_end])
            .unwrap()
            .trim_end_matches(' ');
        let doc: serde_json::Value = serde_json::from_str(json_text).unwrap();

        assert!(
            doc.get("cameras").is_none(),
            "cameras must be omitted when none authored, got {:?}",
            doc.get("cameras")
        );

        Ok(())
    }

    /// Phase 7a regression: stages without any authored UsdLuxLight
    /// must not touch the glTF extension machinery — no
    /// `extensions`, no `extensionsUsed` entry, no light-bearing
    /// nodes. Keeps pre-7a output byte-identical when no lights
    /// are authored.
    #[test]
    fn extract_geometry_omits_lights_when_none_authored() -> std::io::Result<()> {
        let tmp_dir = std::env::temp_dir().join("yw_look_phase7a_no_lights");
        std::fs::create_dir_all(&tmp_dir)?;
        let usda_path = tmp_dir.join("plain.usda");
        std::fs::write(
            &usda_path,
            r#"#usda 1.0
(
    defaultPrim = "Root"
    upAxis = "Y"
)

def Xform "Root"
{
    def Mesh "Tri"
    {
        int[] faceVertexCounts = [3]
        int[] faceVertexIndices = [0, 1, 2]
        point3f[] points = [(0, 0, 0), (1, 0, 0), (0, 1, 0)]
    }
}
"#,
        )?;

        let backend = OpenusdBackend::new();
        let glb = backend
            .extract_geometry_glb(&usda_path, super::StageLoadPolicy::LoadAll)
            .expect("extract plain.usda");

        let json_chunk_len = u32::from_le_bytes(glb[12..16].try_into().unwrap()) as usize;
        let json_start = 20;
        let json_end = json_start + json_chunk_len;
        let json_text = std::str::from_utf8(&glb[json_start..json_end])
            .unwrap()
            .trim_end_matches(' ');
        let doc: serde_json::Value = serde_json::from_str(json_text).unwrap();

        // No KHR_lights_punctual anywhere.
        if let Some(ext_used) = doc.get("extensionsUsed") {
            let names: Vec<&str> = ext_used
                .as_array()
                .unwrap()
                .iter()
                .filter_map(|v| v.as_str())
                .collect();
            assert!(
                !names.contains(&"KHR_lights_punctual"),
                "extensionsUsed must not list KHR_lights_punctual when no lights authored: {names:?}"
            );
        }
        assert!(
            doc["extensions"].get("KHR_lights_punctual").is_none(),
            "document.extensions must not carry KHR_lights_punctual when no lights authored"
        );

        Ok(())
    }

    /// Phase 5e final state for the chameleon Apple AR Quick Look
    /// asset (`samples/private/usd/chameleon_anim_mtl_variant.usdz`):
    /// neither yw-look nor the openusd fork can recover the textured
    /// PBR look from this asset, and the reason is **the asset
    /// itself**, not a fork bug.
    ///
    /// Two successive fork-side investigations (`fork 0d40283`,
    /// `fork 1a7758b`) drilled through the chameleon USDC at the
    /// raw `CrateFile` PATHS section level and found:
    ///
    /// - `/Root/chameleon_idle/Looks/chameleon_mat*/UsdPreviewSurface`
    ///   prim specs author **only** `info:id` and `outputs:surface`.
    ///   No `inputs:diffuseColor` / `inputs:metallic` /
    ///   `inputs:roughness` are written into the file at all — the
    ///   shader is an empty stub for compatibility.
    /// - The real shader graph lives in a separate prim tree at
    ///   `/Root/chameleon_mtl/Looks/{chameleon_blue_mat,
    ///   chameleon_green_mat, chameleon_camo_mat}` as a MaterialX +
    ///   RealityKit subgraph (~485 inputs:* property specs).
    /// - **No composition arc** connects `chameleon_idle/Looks` to
    ///   `chameleon_mtl/Looks` — references / payload / inheritPaths
    ///   / specializes / variantSets are all unauthored on both
    ///   sides. The variant set on the meshes only retargets
    ///   `material:binding` to `chameleon_mat_N`, never reaching the
    ///   `chameleon_mtl` tree.
    ///
    /// So `Stage::material_of` returns `None` for every chameleon
    /// piece **correctly**, and the same in yw-look. Recovering the
    /// chameleon's textured look would require a yw-look-side
    /// asset-specific heuristic that maps the empty stubs onto the
    /// MaterialX subgraph, which we explicitly do **not** want to
    /// take on. The chameleon asset stays as a non-goal for the
    /// pure USD preview path.
    ///
    /// This test pins the structural baseline (the default slot,
    /// the stick placeholder material slot, and at least 5 mesh
    /// prims after F1 variant resolution) so any regression in pcp
    /// variant resolution or `is_renderable_mesh` would still trip.
    #[test]
    #[ignore = "needs samples/private + Phase 5d L2 NodeGraph walker for full pin"]
    fn extract_geometry_chameleon_textured_smoke() {
        let path = PathBuf::from("../samples/private/usd/chameleon_anim_mtl_variant.usdz");
        if skip_if_missing(&path, "chameleon_textures") {
            return;
        }
        let backend = OpenusdBackend::new();
        let glb = backend
            .extract_geometry_glb(&path, super::StageLoadPolicy::LoadAll)
            .expect("extract chameleon usdz");
        assert_eq!(&glb[0..4], b"glTF");

        let json_chunk_len = u32::from_le_bytes(glb[12..16].try_into().unwrap()) as usize;
        let json_start = 20;
        let json_end = json_start + json_chunk_len;
        let json_text = std::str::from_utf8(&glb[json_start..json_end])
            .unwrap()
            .trim_end_matches(' ');
        let doc: serde_json::Value = serde_json::from_str(json_text).unwrap();
        let materials = doc["materials"].as_array().expect("materials array");
        let mesh_count = doc["meshes"].as_array().map(|a| a.len()).unwrap_or(0);

        // Variant resolution is working, so the chameleon traverse
        // produces multiple Mesh prims (eye, nail, tongue, body,
        // etc.). Lock the count so a regression in
        // `is_renderable_mesh` or pcp variant resolution would trip
        // this immediately.
        assert!(
            mesh_count >= 5,
            "chameleon should expose >= 5 Mesh prims after F1 variant fix, got {mesh_count}"
        );

        // Pin: at minimum we expect the default slot + the stick
        // placeholder material slot. Phase 5d L2 will add the rest.
        assert!(
            materials.len() >= 2,
            "chameleon should produce at least 2 material slots, got {}",
            materials.len()
        );
    }

    /// Phase 5a regression (Codex P1): a `UsdPreviewSurface` that
    /// only authors `diffuseColor` must export the **schema defaults**
    /// for `metallic`, `roughness`, `opacity` and `emissiveColor` —
    /// not yw-look's neutral preview material. The bug was that
    /// `material_input_from_data` was filling missing channels from
    /// `MaterialInput::default_preview()`, which uses
    /// `roughness_factor = 0.9` and `metallic_factor = 0.0`. A USD
    /// shader that explicitly relies on `roughness = 0.5` (the spec
    /// default) would silently render too rough.
    #[test]
    fn partial_preview_surface_uses_schema_defaults_not_yw_look_defaults() -> std::io::Result<()> {
        let tmp_dir = std::env::temp_dir().join("yw_look_phase5a_partial_shader");
        std::fs::create_dir_all(&tmp_dir)?;
        let usda = tmp_dir.join("partial.usda");
        std::fs::write(
            &usda,
            r#"#usda 1.0
(
    defaultPrim = "Root"
    upAxis = "Y"
)

def Xform "Root"
{
    def Mesh "Tri" (
        prepend apiSchemas = ["MaterialBindingAPI"]
    )
    {
        int[] faceVertexCounts = [3]
        int[] faceVertexIndices = [0, 1, 2]
        point3f[] points = [(0, 0, 0), (1, 0, 0), (0, 1, 0)]
        rel material:binding = </Root/Looks/PartialMat>
    }

    def "Looks"
    {
        def Material "PartialMat"
        {
            token outputs:surface.connect = </Root/Looks/PartialMat/Shader.outputs:surface>

            def Shader "Shader"
            {
                uniform token info:id = "UsdPreviewSurface"
                # Only diffuseColor authored — the other PBR factors
                # must inherit UsdPreviewSurface schema defaults.
                color3f inputs:diffuseColor = (0.5, 0.5, 0.5)
                token outputs:surface
            }
        }
    }
}
"#,
        )?;

        let backend = OpenusdBackend::new();
        let glb = backend
            .extract_geometry_glb(&usda, super::StageLoadPolicy::LoadAll)
            .expect("extract partial.usda");
        let json_chunk_len = u32::from_le_bytes(glb[12..16].try_into().unwrap()) as usize;
        let json_start = 20;
        let json_end = json_start + json_chunk_len;
        let json_text = std::str::from_utf8(&glb[json_start..json_end])
            .unwrap()
            .trim_end_matches(' ');
        let doc: serde_json::Value = serde_json::from_str(json_text).unwrap();

        let materials = doc["materials"].as_array().expect("materials array");
        let partial_slot = materials
            .iter()
            .position(|m| {
                m["name"]
                    .as_str()
                    .map(|n| n.contains("PartialMat"))
                    .unwrap_or(false)
            })
            .expect("PartialMat slot");
        let partial = &materials[partial_slot];
        let pbr = &partial["pbrMetallicRoughness"];

        let metallic = pbr["metallicFactor"].as_f64().unwrap();
        let roughness = pbr["roughnessFactor"].as_f64().unwrap();
        let alpha = pbr["baseColorFactor"][3].as_f64().unwrap();
        // UsdPreviewSurface schema defaults: metallic 0, roughness 0.5,
        // opacity 1.
        assert!(
            (metallic - 0.0).abs() < 1e-4,
            "metallic should be 0 (USD default), got {metallic}"
        );
        assert!(
            (roughness - 0.5).abs() < 1e-4,
            "roughness should be 0.5 (USD default), got {roughness}"
        );
        assert!(
            (alpha - 1.0).abs() < 1e-4,
            "opacity should be 1 (USD default), got {alpha}"
        );
        // Opaque material → no `alphaMode` field emitted.
        assert!(
            partial.get("alphaMode").is_none(),
            "fully-opaque material should not emit alphaMode"
        );

        Ok(())
    }

    /// Phase 5a end-to-end: a `Mesh` bound to a `Material` that holds a
    /// `UsdPreviewSurface` with authored diffuse / metallic / roughness
    /// must land in the GLB's `materials` array with matching factors,
    /// and the corresponding mesh primitive must reference that slot
    /// (not slot 0 / the default). Uses a temp-dir USDA fixture so the
    /// test runs without needing samples/private.
    #[test]
    fn extract_geometry_applies_usd_preview_surface_factors() -> std::io::Result<()> {
        let tmp_dir = std::env::temp_dir().join("yw_look_phase5a_material_smoke");
        std::fs::create_dir_all(&tmp_dir)?;
        let usda = tmp_dir.join("preview_surface.usda");
        std::fs::write(
            &usda,
            r#"#usda 1.0
(
    defaultPrim = "Root"
    upAxis = "Y"
)

def Xform "Root" (
    kind = "component"
)
{
    def Mesh "Tri" (
        prepend apiSchemas = ["MaterialBindingAPI"]
    )
    {
        int[] faceVertexCounts = [3]
        int[] faceVertexIndices = [0, 1, 2]
        point3f[] points = [(0, 0, 0), (1, 0, 0), (0, 1, 0)]
        rel material:binding = </Root/Looks/BlueMat>
    }

    def "Looks"
    {
        def Material "BlueMat"
        {
            token outputs:surface.connect = </Root/Looks/BlueMat/PreviewSurface.outputs:surface>

            def Shader "PreviewSurface"
            {
                uniform token info:id = "UsdPreviewSurface"
                color3f inputs:diffuseColor = (0.1, 0.3, 0.9)
                float inputs:metallic = 0.25
                float inputs:roughness = 0.4
                token outputs:surface
            }
        }
    }
}
"#,
        )?;

        let backend = OpenusdBackend::new();
        let glb = backend
            .extract_geometry_glb(&usda, super::StageLoadPolicy::LoadAll)
            .expect("extract preview_surface.usda");
        assert_eq!(&glb[0..4], b"glTF");

        // Pull the JSON chunk out so we can inspect materials + the
        // primitive's material index directly.
        let json_chunk_len = u32::from_le_bytes(glb[12..16].try_into().unwrap()) as usize;
        let json_start = 20;
        let json_end = json_start + json_chunk_len;
        let json_text = std::str::from_utf8(&glb[json_start..json_end])
            .unwrap()
            .trim_end_matches(' ');
        let doc: serde_json::Value = serde_json::from_str(json_text).unwrap();

        let materials = doc["materials"].as_array().expect("materials array");
        assert!(
            materials.len() >= 2,
            "expected default + BlueMat slots, got {}",
            materials.len()
        );
        // Slot 0 is always the default preview material.
        assert_eq!(materials[0]["name"], "yw_look_default");

        // Find the BlueMat slot and verify authored scalars survived
        // the round trip through MaterialData → MaterialInput → GLTF.
        let blue_slot = materials
            .iter()
            .position(|m| {
                m["name"]
                    .as_str()
                    .map(|n| n.contains("BlueMat"))
                    .unwrap_or(false)
            })
            .expect("BlueMat material slot must be present");
        let blue = &materials[blue_slot];
        let base = blue["pbrMetallicRoughness"]["baseColorFactor"]
            .as_array()
            .expect("baseColorFactor");
        // USD authors diffuseColor as sRGB = (0.1, 0.3, 0.9). After
        // `material_input_from_data` linearizes for glTF, we expect
        // the IEC sRGB decoding of each channel. Using the same helper
        // the production code uses keeps this test robust against any
        // future changes to the conversion formula.
        let expected_base = [
            super::srgb_to_linear(0.1_f32) as f64,
            super::srgb_to_linear(0.3_f32) as f64,
            super::srgb_to_linear(0.9_f32) as f64,
        ];
        for (i, v) in expected_base.iter().enumerate() {
            let got = base[i].as_f64().unwrap();
            assert!(
                (got - v).abs() < 1e-4,
                "baseColorFactor[{i}] = {got}, expected {v}"
            );
        }
        let metallic = blue["pbrMetallicRoughness"]["metallicFactor"]
            .as_f64()
            .unwrap();
        let roughness = blue["pbrMetallicRoughness"]["roughnessFactor"]
            .as_f64()
            .unwrap();
        assert!(
            (metallic - 0.25).abs() < 1e-4,
            "metallicFactor = {metallic}"
        );
        assert!(
            (roughness - 0.4).abs() < 1e-4,
            "roughnessFactor = {roughness}"
        );

        // And the Tri mesh must reference the BlueMat slot, not the
        // default. This exercises the dedup + slot assignment in
        // `extract_geometry_glb`.
        let meshes = doc["meshes"].as_array().expect("meshes array");
        let tri = meshes
            .iter()
            .find(|m| {
                m["name"]
                    .as_str()
                    .map(|n| n.ends_with("Tri"))
                    .unwrap_or(false)
            })
            .expect("Tri mesh must appear");
        let material_idx = tri["primitives"][0]["material"]
            .as_u64()
            .expect("material index") as usize;
        assert_eq!(
            material_idx, blue_slot,
            "Tri mesh should reference the BlueMat slot, not the default"
        );

        Ok(())
    }

    /// Phase 4 regression: `Stage::skipped_payloads()` keys on the prim
    /// that **declared** the payload, not on the target prim inside the
    /// external layer. This test authors
    /// `payload = @./payload.usda@</Target>` on a root prim called
    /// `/Root` (where source `/Root` and target `/Target` are distinct)
    /// and verifies the payload arc is reported as `Unloaded` under
    /// `NoPayloads`. A target-keyed lookup would miss and report
    /// `Loaded` by mistake — Codex P2.
    #[test]
    fn no_payloads_matches_on_source_prim_not_target() -> std::io::Result<()> {
        let tmp_dir = std::env::temp_dir().join("yw_look_payload_source_test");
        std::fs::create_dir_all(&tmp_dir)?;
        let root_usda = tmp_dir.join("root.usda");
        let payload_usda = tmp_dir.join("payload.usda");

        std::fs::write(
            &payload_usda,
            r#"#usda 1.0
(
    defaultPrim = "Target"
)

def Mesh "Target"
{
    int[] faceVertexCounts = [3]
    int[] faceVertexIndices = [0, 1, 2]
    point3f[] points = [(0, 0, 0), (1, 0, 0), (0, 1, 0)]
}
"#,
        )?;
        std::fs::write(
            &root_usda,
            r#"#usda 1.0
(
    defaultPrim = "Root"
    upAxis = "Y"
)

def Xform "Root" (
    payload = @./payload.usda@</Target>
)
{
}
"#,
        )?;

        let backend = OpenusdBackend::new();
        let inspection = backend
            .inspect_stage(&root_usda, super::StageLoadPolicy::NoPayloads)
            .expect("inspect root.usda NoPayloads");

        let payload_arc = inspection
            .payloads
            .iter()
            .find(|a| a.source_prim == "/Root")
            .expect("payload arc on /Root should be recorded");
        assert_eq!(
            payload_arc.state,
            CompositionArcState::Unloaded,
            "arc on /Root must match skipped_payloads on its source prim"
        );
        assert_eq!(payload_arc.target_prim, "/Target");

        // And LoadAll must still compose the payload — regression guard
        // that we are not accidentally skipping payloads under LoadAll.
        let loaded = backend
            .inspect_stage(&root_usda, super::StageLoadPolicy::LoadAll)
            .expect("inspect root.usda LoadAll");
        let loaded_arc = loaded
            .payloads
            .iter()
            .find(|a| a.source_prim == "/Root")
            .expect("payload arc on /Root under LoadAll");
        assert_eq!(loaded_arc.state, CompositionArcState::Loaded);

        Ok(())
    }

    /// Phase 4: Ball.usd holds a single payload arc. Under `LoadAll`
    /// the summary reports zero unloaded payloads and the composition
    /// arc is `Loaded`; under `NoPayloads` the same arc flips to
    /// `Unloaded` and is mirrored in `summary.unloaded_payload_count`.
    /// The issue list must remain unchanged because asset hygiene runs
    /// regardless of frontend deferred-load state.
    #[test]
    #[ignore = "needs samples/private (Pixar license)"]
    fn ball_usd_no_payloads_reports_unloaded_arc() {
        let path =
            PathBuf::from("../samples/private/usd/Kitchen_set/Kitchen_set/assets/Ball/Ball.usd");
        if skip_if_missing(&path, "ball_usd") {
            return;
        }
        let backend = OpenusdBackend::new();

        let loaded_summary = backend
            .summarize_stage(&path, super::StageLoadPolicy::LoadAll)
            .expect("summarize Ball.usd LoadAll");
        assert_eq!(
            loaded_summary.unloaded_payload_count, 0,
            "LoadAll must never skip payloads"
        );
        assert_eq!(loaded_summary.load_policy, super::StageLoadPolicy::LoadAll);

        let deferred_summary = backend
            .summarize_stage(&path, super::StageLoadPolicy::NoPayloads)
            .expect("summarize Ball.usd NoPayloads");
        assert!(
            deferred_summary.unloaded_payload_count >= 1,
            "NoPayloads must report at least one deferred payload, got {}",
            deferred_summary.unloaded_payload_count
        );
        assert_eq!(
            deferred_summary.load_policy,
            super::StageLoadPolicy::NoPayloads
        );
        assert_eq!(
            deferred_summary.payload_count, loaded_summary.payload_count,
            "authored payload count is independent of load policy"
        );

        let loaded_insp = backend
            .inspect_stage(&path, super::StageLoadPolicy::LoadAll)
            .expect("inspect Ball.usd LoadAll");
        assert!(
            loaded_insp
                .payloads
                .iter()
                .all(|a| a.state == CompositionArcState::Loaded),
            "LoadAll should mark every Ball payload arc as Loaded: {:?}",
            loaded_insp.payloads
        );

        let deferred_insp = backend
            .inspect_stage(&path, super::StageLoadPolicy::NoPayloads)
            .expect("inspect Ball.usd NoPayloads");
        let unloaded = deferred_insp
            .payloads
            .iter()
            .filter(|a| a.state == CompositionArcState::Unloaded)
            .count();
        assert!(
            unloaded >= 1,
            "NoPayloads must mark at least one Ball payload arc as Unloaded: {:?}",
            deferred_insp.payloads
        );
        assert_eq!(
            deferred_insp.load_policy,
            super::StageLoadPolicy::NoPayloads
        );
    }

    /// `extract_geometry_glb` is the GLB pipeline entry point. Under
    /// `LoadAll` Ball.usd produces a non-trivial GLB (its payload mesh
    /// is composed); under `NoPayloads` the payload target is skipped,
    /// so there are no renderable Mesh prims and we return a valid empty
    /// GLB scene instead of surfacing a load error in the viewer.
    #[test]
    #[ignore = "needs samples/private (Pixar license)"]
    fn ball_usd_no_payloads_extract_geometry_is_empty() {
        let path =
            PathBuf::from("../samples/private/usd/Kitchen_set/Kitchen_set/assets/Ball/Ball.usd");
        if skip_if_missing(&path, "ball_usd_extract") {
            return;
        }
        let backend = OpenusdBackend::new();

        let loaded_glb = backend
            .extract_geometry_glb(&path, super::StageLoadPolicy::LoadAll)
            .expect("extract Ball.usd LoadAll");
        assert_eq!(&loaded_glb[0..4], b"glTF");
        assert!(
            loaded_glb.len() > 512,
            "LoadAll GLB unexpectedly small: {} bytes",
            loaded_glb.len()
        );

        let deferred_glb = backend
            .extract_geometry_glb(&path, super::StageLoadPolicy::NoPayloads)
            .expect("NoPayloads should return an empty GLB scene");
        assert_eq!(&deferred_glb[0..4], b"glTF");
    }
}
