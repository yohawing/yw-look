//! Concrete `UsdBackend` implementation backed by the `openusd` crate
//! (yohawing fork of `mxpv/openusd`, branch `yw-look-phase3`).
//!
//! This adapter is intentionally thin: it converts paths, calls the
//! parser, and maps the result into `yw-look`'s wire types in
//! [`super::types`]. Anything richer (heuristics, scoring, UI sorting)
//! belongs in the frontend or a higher layer.

use std::cell::RefCell;
use std::path::Path as StdPath;

use openusd::sdf::schema::FieldKey;
use openusd::sdf::{Path as SdfPath, Value as SdfValue};
use openusd::stage::{MeshData, UpAxis};
use openusd::Stage;

use super::backend::{UsdBackend, UsdError};
use super::glb::{self, MeshInput};
use super::types::{
    AssetIssue, AssetIssueCode, AssetIssueLevel, CompositionArc, CompositionArcState,
    StageInspection, StageSummary,
};

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
    fn open(path: &StdPath) -> Result<Stage, UsdError> {
        let path_str = path
            .to_str()
            .ok_or_else(|| UsdError::Io(format!("non-UTF8 path: {}", path.display())))?;
        Stage::builder()
            .on_error(|_err| Ok(()))
            .open(path_str)
            .map_err(|e| UsdError::Parse(e.to_string()))
    }
}

impl Default for OpenusdBackend {
    fn default() -> Self {
        Self::new()
    }
}

impl UsdBackend for OpenusdBackend {
    fn inspect_stage(&self, path: &StdPath) -> Result<StageInspection, UsdError> {
        let stage = Self::open(path)?;

        let default_prim = stage.default_prim();
        let up_axis = stage.up_axis().map(|axis| match axis {
            UpAxis::Y => "Y".to_string(),
            UpAxis::Z => "Z".to_string(),
        });
        let meters_per_unit = stage.meters_per_unit();

        let root_prims = stage
            .root_prims()
            .map_err(|e| UsdError::Parse(e.to_string()))?;

        // We expose every collected layer identifier (root layer excluded) as
        // `composedLayers`. This includes all layers that participate in
        // composition (references, payloads, sublayers) — not just authored
        // `subLayers` arcs — which is what the frontend actually needs.
        let layer_ids = stage.layer_identifiers();
        let composed_layers: Vec<String> = layer_ids.into_iter().skip(1).collect();

        // Capture unresolved assets upfront so each composition arc can be
        // tagged with its current resolution state. This uses the same
        // exact-string matching as `collect_asset_issues` — any arc whose
        // authored `assetPath` appears in `unresolved_assets()` is reported
        // as `Missing`, everything else is `Loaded`. Deferred loading is
        // out of scope (Phase 4 Lite); `Loaded` here means "composed into
        // the stage", not "cached in memory on demand".
        let missing_assets = stage.unresolved_assets();
        let unresolved_set: std::collections::HashSet<&str> =
            missing_assets.iter().map(String::as_str).collect();

        let references = RefCell::new(Vec::new());
        let payloads = RefCell::new(Vec::new());

        stage
            .traverse(|prim_path| {
                let source = prim_path.as_str().to_string();
                for r in stage.references_in(prim_path.clone()) {
                    let state = arc_state(&unresolved_set, &r.asset_path);
                    references.borrow_mut().push(CompositionArc {
                        source_prim: source.clone(),
                        asset_path: r.asset_path,
                        target_prim: r.prim_path.to_string(),
                        state,
                    });
                }
                for p in stage.payloads_in(prim_path.clone()) {
                    let state = arc_state(&unresolved_set, &p.asset_path);
                    payloads.borrow_mut().push(CompositionArc {
                        source_prim: source.clone(),
                        asset_path: p.asset_path,
                        target_prim: p.prim_path.to_string(),
                        state,
                    });
                }
            })
            .map_err(|e| UsdError::Parse(e.to_string()))?;

        Ok(StageInspection {
            path: path.display().to_string(),
            default_prim,
            up_axis,
            meters_per_unit,
            root_prims,
            composed_layers,
            references: references.into_inner(),
            payloads: payloads.into_inner(),
            missing_assets,
        })
    }

    fn summarize_stage(&self, path: &StdPath) -> Result<StageSummary, UsdError> {
        let stage = Self::open(path)?;

        let layer_count = stage.layer_count();
        let root_prim_count = stage
            .root_prims()
            .map_err(|e| UsdError::Parse(e.to_string()))?
            .len();

        let mesh_count = RefCell::new(0usize);
        let payload_count = RefCell::new(0usize);
        let has_variants = RefCell::new(false);

        stage
            .traverse(|prim_path| {
                if let Ok(Some(type_name)) =
                    stage.field::<String>(prim_path.clone(), FieldKey::TypeName)
                {
                    if type_name == "Mesh" {
                        *mesh_count.borrow_mut() += 1;
                    }
                }
                let payloads = stage.payloads_in(prim_path.clone());
                if !payloads.is_empty() {
                    *payload_count.borrow_mut() += payloads.len();
                }
                // VariantSetNames may be authored as several different
                // value types depending on the layer; we only care that
                // *something* is authored, so query as raw Value.
                if let Ok(Some(_)) =
                    stage.field::<SdfValue>(prim_path.clone(), FieldKey::VariantSetNames)
                {
                    *has_variants.borrow_mut() = true;
                }
            })
            .map_err(|e| UsdError::Parse(e.to_string()))?;

        let warnings: Vec<String> = stage
            .unresolved_assets()
            .into_iter()
            .map(|a| format!("unresolved asset: {a}"))
            .collect();

        Ok(StageSummary {
            path: path.display().to_string(),
            layer_count,
            root_prim_count,
            mesh_count: mesh_count.into_inner(),
            payload_count: payload_count.into_inner(),
            has_variants: has_variants.into_inner(),
            warnings,
        })
    }

    fn root_layer_is_binary(&self, path: &StdPath) -> Result<bool, UsdError> {
        Ok(Self::open(path)?.root_layer_is_binary())
    }

    fn requires_glb_preview(&self, path: &StdPath) -> Result<bool, UsdError> {
        let stage = Self::open(path)?;
        // Binary root → Three.js USDLoader can't parse it at all.
        if stage.root_layer_is_binary() {
            return Ok(true);
        }
        // More than one composed layer → the stage depends on at least
        // one external file (sublayer, reference, or payload). yw-look
        // only hands USDLoader.parse a single text buffer, so every such
        // dependency is invisible on the JS side. Route to GLB.
        if stage.layer_count() > 1 {
            return Ok(true);
        }
        // Single self-contained USDA layer — USDLoader handles hierarchy
        // and xform composition better than the GLB flattener, so prefer
        // the JS path.
        Ok(false)
    }

