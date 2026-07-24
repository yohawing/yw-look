//! Stage-level query surface built entirely on upstream (mxpv/openusd)
//! public API: stage metadata (`up_axis` / `meters_per_unit`), mesh /
//! material / skeleton extraction, and composed prim children.
//!
//! This is yw-look's own query surface over `openusd::Stage` /
//! `openusd::StageBuilder`, replacing the fork's pre-0.5 compatibility
//! surface so the rest of the backend stops depending on the fork-only
//! `stage` re-export module and its `StageLoadPolicy` type. Every
//! function here is implemented with `Stage::attribute(..).get()` /
//! `get_metadata()` / `time_samples()`, `Stage::prim(..).type_name()`,
//! `Stage::relationship(..).targets()`, and `Attribute::connections()`
//! — all confirmed-public upstream APIs.
//!
//! USD-NATIVE-01 Phase 3: the composed reference/payload-list reads and
//! the asset-resolution probe no longer reach for the private
//! `Stage::field` escape hatch (nor the fork-only `Stage::asset_resolves`
//! probe) that the deleted `nonpublic_api` module used to wrap. Instead:
//!
//! - [`references_in`] / [`payloads_in`] walk `Prim::prim_stack()` —
//!   upstream's public `(layer identifier, spec path)` list of every site
//!   that contributes a spec to a composed prim, strongest first — and
//!   read the raw `references` / `payload` field off each site's
//!   [`sdf::Layer::prim`] spec via the public [`sdf::Spec::field`]. This
//!   reproduces `Stage::field`'s own "strongest opinion wins" resolution
//!   (see its doc comment in the fork) without calling it: `prim_stack`
//!   is backed by the same composition cache `Stage::field` uses
//!   internally, just exposed as a public accessor.
//! - [`resolve_asset`] rebuilds the fork's `Stage::asset_resolves` /
//!   `LayerGraph::asset_path_resolves` probe from the public
//!   `openusd::ar::{DefaultResolver, Resolver, ResolvedPath}` asset
//!   resolution API plus `Stage::layer_identifiers()` — an unanchored
//!   resolve first (absolute path / cwd-relative), then an anchored
//!   resolve against every loaded layer's identifier (skipping anonymous
//!   layers via `sdf::Layer::is_anonymous_identifier`). `DefaultResolver`
//!   already understands package-relative (`pkg.usdz[entry]`) identifiers,
//!   so USDZ-packaged assets resolve the same way without any bespoke zip
//!   handling here.
//!
//! Deliberately **free functions**, not an extension trait: the fork
//! this crate still depends on for Phase 2a defines inherent methods of
//! the same names directly on `openusd::Stage` (its own pre-0.5
//! compatibility surface), and Rust always prefers an inherent method
//! over a trait method of the same name — a same-named trait method
//! would silently never run. Free functions have no such ambiguity:
//! every call site here explicitly names this module's implementation.
//!
//! Return types are yw-look's own backend-independent
//! [`crate::usd::ir`] structs, so callers no longer need a separate
//! bridging conversion step.

use std::io::Read;

use openusd::ar::{DefaultResolver, ResolvedPath, Resolver as AssetResolver};
use openusd::schemas::geom::PointInstancer;
use openusd::sdf::schema::FieldKey;
use openusd::sdf::{self, Value};
use openusd::usd::{InitialLoadSet, PrimPredicate};
use openusd::usd::{Stage, StageBuilder};

use crate::usd::ir::{MaterialData, MeshData, SkelAnimationData, SkeletonData};
use crate::usd::types::StageLoadPolicy;

/// Payload arc skipped during composition under
/// [`StageLoadPolicy::NoPayloads`]. `prim_path` is the prim that
/// *authored* the payload (matches [`skipped_payloads`]'s docs).
#[derive(Debug, Clone)]
pub(crate) struct SkippedPayload {
    pub asset_path: String,
    pub prim_path: sdf::Path,
}

/// Stage `upAxis` metadata, restricted to the two values USD allows.
#[derive(Debug, Clone, Copy, Eq, PartialEq)]
pub(crate) enum UpAxis {
    Y,
    Z,
}

