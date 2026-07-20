use openusd::sdf::schema::FieldKey;
use openusd::sdf::{Path as SdfPath, Value as SdfValue};
use openusd::Stage;

use crate::usd::skel::DenseBlendShape;

use super::stage_fields::{read_token_or_string_field, token_vec_to_strings};

/// Phase 6d: resolve every `UsdSkelBlendShape` target bound to a
/// mesh prim into a dense per-vertex offset array. Returns `Vec::new()`
/// when the mesh has no `skel:blendShapeTargets` relationship, no
/// resolvable targets, or any per-target authored data is malformed.
///
/// The fork's `Stage::mesh_of` does not surface blend shapes (there
/// is no `MeshData::blend_shapes` field), so yw-look walks the stage
/// directly via the public schema API -- `prim_children`, `field`, and
/// `FieldKey::TargetPaths` for the relationship, `FieldKey::Default`
/// for the BlendShape prim's attributes. When the fork eventually
/// grows a blend-shape aware MeshData variant, this helper is the
/// place to replace.
///
/// **Scope (Phase 6d initial cut)**: positions only. `normalOffsets`
/// are read by the spec but intentionally ignored -- the renderer
/// re-derives shading normals from the deformed positions, which is
/// visually a bit noisier but keeps the initial implementation
/// small. `inbetweens` (auxiliary shapes at fractional weights) are
/// out of scope; only the primary shape is resolved.
pub(crate) fn resolve_blend_shapes(
    stage: &Stage,
    mesh_path: &SdfPath,
    point_count: usize,
) -> Vec<DenseBlendShape> {
    // Authored targets live on `skel:blendShapeTargets` as a USD
    // relationship, which the fork exposes via
    // `FieldKey::TargetPaths`. USDA parse example:
    //
    //     rel skel:blendShapeTargets = [</Mesh/Shapes/Smile>]
    let targets_path = match mesh_path.append_property("skel:blendShapeTargets") {
        Ok(p) => p,
        Err(_) => return Vec::new(),
    };
    let targets_value: Option<SdfValue> = stage
        .field(targets_path, FieldKey::TargetPaths)
        .ok()
        .flatten();
    let list_op = match targets_value {
        Some(SdfValue::PathListOp(op)) => op,
        _ => return Vec::new(),
    };

    // Read `skel:blendShapes` token array (if authored) so we can
    // name each channel symmetrically with how UsdSkelAnimation will
    // look them up later. When unauthored, fall back to the target
    // prim's own name.
    let skel_blend_shapes = read_blend_shape_names(stage, mesh_path);

    let mut out: Vec<DenseBlendShape> = Vec::new();
    for (i, target) in list_op.iter().enumerate() {
        let target_path = target.clone();
        let Some(dense) = read_dense_blend_shape(stage, &target_path, point_count) else {
            continue;
        };
        let name = skel_blend_shapes
            .get(i)
            .cloned()
            .or_else(|| target_path.name().map(|s| s.to_string()))
            .unwrap_or_else(|| format!("blend_shape_{i}"));
        out.push(DenseBlendShape {
            name,
            offsets: dense,
        });
    }
    out
}

/// Read the `uniform token[] skel:blendShapes` primvar / attribute on
/// the mesh. Returns an empty Vec when unauthored; the authored order
/// is the channel order and must parallel `skel:blendShapeTargets`.
fn read_blend_shape_names(stage: &Stage, mesh_path: &SdfPath) -> Vec<String> {
    let prop_path = match mesh_path.append_property("skel:blendShapes") {
        Ok(p) => p,
        Err(_) => return Vec::new(),
    };
    match stage
        .field::<SdfValue>(prop_path, FieldKey::Default)
        .ok()
        .flatten()
    {
        Some(SdfValue::TokenVec(names)) => token_vec_to_strings(names),
        Some(SdfValue::StringVec(names)) => names,
        _ => Vec::new(),
    }
}

/// Resolve a single `UsdSkelBlendShape` prim to a dense per-vertex
/// offset array. Returns `None` when the prim has no usable authored
/// data (missing offsets, malformed pointIndices, offsets count
/// mismatch).
fn read_dense_blend_shape(
    stage: &Stage,
    target_path: &SdfPath,
    point_count: usize,
) -> Option<Vec<f32>> {
    // Confirm the target is actually a BlendShape prim. Mis-authored
    // relationships pointing at random prims are surprisingly common
    // in production exports, so a quiet skip here is better than
    // propagating the failure up.
    let type_name = read_token_or_string_field(stage, target_path.clone(), FieldKey::TypeName);
    if type_name.as_deref() != Some("BlendShape") {
        return None;
    }

    // `offsets` is always authored as `vector3f[]`; `pointIndices` is
    // optional -- when absent, `offsets` must match the full point
    // count (dense authoring).
    let offsets_path = target_path.append_property("offsets").ok()?;
    let offsets_value: SdfValue = stage
        .field(offsets_path, FieldKey::Default)
        .ok()
        .flatten()?;
    let offsets_vec: Vec<[f32; 3]> = match offsets_value {
        SdfValue::Vec3fVec(v) => v.into_iter().map(Into::into).collect(),
        _ => return None,
    };

    let indices_path = target_path.append_property("pointIndices").ok()?;
    let indices_value: Option<SdfValue> =
        stage.field(indices_path, FieldKey::Default).ok().flatten();

    let mut dense = vec![0.0f32; point_count * 3];

    match indices_value {
        Some(SdfValue::IntVec(point_indices)) => {
            // Sparse: `offsets[i]` applies to `pointIndices[i]`.
            if point_indices.len() != offsets_vec.len() {
                return None;
            }
            for (idx, off) in point_indices.iter().zip(offsets_vec.iter()) {
                let pi = *idx as usize;
                if pi >= point_count {
                    // Silently clamp: an authored pointIndex outside
                    // the mesh's point range is authoring garbage.
                    // Dropping it keeps the mesh renderable.
                    continue;
                }
                dense[pi * 3] = off[0];
                dense[pi * 3 + 1] = off[1];
                dense[pi * 3 + 2] = off[2];
            }
        }
        _ => {
            // Dense: `offsets.len()` must equal `point_count`.
            if offsets_vec.len() != point_count {
                return None;
            }
            for (pi, off) in offsets_vec.iter().enumerate() {
                dense[pi * 3] = off[0];
                dense[pi * 3 + 1] = off[1];
                dense[pi * 3 + 2] = off[2];
            }
        }
    }

    Some(dense)
}