    fn extract_geometry_glb(&self, path: &StdPath) -> Result<Vec<u8>, UsdError> {
        let stage = Self::open(path)?;

        // Pre-compute the Z-up → Y-up correction, if any. The viewer is
        // Y-up; Z-up USD scenes (Kitchen Set, most DCC exports from Maya
        // / Houdini) need rotating into viewer space. We bake the
        // correction into every mesh's world matrix below so the GLB is
        // self-describing — the frontend doesn't need to know the
        // original stage's up-axis.
        let up_axis_correction = match stage.up_axis() {
            Some(UpAxis::Z) => Some(z_up_to_y_up_mat4()),
            _ => None,
        };

        // Pass 1: collect every renderable Mesh prim path. We filter by
        // USD renderability metadata here so hidden scaffolding doesn't
        // show up in the preview:
        //   - active == false            → prim is disabled
        //   - visibility == "invisible"  → prim and descendants hidden
        //   - purpose in {proxy, guide}  → helper geometry for DCC tools
        // These match what Hydra / usdview use for the `default` viewer
        // purpose, which is what yw-look emulates.
        //
        // We can't call mesh_of from inside the traverse closure because
        // both borrow the stage, so we gather paths first and process
        // them after the walk completes.
        let mesh_paths = RefCell::new(Vec::<SdfPath>::new());
        stage
            .traverse(|prim_path| {
                if !is_renderable_mesh(&stage, prim_path) {
                    return;
                }
                mesh_paths.borrow_mut().push(prim_path.clone());
            })
            .map_err(|e| UsdError::Parse(e.to_string()))?;

        let mesh_paths = mesh_paths.into_inner();
        if mesh_paths.is_empty() {
            return Err(UsdError::Parse(
                "no renderable Mesh prims found in stage".to_string(),
            ));
        }

        // Pass 2: build a MeshInput per Mesh prim, composing the world
        // transform along the parent chain and pre-applying the up-axis
        // correction.
        let mut inputs: Vec<MeshInput> = Vec::with_capacity(mesh_paths.len());
        for prim_path in &mesh_paths {
            let Some(mesh_data) = stage
                .mesh_of(prim_path.clone())
                .map_err(|e| UsdError::Parse(e.to_string()))?
            else {
                continue;
            };

            let mut world = compose_world_xform(&stage, prim_path)?;
            if let Some(correction) = &up_axis_correction {
                world = mat4_mul(correction, &world);
            }
            let world_f32 = mat4_f64_to_f32(&world);

            let orientation = read_mesh_orientation(&stage, prim_path);
            let triangulated =
                mesh_data_to_input(prim_path, world_f32, &mesh_data, orientation)?;
            inputs.push(triangulated);
        }

        if inputs.is_empty() {
            return Err(UsdError::Parse(
                "stage has Mesh prims but none had usable points data".to_string(),
            ));
        }

        glb::build_glb(&inputs).map_err(UsdError::Parse)
    }