/// One `GeomSubset` child of a `Mesh` prim: a face-index subset with an
/// optional material binding.
#[derive(Debug, Clone, Default, PartialEq)]
pub(crate) struct GeomSubsetData {
    pub name: String,
    pub indices: Vec<u32>,
    pub material_binding: Option<sdf::Path>,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub(crate) struct PointInstancerData {
    pub prototypes: Vec<sdf::Path>,
    pub proto_indices: Vec<i32>,
    pub positions: Vec<[f32; 3]>,
    pub orientations: Vec<[f32; 4]>,
    pub scales: Vec<[f32; 3]>,
    pub ids: Vec<i64>,
    pub invisible_ids: Vec<i64>,
}

/// Maps the wire-level [`StageLoadPolicy`] onto upstream's
/// `InitialLoadSet`, applied to a `StageBuilder` before `open`.
pub(crate) fn apply_load_policy(builder: StageBuilder, policy: StageLoadPolicy) -> StageBuilder {
    match policy {
        StageLoadPolicy::LoadAll => builder.load(InitialLoadSet::LoadAll),
        StageLoadPolicy::NoPayloads => builder.load(InitialLoadSet::LoadNone),
    }
}

pub(crate) fn up_axis(stage: &Stage) -> Option<UpAxis> {
    let value = stage.stage_metadata("upAxis").ok().flatten()?;
    match value {
        Value::Token(token) if token.as_str() == "Y" => Some(UpAxis::Y),
        Value::Token(token) if token.as_str() == "Z" => Some(UpAxis::Z),
        Value::String(s) if s == "Y" => Some(UpAxis::Y),
        Value::String(s) if s == "Z" => Some(UpAxis::Z),
        _ => None,
    }
}

pub(crate) fn meters_per_unit(stage: &Stage) -> Option<f64> {
    stage
        .stage_metadata("metersPerUnit")
        .ok()
        .flatten()
        .and_then(|v| match v {
            Value::Double(v) => Some(v),
            Value::Float(v) => Some(v as f64),
            _ => None,
        })
}

/// Unresolved layer/sublayer arcs from `Stage::composition_errors()`,
/// plus every authored reference/payload `asset_path` (see
/// [`references_in`] / [`payloads_in`]) that [`resolve_asset`] can't
/// locate. The latter catches broken reference/payload targets *inside*
/// otherwise-composed layers (e.g. `error-ref-missing-usda`,
/// `error-ref-missing-payload-usda`) that the composer's own error list
/// doesn't cover, because the composer only fails to open the arc's
/// *layer* when the layer itself can't be found — a reference to a
/// prim path or asset that a still-openable layer never authored is not
/// a composition error, so it has to be checked here explicitly.
pub(crate) fn unresolved_assets(stage: &Stage) -> Vec<String> {
    let mut unresolved: Vec<String> = stage
        .composition_errors()
        .into_iter()
        .filter_map(|err| match err {
            openusd::pcp::Error::UnresolvedLayer { asset_path, .. }
            | openusd::pcp::Error::UnresolvedSublayer { asset_path, .. } => Some(asset_path),
            _ => None,
        })
        .collect();

    let _ = stage.traverse(PrimPredicate::ALL, |prim_path| {
        for asset_path in references_in(stage, prim_path.clone())
            .into_iter()
            .map(|reference| reference.asset_path)
            .chain(
                payloads_in(stage, prim_path.clone())
                    .into_iter()
                    .map(|payload| payload.asset_path),
            )
        {
            if !asset_path.is_empty()
                && !asset_path.contains("${")
                && !resolve_asset(stage, &asset_path)
                && !unresolved.iter().any(|existing| existing == &asset_path)
            {
                unresolved.push(asset_path);
            }
        }
    });

    unresolved
}

/// Payload arcs authored on a composed prim while the stage was opened
/// under [`StageLoadPolicy::NoPayloads`] (`InitialLoadSet::LoadNone`):
/// with that policy every authored payload is skipped by definition, so
/// every arc [`payloads_in`] finds while traversing the composed prim
/// tree qualifies. Composing this list needs [`payloads_in`] on every
/// composed prim path, same as [`unresolved_assets`].
pub(crate) fn skipped_payloads(stage: &Stage, policy: StageLoadPolicy) -> Vec<SkippedPayload> {
    if policy != StageLoadPolicy::NoPayloads {
        return Vec::new();
    }

    let mut skipped = Vec::new();
    let _ = stage.traverse(PrimPredicate::ALL, |prim_path| {
        for payload in payloads_in(stage, prim_path.clone()) {
            skipped.push(SkippedPayload {
                asset_path: payload.asset_path,
                prim_path: prim_path.clone(),
            });
        }
    });
    skipped
}

pub(crate) fn root_layer_is_binary(stage: &Stage) -> bool {
    let id = stage.root_layer().identifier().to_ascii_lowercase();
    if id.ends_with(".usdc") {
        return true;
    }
    if !id.ends_with(".usd") {
        return false;
    }
    let Ok(mut file) = std::fs::File::open(stage.root_layer().identifier()) else {
        return false;
    };
    let mut magic = [0_u8; 8];
    file.read_exact(&mut magic).is_ok() && magic == *openusd::usdc::MAGIC
}

pub(crate) fn prim_children(stage: &Stage, path: impl Into<sdf::Path>) -> anyhow::Result<Vec<String>> {
    Ok(stage
        .prim(path)
        .children()?
        .into_iter()
        .map(|prim| prim.path().name().unwrap_or_default().to_owned())
        .collect())
}

/// The strongest authored `references` list-op at `path`, read off
/// whichever site in `Prim::prim_stack` authors
/// one — see the module doc for why this reproduces `Stage::field`'s
/// "strongest opinion wins" resolution without calling it. There is no
/// public *composed* reference-list accessor (the composer that would
/// provide one, `pcp::compose_site::compose_references_in`, is private
/// to the prim-index builder), so, like the fork's own pre-0.5
/// compatibility layer, this only exposes the strongest authored field
/// for the arc — not a list-op-folded merge across every contributing
/// layer.
pub(crate) fn references_in(stage: &Stage, path: impl Into<sdf::Path>) -> Vec<sdf::Reference> {
    match read_composed_field(stage, path.into(), FieldKey::References.as_str()) {
        Some(Value::ReferenceListOp(op)) => op.iter().cloned().collect(),
        _ => Vec::new(),
    }
}

/// The strongest authored `payload` field at `path`, same rationale and
/// strongest-authored-site-only limitation as [`references_in`] but for
/// `FieldKey::Payload`.
pub(crate) fn payloads_in(stage: &Stage, path: impl Into<sdf::Path>) -> Vec<sdf::Payload> {
    match read_composed_field(stage, path.into(), FieldKey::Payload.as_str()) {
        Some(Value::Payload(payload)) => vec![payload],
        Some(Value::PayloadListOp(op)) => op.iter().cloned().collect(),
        _ => Vec::new(),
    }
}

/// Reads `key` off the first (strongest) site in `path`'s
/// `Prim::prim_stack` that authors it.
/// `prim_stack` lists every `(layer identifier, spec path)` site
/// contributing a prim spec to the composed prim, strongest first —
/// the same order `Stage::field`'s internal prim-index walk uses — so
/// resolving each site's `sdf::Layer::prim(..)` spec and reading
/// `sdf::Spec::field` in that order reproduces `Stage::field`'s
/// "first opinion found wins" behavior via public API only.
fn read_composed_field(stage: &Stage, path: sdf::Path, key: &str) -> Option<Value> {
    let stack = stage.prim(path).prim_stack().ok()?;
    for (layer_id, local_path) in stack {
        let Some(layer) = stage.layer(&layer_id) else {
            continue;
        };
        let Some(spec) = layer.prim(local_path) else {
            continue;
        };
        if let Ok(Some(value)) = spec.field(key) {
            return Some(value);
        }
    }
    None
}

/// Reimplementation of the fork's `Stage::asset_resolves` /
/// `pcp::LayerGraph::asset_path_resolves` probe using only public
/// `openusd::ar` API: an unanchored resolve first (handles absolute
/// paths and cwd-relative lookups the same way `DefaultResolver` always
/// has), then an anchored resolve against every loaded layer's
/// identifier (`Stage::layer_identifiers()`), skipping anonymous layers
/// since anchoring a relative path against an in-memory layer identifier
/// would produce a bogus path. `DefaultResolver` already understands
/// package-relative (`pkg.usdz[entry]`) identifiers end to end — both as
/// the anchor and as the asset path being resolved — so a stage opened
/// from a `.usdz` resolves its internal references the same way without
/// any bespoke archive handling here.
fn resolve_asset(stage: &Stage, asset_path: &str) -> bool {
    if asset_path.is_empty() {
        return true;
    }

    let resolver = DefaultResolver::new();
    let unanchored = resolver.create_identifier(asset_path, None);
    if resolver.resolve(&unanchored).is_some() {
        return true;
    }

    stage.layer_identifiers().into_iter().any(|layer_id| {
        if sdf::Layer::is_anonymous_identifier(&layer_id) {
            return false;
        }
        let anchor = ResolvedPath::new(std::path::PathBuf::from(&layer_id));
        let identifier = resolver.create_identifier(asset_path, Some(&anchor));
        resolver.resolve(&identifier).is_some()
    })
}

pub(crate) fn mesh_of(stage: &Stage, prim_path: impl Into<sdf::Path>) -> anyhow::Result<Option<MeshData>> {
    let prim_path = prim_path.into();
    if read_type_name(stage, prim_path.clone()).as_deref() != Some("Mesh") {
        return Ok(None);
    }

    let Some(points) = read_vec3_array(stage, &prim_path, "points")? else {
        return Ok(None);
    };
    let face_vertex_indices = read_i32_array(stage, &prim_path, "faceVertexIndices")?.unwrap_or_default();
    let face_vertex_counts = read_i32_array(stage, &prim_path, "faceVertexCounts")?.unwrap_or_default();
    let normals = read_vec3_array(stage, &prim_path, "normals")?;
    let uvs = read_vec2_array(stage, &prim_path, "primvars:st")?;
    let display_color = read_vec3_array(stage, &prim_path, "primvars:displayColor")?;
    let joint_indices = read_u32_array(stage, &prim_path, "primvars:skel:jointIndices")?;
    let joint_weights = read_f32_array(stage, &prim_path, "primvars:skel:jointWeights")?;
    let joints_per_vertex = read_element_size(stage, &prim_path, "primvars:skel:jointIndices")
        .or_else(|| read_element_size(stage, &prim_path, "primvars:skel:jointWeights"))
        .or_else(|| {
            let point_count = points.len() / 3;
            joint_indices.as_ref().and_then(|indices: &Vec<u32>| {
                (point_count > 0 && indices.len() % point_count == 0).then_some(indices.len() / point_count)
            })
        })
        .unwrap_or(0);

    Ok(Some(MeshData {
        points,
        face_vertex_indices,
        face_vertex_counts,
        normals,
        uvs,
        joint_indices,
        joint_weights,
        joints_per_vertex,
        display_color,
    }))
}

pub(crate) fn point_instancer_of(
    stage: &Stage,
    prim_path: impl Into<sdf::Path>,
) -> anyhow::Result<Option<PointInstancerData>> {
    let prim_path = prim_path.into();
    let Some(instancer) = PointInstancer::get(stage, prim_path.clone())? else {
        return Ok(None);
    };

    let prototypes = instancer.prototypes_rel().targets()?;
    let proto_indices = read_i32_array(stage, &prim_path, "protoIndices")?.unwrap_or_default();
    let positions = read_vec3_array(stage, &prim_path, "positions")?
        .map(vec3_chunks)
        .unwrap_or_default();
    let orientations = if let Some(values) =
        read_attr(stage, &prim_path, "orientationsf")?.and_then(flatten_quat_value)
    {
        values
    } else {
        read_attr(stage, &prim_path, "orientations")?
            .and_then(flatten_quat_value)
            .unwrap_or_default()
    };
    let orientations = if orientations.is_empty() {
        vec![[0.0, 0.0, 0.0, 1.0]; proto_indices.len()]
    } else {
        quat_chunks(orientations)
    };
    let scales = read_vec3_array(stage, &prim_path, "scales")?
        .map(vec3_chunks)
        .unwrap_or_else(|| vec![[1.0, 1.0, 1.0]; proto_indices.len()]);
    let ids = read_i64_array(stage, &prim_path, "ids")?
        .unwrap_or_else(|| (0..proto_indices.len() as i64).collect());
    let invisible_ids = read_i64_array(stage, &prim_path, "invisibleIds")?.unwrap_or_default();

    Ok(Some(PointInstancerData {
        prototypes,
        proto_indices,
        positions,
        orientations,
        scales,
        ids,
        invisible_ids,
    }))
}

pub(crate) fn bound_material(stage: &Stage, mesh_path: impl Into<sdf::Path>) -> Option<sdf::Path> {
    let mesh_path = mesh_path.into();
    for rel_name in ["material:binding:preview", "material:binding:full", "material:binding"] {
        if let Some(path) = first_target_in_self_or_ancestors(stage, &mesh_path, rel_name) {
            return Some(path);
        }
    }
    None
}

pub(crate) fn material_of(stage: &Stage, mesh_path: impl Into<sdf::Path>) -> Option<MaterialData> {
    let material_path = bound_material(stage, mesh_path)?;
    if read_type_name(stage, material_path.clone()).as_deref() != Some("Material") {
        return None;
    }

    let shader = find_preview_surface_shader(stage, &material_path)?;
    let diffuse_input = shader.append_property("inputs:diffuseColor").ok()?;
    let texture = follow_texture_connection(stage, &diffuse_input);
    let mut data = MaterialData {
        diffuse_color: read_vec3_input(stage, &shader, "inputs:diffuseColor"),
        metallic: read_float_input(stage, &shader, "inputs:metallic"),
        roughness: read_float_input(stage, &shader, "inputs:roughness"),
        opacity: read_float_input(stage, &shader, "inputs:opacity"),
        emissive_color: read_vec3_input(stage, &shader, "inputs:emissiveColor"),
        diffuse_texture: texture.as_ref().map(|t| t.file.clone()),
        wrap_s: texture.as_ref().and_then(|t| t.wrap_s.clone()),
        wrap_t: texture.and_then(|t| t.wrap_t),
    };

    if data.diffuse_texture.is_some() && data.diffuse_color.is_none() {
        data.diffuse_color = Some([1.0, 1.0, 1.0]);
    }
    (data != MaterialData::default()).then_some(data)
}

pub(crate) fn geom_subsets_of(stage: &Stage, mesh_path: impl Into<sdf::Path>) -> Vec<GeomSubsetData> {
    let mesh_path = mesh_path.into();
    let Ok(children) = prim_children(stage, mesh_path.clone()) else {
        return Vec::new();
    };

    children
        .into_iter()
        .filter_map(|name| {
            let subset_path = sdf::Path::new(&format!("{}/{}", mesh_path.as_str(), name)).ok()?;
            if read_type_name(stage, subset_path.clone()).as_deref() != Some("GeomSubset") {
                return None;
            }
            let element_type = subset_path
                .append_property("elementType")
                .ok()
                .and_then(|path| read_string_attr(stage, path));
            if !matches!(element_type.as_deref(), None | Some("face")) {
                return None;
            }
            let indices = read_i32_array(stage, &subset_path, "indices")
                .ok()
                .flatten()?
                .into_iter()
                .filter_map(|index| u32::try_from(index).ok())
                .collect::<Vec<_>>();
            if indices.is_empty() {
                return None;
            }
            let material_binding = bound_material(stage, subset_path);
            Some(GeomSubsetData {
                name,
                indices,
                material_binding,
            })
        })
        .collect()
}

pub(crate) fn skeleton_of(stage: &Stage, mesh_path: impl Into<sdf::Path>) -> Option<(sdf::Path, SkeletonData)> {
    let skeleton_path = first_target_in_self_or_ancestors(stage, &mesh_path.into(), "skel:skeleton")?;
    if read_type_name(stage, skeleton_path.clone()).as_deref() != Some("Skeleton") {
        return None;
    }
    let joints = read_string_vec_attr(stage, &skeleton_path, "joints")?;
    let bind_transforms = read_mat4_vec_attr(stage, &skeleton_path, "bindTransforms").unwrap_or_default();
    let rest_transforms = read_mat4_vec_attr(stage, &skeleton_path, "restTransforms").unwrap_or_default();
    let parents = joint_parents(&joints);
    Some((
        skeleton_path,
        SkeletonData {
            joints,
            bind_transforms,
            rest_transforms,
            parents,
        },
    ))
}

pub(crate) fn skel_animation_of(stage: &Stage, skeleton_path: impl Into<sdf::Path>) -> Option<SkelAnimationData> {
    let anim_path = first_target_in_self_or_ancestors(stage, &skeleton_path.into(), "skel:animationSource")?;
    if read_type_name(stage, anim_path.clone()).as_deref() != Some("SkelAnimation") {
        return None;
    }
    let joints = read_string_vec_attr(stage, &anim_path, "joints").unwrap_or_default();
    let translations = read_vec3_time_samples(stage, &anim_path, "translations");
    let rotations = read_quat_time_samples(stage, &anim_path, "rotations");
    let scales = read_vec3_time_samples(stage, &anim_path, "scales");
    let mut times: Vec<f64> = translations
        .iter()
        .chain(rotations.iter())
        .chain(scales.iter())
        .map(|(time, _)| *time)
        .collect();
    times.sort_by(f64::total_cmp);
    times.dedup_by(|a, b| (*a - *b).abs() < f64::EPSILON);
    if times.is_empty() {
        return None;
    }
    Some(SkelAnimationData {
        translations: align_samples(&times, translations),
        rotations: align_samples(&times, rotations),
        scales: align_samples(&times, scales),
        times,
        joints,
    })
}

/// Composed default value of `prim_path.name`, read via
/// `Attribute::get::<Value>()` — upstream's public spelling of the
/// fork's `Stage::field(path, FieldKey::Default)`; `Attribute::get`
/// resolves through the same call internally, so behavior is identical.
fn read_attr(stage: &Stage, prim_path: &sdf::Path, name: &str) -> anyhow::Result<Option<Value>> {
    let attr_path = prim_path.append_property(name)?;
    stage.attribute(attr_path).get::<Value>()
}

/// Composed `typeName` of a prim, read via `Prim::type_name()` —
/// upstream's public spelling of `Stage::field(prim_path,
/// FieldKey::TypeName)`; `Prim::type_name` resolves through the same
/// call internally, so behavior is identical.
fn read_type_name(stage: &Stage, prim_path: sdf::Path) -> Option<String> {
    stage.prim(prim_path).type_name().ok().flatten().map(|t| t.as_str().to_owned())
}

/// Composed default value of a property, decoded as a string-ish
/// scalar. Read via `Attribute::get::<Value>()` (see [`read_attr`]);
/// used for token/string/asset-path properties like `info:id` or
/// `elementType` that don't fit the typed helpers below.
fn read_string_attr(stage: &Stage, path: sdf::Path) -> Option<String> {
    let value: Option<Value> = stage.attribute(path).get::<Value>().ok().flatten();
    match value? {
        Value::String(v) => Some(v),
        Value::Token(v) => Some(v.as_str().to_owned()),
        Value::AssetPath(v) => Some(v.to_string()),
        _ => None,
    }
}

fn read_vec3_array(stage: &Stage, prim_path: &sdf::Path, name: &str) -> anyhow::Result<Option<Vec<f32>>> {
    let Some(value) = read_attr(stage, prim_path, name)? else {
        return Ok(None);
    };
    Ok(flatten_vec3_value(value))
}

fn read_vec2_array(stage: &Stage, prim_path: &sdf::Path, name: &str) -> anyhow::Result<Option<Vec<f32>>> {
    let Some(value) = read_attr(stage, prim_path, name)? else {
        return Ok(None);
    };
    Ok(flatten_vec2_value(value))
}

fn read_i32_array(stage: &Stage, prim_path: &sdf::Path, name: &str) -> anyhow::Result<Option<Vec<i32>>> {
    let Some(value) = read_attr(stage, prim_path, name)? else {
        return Ok(None);
    };
    Ok(match value {
        Value::IntVec(v) => Some(v),
        Value::UintVec(v) => Some(v.into_iter().map(|v| v as i32).collect()),
        _ => None,
    })
}

fn read_u32_array(stage: &Stage, prim_path: &sdf::Path, name: &str) -> anyhow::Result<Option<Vec<u32>>> {
    let Some(value) = read_attr(stage, prim_path, name)? else {
        return Ok(None);
    };
    Ok(match value {
        Value::UintVec(v) => Some(v),
        Value::IntVec(v) => Some(v.into_iter().filter_map(|v| u32::try_from(v).ok()).collect()),
        _ => None,
    })
}

fn read_f32_array(stage: &Stage, prim_path: &sdf::Path, name: &str) -> anyhow::Result<Option<Vec<f32>>> {
    let Some(value) = read_attr(stage, prim_path, name)? else {
        return Ok(None);
    };
    Ok(match value {
        Value::FloatVec(v) => Some(v),
        Value::DoubleVec(v) => Some(v.into_iter().map(|v| v as f32).collect()),
        Value::HalfVec(v) => Some(v.into_iter().map(f32::from).collect()),
        _ => None,
    })
}

fn read_i64_array(
    stage: &Stage,
    prim_path: &sdf::Path,
    name: &str,
) -> anyhow::Result<Option<Vec<i64>>> {
    let Some(value) = read_attr(stage, prim_path, name)? else {
        return Ok(None);
    };
    Ok(match value {
        Value::Int64Vec(values) => Some(values),
        Value::IntVec(values) => Some(values.into_iter().map(i64::from).collect()),
        _ => None,
    })
}

fn vec3_chunks(values: Vec<f32>) -> Vec<[f32; 3]> {
    values
        .chunks_exact(3)
        .map(|value| [value[0], value[1], value[2]])
        .collect()
}

fn quat_chunks(values: Vec<f32>) -> Vec<[f32; 4]> {
    values
        .chunks_exact(4)
        .map(|value| [value[0], value[1], value[2], value[3]])
        .collect()
}

/// `elementSize` metadata via `Attribute::get_metadata::<Value>()` —
/// upstream's public spelling of `Stage::field(attr_path,
/// "elementSize")`; `get_metadata` resolves through the same call
/// internally, so behavior is identical.
fn read_element_size(stage: &Stage, prim_path: &sdf::Path, name: &str) -> Option<usize> {
    let attr_path = prim_path.append_property(name).ok()?;
    let value: Option<Value> = stage.attribute(attr_path).get_metadata("elementSize").ok().flatten();
    match value? {
        Value::Int(v) if v > 0 => Some(v as usize),
        Value::Uint(v) if v > 0 => Some(v as usize),
        _ => None,
    }
}

fn flatten_vec3_value(value: Value) -> Option<Vec<f32>> {
    match value {
        Value::Vec3fVec(v) => Some(v.into_iter().flat_map(<[f32; 3]>::from).collect()),
        Value::Vec3dVec(v) => Some(v.into_iter().flat_map(<[f64; 3]>::from).map(|v| v as f32).collect()),
        Value::Vec3hVec(v) => Some(
            v.into_iter()
                .flat_map(<[openusd::gf::f16; 3]>::from)
                .map(f32::from)
                .collect(),
        ),
        Value::FloatVec(v) if v.len() % 3 == 0 => Some(v),
        Value::DoubleVec(v) if v.len() % 3 == 0 => Some(v.into_iter().map(|v| v as f32).collect()),
        _ => None,
    }
}

struct TextureConnection {
    file: String,
    wrap_s: Option<String>,
    wrap_t: Option<String>,
}

fn find_preview_surface_shader(stage: &Stage, material_path: &sdf::Path) -> Option<sdf::Path> {
    for child_name in prim_children(stage, material_path.clone()).ok()? {
        let child = sdf::Path::new(&format!("{}/{}", material_path.as_str(), child_name)).ok()?;
        if read_type_name(stage, child.clone()).as_deref() != Some("Shader") {
            continue;
        }
        let Some(info_id) = child
            .append_property("info:id")
            .ok()
            .and_then(|path| read_string_attr(stage, path))
        else {
            continue;
        };
        if matches!(
            info_id.as_str(),
            "UsdPreviewSurface" | "ND_UsdPreviewSurface_surfaceshader"
        ) {
            return Some(child);
        }
    }
    None
}

fn follow_texture_connection(stage: &Stage, input_path: &sdf::Path) -> Option<TextureConnection> {
    let target = first_attribute_connection(stage, input_path.clone())?;
    let shader_path = target.prim_path();
    if read_type_name(stage, shader_path.clone()).as_deref() != Some("Shader") {
        return None;
    }
    let info_id_path = shader_path.append_property("info:id").ok()?;
    let info_id = read_string_attr(stage, info_id_path)?;
    if !matches!(
        info_id.as_str(),
        "UsdUVTexture" | "ND_image_color3" | "ND_image_color4" | "ND_image_float" | "ND_image_vector3"
    ) {
        return None;
    }

    let file_path = shader_path.append_property("inputs:file").ok()?;
    let file = read_string_attr(stage, file_path)?;
    let wrap_s = shader_path
        .append_property("inputs:wrapS")
        .ok()
        .and_then(|p| read_string_attr(stage, p));
    let wrap_t = shader_path
        .append_property("inputs:wrapT")
        .ok()
        .and_then(|p| read_string_attr(stage, p));
    Some(TextureConnection { file, wrap_s, wrap_t })
}

fn first_target(stage: &Stage, prim_path: &sdf::Path, rel_name: &str) -> Option<sdf::Path> {
    let rel_path = prim_path.append_property(rel_name).ok()?;
    first_relationship_target(stage, rel_path)
}

fn first_target_in_self_or_ancestors(stage: &Stage, prim_path: &sdf::Path, rel_name: &str) -> Option<sdf::Path> {
    let mut path = Some(prim_path.clone());
    while let Some(current) = path {
        if let Some(target) = first_target(stage, &current, rel_name) {
            return Some(target);
        }
        path = parent_path(&current);
    }
    None
}

fn parent_path(path: &sdf::Path) -> Option<sdf::Path> {
    let value = path.as_str();
    let slash = value.rfind('/')?;
    if slash == 0 {
        return None;
    }
    sdf::Path::new(&value[..slash]).ok()
}

fn first_relationship_target(stage: &Stage, path: sdf::Path) -> Option<sdf::Path> {
    stage.relationship(path).targets().ok()?.into_iter().next()
}

fn first_attribute_connection(stage: &Stage, path: sdf::Path) -> Option<sdf::Path> {
    stage.attribute(path).connections().ok()?.into_iter().next()
}

fn read_float_input(stage: &Stage, shader_path: &sdf::Path, input_name: &str) -> Option<f32> {
    let input_path = shader_path.append_property(input_name).ok()?;
    let value: Option<Value> = stage.attribute(input_path).get::<Value>().ok().flatten();
    match value? {
        Value::Float(v) => Some(v),
        Value::Double(v) => Some(v as f32),
        Value::Half(v) => Some(v.to_f32()),
        _ => None,
    }
}

fn read_vec3_input(stage: &Stage, shader_path: &sdf::Path, input_name: &str) -> Option<[f32; 3]> {
    let input_path = shader_path.append_property(input_name).ok()?;
    let value: Option<Value> = stage.attribute(input_path).get::<Value>().ok().flatten();
    vec3_value(value?)
}

fn vec3_value(value: Value) -> Option<[f32; 3]> {
    match value {
        Value::Vec3f(v) => Some(v.into()),
        Value::Vec3d(v) => {
            let v: [f64; 3] = v.into();
            Some([v[0] as f32, v[1] as f32, v[2] as f32])
        }
        Value::Vec3h(v) => {
            let v: [openusd::gf::f16; 3] = v.into();
            Some([v[0].to_f32(), v[1].to_f32(), v[2].to_f32()])
        }
        Value::FloatVec(v) if v.len() == 3 => Some([v[0], v[1], v[2]]),
        Value::DoubleVec(v) if v.len() == 3 => Some([v[0] as f32, v[1] as f32, v[2] as f32]),
        _ => None,
    }
}

fn read_string_vec_attr(stage: &Stage, prim_path: &sdf::Path, name: &str) -> Option<Vec<String>> {
    let attr_path = prim_path.append_property(name).ok()?;
    let value: Option<Value> = stage.attribute(attr_path).get::<Value>().ok().flatten();
    match value? {
        Value::StringVec(v) => Some(v),
        Value::TokenVec(v) => Some(v.into_iter().map(|v| v.as_str().to_owned()).collect()),
        _ => None,
    }
}

fn read_mat4_vec_attr(stage: &Stage, prim_path: &sdf::Path, name: &str) -> Option<Vec<[f32; 16]>> {
    let attr_path = prim_path.append_property(name).ok()?;
    let value: Option<Value> = stage.attribute(attr_path).get::<Value>().ok().flatten();
    match value? {
        Value::Matrix4dVec(v) => Some(v.into_iter().map(|m| mat4_f64_to_f32(m.0)).collect()),
        _ => None,
    }
}

/// USD's row-major, row-vector matrix layout (translation at flat indices
/// 12–14) is element-for-element identical to glTF's column-major,
/// column-vector layout, so the only conversion needed is the f64 → f32
/// cast. Transposing here would move the translation into the projection
/// slots and invert the rotation basis — the "exploded skeleton" bug that
/// broke every rig with non-identity joint transforms.
fn mat4_f64_to_f32(m: [f64; 16]) -> [f32; 16] {
    m.map(|v| v as f32)
}

fn joint_parents(joints: &[String]) -> Vec<Option<usize>> {
    joints
        .iter()
        .map(|joint| {
            joint
                .rsplit_once('/')
                .and_then(|(parent, _)| joints.iter().position(|candidate| candidate == parent))
        })
        .collect()
}

fn read_vec3_time_samples(stage: &Stage, prim_path: &sdf::Path, name: &str) -> Vec<(f64, Vec<f32>)> {
    let Some(samples) = read_time_samples(stage, prim_path, name) else {
        return Vec::new();
    };
    samples
        .into_iter()
        .filter_map(|(time, value)| flatten_vec3_value(value).map(|v| (time, v)))
        .collect()
}

fn read_quat_time_samples(stage: &Stage, prim_path: &sdf::Path, name: &str) -> Vec<(f64, Vec<f32>)> {
    let Some(samples) = read_time_samples(stage, prim_path, name) else {
        return Vec::new();
    };
    samples
        .into_iter()
        .filter_map(|(time, value)| flatten_quat_value(value).map(|v| (time, v)))
        .collect()
}

/// `timeSamples` map via `Attribute::time_samples()` — upstream's
/// public spelling of `Stage::field(attr_path, FieldKey::TimeSamples)`;
/// `Attribute::time_samples` resolves through the same call
/// internally (matching on `Value::TimeSamples`), so behavior is
/// identical.
fn read_time_samples(stage: &Stage, prim_path: &sdf::Path, name: &str) -> Option<sdf::TimeSampleMap> {
    let attr_path = prim_path.append_property(name).ok()?;
    stage.attribute(attr_path).time_samples().ok().flatten()
}

fn flatten_quat_value(value: Value) -> Option<Vec<f32>> {
    match value {
        Value::QuatfVec(v) => Some(v.into_iter().flat_map(|q| [q.x, q.y, q.z, q.w]).collect()),
        Value::QuatdVec(v) => Some(
            v.into_iter()
                .flat_map(|q| [q.x as f32, q.y as f32, q.z as f32, q.w as f32])
                .collect(),
        ),
        Value::QuathVec(v) => Some(
            v.into_iter()
                .flat_map(|q| [q.x.to_f32(), q.y.to_f32(), q.z.to_f32(), q.w.to_f32()])
                .collect(),
        ),
        Value::Vec4fVec(v) => Some(v.into_iter().flat_map(<[f32; 4]>::from).collect()),
        Value::Vec4dVec(v) => Some(v.into_iter().flat_map(<[f64; 4]>::from).map(|v| v as f32).collect()),
        _ => None,
    }
}

fn align_samples(times: &[f64], samples: Vec<(f64, Vec<f32>)>) -> Vec<Vec<f32>> {
    times
        .iter()
        .map(|time| {
            samples
                .iter()
                .find_map(|(sample_time, value)| ((*sample_time - *time).abs() < f64::EPSILON).then(|| value.clone()))
                .unwrap_or_default()
        })
        .collect()
}

fn flatten_vec2_value(value: Value) -> Option<Vec<f32>> {
    match value {
        Value::Vec2fVec(v) => Some(v.into_iter().flat_map(<[f32; 2]>::from).collect()),
        Value::Vec2dVec(v) => Some(v.into_iter().flat_map(<[f64; 2]>::from).map(|v| v as f32).collect()),
        Value::Vec2hVec(v) => Some(
            v.into_iter()
                .flat_map(<[openusd::gf::f16; 2]>::from)
                .map(f32::from)
                .collect(),
        ),
        Value::FloatVec(v) if v.len() % 2 == 0 => Some(v),
        Value::DoubleVec(v) if v.len() % 2 == 0 => Some(v.into_iter().map(|v| v as f32).collect()),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mat4_conversion_preserves_usd_flat_layout() {
        // USD row-major/row-vector flat layout == glTF column-major
        // flat layout, so conversion is a pure f64 -> f32 cast: a
        // translation must stay at flat indices 12-14.
        let usd_translate_z = [
            1.0, 0.0, 0.0, 0.0, //
            0.0, 1.0, 0.0, 0.0, //
            0.0, 0.0, 1.0, 0.0, //
            0.0, 0.0, 0.875, 1.0,
        ];
        assert_eq!(
            mat4_f64_to_f32(usd_translate_z),
            [
                1.0, 0.0, 0.0, 0.0, //
                0.0, 1.0, 0.0, 0.0, //
                0.0, 0.0, 1.0, 0.0, //
                0.0, 0.0, 0.875, 1.0,
            ]
        );
    }

    #[test]
    fn bound_material_inherits_from_parent() -> anyhow::Result<()> {
        let stage = Stage::builder().in_memory("anon.usda")?;
        stage.define_prim("/World")?.set_type_name("Xform")?;
        stage.define_prim("/World/Mesh")?.set_type_name("Mesh")?;
        stage.define_prim("/Mat")?.set_type_name("Material")?;
        stage
            .define_prim("/World")?
            .create_relationship("material:binding")?
            .set_targets([sdf::path("/Mat")?])?;

        assert_eq!(
            bound_material(&stage, sdf::path("/World/Mesh")?)
                .as_ref()
                .map(sdf::Path::as_str),
            Some("/Mat")
        );
        Ok(())
    }

    #[test]
    fn preview_surface_search_skips_shader_without_info_id() -> anyhow::Result<()> {
        let stage = Stage::builder().in_memory("anon.usda")?;
        stage.define_prim("/Mat")?.set_type_name("Material")?;
        stage.define_prim("/Mat/Utility")?.set_type_name("Shader")?;
        stage.define_prim("/Mat/Surface")?.set_type_name("Shader")?;
        stage
            .define_prim("/Mat/Surface")?
            .create_attribute("info:id", "token")?
            .set(sdf::Value::token("UsdPreviewSurface"))?;

        assert_eq!(
            find_preview_surface_shader(&stage, &sdf::path("/Mat")?)
                .as_ref()
                .map(sdf::Path::as_str),
            Some("/Mat/Surface")
        );
        Ok(())
    }

    #[test]
    fn reads_point_instancer_arrays_and_visibility() -> anyhow::Result<()> {
        let stage = Stage::builder().in_memory("anon.usda")?;
        stage
            .define_prim("/World/Prototype")?
            .set_type_name("Mesh")?;
        let instancer = PointInstancer::define(&stage, "/World/Instances")?;
        instancer
            .create_prototypes_rel()?
            .set_targets([sdf::path("/World/Prototype")?])?;
        instancer
            .create_proto_indices_attr()?
            .set(Value::IntVec(vec![0, 0]))?;
        instancer
            .create_positions_attr()?
            .set(Value::Vec3fVec(vec![
                [1.0, 2.0, 3.0].into(),
                [4.0, 5.0, 6.0].into(),
            ]))?;
        instancer
            .create_ids_attr()?
            .set(Value::Int64Vec(vec![10, 20]))?;
        instancer
            .create_invisible_ids_attr()?
            .set(Value::Int64Vec(vec![20]))?;

        let data = point_instancer_of(&stage, sdf::path("/World/Instances")?)?
            .expect("PointInstancer data");

        assert_eq!(data.prototypes, vec![sdf::path("/World/Prototype")?]);
        assert_eq!(data.proto_indices, vec![0, 0]);
        assert_eq!(data.positions, vec![[1.0, 2.0, 3.0], [4.0, 5.0, 6.0]]);
        assert_eq!(data.orientations, vec![[0.0, 0.0, 0.0, 1.0]; 2]);
        assert_eq!(data.scales, vec![[1.0, 1.0, 1.0]; 2]);
        assert_eq!(data.ids, vec![10, 20]);
        assert_eq!(data.invisible_ids, vec![20]);
        Ok(())
    }

    #[test]
    #[ignore = "USDC-INTFLOAT-KNOWN-01: upstream usdc reader mis-decodes integer-compressed float arrays; fix staged in fix/usdc-integer-compressed-floats"]
    fn reads_integer_compressed_float_weights_from_usdc_fixture() -> anyhow::Result<()> {
        // This is an actual OpenUSD-usdcat binary fixture, not a USDA
        // round-trip: its `float[]` value uses the USDC `i` compression code.
        let stage = Stage::open("../tests/fixtures/models/integer-compressed-float-weights.usdc")?;
        let weights = read_f32_array(&stage, &sdf::path("/IntegerCompressedFloats")?, "weights")?;

        assert_eq!(
            weights,
            Some(vec![
                1.0, 0.0, 1.0, 0.0, 0.0, 1.0, 0.0, 1.0, 1.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 1.0,
            ])
        );
        Ok(())
    }
}