    fn collect_asset_issues(&self, path: &StdPath) -> Result<Vec<AssetIssue>, UsdError> {
        let stage = Self::open(path)?;
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

        // Build the set of unresolved assets for arc-level lookups.
        let unresolved_owned = stage.unresolved_assets();
        let unresolved: std::collections::HashSet<&str> =
            unresolved_owned.iter().map(|s| s.as_str()).collect();

        // Walk references / payloads and emit one contextualized issue per
        // arc that points at an unresolved asset. Track which assets were
        // attributed so that we can fall back to a generic issue for any
        // that aren't reachable via an explicit arc.
        let collected: RefCell<Vec<AssetIssue>> = RefCell::new(Vec::new());
        let covered: RefCell<std::collections::HashSet<String>> =
            RefCell::new(std::collections::HashSet::new());

        stage
            .traverse(|prim_path| {
                let source = prim_path.as_str().to_string();
                for r in stage.references_in(prim_path.clone()) {
                    if arc_state(&unresolved, &r.asset_path) == CompositionArcState::Missing {
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
                for p in stage.payloads_in(prim_path.clone()) {
                    if arc_state(&unresolved, &p.asset_path) == CompositionArcState::Missing {
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

        // Emit a generic (context-free) fallback only for unresolved assets
        // that were not attributed to any specific arc during traversal.
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

// ----- Phase 4 helpers ------------------------------------------------------

/// Classify a composition arc based on whether its authored `asset_path`
/// is in the stage's unresolved-asset set. Kept as a free function so
/// both `inspect_stage` and `collect_asset_issues` can share the same
/// exact-string matching rule.
fn arc_state(
    unresolved: &std::collections::HashSet<&str>,
    asset_path: &str,
) -> CompositionArcState {
    if unresolved.contains(asset_path) {
        CompositionArcState::Missing
    } else {
        CompositionArcState::Loaded
    }
}


// ----- Phase 3 helpers ------------------------------------------------------

/// Column-major rotation that maps a Z-up point `(x, y, z)` to the
/// equivalent Y-up point `(x, z, -y)`. Used to bake scene up-axis
/// conversion into mesh world matrices so the GLB is self-describing.
fn z_up_to_y_up_mat4() -> [f64; 16] {
    [
        1.0, 0.0, 0.0, 0.0, //
        0.0, 0.0, -1.0, 0.0, //
        0.0, 1.0, 0.0, 0.0, //
        0.0, 0.0, 0.0, 1.0,
    ]
}

/// USD mesh face-vertex winding convention. Determines the triangle
/// vertex order emitted by the triangulator; `LeftHanded` meshes need
/// reversed indices so backface culling and flat-normal generation
/// agree with the Y-up right-handed GLTF coordinate system.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum MeshOrientation {
    RightHanded,
    LeftHanded,
}

/// Reads the `orientation` metadata from a Mesh prim. USD's default is
/// `rightHanded`. Left-handed meshes are common in DCC tools authored
/// for OpenGL-style pipelines.
fn read_mesh_orientation(stage: &Stage, prim_path: &SdfPath) -> MeshOrientation {
    let Ok(prop_path) = prim_path.append_property("orientation") else {
        return MeshOrientation::RightHanded;
    };
    match stage.field::<SdfValue>(prop_path, FieldKey::Default) {
        Ok(Some(SdfValue::Token(token))) | Ok(Some(SdfValue::String(token))) => {
            if token == "leftHanded" {
                MeshOrientation::LeftHanded
            } else {
                MeshOrientation::RightHanded
            }
        }
        _ => MeshOrientation::RightHanded,
    }
}

/// Returns `true` if the prim at `prim_path` should contribute geometry
/// to the preview. Filters out anything the authoring DCC would hide
/// from the default render purpose:
///   - non-Mesh types,
///   - any prim in the ancestor chain with `active = false`,
///   - any prim in the ancestor chain with `visibility = "invisible"`,
///   - any prim in the ancestor chain with `purpose` of `"proxy"` or
///     `"guide"`.
///
/// USD's imageability attributes are inherited down the hierarchy, so a
/// simple local-only check would still preview meshes hidden by an
/// ancestor Xform. We walk the parent chain for visibility and purpose;
/// `active` is not technically inherited but deactivating an ancestor
/// conceptually removes the whole subtree from composition, so we treat
/// it the same way.
fn is_renderable_mesh(stage: &Stage, prim_path: &SdfPath) -> bool {
    // Must be a Mesh at the leaf.
    match stage.field::<String>(prim_path.clone(), FieldKey::TypeName) {
        Ok(Some(type_name)) if type_name == "Mesh" => {}
        _ => return false,
    }

    // Walk from the leaf toward the pseudo-root. Every step checks the
    // current prim's own opinions for active/visibility/purpose. If any
    // ancestor hides or deactivates the subtree, the mesh is skipped.
    // String-based parent walk matches `compose_world_xform`.
    let mut path_str = prim_path.as_str().to_string();
    loop {
        let Ok(ancestor) = SdfPath::new(&path_str) else {
            break;
        };

        // `active = false` at any level drops the whole subtree.
        if let Ok(Some(false)) =
            stage.field::<bool>(ancestor.clone(), FieldKey::Active)
        {
            return false;
        }

        // `visibility = "invisible"` hides the prim and all descendants
        // until an inner prim re-authors `visibility = "inherited"`. We
        // don't do the full inherited-override walk here; yw-look's
        // preview purpose is the coarse "show what usdview would show by
        // default", which matches a first-invisible-wins heuristic well
        // enough for the scenes yw-look targets.
        if let Ok(prop) = ancestor.append_property("visibility") {
            if let Ok(Some(value)) = stage.field::<SdfValue>(prop, FieldKey::Default) {
                if let SdfValue::Token(token) | SdfValue::String(token) = value {
                    if token == "invisible" {
                        return false;
                    }
                }
            }
        }

        if let Ok(prop) = ancestor.append_property("purpose") {
            if let Ok(Some(value)) = stage.field::<SdfValue>(prop, FieldKey::Default) {
                if let SdfValue::Token(token) | SdfValue::String(token) = value {
                    if token == "proxy" || token == "guide" {
                        return false;
                    }
                }
            }
        }

        // Ascend to the parent. Stop once we hit the pseudo-root.
        let Some(slash_idx) = path_str.rfind('/') else {
            break;
        };
        if slash_idx == 0 {
            break;
        }
        path_str.truncate(slash_idx);
    }

    true
}


/// Walks `prim_path` toward the pseudo-root, multiplying each ancestor's
/// `local_xform_of` to obtain a composed world matrix in column-major order.
/// Missing local xforms are treated as identity. A prim whose `xformOpOrder`
/// contains the `!resetXformStack!` pseudo-op truncates the walk — its own
/// local xform is still applied, but its ancestors contribute nothing. This
/// matches USD's reset-xform-stack semantics.
///
/// A failure from `local_xform_of` (e.g. an unsupported op type the fork
/// doesn't know how to materialise) is logged and treated as identity at that
/// level rather than aborting the entire GLB build. Losing one prim's
/// transform is better than refusing to preview the whole stage.
///
/// The returned matrix matches the convention used by glTF and Three.js
/// (column-vector, `M * v`).
fn compose_world_xform(stage: &Stage, prim_path: &SdfPath) -> Result<[f64; 16], UsdError> {
    // Walking by string is a deliberate simplification: the openusd `Path`
    // API doesn't expose a built-in `parent()`, and trimming the textual
    // form is robust enough for the canonical absolute paths that
    // `Stage::traverse` hands us.
    let mut path_str = prim_path.as_str().to_string();
    let mut chain: Vec<[f64; 16]> = Vec::new();

    loop {
        let sdf_path = SdfPath::new(&path_str)
            .map_err(|e| UsdError::Parse(format!("invalid prim path '{path_str}': {e}")))?;

        // Note whether this prim resets the xform stack BEFORE we read its
        // local matrix — reading `xformOpOrder` is cheap (just a field lookup)
        // and we want to honor the boundary even if `local_xform_of` below
        // produces an error we decide to swallow.
        let resets = has_reset_xform_stack(stage, &sdf_path);

        // Always use yw-look's own composer rather than the fork's
        // `local_xform_of`: it handles `xformOp:orient` (quaternion
        // rotation — used by e.g. Apple AR Quick Look USDZ files) and
        // `!invert!` prefixes (Maya pivot pairs), both of which the
        // fork's implementation silently drops. Doing the work here
        // keeps the routing surface small — whatever `requires_glb_preview`
        // sends through will see the authored transforms faithfully.
        match compose_prim_local_xform(stage, &sdf_path) {
            Ok(Some(local)) => chain.push(local),
            Ok(None) => {}
            Err(e) => {
                eprintln!(
                    "[usd] compose_prim_local_xform('{path_str}') failed, treating as identity: {e}"
                );
            }
        }

        if resets {
            // This prim overrides inherited ancestor transforms — stop
            // walking upward so we don't fold any parent locals in.
            break;
        }

        // Walk to parent. Stop at the pseudo-root '/'.
        let Some(slash_idx) = path_str.rfind('/') else {
            break;
        };
        if slash_idx == 0 {
            // path_str is "/something" → parent is "/" (pseudo-root).
            break;
        }
        path_str.truncate(slash_idx);
    }

    // Multiply ancestors first so the leaf's local transform lands on the
    // right of the product (column-vector convention: applied first to v).
    let mut world = identity_mat4();
    for local in chain.iter().rev() {
        world = mat4_mul(&world, local);
    }
    Ok(world)
}

/// Returns `true` if the prim's `xformOpOrder` attribute contains the
/// `!resetXformStack!` pseudo-op that truncates inherited transforms.
///
/// The fork's `local_xform_of` silently ignores the token (there is no
/// `xformOp:!resetXformStack!` attribute to look up), so we probe the order
/// list here in order to honor the boundary during parent composition.
/// Any error or missing attribute is treated as "no reset".
/// yw-look-side replacement for the fork's `local_xform_of`. Used by every
/// Mesh prim traversed for GLB extraction, so it needs to cover anything a
/// real-world USD asset may author — not just the minimal op set the fork
/// materialises.
///
/// Beyond the fork's capabilities this composer handles:
///   - `xformOp:orient` (quaternion rotation, used in Apple AR Quick Look
///     USDZ files)
///   - `!invert!` prefixes (Maya-style pivot pairs)
///
/// USD (row-vector) composes ops as `M_row = op[0] * op[1] * ... * op[N-1]`,
/// so in column-vector convention the equivalent matrix is
/// `M_col = op[0] * op[1] * ... * op[N-1]` as well — the first op in the
/// list becomes the leftmost factor (outermost), and the last op becomes
/// the rightmost factor (innermost, applied first to the vertex).
///
/// Concretely: `xformOpOrder = [translate, rotateXYZ]` means "rotate
/// locally, then translate to position" — the standard placement
/// convention used by XformCommonAPI and heavy users like Pixar's
/// Kitchen Set. The earlier implementation iterated in reverse and
/// produced `R * T`, which flung every prop around the origin.
///
/// For each entry:
///   1. Strip an optional `!invert!` prefix, remembering the flag.
///   2. Look up the underlying attribute via `stage.field::<Value>(...)`.
///   3. Build the op matrix via [`build_xform_op_matrix`].
///   4. Invert the matrix when the flag was set.
///   5. Append on the right: `result = result * op` — so iterating the
///      list forward yields `op[0] * op[1] * ... * op[N-1]`.
///
/// Returns `Ok(None)` when the prim has no `xformOpOrder` authored.
fn compose_prim_local_xform(
    stage: &Stage,
    prim_path: &SdfPath,
) -> Result<Option<[f64; 16]>, UsdError> {
    let order_path = prim_path
        .append_property("xformOpOrder")
        .map_err(|e| UsdError::Parse(e.to_string()))?;
    let Some(order_value) = stage
        .field::<SdfValue>(order_path, FieldKey::Default)
        .map_err(|e| UsdError::Parse(e.to_string()))?
    else {
        return Ok(None);
    };
    let op_names: Vec<String> = match order_value {
        SdfValue::TokenVec(v) | SdfValue::StringVec(v) => v,
        other => {
            return Err(UsdError::Parse(format!(
                "Unexpected type for xformOpOrder: {other:?}"
            )));
        }
    };
    if op_names.is_empty() {
        return Ok(None);
    }

    let mut result = identity_mat4();
    for name in op_names.iter() {
        if name == "!resetXformStack!" {
            // Reset is handled by the caller (via has_reset_xform_stack),
            // not as an op — skip it here.
            continue;
        }
        let (invert, attr_name) = match name.strip_prefix("!invert!") {
            Some(rest) => (true, rest),
            None => (false, name.as_str()),
        };

        let prop_path = prim_path
            .append_property(attr_name)
            .map_err(|e| UsdError::Parse(e.to_string()))?;
        let Some(value) = stage
            .field::<SdfValue>(prop_path, FieldKey::Default)
            .map_err(|e| UsdError::Parse(e.to_string()))?
        else {
            continue;
        };

        let mut op_matrix = build_xform_op_matrix(attr_name, &value)?;
        if invert {
            op_matrix = invert_mat4(&op_matrix).ok_or_else(|| {
                UsdError::Parse(format!("failed to invert xformOp '{attr_name}'"))
            })?;
        }
        result = mat4_mul(&result, &op_matrix);
    }

    Ok(Some(result))
}

/// Builds a column-major matrix for a single `xformOp:*` attribute. Mirrors
/// the fork's private `xform_op_matrix` but lives here so it can be called
/// from the `!invert!`-aware composer above.
fn build_xform_op_matrix(op_name: &str, value: &SdfValue) -> Result<[f64; 16], UsdError> {
    // USD namespaces xform ops as `xformOp:base[:suffix]` — e.g.
    // `xformOp:translate:pivot`. The base at index 1 is what we dispatch on.
    let base = op_name.split(':').nth(1).unwrap_or("");
    match base {
        "transform" => match value {
            SdfValue::Matrix4d(m) => Ok(*m),
            other => Err(UsdError::Parse(format!(
                "xformOp:transform must be matrix4d, got {other:?}"
            ))),
        },
        "translate" => {
            let (x, y, z) = read_vec3(value).ok_or_else(|| {
                UsdError::Parse(format!("xformOp:translate must be vec3, got {value:?}"))
            })?;
            Ok(translation_mat4(x, y, z))
        }
        "scale" => {
            let (x, y, z) = read_vec3(value).ok_or_else(|| {
                UsdError::Parse(format!("xformOp:scale must be vec3, got {value:?}"))
            })?;
            Ok(scale_mat4(x, y, z))
        }
        "rotateX" => {
            let a = read_angle(value)
                .ok_or_else(|| UsdError::Parse("xformOp:rotateX must be scalar".into()))?;
            Ok(rotate_x_mat4(a))
        }
        "rotateY" => {
            let a = read_angle(value)
                .ok_or_else(|| UsdError::Parse("xformOp:rotateY must be scalar".into()))?;
            Ok(rotate_y_mat4(a))
        }
        "rotateZ" => {
            let a = read_angle(value)
                .ok_or_else(|| UsdError::Parse("xformOp:rotateZ must be scalar".into()))?;
            Ok(rotate_z_mat4(a))
        }
        "orient" => {
            // USD stores quaternions as `(real, i, j, k)` i.e.
            // `[w, x, y, z]` in array order.
            let (w, x, y, z) = read_quat(value).ok_or_else(|| {
                UsdError::Parse(format!(
                    "xformOp:orient must be a quat (Quatf/Quatd/Quath), got {value:?}"
                ))
            })?;
            Ok(quat_to_mat4(w, x, y, z))
        }
        "rotateXYZ" | "rotateXZY" | "rotateYXZ" | "rotateYZX" | "rotateZXY" | "rotateZYX" => {
            let (rx, ry, rz) = read_vec3(value).ok_or_else(|| {
                UsdError::Parse(format!("Euler xformOp must be vec3, got {value:?}"))
            })?;
            // Axis suffix lists innermost-first (e.g. XYZ means X then Y
            // then Z applied to the point). In column-vector convention
            // we multiply right-to-left, so the first listed axis becomes
            // the rightmost factor.
            let mut m = identity_mat4();
            for axis in base[6..].chars().rev() {
                let r = match axis {
                    'X' => rotate_x_mat4(rx),
                    'Y' => rotate_y_mat4(ry),
                    'Z' => rotate_z_mat4(rz),
                    _ => unreachable!(),
                };
                m = mat4_mul(&m, &r);
            }
            Ok(m)
        }
        other => Err(UsdError::Parse(format!("Unsupported xformOp: {other}"))),
    }
}

fn read_vec3(value: &SdfValue) -> Option<(f64, f64, f64)> {
    match value {
        SdfValue::Vec3d([x, y, z]) => Some((*x, *y, *z)),
        SdfValue::Vec3f([x, y, z]) => Some((*x as f64, *y as f64, *z as f64)),
        SdfValue::Vec3h([x, y, z]) => Some((f64::from(*x), f64::from(*y), f64::from(*z))),
        _ => None,
    }
}

fn read_angle(value: &SdfValue) -> Option<f64> {
    match value {
        SdfValue::Float(f) => Some(*f as f64),
        SdfValue::Double(d) => Some(*d),
        SdfValue::Half(h) => Some(f64::from(*h)),
        _ => None,
    }
}

/// Extracts a quaternion from any of USD's quat value types. USD stores
/// quaternions as `(real, i, j, k)` i.e. `[w, x, y, z]` in array order.
fn read_quat(value: &SdfValue) -> Option<(f64, f64, f64, f64)> {
    match value {
        SdfValue::Quatd([w, x, y, z]) => Some((*w, *x, *y, *z)),
        SdfValue::Quatf([w, x, y, z]) => {
            Some((*w as f64, *x as f64, *y as f64, *z as f64))
        }
        SdfValue::Quath([w, x, y, z]) => Some((
            f64::from(*w),
            f64::from(*x),
            f64::from(*y),
            f64::from(*z),
        )),
        _ => None,
    }
}

/// Builds a column-major rotation matrix from a USD quaternion.
/// Assumes `(w, x, y, z)` element order (USD convention: real part first).
/// Normalizes the quaternion first — authored quaternions from DCC tools
/// are usually unit-length but we guard against slightly denormalized
/// inputs that would otherwise produce a scaled rotation.
fn quat_to_mat4(w: f64, x: f64, y: f64, z: f64) -> [f64; 16] {
    let norm_sq = w * w + x * x + y * y + z * z;
    let (w, x, y, z) = if norm_sq > 1e-20 && (norm_sq - 1.0).abs() > 1e-6 {
        let inv = 1.0 / norm_sq.sqrt();
        (w * inv, x * inv, y * inv, z * inv)
    } else {
        (w, x, y, z)
    };

    let xx = x * x;
    let yy = y * y;
    let zz = z * z;
    let xy = x * y;
    let xz = x * z;
    let yz = y * z;
    let wx = w * x;
    let wy = w * y;
    let wz = w * z;

    // Column-major: m[col*4 + row].
    [
        1.0 - 2.0 * (yy + zz),
        2.0 * (xy + wz),
        2.0 * (xz - wy),
        0.0,
        2.0 * (xy - wz),
        1.0 - 2.0 * (xx + zz),
        2.0 * (yz + wx),
        0.0,
        2.0 * (xz + wy),
        2.0 * (yz - wx),
        1.0 - 2.0 * (xx + yy),
        0.0,
        0.0,
        0.0,
        0.0,
        1.0,
    ]
}

fn translation_mat4(tx: f64, ty: f64, tz: f64) -> [f64; 16] {
    let mut m = identity_mat4();
    m[12] = tx;
    m[13] = ty;
    m[14] = tz;
    m
}

fn scale_mat4(sx: f64, sy: f64, sz: f64) -> [f64; 16] {
    let mut m = [0.0; 16];
    m[0] = sx;
    m[5] = sy;
    m[10] = sz;
    m[15] = 1.0;
    m
}

fn rotate_x_mat4(deg: f64) -> [f64; 16] {
    let r = deg.to_radians();
    let (s, c) = r.sin_cos();
    let mut m = identity_mat4();
    m[5] = c;
    m[6] = s;
    m[9] = -s;
    m[10] = c;
    m
}

fn rotate_y_mat4(deg: f64) -> [f64; 16] {
    let r = deg.to_radians();
    let (s, c) = r.sin_cos();
    let mut m = identity_mat4();
    m[0] = c;
    m[2] = -s;
    m[8] = s;
    m[10] = c;
    m
}

fn rotate_z_mat4(deg: f64) -> [f64; 16] {
    let r = deg.to_radians();
    let (s, c) = r.sin_cos();
    let mut m = identity_mat4();
    m[0] = c;
    m[1] = s;
    m[4] = -s;
    m[5] = c;
    m
}

/// Inverts a column-major 4x4 matrix by cofactor expansion. Returns `None`
/// when the determinant is zero (singular matrix). Good enough for
/// xformOp inverses — USD xforms are almost always affine and well-
/// conditioned in practice, and singular matrices are caller errors we
/// propagate upward rather than mask.
fn invert_mat4(m: &[f64; 16]) -> Option<[f64; 16]> {
    // Standard adjugate/determinant inversion copied out from three.js.
    // Indices assume column-major storage: m[col*4 + row].
    let mut inv = [0.0_f64; 16];
    inv[0] = m[5] * m[10] * m[15] - m[5] * m[11] * m[14] - m[9] * m[6] * m[15]
        + m[9] * m[7] * m[14] + m[13] * m[6] * m[11] - m[13] * m[7] * m[10];
    inv[4] = -m[4] * m[10] * m[15] + m[4] * m[11] * m[14] + m[8] * m[6] * m[15]
        - m[8] * m[7] * m[14] - m[12] * m[6] * m[11] + m[12] * m[7] * m[10];
    inv[8] = m[4] * m[9] * m[15] - m[4] * m[11] * m[13] - m[8] * m[5] * m[15]
        + m[8] * m[7] * m[13] + m[12] * m[5] * m[11] - m[12] * m[7] * m[9];
    inv[12] = -m[4] * m[9] * m[14] + m[4] * m[10] * m[13] + m[8] * m[5] * m[14]
        - m[8] * m[6] * m[13] - m[12] * m[5] * m[10] + m[12] * m[6] * m[9];
    inv[1] = -m[1] * m[10] * m[15] + m[1] * m[11] * m[14] + m[9] * m[2] * m[15]
        - m[9] * m[3] * m[14] - m[13] * m[2] * m[11] + m[13] * m[3] * m[10];
    inv[5] = m[0] * m[10] * m[15] - m[0] * m[11] * m[14] - m[8] * m[2] * m[15]
        + m[8] * m[3] * m[14] + m[12] * m[2] * m[11] - m[12] * m[3] * m[10];
    inv[9] = -m[0] * m[9] * m[15] + m[0] * m[11] * m[13] + m[8] * m[1] * m[15]
        - m[8] * m[3] * m[13] - m[12] * m[1] * m[11] + m[12] * m[3] * m[9];
    inv[13] = m[0] * m[9] * m[14] - m[0] * m[10] * m[13] - m[8] * m[1] * m[14]
        + m[8] * m[2] * m[13] + m[12] * m[1] * m[10] - m[12] * m[2] * m[9];
    inv[2] = m[1] * m[6] * m[15] - m[1] * m[7] * m[14] - m[5] * m[2] * m[15]
        + m[5] * m[3] * m[14] + m[13] * m[2] * m[7] - m[13] * m[3] * m[6];
    inv[6] = -m[0] * m[6] * m[15] + m[0] * m[7] * m[14] + m[4] * m[2] * m[15]
        - m[4] * m[3] * m[14] - m[12] * m[2] * m[7] + m[12] * m[3] * m[6];
    inv[10] = m[0] * m[5] * m[15] - m[0] * m[7] * m[13] - m[4] * m[1] * m[15]
        + m[4] * m[3] * m[13] + m[12] * m[1] * m[7] - m[12] * m[3] * m[5];
    inv[14] = -m[0] * m[5] * m[14] + m[0] * m[6] * m[13] + m[4] * m[1] * m[14]
        - m[4] * m[2] * m[13] - m[12] * m[1] * m[6] + m[12] * m[2] * m[5];
    inv[3] = -m[1] * m[6] * m[11] + m[1] * m[7] * m[10] + m[5] * m[2] * m[11]
        - m[5] * m[3] * m[10] - m[9] * m[2] * m[7] + m[9] * m[3] * m[6];
    inv[7] = m[0] * m[6] * m[11] - m[0] * m[7] * m[10] - m[4] * m[2] * m[11]
        + m[4] * m[3] * m[10] + m[8] * m[2] * m[7] - m[8] * m[3] * m[6];
    inv[11] = -m[0] * m[5] * m[11] + m[0] * m[7] * m[9] + m[4] * m[1] * m[11]
        - m[4] * m[3] * m[9] - m[8] * m[1] * m[7] + m[8] * m[3] * m[5];
    inv[15] = m[0] * m[5] * m[10] - m[0] * m[6] * m[9] - m[4] * m[1] * m[10]
        + m[4] * m[2] * m[9] + m[8] * m[1] * m[6] - m[8] * m[2] * m[5];

    let det = m[0] * inv[0] + m[1] * inv[4] + m[2] * inv[8] + m[3] * inv[12];
    if det.abs() < 1e-20 {
        return None;
    }
    let inv_det = 1.0 / det;
    for x in &mut inv {
        *x *= inv_det;
    }
    Some(inv)
}

fn has_reset_xform_stack(stage: &Stage, prim_path: &SdfPath) -> bool {
    let order_path = match prim_path.append_property("xformOpOrder") {
        Ok(p) => p,
        Err(_) => return false,
    };
    // `xformOpOrder` is authored as a token[] (or, rarely, a string[]). The
    // fork's `Value` enum stores these as `TokenVec` / `StringVec`; no
    // `TryFrom<Value>` for `Vec<String>` exists so we match the raw enum.
    match stage.field::<SdfValue>(order_path, FieldKey::Default) {
        Ok(Some(SdfValue::TokenVec(ops))) | Ok(Some(SdfValue::StringVec(ops))) => {
            ops.iter().any(|op| op == "!resetXformStack!")
        }
        _ => false,
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

/// Multiplies two column-major 4x4 matrices: `a * b`.
fn mat4_mul(a: &[f64; 16], b: &[f64; 16]) -> [f64; 16] {
    let mut out = [0.0; 16];
    for col in 0..4 {
        for row in 0..4 {
            let mut sum = 0.0;
            for k in 0..4 {
                sum += a[k * 4 + row] * b[col * 4 + k];
            }
            out[col * 4 + row] = sum;
        }
    }
    out
}

fn mat4_f64_to_f32(m: &[f64; 16]) -> [f32; 16] {
    let mut out = [0.0_f32; 16];
    for i in 0..16 {
        out[i] = m[i] as f32;
    }
    out
}

/// Triangulates a USD mesh and expands face-varying attributes into the
/// per-vertex layout `glb::build_glb` expects.
///
/// We always emit triangle soup — every face vertex becomes a unique GLTF
/// vertex even if a position is shared with neighbors. This loses the index
/// sharing the USD source had, but keeps the conversion trivial and works
/// uniformly whether normals/UVs are vertex-varying or face-varying. The
/// frontend's `GLTFLoader` is fast enough that this isn't a bottleneck for
/// the asset sizes we currently care about; revisit if Kitchen Set timings
/// regress noticeably.
fn mesh_data_to_input(
    prim_path: &SdfPath,
    world: [f32; 16],
    data: &MeshData,
    orientation: MeshOrientation,
) -> Result<MeshInput, UsdError> {
    let point_count = data.points.len() / 3;
    if data.points.len() % 3 != 0 || point_count == 0 {
        return Err(UsdError::Parse(format!(
            "Mesh '{}' has malformed points (len={})",
            prim_path.as_str(),
            data.points.len()
        )));
    }

    // USD stores faceVertexCounts as signed i32 but counts are
    // conceptually unsigned. A negative value means the file is corrupt
    // or adversarial — casting straight to `usize` would either panic on
    // the debug-mode arithmetic overflow or silently wrap to a massive
    // index in release mode and then index out-of-bounds into
    // `face_vertex_indices`. Reject early so we return a clean parse
    // error instead of crashing the Tauri backend.
    if let Some(bad) = data.face_vertex_counts.iter().find(|c| **c < 0) {
        return Err(UsdError::Parse(format!(
            "Mesh '{}' has negative faceVertexCounts entry ({}); file is malformed",
            prim_path.as_str(),
            bad
        )));
    }
    if let Some(bad) = data.face_vertex_indices.iter().find(|i| **i < 0) {
        return Err(UsdError::Parse(format!(
            "Mesh '{}' has negative faceVertexIndices entry ({}); file is malformed",
            prim_path.as_str(),
            bad
        )));
    }

    let total_face_vertices: usize =
        data.face_vertex_counts.iter().map(|c| *c as usize).sum();
    if total_face_vertices != data.face_vertex_indices.len() {
        return Err(UsdError::Parse(format!(
            "Mesh '{}' faceVertexIndices length {} doesn't match sum of faceVertexCounts ({})",
            prim_path.as_str(),
            data.face_vertex_indices.len(),
            total_face_vertices
        )));
    }

    let face_count = data.face_vertex_counts.len();

    // Determine interpolation by length comparison. USD's authored
    // `interpolation` metadata is the canonical source of truth, but
    // `mesh_of` doesn't surface it, so size matching is what we have.
    // The supported modes are:
    //   - vertex-varying     (stride * point_count)
    //   - face-varying       (stride * sum(faceVertexCounts))
    //   - uniform            (stride * face_count)            — one per face
    //   - constant           (stride)                         — one total
    let normal_kind = classify_attribute(
        data.normals.as_ref().map(Vec::as_slice),
        3,
        point_count,
        total_face_vertices,
        face_count,
    );
    let uv_kind = classify_attribute(
        data.uvs.as_ref().map(Vec::as_slice),
        2,
        point_count,
        total_face_vertices,
        face_count,
    );

    let mut positions: Vec<f32> = Vec::new();
    let mut normals: Vec<f32> = Vec::new();
    let mut uvs: Vec<f32> = Vec::new();
    let mut indices: Vec<u32> = Vec::new();
    let mut next_vertex: u32 = 0;

    let mut fv_cursor: usize = 0;
    for (face_idx, &count_i32) in data.face_vertex_counts.iter().enumerate() {
        let count = count_i32 as usize;
        if count < 3 {
            // Skip degenerate faces (lines / points). USD allows them but
            // they don't contribute renderable triangles.
            fv_cursor += count;
            continue;
        }

        // Fan-triangulate the face: (0, k, k+1) for k = 1..count-1.
        // For `orientation = "leftHanded"` meshes we reverse the triangle
        // winding to (0, k+1, k) so GLTF's right-handed convention agrees
        // with the authored front-face.
        //
        // Known limitation: this fan is only correct for convex faces.
        // Concave n-gons (count > 4) may produce self-intersecting
        // triangles that render incorrectly. Most DCC exports use tri
        // or quad meshes, both handled correctly by the fan. Proper
        // ear-clipping is Phase 5 territory; file a regression if you
        // hit a visibly broken concave preview.
        for k in 1..(count - 1) {
            let corners: [usize; 3] = match orientation {
                MeshOrientation::RightHanded => [0, k, k + 1],
                MeshOrientation::LeftHanded => [0, k + 1, k],
            };
            for &local_corner in &corners {
                let fv_index = fv_cursor + local_corner;
                let point_index = data.face_vertex_indices[fv_index] as usize;
                if point_index >= point_count {
                    return Err(UsdError::Parse(format!(
                        "Mesh '{}' faceVertexIndex {} out of range (point_count={})",
                        prim_path.as_str(),
                        point_index,
                        point_count
                    )));
                }

                positions.push(data.points[point_index * 3]);
                positions.push(data.points[point_index * 3 + 1]);
                positions.push(data.points[point_index * 3 + 2]);

                if let Some(src) = &data.normals {
                    match normal_kind {
                        AttrKind::Vertex => {
                            normals.extend_from_slice(
                                &src[point_index * 3..point_index * 3 + 3],
                            );
                        }
                        AttrKind::FaceVarying => {
                            normals
                                .extend_from_slice(&src[fv_index * 3..fv_index * 3 + 3]);
                        }
                        AttrKind::Uniform => {
                            normals
                                .extend_from_slice(&src[face_idx * 3..face_idx * 3 + 3]);
                        }
                        AttrKind::Constant => {
                            normals.extend_from_slice(&src[0..3]);
                        }
                        AttrKind::None | AttrKind::Unknown => {}
                    }
                }

                if let Some(src) = &data.uvs {
                    match uv_kind {
                        AttrKind::Vertex => {
                            uvs.extend_from_slice(
                                &src[point_index * 2..point_index * 2 + 2],
                            );
                        }
                        AttrKind::FaceVarying => {
                            uvs.extend_from_slice(&src[fv_index * 2..fv_index * 2 + 2]);
                        }
                        AttrKind::Uniform => {
                            uvs.extend_from_slice(&src[face_idx * 2..face_idx * 2 + 2]);
                        }
                        AttrKind::Constant => {
                            uvs.extend_from_slice(&src[0..2]);
                        }
                        AttrKind::None | AttrKind::Unknown => {}
                    }
                }

                indices.push(next_vertex);
                next_vertex += 1;
            }
        }

        fv_cursor += count;
    }

    if positions.is_empty() {
        return Err(UsdError::Parse(format!(
            "Mesh '{}' produced no triangles after triangulation",
            prim_path.as_str()
        )));
    }

    // Generate flat normals if the source had none (or had a length we
    // couldn't classify). Three.js can synthesize them too, but giving the
    // GLB authored normals avoids a noticeable visual flicker on first
    // paint and keeps the GLTF self-contained.
    let normals_out = if matches!(normal_kind, AttrKind::None | AttrKind::Unknown) {
        Some(generate_flat_normals(&positions, &indices))
    } else {
        Some(normals)
    };

    let uvs_out = if matches!(uv_kind, AttrKind::None | AttrKind::Unknown) {
        None
    } else {
        Some(uvs)
    };

    Ok(MeshInput {
        name: prim_path.as_str().to_string(),
        world_matrix: world,
        positions,
        indices,
        normals: normals_out,
        uvs: uvs_out,
    })
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum AttrKind {
    None,
    Vertex,
    FaceVarying,
    Uniform,
    Constant,
    Unknown,
}

/// Classifies an optional flat attribute by matching its length against
/// USD's four valid interpolation modes. `stride` is the number of floats
/// per element (3 for vec3, 2 for vec2).
///
/// Priority when multiple interpretations would fit (e.g. a mesh where
/// face_count happens to equal point_count): vertex > face-varying >
/// uniform > constant. This ordering picks the interpretation that uses
/// the most authored data and matches common USD conventions.
fn classify_attribute(
    src: Option<&[f32]>,
    stride: usize,
    point_count: usize,
    face_vertex_count: usize,
    face_count: usize,
) -> AttrKind {
    let Some(src) = src else {
        return AttrKind::None;
    };
    if src.len() == point_count * stride {
        AttrKind::Vertex
    } else if src.len() == face_vertex_count * stride {
        AttrKind::FaceVarying
    } else if src.len() == face_count * stride {
        AttrKind::Uniform
    } else if src.len() == stride {
        AttrKind::Constant
    } else {
        AttrKind::Unknown
    }
}

/// Generates flat per-triangle normals for a triangle-soup mesh by computing
/// the cross product of each triangle's edges and writing the result back to
/// every vertex of that triangle.
fn generate_flat_normals(positions: &[f32], indices: &[u32]) -> Vec<f32> {
    let mut normals = vec![0.0_f32; positions.len()];
    for tri in indices.chunks_exact(3) {
        let i0 = tri[0] as usize * 3;
        let i1 = tri[1] as usize * 3;
        let i2 = tri[2] as usize * 3;

        let ax = positions[i1] - positions[i0];
        let ay = positions[i1 + 1] - positions[i0 + 1];
        let az = positions[i1 + 2] - positions[i0 + 2];

        let bx = positions[i2] - positions[i0];
        let by = positions[i2 + 1] - positions[i0 + 1];
        let bz = positions[i2 + 2] - positions[i0 + 2];

        let nx = ay * bz - az * by;
        let ny = az * bx - ax * bz;
        let nz = ax * by - ay * bx;

        let len = (nx * nx + ny * ny + nz * nz).sqrt().max(1e-20);
        let nx = nx / len;
        let ny = ny / len;
        let nz = nz / len;

        for &i in tri {
            let off = i as usize * 3;
            normals[off] = nx;
            normals[off + 1] = ny;
            normals[off + 2] = nz;
        }
    }
    normals
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

    #[test]
    fn summarize_tiny_usda() {
        let path = tiny_usda();
        if is_lfs_pointer(&path) {
            eprintln!("SKIP summarize_tiny_usda: tiny.usda is an LFS pointer (checkout without lfs: true)");
            return;
        }
        let backend = OpenusdBackend::new();
        let summary = backend
            .summarize_stage(&path)
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
            eprintln!("SKIP inspect_tiny_usda: tiny.usda is an LFS pointer (checkout without lfs: true)");
            return;
        }
        let backend = OpenusdBackend::new();
        let inspection = backend
            .inspect_stage(&path)
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
    fn collect_issues_tiny_usda_is_clean() {
        let path = tiny_usda();
        if is_lfs_pointer(&path) {
            eprintln!("SKIP collect_issues_tiny_usda_is_clean: tiny.usda is an LFS pointer (checkout without lfs: true)");
            return;
        }
        let backend = OpenusdBackend::new();
        let issues = backend
            .collect_asset_issues(&path)
            .expect("collect issues");
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
            .inspect_stage(&path)
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

    /// Regression test for the P2 Codex finding: a negative entry in
    /// `faceVertexCounts` used to cast to `usize` and either panic
    /// (debug) or wrap and index OOB (release). Now the triangulator
    /// should return a clean parse error instead of crashing.
    #[test]
    fn negative_face_counts_are_rejected() {
        let bad_mesh = openusd::stage::MeshData {
            points: vec![0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0],
            face_vertex_indices: vec![0, 1, 2],
            face_vertex_counts: vec![-1],
            normals: None,
            uvs: None,
        };
        let prim_path = SdfPath::new("/Malicious").unwrap();
        let err = mesh_data_to_input(
            &prim_path,
            [0.0; 16],
            &bad_mesh,
            MeshOrientation::RightHanded,
        )
        .expect_err("negative faceVertexCounts must be rejected");
        let UsdError::Parse(msg) = err else {
            panic!("expected Parse error, got {err:?}");
        };
        assert!(
            msg.contains("negative faceVertexCounts"),
            "unexpected error message: {msg}"
        );
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
            .extract_geometry_glb(&usda)
            .expect("extract_geometry pivot_pair.usda");

        // GLB sanity check, then pull out the first node's matrix and
        // verify it's the identity (modulo floating point rounding). If
        // the pivot inverse were still being dropped, the node matrix
        // would carry a (10, 20, 30) translation.
        assert_eq!(&glb[0..4], b"glTF");

        let json_chunk_len =
            u32::from_le_bytes(glb[12..16].try_into().unwrap()) as usize;
        let json_start = 20;
        let json_end = json_start + json_chunk_len;
        let json_text = std::str::from_utf8(&glb[json_start..json_end])
            .unwrap()
            .trim_end_matches(' ');
        let doc: serde_json::Value = serde_json::from_str(json_text).unwrap();
        let matrix = doc["nodes"][0]["matrix"].as_array().expect("node matrix");
        let values: Vec<f64> = matrix
            .iter()
            .map(|v| v.as_f64().unwrap())
            .collect();
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
            .extract_geometry_glb(&path)
            .expect("extract_geometry tiny_trs.usda");
        assert_eq!(&glb[0..4], b"glTF");

        let json_chunk_len =
            u32::from_le_bytes(glb[12..16].try_into().unwrap()) as usize;
        let json_start = 20;
        let json_end = json_start + json_chunk_len;
        let json_text = std::str::from_utf8(&glb[json_start..json_end])
            .unwrap()
            .trim_end_matches(' ');
        let doc: serde_json::Value = serde_json::from_str(json_text).unwrap();
        let matrix = doc["nodes"][0]["matrix"].as_array().expect("node matrix");
        let m: Vec<f64> = matrix.iter().map(|v| v.as_f64().unwrap()).collect();

        // Column-major layout: m[12..15] is the translation column.
        // Under the correct `T * R` composition, applying M to the local
        // origin (0, 0, 0, 1) must give (10, 0, 0, 1) — the value we
        // authored in xformOp:translate. The old `R * T` code rotated
        // (10, 0, 0) by 90° around Z, which would put translation at
        // roughly (0, 10, 0) instead.
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
        assert!(!needs_glb, "tiny.usda is single-layer USDA — USDLoader handles it");
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
            .extract_geometry_glb(&path)
            .expect("extract_geometry tiny.usda");

        // GLB header check.
        assert_eq!(&glb[0..4], b"glTF");
        let total_length = u32::from_le_bytes(glb[8..12].try_into().unwrap()) as usize;
        assert_eq!(total_length, glb.len());
    }

    // ----- Phase 0 production-asset parity tests --------------------------
    //
    // These tests reproduce the numbers we observed in `experiments/usd-poc`
    // (see docs/usd.md) but through `OpenusdBackend` instead of the
    // raw `openusd` API. They confirm the adapter does not lose information
    // for real-world USD scenes.
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
        let path = PathBuf::from(
            "../samples/private/usd/Kitchen_set/Kitchen_set/Kitchen_set.usd",
        );
        if skip_if_missing(&path, "kitchen_set_full") {
            return;
        }
        let backend = OpenusdBackend::new();
        let started = std::time::Instant::now();
        let glb = backend
            .extract_geometry_glb(&path)
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
        let path = PathBuf::from(
            "../samples/private/usd/Kitchen_set/Kitchen_set/assets/Ball/Ball.usd",
        );
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
            .extract_geometry_glb(&path)
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
            .extract_geometry_glb(&path)
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
        let path = PathBuf::from(
            "../samples/private/usd/Kitchen_set/Kitchen_set/Kitchen_set.usd",
        );
        if skip_if_missing(&path, "kitchen_set") {
            return;
        }
        let backend = OpenusdBackend::new();
        let summary = backend.summarize_stage(&path).expect("summarize kitchen_set");
        // Phase 0 observation: 229 layers, 77 root prims, 2048 traversed prims.
        assert_eq!(summary.layer_count, 229, "kitchen_set layer count");
        assert_eq!(summary.root_prim_count, 77, "kitchen_set root prim count");
    }

    #[test]
    #[ignore = "needs samples/private (Pixar license)"]
    fn inspect_kitchen_set() {
        let path = PathBuf::from(
            "../samples/private/usd/Kitchen_set/Kitchen_set/Kitchen_set.usd",
        );
        if skip_if_missing(&path, "kitchen_set") {
            return;
        }
        let backend = OpenusdBackend::new();
        let inspection = backend.inspect_stage(&path).expect("inspect kitchen_set");
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
            .inspect_stage(&path)
            .expect("instanceable metadata regression: should now parse");
        assert_eq!(inspection.default_prim.as_deref(), Some("Kitchen_set"));
    }

    #[test]
    #[ignore = "needs samples/private (Apple AR Quick Look)"]
    fn inspect_chameleon_usdz() {
        let path = PathBuf::from(
            "../samples/private/usd/chameleon_anim_mtl_variant.usdz",
        );
        if skip_if_missing(&path, "chameleon_usdz") {
            return;
        }
        let backend = OpenusdBackend::new();
        let summary = backend.summarize_stage(&path).expect("summarize chameleon");
        assert_eq!(summary.layer_count, 1, "usdz reports as a single layer");
        assert_eq!(summary.root_prim_count, 1);

        let inspection = backend.inspect_stage(&path).expect("inspect chameleon");
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
        let path =
            PathBuf::from("../samples/private/usd/chameleon_anim_mtl_variant.usdz");
        if skip_if_missing(&path, "chameleon_usdz") {
            return;
        }
        let backend = OpenusdBackend::new();

        let is_binary = backend
            .root_layer_is_binary(&path)
            .expect("root_layer_is_binary chameleon");
        assert!(is_binary, "chameleon usdz has a USDC root layer");

        let glb = backend
            .extract_geometry_glb(&path)
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
            .extract_geometry_glb(&path)
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
            .extract_geometry_glb(&path)
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
                .extract_geometry_glb(&path)
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
        let path = PathBuf::from(
            "../samples/private/usd/glove_baseball_mtl_variant.usdz",
        );
        if skip_if_missing(&path, "glove_usdz") {
            return;
        }
        let backend = OpenusdBackend::new();
        let summary = backend.summarize_stage(&path).expect("summarize glove");
        assert_eq!(summary.layer_count, 1);
        assert_eq!(summary.root_prim_count, 1);

        let inspection = backend.inspect_stage(&path).expect("inspect glove");
        assert_eq!(inspection.default_prim.as_deref(), Some("glove_baseball"));
    }
}
